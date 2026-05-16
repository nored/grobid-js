// Port of org.grobid.core.layout.GraphicObject.
// Upstream: grobid-core/src/main/java/org/grobid/core/layout/GraphicObject.java

import type { BoundingBox } from "./bounding-box.js";
import { GraphicObjectType } from "./graphic-object-type.js";

export class GraphicObject {
  private filePath: string | null = null;
  private type: GraphicObjectType = GraphicObjectType.UNKNOWN;
  private startPosition: number = -1;
  private endPosition: number = -1;
  private blockNumber: number = -1;
  private boundingBox: BoundingBox | null = null;
  private mask: boolean = false;
  /** Page number when no bounding box is available (vector image case). */
  private _page: number = -1;
  /** Public mutable in upstream. */
  used: boolean = false;

  constructor(boundingBox?: BoundingBox, type?: GraphicObjectType) {
    if (boundingBox !== undefined) this.boundingBox = boundingBox;
    if (type !== undefined) this.type = type;
  }

  getFilePath(): string | null { return this.filePath; }

  /** Portable relative URI: basename of the file path. */
  getURI(): string | null {
    if (this.filePath === null) return null;
    const slashIdx = this.filePath.lastIndexOf("/");
    if (slashIdx !== -1) return this.filePath.substring(slashIdx + 1);
    return this.filePath;
  }

  getType(): GraphicObjectType { return this.type; }
  setFilePath(p: string): void { this.filePath = p; }
  setType(t: GraphicObjectType): void { this.type = t; }
  getStartPosition(): number { return this.startPosition; }
  getEndPosition(): number { return this.endPosition; }
  setStartPosition(s: number): void { this.startPosition = s; }
  setEndPosition(e: number): void { this.endPosition = e; }
  setBlockNumber(b: number): void { this.blockNumber = b; }

  getX(): number { return this.boundingBox?.getX() ?? 0.0; }
  getY(): number { return this.boundingBox?.getY() ?? 0.0; }
  getWidth(): number { return this.boundingBox?.getWidth() ?? 0.0; }
  getHeight(): number { return this.boundingBox?.getHeight() ?? 0.0; }
  getPage(): number { return this.boundingBox?.getPage() ?? this._page; }
  setPage(p: number): void { this._page = p; }
  getBoundingBox(): BoundingBox | null { return this.boundingBox; }
  setBoundingBox(box: BoundingBox): void { this.boundingBox = box; }

  toString(): string {
    let res: string;
    if (this.type === GraphicObjectType.BITMAP) res = "Graphic Bitmap [";
    else if (this.type === GraphicObjectType.VECTOR) res = "Vector Graphic [";
    else if (this.type === GraphicObjectType.VECTOR_BOX) res = "Vector Box: [";
    else res = "Unknown [";
    if (this.startPosition !== -1) res += String(this.startPosition);
    res += "-";
    if (this.endPosition !== -1) res += String(this.endPosition);
    res += "]: \t";
    res += this.filePath !== null ? `${this.filePath}\t` : "\t";
    res += `(${this.boundingBox !== null ? this.boundingBox.toString() : "no bounding box"}\t`;
    return res;
  }

  isUsed(): boolean { return this.used; }
  setUsed(u: boolean): void { this.used = u; }
  isMask(): boolean { return this.mask; }
  setMask(m: boolean): void { this.mask = m; }
}
