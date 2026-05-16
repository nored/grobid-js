// Unit tests for the page-1 cleanup pre-processor.
//
// Builds synthetic Document instances (page + blocks + tokens) that mirror
// the layout pdfalto emits for the catalogued archive-cover and banner
// failure modes, then asserts that applyPage1Cleanup removes the right
// blocks while leaving body content intact.

import { describe, it, expect, beforeEach } from "vitest";
import { Block } from "../../src/grobid/layout/block.js";
import { BoundingBox } from "../../src/grobid/layout/bounding-box.js";
import { LayoutToken } from "../../src/grobid/layout/layout-token.js";
import { Page } from "../../src/grobid/layout/page.js";
import {
  applyPage1Cleanup,
  getDroppedPage1Blocks,
  isPage1CleanupEnabled,
  setPage1CleanupEnabled,
} from "../../src/grobid/document/page1-cleanup.js";

/**
 * Minimal Document substitute used here to avoid pulling Document.ts (and its
 * transitive Engine import chain) into the test file. Mirrors only the two
 * methods page1-cleanup actually reads — `getPages()` and `getBlocks()` —
 * plus mutable inner state so the cleanup can splice on the returned arrays.
 */
class FakeDocument {
  private pages: Page[] = [];
  private blocks: Block[] = [];
  private tokenizations: LayoutToken[] = [];
  setPages(p: Page[]): void {
    this.pages = p;
  }
  getPages(): Page[] | null {
    return this.pages;
  }
  addBlock(b: Block): void {
    // Mirror the SAX parser: each block claims [startToken, endToken) over
    // the doc-wide tokenization stream. We append the block's tokens onto
    // tokenizations in document order, then set start/end on the block.
    const start = this.tokenizations.length;
    b.setStartToken(start);
    const tokens = b.getTokens() ?? [];
    for (const t of tokens) {
      t.setBlockPtr(this.blocks.length);
      this.tokenizations.push(t);
    }
    b.setEndToken(this.tokenizations.length);
    this.blocks.push(b);
  }
  getBlocks(): Block[] {
    return this.blocks;
  }
  getTokenizations(): LayoutToken[] | null {
    return this.tokenizations;
  }
}

/**
 * Build a single Block carrying `text` at (x, y), as one token. Width/height
 * default to a non-degenerate value so produceStatistics doesn't divide by 0.
 */
function mkBlock(text: string, opts: { x?: number; y?: number; rotated?: boolean } = {}): Block {
  const b = new Block();
  const tok = new LayoutToken(text);
  tok.setX(opts.x ?? 100);
  tok.setY(opts.y ?? 200);
  tok.setWidth(text.length * 6);
  tok.setHeight(10);
  tok.setRotation(opts.rotated ?? false);
  b.addToken(tok);
  b.setBoundingBox(
    BoundingBox.fromPointAndDimensions(1, opts.x ?? 100, opts.y ?? 200, text.length * 6, 10),
  );
  return b;
}

/** Assemble a 2-page Document with the given page-1 blocks and a body page. */
function mkDoc(page1Blocks: Block[]): FakeDocument {
  const doc = new FakeDocument();
  const page1 = new Page(1);
  page1.setWidth(595);
  page1.setHeight(842);
  for (const b of page1Blocks) {
    b.setPage(page1);
    page1.addBlock(b);
    doc.addBlock(b);
  }
  const page2 = new Page(2);
  page2.setWidth(595);
  page2.setHeight(842);
  const bodyBlock = mkBlock(
    "This is the real body of the paper. ".repeat(20),
    { x: 100, y: 200 },
  );
  bodyBlock.setPage(page2);
  page2.addBlock(bodyBlock);
  doc.addBlock(bodyBlock);
  doc.setPages([page1, page2]);
  return doc;
}

