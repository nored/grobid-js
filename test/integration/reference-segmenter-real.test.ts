import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPdfFromPath } from "../../src/node/load-pdf.js";
import { extractSegmentationFeatures } from "../../src/core/features/segmentation.js";
import { extractReferenceSegmenterFeatures } from "../../src/core/features/reference-segmenter.js";
import { loadWapitiModel } from "../../src/core/crf/wapiti-model.js";
import { decode } from "../../src/core/crf/wapiti-decoder.js";
import type { LayoutLine } from "../../src/core/types/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const segPath = path.resolve(here, "../../fixtures/models/segmentation.wapiti");
const refSegPath = path.resolve(here, "../../fixtures/models/reference-segmenter.wapiti");
const pdfPath = path.resolve(here, "../../fixtures/sample-arxiv.pdf");

const skipIfMissing = existsSync(segPath) && existsSync(refSegPath) && existsSync(pdfPath) ? describe : describe.skip;

skipIfMissing("End-to-end: real PDF → segmentation → reference-segmenter", () => {
  it("slices the references zone and marks individual reference entries with I-<ref>", async () => {
    const segModel = loadWapitiModel(readFileSync(segPath));
    const refSegModel = loadWapitiModel(readFileSync(refSegPath));
    expect(refSegModel.patterns.length).toBe(70);

    const doc = await loadPdfFromPath(pdfPath);
    const seg = extractSegmentationFeatures(doc);
    const segLabels = decode(segModel, seg.rows).labels;

    const refLines: LayoutLine[] = [];
    for (let i = 0; i < segLabels.length; i++) {
      const base = segLabels[i]!.replace(/^I-/, "");
      if (base === "<references>") refLines.push(seg.lines[i]!);
    }
    expect(refLines.length).toBeGreaterThan(10);

    const refSeg = extractReferenceSegmenterFeatures(refLines);
    for (const r of refSeg.rows) expect(r.length).toBe(27);

    const out = decode(refSegModel, refSeg.rows);
    // The reference-segmenter labels each token as <reference>, <label>, or
    // <other>, with the BIO `I-` prefix marking the first token of a span.
    // Counting I-<reference> gives the number of individual citation entries.
    const labelStarts = out.labels.filter((l) => /^I-<reference>$/.test(l)).length;
    const hist = new Map<string, number>();
    for (const l of out.labels) hist.set(l, (hist.get(l) ?? 0) + 1);
    // eslint-disable-next-line no-console
    console.log("ref-segmenter label histogram:", Object.fromEntries(hist));
    // eslint-disable-next-line no-console
    console.log("number of individual references detected:", labelStarts);

    // The arXiv paper has ~40 references; require at least 20 detected.
    expect(labelStarts).toBeGreaterThanOrEqual(20);
  }, 240_000);
});
