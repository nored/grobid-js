// Port of org.grobid.core.layout.BoundingBox.
// Upstream: grobid-core/src/main/java/org/grobid/core/layout/BoundingBox.java

import { getLogger } from "../utilities/logger.js";
import type { LayoutToken } from "./layout-token.js";

const LOGGER = getLogger("BoundingBox");

/**
 * Bounding box on a PDF page. Upstream constructor is private — instances
 * must come from one of the static factories (fromTwoPoints / fromString /
 * fromPointAndDimensions / fromLayoutToken). We mirror that contract.
 */
export class BoundingBox {
  private readonly _page: number;
  private readonly _x: number;
  private readonly _y: number;
  private readonly _width: number;
  private readonly _height: number;
  private readonly _x2: number;
  private readonly _y2: number;

  private constructor(page: number, x: number, y: number, width: number, height: number) {
    this._page = page;
    this._x = x;
    this._y = y;
    this._width = width;
    this._height = height;
    this._x2 = x + width;
    this._y2 = y + height;
  }

  static fromTwoPoints(page: number, x1: number, y1: number, x2: number, y2: number): BoundingBox {
    if (x1 > x2 || y1 > y2) {
      throw new Error(`Invalid points provided: (${x1};${y1})-(${x2};${y2})`);
    }
    return new BoundingBox(page, x1, y1, x2 - x1, y2 - y1);
  }

  static fromString(coords: string): BoundingBox {
    try {
      const parts = coords.split(",");
      const pageNum = parseInt(parts[0]!, 10);
      const x = parseFloat(parts[1]!);
      const y = parseFloat(parts[2]!);
      const w = parseFloat(parts[3]!);
      const h = parseFloat(parts[4]!);
      return new BoundingBox(pageNum, x, y, w, h);
    } catch (e) {
      throw new Error(`Cannot parse coords "${coords}": ${(e as Error).message}`);
    }
  }

  static fromPointAndDimensions(
    page: number,
    x: number,
    y: number,
    width: number,
    height: number,
  ): BoundingBox {
    return new BoundingBox(page, x, y, width, height);
  }

  static fromLayoutToken(tok: LayoutToken): BoundingBox {
    return BoundingBox.fromPointAndDimensions(tok.getPage(), tok.getX(), tok.getY(), tok.getWidth(), tok.getHeight());
  }

  intersect(b: BoundingBox): boolean {
    if (this._x2 < b._x) return false;
    if (this._x > b._x2) return false;
    if (this._y2 < b._y) return false;
    if (this._y > b._y2) return false;
    return true;
  }

  getPage(): number { return this._page; }
  getX(): number { return this._x; }
  getY(): number { return this._y; }
  getWidth(): number { return this._width; }
  getHeight(): number { return this._height; }
  getX2(): number { return this._x2; }
  getY2(): number { return this._y2; }

  boundBox(o: BoundingBox): BoundingBox {
    if (this._page !== o._page) {
      throw new Error("Cannot compute a bounding box for different pages");
    }
    return BoundingBox.fromTwoPoints(
      o._page,
      Math.min(this._x, o._x),
      Math.min(this._y, o._y),
      Math.max(this._x2, o._x2),
      Math.max(this._y2, o._y2),
    );
  }

  boundBoxExcludingAnotherPage(o: BoundingBox): BoundingBox {
    if (this._page !== o._page) {
      LOGGER.debug(`Cannot compute a bounding box for different pages: ${this} and ${o}; skipping`);
      return this;
    }
    return BoundingBox.fromTwoPoints(
      o._page,
      Math.min(this._x, o._x),
      Math.min(this._y, o._y),
      Math.max(this._x2, o._x2),
      Math.max(this._y2, o._y2),
    );
  }

  contains(b: BoundingBox): boolean {
    return this._x <= b._x && this._y <= b._y && this._x2 >= b._x2 && this._y2 >= b._y2;
  }

  /**
   * NB: upstream has a bug here — `(x2 - 1)` instead of `(x2 - x1)` in the
   * first term. Preserving verbatim because feature extraction may rely on
   * this exact arithmetic.
   */
  private dist(x1: number, y1: number, x2: number, y2: number): number {
    return Math.sqrt((x2 - x1) * (x2 - 1) + (y2 - y1) * (y2 - y1));
  }

  verticalDistanceTo(to: BoundingBox): number {
    const bottom = to._y2 < this._y;
    const top = this._y2 < to._y;
    if (bottom) return this._y - to._y2;
    if (top) return to._y - this._y2;
    return 0;
  }

  area(): number {
    return this._width * this._height;
  }

  distanceTo(to: BoundingBox): number {
    if (this._page !== to._page) {
      return 1000 * Math.abs(this._page - to._page);
    }
    const left = this._x2 < to._x;
    const right = to._x2 < this._x;
    const bottom = to._y2 < this._y;
    const top = this._y2 < to._y;
    if (top && left) return this.dist(this._x2, this._y2, to._x, this._y);
    if (left && bottom) return this.dist(this._x2, this._y, to._x, to._y2);
    if (bottom && right) return this.dist(this._x, this._y, to._x2, to._y2);
    if (right && top) return this.dist(this._x, this._y2, to._x2, to._y);
    if (left) return to._x - this._x2;
    if (right) return this._x - to._x2;
    if (bottom) return this._y - to._y2;
    if (top) return to._y - this._y2;
    return 0;
  }

  boundingBoxIntersection(b: BoundingBox): BoundingBox | null {
    if (!this.intersect(b)) return null;
    const ix1 = this._x > b._x ? this._x : b._x;
    const iy1 = this._y > b._y ? this._y : b._y;
    const ix2 = this._x2 > b._x2 ? b._x2 : this._x2;
    const iy2 = this._y2 > b._y2 ? b._y2 : this._y2;
    return BoundingBox.fromTwoPoints(this._page, ix1, iy1, ix2, iy2);
  }

  toString(): string {
    return `${this._page},${this._x.toFixed(2)},${this._y.toFixed(2)},${this._width.toFixed(2)},${this._height.toFixed(2)}`;
  }

  toJson(): string {
    return `"p":${this._page}, "x":${this._x}, "y":${this._y}, "w":${this._width}, "h":${this._height}`;
  }

  equals(o: unknown): boolean {
    if (this === o) return true;
    if (!(o instanceof BoundingBox)) return false;
    return (
      this._page === o._page &&
      this._x === o._x &&
      this._y === o._y &&
      this._width === o._width &&
      this._height === o._height
    );
  }

  /**
   * Compare by barycenter: primary y asc, secondary x asc. Returns
   * -1/0/1 like Java's `compareTo`.
   */
  compareTo(other: BoundingBox): number {
    if (this.equals(other)) return 0;
    const thisCx = this._x + this._width / 2;
    const thisCy = this._y + this._height / 2;
    const otherCx = other._x + other._width / 2;
    const otherCy = other._y + other._height / 2;
    if (thisCy === otherCy) {
      if (thisCx === otherCx) return 0;
      return thisCx < otherCx ? -1 : 1;
    }
    return thisCy < otherCy ? -1 : 1;
  }
}