describe("page1-cleanup: enable/disable toggle", () => {
  beforeEach(() => {
    setPage1CleanupEnabled(true);
  });
  it("defaults to enabled", () => {
    expect(isPage1CleanupEnabled()).toBe(true);
  });
  it("no-ops when disabled", () => {
    setPage1CleanupEnabled(false);
    const doc = mkDoc([
      mkBlock("Citation: Lee, A. et al. 2020. Edinburgh Research Explorer."),
      mkBlock("Citation for published version (APA):"),
    ]);
    const r = applyPage1Cleanup(doc);
    expect(r.modified).toBe(false);
    expect(doc.getBlocks().length).toBe(3);
  });
});

describe("page1-cleanup: archive cover detection", () => {
  beforeEach(() => {
    setPage1CleanupEnabled(true);
  });

  it("strips a Leeds Beckett / Edinburgh-style cover (2 markers)", () => {
    const doc = mkDoc([
      mkBlock("Leeds Beckett University Open Research Repository"),
      mkBlock("Citation: Smith, J. (2020). A paper. Conference XYZ."),
      mkBlock("This work is licensed under a Creative Commons Attribution"),
    ]);
    const r = applyPage1Cleanup(doc);
    expect(r.modified).toBe(true);
    expect(r.strippedEntirePage1).toBe(true);
    expect(r.firedRules[0]).toMatch(/archive-cover/);
    expect(doc.getPages()![0]!.getBlocks()!.length).toBe(0);
    expect(doc.getBlocks().length).toBe(1); // only the body block remains
  });

  it("strips an Edinburgh Research Explorer cover (2 markers)", () => {
    const doc = mkDoc([
      mkBlock("Edinburgh Research Explorer"),
      mkBlock("Citation for published version (APA): Lee, K. 2018."),
    ]);
    const r = applyPage1Cleanup(doc);
    expect(r.modified).toBe(true);
    expect(r.strippedEntirePage1).toBe(true);
    expect(getDroppedPage1Blocks(doc)!.blocks.length).toBe(2);
  });

  it("strips an NRC Publications Archive cover (2 markers)", () => {
    const doc = mkDoc([
      mkBlock("NRC Publications Archive / Archives des publications du CNRC"),
      mkBlock("Citation: Tremblay, R. 2017."),
      mkBlock("Pour communiquer avec le NRC..."),
    ]);
    const r = applyPage1Cleanup(doc);
    expect(r.modified).toBe(true);
    expect(r.strippedEntirePage1).toBe(true);
  });

  it("strips a Research Square preprint cover (single strong marker + sparse page)", () => {
    const doc = mkDoc([
      mkBlock("Research Square https://researchsquare.com"),
      mkBlock("Posted Date: May 5th, 2021"),
      mkBlock("DOI: 10.21203/rs.3.rs-493941/v1"),
    ]);
    const r = applyPage1Cleanup(doc);
    expect(r.modified).toBe(true);
    expect(r.strippedEntirePage1).toBe(true);
  });

  it("does NOT strip a real paper page 1 with no markers", () => {
    const doc = mkDoc([
      mkBlock("On the foundations of distributed quantum computing"),
      mkBlock("Alice Author, Bob Builder, Carol Coder"),
      mkBlock("Abstract — We present a new algorithm for "
        + "distributed consensus on a hybrid quantum-classical "
        + "network. Our approach reduces overhead by 30% on "
        + "average compared to prior work and handles up to "
        + "16 noisy qubits per partition.".repeat(2)),
    ]);
    const r = applyPage1Cleanup(doc);
    expect(r.modified).toBe(false);
    expect(doc.getPages()![0]!.getBlocks()!.length).toBe(3);
  });

  it("does NOT strip when only a weak single marker is present plus a long abstract", () => {
    // 'Citation:' might appear in a footnote on a legitimate first page; the
    // single-marker path requires no abstract-like long paragraph to fire.
    const doc = mkDoc([
      mkBlock("A Real Paper Title That Looks Plausible"),
      mkBlock("Citation: J. Smith, 2020, Annual Review."),
      mkBlock(
        "Abstract — This paper investigates a novel mechanism for ".repeat(8),
      ),
    ]);
    const r = applyPage1Cleanup(doc);
    expect(r.modified).toBe(false);
  });
});

