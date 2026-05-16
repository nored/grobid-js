// Port of org.grobid.core.data.table.Row.
// Upstream: grobid-core/src/main/java/org/grobid/core/data/table/Row.java

import type { LayoutToken } from "../../layout/layout-token.js";
import { Cell } from "./cell.js";
import type { Line } from "./line.js";
import { LinePart } from "./line-part.js";

export class Row extends LinePart {
  private cells: Cell[] = [];

  // Java has `add(Cell)` here, plus inherited `add(LayoutToken)`.
  // Dispatch on type.
  addCell(cell: Cell): void {
    this.cells.push(cell);
    this.setTopFromCell(cell);
    this.setBottomFromCell(cell);
    this.setLeftFromCell(cell);
    this.setRightFromCell(cell);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override add(arg: any): void {
    if (arg instanceof Cell) {
      this.addCell(arg);
    } else {
      super.add(arg as LayoutToken);
    }
  }

  private setTopFromCell(cell: Cell): void {
    const cellTop = cell.getTop();
    if (this.top === LinePart.GROBID_TOKEN_DEFAULT_DOUBLE || this.top > cellTop) {
      this.top = cellTop;
    }
  }

  private setBottomFromCell(cell: Cell): void {
    const cellBottom = cell.getBottom();
    if (this.bottom === LinePart.GROBID_TOKEN_DEFAULT_DOUBLE || this.bottom < cellBottom) {
      this.bottom = cellBottom;
    }
  }

  private setLeftFromCell(cell: Cell): void {
    const cellLeft = cell.getLeft();
    if (this.left === LinePart.GROBID_TOKEN_DEFAULT_DOUBLE || this.left > cellLeft) {
      this.left = cellLeft;
    }
  }

  private setRightFromCell(cell: Cell): void {
    const cellRight = cell.getRight();
    if (this.right === LinePart.GROBID_TOKEN_DEFAULT_DOUBLE || this.right < cellRight) {
      this.right = cellRight;
    }
  }

  getContent(): Cell[] {
    return this.cells;
  }

  override isEmpty(): boolean {
    return this.getContent().length === 0;
  }

  /**
   * @param lines Lines, detected by the algorithm, see Line::extractLines
   * @return rows containing cells; doesn't include empty cells
   */
  static extractRows(lines: Line[]): Row[] {
    const rows: Row[] = [];
    for (const line of lines) {
      if (line.getText().length === 0) continue;
      const lineContent = line.getContent();
      if (lineContent == null) continue;
      const row = new Row();
      let currentCell: Cell | null = null;
      let i = lineContent.length - 1;
      while (lineContent.length !== 0 && i >= 0) {
        const linePart = lineContent[i]!;
        if (currentCell == null) {
          currentCell = new Cell();
          row.addCell(currentCell);
          currentCell.add(linePart);
          lineContent.splice(i, 1);
          i--;
          continue;
        }

        if (currentCell.linePartInBorders(linePart)) {
          currentCell.add(linePart);
          lineContent.splice(i, 1);
          i = lineContent.length - 1; // return to the first item and recheck borders
          continue;
        }

        if (i === 0) {
          currentCell = null;
          i = lineContent.length - 1;
        } else {
          i--;
        }
      }
      row.getContent().sort((a, b) => a.getLeft() - b.getLeft());
      rows.push(row);
    }
    return rows;
  }

  /**
   * @param rows extracted rows
   * @param columnCount the maximum number of columns in the table
   * Identifies and inserts empty cells into the table based on the left and right margins of the content inside columns.
   */
  static insertEmptyCells(rows: Row[], columnCount: number): void {
    let columnNumber = 0;
    while (columnNumber < columnCount) {
      let currentLeftMost = LinePart.GROBID_TOKEN_DEFAULT_DOUBLE; // Cell.GROBID_TOKEN_DEFAULT_DOUBLE
      let nextColumnLeftMost = LinePart.GROBID_TOKEN_DEFAULT_DOUBLE;

      for (const row of rows) {
        const cells = row.getContent();
        if (columnNumber > cells.length - 1) continue;
        const cell = cells[columnNumber]!;
        if (currentLeftMost === LinePart.GROBID_TOKEN_DEFAULT_DOUBLE || currentLeftMost > cell.getLeft()) {
          currentLeftMost = cell.getLeft();
        }

        if (columnNumber + 1 < cells.length) {
          const nextColumnCell = cells[columnNumber + 1]!;
          if (nextColumnLeftMost === LinePart.GROBID_TOKEN_DEFAULT_DOUBLE || nextColumnLeftMost > nextColumnCell.getLeft()) {
            nextColumnLeftMost = nextColumnCell.getLeft();
          }
        }
      }

      let currentRightMost = LinePart.GROBID_TOKEN_DEFAULT_DOUBLE;
      for (const row of rows) {
        const cells = row.getContent();
        if (columnNumber > cells.length - 1) continue;
        const cell = cells[columnNumber]!;
        if (nextColumnLeftMost !== LinePart.GROBID_TOKEN_DEFAULT_DOUBLE) {
          if (cell.getRight() < nextColumnLeftMost && currentRightMost < cell.getRight()) {
            currentRightMost = cell.getRight();
          }
        }
      }

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]!;
        const cells = row.getContent();
        if (columnNumber > cells.length - 1) {
          // insert empty cell for premature ended rows
          const newCell = new Cell();
          newCell.setLeft(currentLeftMost);
          newCell.setRight(currentRightMost);
          newCell.setPositionRow(i);
          newCell.setPositionColumn(columnNumber);
          row.addCell(newCell);
          continue;
        }
        const cell = cells[columnNumber]!;
        if (cell.getRight() <= currentRightMost || currentRightMost === LinePart.GROBID_TOKEN_DEFAULT_DOUBLE) {
          cell.setPositionRow(i);
          cell.setPositionColumn(columnNumber);
        } else if (cell.getLeft() > currentRightMost) {
          // empty cell
          const newCell = new Cell();
          newCell.setRight(cell.getRight());
          newCell.setLeft(currentLeftMost);
          newCell.setPositionRow(i);
          newCell.setPositionColumn(columnNumber);
          row.getContent().splice(columnNumber, 0, newCell);
        } else {
          const newCell = new Cell();
          newCell.setRight(cell.getRight());
          newCell.setLeft(nextColumnLeftMost);
          newCell.setPositionRow(i);
          newCell.setPositionColumn(columnNumber + 1);
          newCell.setMerged(true);
          row.getContent().splice(columnNumber + 1, 0, newCell);

          // current cell spans on several columns
          let z = columnNumber;
          while (z >= 0) {
            const colspanCell = cells[z]!;
            // find the cell that spans on several rows, it's the first non-empty cell.
            if (!colspanCell.isEmpty()) {
              colspanCell.setColspan(colspanCell.getColspan() + 1);
              if (colspanCell.getPositionRow() === -1) {
                colspanCell.setPositionRow(z);
              }
              if (colspanCell.getPositionColumn() === -1) {
                colspanCell.setPositionColumn(columnNumber);
              }
              break;
            }
            z--;
          }
        }
      }

      columnNumber++;
    }
  }

  static columnCount(rows: Row[]): number {
    let columnCount = 0;
    for (const row of rows) {
      const cellNumber = row.getContent().length;
      if (cellNumber > columnCount) {
        columnCount = cellNumber;
      }
    }
    return columnCount;
  }

  static mergeMulticolumnCells(rows: Row[]): void {
    for (const row of rows) {
      const cells = row.getContent();
      for (let i = cells.length - 1; i >= 0; i--) {
        const cell = cells[i]!;
        if (cell.isMerged()) {
          row.getContent().splice(i, 1);
        }
      }
    }
  }
}
