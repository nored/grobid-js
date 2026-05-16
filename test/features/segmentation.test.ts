import { describe, it, expect } from "vitest";
import { buildLayout } from "../../src/core/pdf/build-layout.js";
import { extractSegmentationFeatures } from "../../src/core/features/segmentation.js";
import type { RawPage, RawTextItem } from "../../src/core/pdf/types.js";

function item(opts: Partial<RawTextItem> & { str: string; x: number; y: number }): RawTextItem {
  return {
    str: opts.str,
    x: opts.x,
    y: opts.y,
    width: opts.width ?? opts.str.length * 5,
    height: opts.height ?? 10,
    fontName: opts.fontName ?? "Times-Roman",
    fontSize: opts.fontSize ?? 10,
    bold: opts.bold ?? false,
    italic: opts.italic ?? false,
    hasEOL: opts.hasEOL ?? false,
  };
}

function tinyDoc() {
  const items: RawTextItem[] = [
    // Header zone, bold large font.
    item({ str: "A Side Channel Attack on AES-128", x: 50, y: 80, fontSize: 14, fontName: "Times-Bold", bold: true }),
    item({ str: "Alice Bob and Eve Doe", x: 50, y: 105 }),
    // Abstract
    item({ str: "Abstract. We show a Prime+Probe variant.", x: 50, y: 140 }),
    // Body
    item({ str: "1 Introduction", x: 50, y: 200, fontSize: 12, bold: true, fontName: "Times-Bold" }),
    item({ str: "Cache side-channel attacks have been studied [1].", x: 50, y: 220 }),
    item({ str: "We focus on Prime+Probe and Flush+Reload.", x: 50, y: 234 }),
    item({ str: "References", x: 50, y: 700, bold: true, fontName: "Times-Bold" }),
    item({ str: "[1] Yarom and Falkner. FLUSH+RELOAD. USENIX 2014.", x: 50, y: 720 }),
  ];
  const page: RawPage = { pageNumber: 1, width: 595, height: 842, items };
  return buildLayout([page]);
}

describe("extractSegmentationFeatures", () => {
  it("produces one row per non-empty line with the expected 33 columns", () => {
    const doc = tinyDoc();
    const { rows, lines } = extractSegmentationFeatures(doc);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBe(lines.length);
    for (const r of rows) expect(r.length).toBe(33);
  });
  it("populates the lexical anchor columns from the first token of each line", () => {
    const doc = tinyDoc();
    const { rows } = extractSegmentationFeatures(doc);
    // The very first line begins with "A".
    expect(rows[0]![0]).toBe("A");
    expect(rows[0]![2]).toBe("a");
    expect(rows[0]![3]).toBe("A"); // prefix1
  });
  it("marks the first line of the document as PAGESTART", () => {
    const doc = tinyDoc();
    const { rows } = extractSegmentationFeatures(doc);
    expect(rows[0]![8]).toBe("PAGESTART");
    expect(rows.at(-1)![8]).toMatch(/^PAGE(IN|END)$/);
  });
  it("detects bold and propagates it as column 11", () => {
    const doc = tinyDoc();
    const { rows } = extractSegmentationFeatures(doc);
    const boldRows = rows.filter((r) => r[11] === "1");
    expect(boldRows.length).toBeGreaterThan(0);
  });
  it("captures the punctuation profile of each line at column 25", () => {
    const doc = tinyDoc();
    const { rows } = extractSegmentationFeatures(doc);
    const profiles = rows.map((r) => r[25]);
    expect(profiles.some((p) => p === "-[].")).toBe(true);
  });
});
