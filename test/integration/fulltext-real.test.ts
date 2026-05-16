import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPdfFromPath } from "../../src/node/load-pdf.js";
import { extractSegmentationFeatures } from "../../src/core/features/segmentation.js";
import { extractFulltextFeatures } from "../../src/core/features/fulltext.js";
import { loadWapitiModel } from "../../src/core/crf/wapiti-model.js";
import { decode } from "../../src/core/crf/wapiti-decoder.js";
import type { LayoutToken } from "../../src/core/types/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const segPath = path.resolve(here, "../../fixtures/models/segmentation.wapiti");
const fullPath = path.resolve(here, "../../fixtures/models/fulltext.wapiti");
const pdfPath = path.resolve(here, "../../fixtures/sample-arxiv.pdf");

const skipIfMissing = existsSync(segPath) && existsSync(fullPath) && existsSync(pdfPath) ? describe : describe.skip;

skipIfMissing("End-to-end: real PDF → segmentation → fulltext", () => {
  it("slices the body zone and labels body tokens with GROBID fulltext tags", async () => {
    const segModel = loadWapitiModel(readFileSync(segPath));
    const fullModel = loadWapitiModel(readFileSync(fullPath));
    expect(fullModel.patterns.length).toBe(90);

    const doc = await loadPdfFromPath(pdfPath);
    const seg = extractSegmentationFeatures(doc);
    const segLabels = decode(segModel, seg.rows).labels;

    // Collect the tokens belonging to lines tagged as <body>.
    const bodyTokens: LayoutToken[] = [];
    for (let i = 0; i < segLabels.length; i++) {
      const base = segLabels[i]!.replace(/^I-/, "");
      if (base !== "<body>") continue;
      for (const t of seg.lines[i]!.tokens) bodyTokens.push(t);
    }
    expect(bodyTokens.length).toBeGreaterThan(500);

    const pageHeights = new Map<number, number>();
    for (const p of doc.pages) pageHeights.set(p.pageNumber, p.height);
    const full = extractFulltextFeatures(bodyTokens, { pageHeights });
    expect(full.rows.length).toBe(bodyTokens.length);
    for (const r of full.rows) expect(r.length).toBe(27);

    const out = decode(fullModel, full.rows);
    const hist = new Map<string, number>();
    for (const l of out.labels) hist.set(l, (hist.get(l) ?? 0) + 1);
    // eslint-disable-next-line no-console
    console.log("fulltext label histogram:", Object.fromEntries(hist));

    // The model's label set: <paragraph>, <section>, <citation_marker>,
    // <figure>, <figure_marker>, <table>, <table_marker>, <equation>, etc.
    // Paragraph should dominate; we should see at least one section header.
    const baseTags = new Set(out.labels.map((l) => l.replace(/^I-/, "")));
    expect(baseTags.has("<paragraph>")).toBe(true);
    // Section markers — at minimum one section heading on a 15-page paper.
    const sectionHits = out.labels.filter((l) => /<section>/.test(l)).length;
    expect(sectionHits).toBeGreaterThanOrEqual(1);
  }, 240_000);
});
