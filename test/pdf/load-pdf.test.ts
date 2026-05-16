import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPdfFromPath } from "../../src/node/load-pdf.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const pdfPath = path.resolve(here, "../../fixtures/sample-arxiv.pdf");

describe("loadPdfFromPath against a real arXiv paper", () => {
  it("extracts pages, tokens with bbox/page/font, and reading-order text", async () => {
    const doc = await loadPdfFromPath(pdfPath);
    // Sanity on document shape.
    expect(doc.pages.length).toBeGreaterThan(5); // arXiv 1706.03762 is 15 pages
    expect(doc.tokens.length).toBeGreaterThan(2000);

    // Every token should carry bbox/page/font.
    for (const t of doc.tokens.slice(0, 200)) {
      expect(typeof t.text).toBe("string");
      expect(t.text.length).toBeGreaterThan(0);
      expect(t.page).toBeGreaterThanOrEqual(1);
      expect(Number.isFinite(t.x)).toBe(true);
      expect(Number.isFinite(t.y)).toBe(true);
      expect(t.fontSize).toBeGreaterThan(0);
    }

    // The first page should contain identifiable header text.
    const page1Tokens = doc.tokens.filter((t) => t.page === 1).map((t) => t.text);
    const page1Text = page1Tokens.join(" ");
    expect(page1Text).toMatch(/Attention/i);
    expect(page1Text).toMatch(/All You Need/i);

    // Lines should be reasonably distinct: page 1 has > 20 lines.
    const page1Lines = doc.pages[0]!.blocks.flatMap((b) => b.lines);
    expect(page1Lines.length).toBeGreaterThan(20);

    // At least some tokens should have been detected as bold (the title).
    const anyBold = doc.tokens.some((t) => t.bold && t.page === 1);
    expect(anyBold).toBe(true);
  }, 60_000);
});
