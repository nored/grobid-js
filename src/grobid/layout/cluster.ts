// Port of org.grobid.core.layout.Cluster.
// Upstream: grobid-core/src/main/java/org/grobid/core/layout/Cluster.java

import type { Block } from "./block.js";

/**
 * Cluster of document layout blocks sharing the same font parameters.
 */
export class Cluster {
  private blocks: Block[] | null = null;
  private blocks2: number[] | null = null;
  // Public mutable like upstream.
  y: number = 0.0;
  x: number = 0.0;
  width: number = 0.0;
  height: number = 0.0;
  private font: string | null = null;
  private bold: boolean = false;
  private italic: boolean = false;
  private fontSize: number = 0.0;
  private nbTokens: number = 0;

  addBlock(b: Block): void {
    if (this.blocks === null) this.blocks = [];
    this.blocks.push(b);
  }
  addBlock2(b: number): void {
    if (this.blocks2 === null) this.blocks2 = [];
    this.blocks2.push(b);
  }
  getBlocks(): Block[] | null { return this.blocks; }
  getBlocks2(): number[] | null { return this.blocks2; }
  setFont(f: string): void { this.font = f; }
  setNbTokens(t: number): void { this.nbTokens = t; }
  getFont(): string | null { return this.font; }
  getNbBlocks(): number { return this.blocks?.length ?? 0; }
  setBold(b: boolean): void { this.bold = b; }
  setItalic(i: boolean): void { this.italic = i; }
  getBold(): boolean { return this.bold; }
  getItalic(): boolean { return this.italic; }
  setFontSize(d: number): void { this.fontSize = d; }
  getFontSize(): number { return this.fontSize; }
}