describe("page1-cleanup: banner / arXiv watermark detection", () => {
  beforeEach(() => {
    setPage1CleanupEnabled(true);
  });

  it("strips an IEEE preprint disclaimer banner at the top of page 1", () => {
    const bannerBlock = mkBlock(
      "This article has been accepted for publication in IEEE Transactions...",
      { x: 100, y: 30 },
    );
    const titleBlock = mkBlock("Real Title of the Paper", { x: 200, y: 150 });
    const authorBlock = mkBlock("Author One, Author Two", { x: 200, y: 200 });
    const doc = mkDoc([bannerBlock, titleBlock, authorBlock]);
    const r = applyPage1Cleanup(doc);
    expect(r.modified).toBe(true);
    expect(r.strippedEntirePage1).toBe(false);
    expect(r.firedRules[0]).toMatch(/IEEE preprint/);
    // Title + author preserved.
    expect(doc.getPages()![0]!.getBlocks()!.length).toBe(2);
  });

  it("strips an arXiv vertical watermark by rotation + position", () => {
    const watermark = mkBlock("arXiv:2104.12345 [cs.LG] 14 May 2021", {
      x: 20,
      y: 400,
      rotated: true,
    });
    const titleBlock = mkBlock("Real Title", { x: 200, y: 80 });
    const longParagraphBlock = mkBlock(
      "Abstract — A long paragraph to avoid the 'cover' single-marker path. ".repeat(8),
      { x: 100, y: 200 },
    );
    const doc = mkDoc([watermark, titleBlock, longParagraphBlock]);
    const r = applyPage1Cleanup(doc);
    expect(r.modified).toBe(true);
    expect(r.firedRules.some((rule) => rule.includes("arXiv"))).toBe(true);
    // Real title + abstract preserved.
    expect(doc.getPages()![0]!.getBlocks()!.length).toBe(2);
  });

  it("does NOT strip a regular block at the top of page 1 that has no banner phrase", () => {
    const titleBlock = mkBlock("A Perfectly Normal Title", { x: 200, y: 50 });
    const authorBlock = mkBlock("Author Foo, Author Bar", { x: 200, y: 100 });
    const longParagraphBlock = mkBlock(
      "Abstract — A real abstract here. ".repeat(20),
      { x: 100, y: 200 },
    );
    const doc = mkDoc([titleBlock, authorBlock, longParagraphBlock]);
    const r = applyPage1Cleanup(doc);
    expect(r.modified).toBe(false);
  });
});

describe("page1-cleanup: edge cases", () => {
  beforeEach(() => {
    setPage1CleanupEnabled(true);
  });

  it("no-ops on a single-page document", () => {
    const doc = new FakeDocument();
    const page1 = new Page(1);
    page1.setWidth(595);
    page1.setHeight(842);
    const block = mkBlock("Leeds Beckett University Repository");
    const block2 = mkBlock("Citation: Foo (2020)");
    block.setPage(page1);
    block2.setPage(page1);
    page1.addBlock(block);
    page1.addBlock(block2);
    doc.addBlock(block);
    doc.addBlock(block2);
    doc.setPages([page1]);
    const r = applyPage1Cleanup(doc);
    expect(r.modified).toBe(false);
  });

  it("preserves removed blocks under __droppedPage1Blocks", () => {
    const doc = mkDoc([
      mkBlock("Edinburgh Research Explorer"),
      mkBlock("Citation for published version (APA): X"),
    ]);
    applyPage1Cleanup(doc);
    const dropped = getDroppedPage1Blocks(doc);
    expect(dropped).not.toBeNull();
    expect(dropped!.blocks.length).toBe(2);
    expect(dropped!.reasons.length).toBe(2);
  });
});
