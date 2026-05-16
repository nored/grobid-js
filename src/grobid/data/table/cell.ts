// Port of org.grobid.core.data.table.Cell.
// Upstream: grobid-core/src/main/java/org/grobid/core/data/table/Cell.java

import { Line } from "./line.js";
import type { LinePart } from "./line-part.js";

export class Cell extends Line {
  private positionRow = -1;
  private positionColumn = -1;
  private colspan = 1;
  private merged = false;

  // Same-signature method as Line.linePartInBorders, but with a
  // horizontal (left/right) overlap rather than vertical (top/bottom).
  override linePartInBorders(linePart: LinePart): boolean {
    if (this.getContent() === null || (this.getContent()!.length === 0)) {
      // Java upstream calls `this.getContent().isEmpty()`. `getContent()`
      // on Line returns null when there is no content; calling .isEmpty()
      // would NPE. We mirror that semantics here (well-formed callers
      // never trigger this branch).
      return true;
    }

    if (this.getLeft() > linePart.getRight() || this.getRight() < linePart.getLeft()) return false;

    return true;
  }

  getColspan(): number {
    return this.colspan;
  }

  setColspan(colspan: number): void {
    this.colspan = colspan;
  }

  getPositionRow(): number {
    return this.positionRow;
  }

  setPositionRow(positionRow: number): void {
    this.positionRow = positionRow;
  }

  getPositionColumn(): number {
    return this.positionColumn;
  }

  setPositionColumn(positionColumn: number): void {
    this.positionColumn = positionColumn;
  }

  setRight(rightpos: number): void {
    this.right = rightpos;
  }

  setLeft(leftpos: number): void {
    this.left = leftpos;
  }

  setMerged(merged: boolean): void {
    this.merged = merged;
  }

  override isEmpty(): boolean {
    // Java Cell inherits Line.isEmpty(); preserve that behaviour explicitly.
    return super.isEmpty();
  }

  isMerged(): boolean {
    return this.merged;
  }
}
