// Port of org.grobid.core.data.table.LinePart.
// Upstream: grobid-core/src/main/java/org/grobid/core/data/table/LinePart.java

import type { LayoutToken } from "../../layout/layout-token.js";

export class LinePart {
  static readonly GROBID_TOKEN_DEFAULT_DOUBLE = -1.0;

  // Upstream uses ArrayList<>; mirror with a TS array.
  private contentTokens: LayoutToken[] = [];

  // Package-private mutable fields in Java; preserved as public-by-default
  // because subclasses (Line, Row, Cell) mutate them directly.
  top: number = LinePart.GROBID_TOKEN_DEFAULT_DOUBLE;
  bottom: number = LinePart.GROBID_TOKEN_DEFAULT_DOUBLE;
  left: number = LinePart.GROBID_TOKEN_DEFAULT_DOUBLE;
  right: number = LinePart.GROBID_TOKEN_DEFAULT_DOUBLE;

  add(contentToken: LayoutToken): void {
    this.contentTokens.push(contentToken);
    this.computeTopFromToken(contentToken);
    this.computeBottomFromToken(contentToken);
    this.computeLeftFromToken(contentToken);
    this.computeRightFromToken(contentToken);
  }

  // Renamed from upstream `setTop` to avoid colliding with Cell.setLeft /
  // Cell.setRight which take a `double` rather than a LayoutToken. Java's
  // overload resolution does not translate cleanly to TS's structural
  // method types under `noImplicitOverride`.
  private computeTopFromToken(contentToken: LayoutToken): void {
    const tokenY = contentToken.getY();
    if (tokenY === LinePart.GROBID_TOKEN_DEFAULT_DOUBLE) return;

    if (this.top === LinePart.GROBID_TOKEN_DEFAULT_DOUBLE) {
      this.top = tokenY;
      return;
    }

    if (tokenY < this.top) {
      this.top = tokenY;
    }
  }

  private computeBottomFromToken(contentToken: LayoutToken): void {
    const tokenY = contentToken.getY();
    const tokenHeight = contentToken.getHeight();

    if (tokenY === LinePart.GROBID_TOKEN_DEFAULT_DOUBLE || tokenHeight === LinePart.GROBID_TOKEN_DEFAULT_DOUBLE) return;

    const tokenBottom = tokenY + tokenHeight; // Java: Double.sum(tokenY, tokenHeight)

    if (this.bottom === LinePart.GROBID_TOKEN_DEFAULT_DOUBLE) {
      this.bottom = tokenBottom;
      return;
    }

    if (tokenBottom > this.bottom) {
      this.bottom = tokenBottom;
    }
  }

  private computeLeftFromToken(contentToken: LayoutToken): void {
    const tokenX = contentToken.getX();
    if (tokenX === LinePart.GROBID_TOKEN_DEFAULT_DOUBLE) return;

    if (this.left === LinePart.GROBID_TOKEN_DEFAULT_DOUBLE) {
      this.left = tokenX;
      return;
    }

    if (tokenX < this.left) {
      this.left = tokenX;
    }
  }

  private computeRightFromToken(contentToken: LayoutToken): void {
    const tokenX = contentToken.getX();
    const tokenWidth = contentToken.getWidth();

    if (tokenX === LinePart.GROBID_TOKEN_DEFAULT_DOUBLE || tokenWidth === LinePart.GROBID_TOKEN_DEFAULT_DOUBLE) return;

    const tokenRight = tokenX + tokenWidth; // Java: Double.sum(tokenX, tokenWidth)

    if (this.right === LinePart.GROBID_TOKEN_DEFAULT_DOUBLE) {
      this.right = tokenRight;
      return;
    }

    if (tokenRight > this.right) {
      this.right = tokenRight;
    }
  }

  getTop(): number {
    return this.top;
  }

  getBottom(): number {
    return this.bottom;
  }

  getLeft(): number {
    return this.left;
  }

  getRight(): number {
    return this.right;
  }

  getText(): string {
    let s = "";
    for (const token of this.contentTokens) {
      s += token.getText() ?? "";
    }
    return s;
  }

  isEmpty(): boolean {
    return this.contentTokens.length === 0;
  }
}
