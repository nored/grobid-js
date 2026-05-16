// Port of org.grobid.core.layout.Page.
// Upstream: grobid-core/src/main/java/org/grobid/core/layout/Page.java

import type { Block } from "./block.js";
import type { BoundingBox } from "./bounding-box.js";

export class Page {
  private blocks: Block[] | null = null;
  private width: number = 0.0;
  private height: number = 0.0;
  private number: number = -1;
  private pageLengthChar: number = 0;
  private mainArea: BoundingBox | null = null;

  constructor(nb: number) {
    this.number = nb;
  }

  isEven(): boolean { return this.number % 2 === 0; }

  addBlock(b: Block): void {
    if (this.blocks === null) this.blocks = [];
    this.blocks.push(b);
  }

  getBlocks(): Block[] | null { return this.blocks; }

  setHeight(d: number): void { this.height = Math.abs(d); }
  getHeight(): number { return this.height; }
  setWidth(d: number): void { this.width = Math.abs(d); }
  getWidth(): number { return this.width; }

  setPageLengthChar(length: number): void { this.pageLengthChar = length; }
  getPageLengthChar(): number { return this.pageLengthChar; }

  setNumber(n: number): void { this.number = n; }
  getNumber(): number { return this.number; }

  getMainArea(): BoundingBox | null { return this.mainArea; }
  setMainArea(b: BoundingBox): void { this.mainArea = b; }
}
