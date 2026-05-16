// Port of org.grobid.core.layout.LayoutToken.
// Upstream: grobid-core/src/main/java/org/grobid/core/layout/LayoutToken.java
//
// The central per-token carrier passed through the entire pipeline. Holds
// text + bbox + font + provenance + accumulated CRF labels.

import type { TaggingLabel } from "../engines/label/tagging-label.js";

export class LayoutToken {
  // Upstream exposes x/y/width/height/fontSize as public mutable fields; we
  // mirror that contract because feature code rewrites them in place.
  text: string | null = null;
  y: number = -1.0;
  x: number = -1.0;
  width: number = 0.0;
  height: number = 0.0;
  fontSize: number = 0.0;
  // The rest are encapsulated behind getters/setters.
  private font: string | null = null;
  private bold: boolean = false;
  private italic: boolean = false;
  private colorFont: string | null = null;
  private rotation: boolean = false;
  private page: number = -1;
  private newLineAfter: boolean = false;
  private blockPtr: number = 0;
  private offset: number = 0;
  private subscript: boolean = false;
  private superscript: boolean = false;
  private labels: TaggingLabel[] | null = null;

  constructor(arg?: string | LayoutToken, label?: TaggingLabel) {
    if (arg === undefined) return;
    if (typeof arg === "string") {
      this.text = arg;
      if (label) this.addLabel(label);
      return;
    }
    // Copy constructor: deep clone of fields + labels list.
    const t = arg;
    this.text = t.text;
    this.y = t.y;
    this.x = t.x;
    this.width = t.width;
    this.height = t.height;
    this.font = t.font;
    this.bold = t.bold;
    this.italic = t.italic;
    this.colorFont = t.colorFont;
    this.fontSize = t.fontSize;
    this.rotation = t.rotation;
    this.page = t.page;
    this.newLineAfter = t.newLineAfter;
    this.blockPtr = t.blockPtr;
    this.offset = t.offset;
    this.subscript = t.subscript;
    this.superscript = t.superscript;
    if (t.labels !== null) {
      this.labels = [...t.labels];
    }
  }

  setFont(f: string | null): void { this.font = f; }
  getFont(): string | null { return this.font; }

  setText(f: string | null): void { this.text = f; }
  getText(): string | null { return this.text; }

  /** Short alias upstream uses in tight loops. */
  t(): string | null { return this.text; }

  setRotation(b: boolean): void { this.rotation = b; }
  getRotation(): boolean { return this.rotation; }

  setColorFont(f: string | null): void { this.colorFont = f; }
  getColorFont(): string | null { return this.colorFont; }

  setBold(b: boolean): void { this.bold = b; }
  setItalic(i: boolean): void { this.italic = i; }
  isBold(): boolean { return this.bold; }
  /** @deprecated use isBold() */
  getBold(): boolean { return this.bold; }
  isItalic(): boolean { return this.italic; }
  /** @deprecated use isItalic() */
  getItalic(): boolean { return this.italic; }

  isSubscript(): boolean { return this.subscript; }
  setSubscript(s: boolean): void { this.subscript = s; }
  isSuperscript(): boolean { return this.superscript; }
  setSuperscript(s: boolean): void { this.superscript = s; }

  setFontSize(d: number): void { this.fontSize = d; }
  getFontSize(): number { return this.fontSize; }

  setX(d: number): void { this.x = d; }
  getX(): number { return this.x; }
  setY(d: number): void { this.y = d; }
  getY(): number { return this.y; }
  setHeight(d: number): void { this.height = d; }
  getHeight(): number { return this.height; }
  setWidth(d: number): void { this.width = d; }
  getWidth(): number { return this.width; }

  getPage(): number { return this.page; }
  setPage(p: number): void { this.page = p; }

  isNewLineAfter(): boolean { return this.newLineAfter; }
  setNewLineAfter(b: boolean): void { this.newLineAfter = b; }

  getBlockPtr(): number { return this.blockPtr; }
  setBlockPtr(b: number): void { this.blockPtr = b; }

  getOffset(): number { return this.offset; }
  setOffset(o: number): void { this.offset = o; }

  /** Returns the accumulated tagging labels (empty array if none, never null). */
  getLabels(): TaggingLabel[] {
    if (this.labels === null) return [];
    return this.labels;
  }

  hasLabel(label: TaggingLabel): boolean {
    if (this.labels === null) return false;
    return this.labels.includes(label);
  }

  addLabel(label: TaggingLabel): void {
    if (this.labels === null) this.labels = [];
    if (!this.hasLabel(label)) this.labels.push(label);
  }

  toString(): string {
    return this.text ?? "";
  }

  /**
   * Reading-order comparison: primary y asc, secondary x asc, tertiary
   * area asc. Returns -1/0/1 like Java's `compareTo`.
   */
  compareTo(other: LayoutToken): number {
    if (this.y !== other.y) return this.y < other.y ? -1 : 1;
    if (this.x !== other.x) return this.x < other.x ? -1 : 1;
    const area1 = this.height * this.width;
    const area2 = other.height * other.width;
    if (area1 === area2) return 0;
    return area1 < area2 ? -1 : 1;
  }
}
