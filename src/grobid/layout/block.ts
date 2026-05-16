// Port of org.grobid.core.layout.Block.
// Upstream: grobid-core/src/main/java/org/grobid/core/layout/Block.java

import type { BoundingBox } from "./bounding-box.js";
import type { LayoutToken } from "./layout-token.js";
import type { Page } from "./page.js";

export enum BlockType {
  DEFAULT = "DEFAULT",
  BULLET = "BULLET",
  FIGURE = "FIGURE",
  TABLE = "TABLE",
  REFERENCE = "REFERENCE",
}

/**
 * A document block — typically a contiguous run of tokens sharing layout
 * properties (font, column, etc.) plus bookkeeping for downstream segmentation.
 */
export class Block {
  // Re-export the enum as a static member to mirror Java's `Block.Type`.
  static readonly Type = BlockType;

  private text: string | null = null;
  private boundingBox: BoundingBox | null = null;
  private font: string | null = null;
  private bold: boolean = false;
  private italic: boolean = false;
  private colorFont: string | null = null;
  /** Public mutable in upstream. */
  fontSize: number = 0.0;
  /** Public mutable in upstream. */
  tokens: LayoutToken[] | null = null;
  private startToken: number = -1;
  private endToken: number = -1;
  private page: Page | null = null;
  private type: BlockType | null = null;

  addToken(lt: LayoutToken): void {
    if (this.tokens === null) this.tokens = [];
    this.tokens.push(lt);
  }
  getTokens(): LayoutToken[] | null { return this.tokens; }
  resetTokens(): void { this.tokens = null; }

  setType(t: BlockType | null): void { this.type = t; }
  getType(): BlockType | null { return this.type; }

  /**
   * Returns block text. Caches into `this.text` after first concat, mirroring
   * upstream. Special case: a leading "@" sentinel in text is treated as a
   * pre-set string (e.g. for `@FIGURE` / `@TABLE` block-type markers).
   */
  getText(): string | null {
    if (this.text !== null && this.text.trim().startsWith("@")) {
      return this.text.trim();
    }
    if (this.tokens === null) return null;
    if (this.text !== null) return this.text;
    let s = "";
    for (const token of this.tokens) {
      const tt = token.getText();
      if (tt !== null) s += tt;
    }
    this.text = s;
    return this.text;
  }

  getNbTokens(): number { return this.tokens?.length ?? 0; }

  setFont(f: string): void { this.font = f; }
  getFont(): string | null { return this.font; }
  setColorFont(f: string): void { this.colorFont = f; }
  getColorFont(): string | null { return this.colorFont; }
  setBold(b: boolean): void { this.bold = b; }
  setItalic(i: boolean): void { this.italic = i; }
  getBold(): boolean { return this.bold; }
  getItalic(): boolean { return this.italic; }
  setFontSize(d: number): void { this.fontSize = d; }
  getFontSize(): number { return this.fontSize; }

  getBoundingBox(): BoundingBox | null { return this.boundingBox; }
  setBoundingBox(box: BoundingBox): void { this.boundingBox = box; }

  getX(): number { return this.boundingBox?.getX() ?? 0.0; }
  getY(): number { return this.boundingBox?.getY() ?? 0.0; }
  getHeight(): number { return this.boundingBox?.getHeight() ?? 0.0; }
  getWidth(): number { return this.boundingBox?.getWidth() ?? 0.0; }

  getStartToken(): number { return this.startToken; }
  getEndToken(): number {
    if (this.endToken === -1) {
      if (this.tokens === null || this.tokens.length === 0) return this.getStartToken();
      return this.getStartToken() + this.tokens.length;
    }
    return this.endToken;
  }
  setStartToken(s: number): void { this.startToken = s; }
  setEndToken(e: number): void { this.endToken = e; }

  getPage(): Page | null { return this.page; }
  getPageNumber(): number { return this.page?.getNumber() ?? -1; }
  setPage(page: Page): void { this.page = page; }

  isNull(): boolean {
    return this.tokens === null && this.startToken === -1 && this.endToken === -1 && this.type === null;
  }

  toString(): string {
    let res = `Block{, startToken=${this.startToken}, endToken=${this.endToken}, type=${this.type}`;
    if (this.boundingBox !== null) res += `, boundingBox=${this.boundingBox.toString()}}`;
    return res;
  }
}
