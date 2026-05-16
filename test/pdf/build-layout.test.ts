import { describe, it, expect } from "vitest";
import { buildLayout } from "../../src/core/pdf/build-layout.js";
import type { RawPage, RawTextItem } from "../../src/core/pdf/types.js";

function item(opts: Partial<RawTextItem> & { str: string; x: number; y: number }): RawTextItem {
  return {
    str: opts.str,
    x: opts.x,
    y: opts.y,
    width: opts.width ?? opts.str.length * 5,
    height: opts.height ?? 10,
    fontName: opts.fontName ?? "Helvetica",
    fontSize: opts.fontSize ?? 10,
    bold: opts.bold ?? false,
    italic: opts.italic ?? false,
    hasEOL: opts.hasEOL ?? false,
  };
}

function page(items: RawTextItem[], opts: { width?: number; height?: number; pageNumber?: number } = {}): RawPage {
  return {
    pageNumber: opts.pageNumber ?? 1,
    width: opts.width ?? 595,
    height: opts.height ?? 842,
    items,
  };
}

describe("buildLayout — word splitting", () => {
  it("splits whitespace and punctuation into separate tokens", () => {
    const doc = buildLayout([page([item({ str: "As shown in [14], we", x: 50, y: 100 })])]);
    const texts = doc.tokens.map((t) => t.text);
    expect(texts).toEqual(["As", "shown", "in", "[", "14", "]", ",", "we"]);
  });
  it("propagates font attributes to every produced token", () => {
    const doc = buildLayout([page([item({ str: "Bold Word", x: 0, y: 0, bold: true, italic: false })])]);
    expect(doc.tokens.every((t) => t.bold === true)).toBe(true);
    expect(doc.tokens.every((t) => t.italic === false)).toBe(true);
  });
  it("assigns 1-indexed page numbers from the input", () => {
    const doc = buildLayout([
      page([item({ str: "first", x: 0, y: 0 })], { pageNumber: 1 }),
      page([item({ str: "second", x: 0, y: 0 })], { pageNumber: 2 }),
    ]);
    const byPage = doc.tokens.map((t) => t.page);
    expect(byPage).toEqual([1, 2]);
  });
});

describe("buildLayout — line grouping", () => {
  it("groups items at the same y into one line, separating from the next", () => {
    const doc = buildLayout([
      page([
        item({ str: "alpha", x: 50, y: 100 }),
        item({ str: "beta", x: 100, y: 100 }),
        // Tight gap (~4pt) keeps both lines in the same block.
        item({ str: "gamma", x: 50, y: 114 }),
      ]),
    ]);
    expect(doc.pages[0]!.blocks.length).toBe(1);
    expect(doc.pages[0]!.blocks[0]!.lines.length).toBe(2);
    const firstLine = doc.pages[0]!.blocks[0]!.lines[0]!.tokens.map((t) => t.text);
    expect(firstLine).toEqual(["alpha", "beta"]);
  });
  it("sorts within-line tokens by x even when input is unordered", () => {
    const doc = buildLayout([
      page([
        item({ str: "third", x: 200, y: 100 }),
        item({ str: "first", x: 50, y: 100 }),
        item({ str: "second", x: 120, y: 100 }),
      ]),
    ]);
    const line = doc.pages[0]!.blocks[0]!.lines[0]!.tokens.map((t) => t.text);
    expect(line).toEqual(["first", "second", "third"]);
  });
  it("flags the last token of each line with newLineAfter", () => {
    const doc = buildLayout([
      page([
        item({ str: "one two", x: 0, y: 0 }),
        item({ str: "three", x: 0, y: 30 }),
      ]),
    ]);
    const tokens = doc.tokens;
    expect(tokens[1]!.newLineAfter).toBe(true);
    expect(tokens[2]!.newLineAfter).toBe(true);
    expect(tokens[0]!.newLineAfter).toBeUndefined();
  });
});

describe("buildLayout — block grouping", () => {
  it("merges visually contiguous lines into one block", () => {
    const items: RawTextItem[] = [];
    for (let i = 0; i < 5; i++) items.push(item({ str: `line${i}`, x: 50, y: 100 + i * 14 }));
    const doc = buildLayout([page(items)]);
    expect(doc.pages[0]!.blocks.length).toBe(1);
    expect(doc.pages[0]!.blocks[0]!.lines.length).toBe(5);
  });
  it("breaks blocks across a large vertical gap", () => {
    const items: RawTextItem[] = [
      item({ str: "para one", x: 50, y: 100 }),
      item({ str: "still one", x: 50, y: 114 }),
      // Big gap → new block
      item({ str: "para two", x: 50, y: 250 }),
      item({ str: "still two", x: 50, y: 264 }),
    ];
    const doc = buildLayout([page(items)]);
    expect(doc.pages[0]!.blocks.length).toBe(2);
  });
});

describe("buildLayout — global structure", () => {
  it("returns a flat tokens array in reading order", () => {
    const doc = buildLayout([
      page([
        item({ str: "second word", x: 50, y: 120 }),
        item({ str: "first word", x: 50, y: 100 }),
      ]),
    ]);
    expect(doc.tokens.map((t) => t.text)).toEqual(["first", "word", "second", "word"]);
  });
});
