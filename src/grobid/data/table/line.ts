// Port of org.grobid.core.data.table.Line.
// Upstream: grobid-core/src/main/java/org/grobid/core/data/table/Line.java

import type { LayoutToken } from "../../layout/layout-token.js";
import { LinePart } from "./line-part.js";

export class Line extends LinePart {
  private contentParts: LinePart[] = [];

  // Java has `add(LinePart contentPart)` here, plus inherited
  // `add(LayoutToken contentToken)` from LinePart. The two overloads
  // dispatch on argument type. TS treats overrides strictly, so we keep
  // the inherited token-add unchanged and expose a separate Line-specific
  // entry point `addPart`, plus a unified `add` that dispatches.
  addPart(contentPart: LinePart): void {
    this.contentParts.push(contentPart);
    this.setTopFromPart(contentPart);
    this.setBottomFromPart(contentPart);
    this.setLeftFromPart(contentPart);
    this.setRightFromPart(contentPart);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override add(arg: any): void {
    if (arg instanceof LinePart) {
      this.addPart(arg);
    } else {
      super.add(arg as LayoutToken);
    }
  }

  private setTopFromPart(contentPart: LinePart): void {
    const partTop = contentPart.getTop();
    if (this.top === LinePart.GROBID_TOKEN_DEFAULT_DOUBLE || this.top > partTop) {
      this.top = partTop;
    }
  }

  private setBottomFromPart(contentPart: LinePart): void {
    const partBottom = contentPart.getBottom();
    if (this.bottom === LinePart.GROBID_TOKEN_DEFAULT_DOUBLE || this.bottom < partBottom) {
      this.bottom = partBottom;
    }
  }

  private setLeftFromPart(contentPart: LinePart): void {
    const partLeft = contentPart.getLeft();
    if (this.left === LinePart.GROBID_TOKEN_DEFAULT_DOUBLE || this.left > partLeft) {
      this.left = partLeft;
    }
  }

  private setRightFromPart(contentPart: LinePart): void {
    const partRight = contentPart.getRight();
    if (this.right === LinePart.GROBID_TOKEN_DEFAULT_DOUBLE || this.right < partRight) {
      this.right = partRight;
    }
  }

  getContent(): LinePart[] | null {
    if (this.contentParts.length > 0) return this.contentParts;
    return null;
  }

  override isEmpty(): boolean {
    return this.contentParts.length === 0;
  }

  linePartInBorders(linePart: LinePart): boolean {
    if (this.contentParts.length === 0) return true;

    // token is fully above the line or below, it doesn't overlap
    if (this.getTop() > linePart.getBottom() || this.getBottom() < linePart.getTop()) return false;

    return true;
  }

  override getText(): string {
    let s = "";
    for (const linePart of this.contentParts) {
      s += linePart.getText();
    }
    return s;
  }

  static extractLineParts(contentTokens: LayoutToken[]): LinePart[] {
    const lineParts: LinePart[] = [];
    let currentLinePart: LinePart | null = null;
    for (let i = 0; i < contentTokens.length; i++) {
      const contentToken = contentTokens[i]!;
      if (i === 0) {
        currentLinePart = new LinePart();
        lineParts.push(currentLinePart);
      }

      if (contentToken.getText() !== "\n") {
        currentLinePart!.add(contentToken);
      }

      if (contentToken.getText() === "\n") {
        const newLinePart = new LinePart();
        lineParts.push(newLinePart);
        currentLinePart = newLinePart;
      }
    }
    return lineParts;
  }

  /*
   * Algorithm for extracting lines.
   * See algorithm 1: Burcu Yildiz, Katharina Kaiser, Silvia Miksch. pdf2table: A Method to Extract Table Information
   * from PDF Files.
   */
  static extractLines(lineParts: LinePart[]): Line[] {
    const lines: Line[] = [];
    let currentLine: Line | null = null;
    let i = lineParts.length - 1;
    while (lineParts.length !== 0 && i >= 0) {
      const linePart = lineParts[i]!;
      if (linePart.getText().length === 0) {
        lineParts.splice(i, 1);
        i--;
        continue;
      }

      if (currentLine == null) {
        currentLine = new Line();
        lines.push(currentLine);
        currentLine.addPart(linePart);
        lineParts.splice(i, 1);
        i--;
        continue;
      }

      if (currentLine.linePartInBorders(linePart)) {
        currentLine.addPart(linePart);
        lineParts.splice(i, 1);
        i = lineParts.length - 1; // return to the first item and recheck borders
        continue;
      }

      if (i === 0) {
        currentLine = null;
        i = lineParts.length - 1;
      } else {
        i--;
      }
    }

    lines.sort((a, b) => a.getTop() - b.getTop()); // sorting by top position
    return lines;
  }
}
