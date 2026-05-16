import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPdfFromPath } from "../../src/node/load-pdf.js";
import { extractSegmentationFeatures } from "../../src/core/features/segmentation.js";
import { loadWapitiModel } from "../../src/core/crf/wapiti-model.js";
import { decode } from "../../src/core/crf/wapiti-decoder.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const modelPath = path.resolve(here, "../../fixtures/models/segmentation.wapiti");
const pdfPath = path.resolve(here, "../../fixtures/sample-arxiv.pdf");

const skipIfNoFixtures = existsSync(modelPath) && existsSync(pdfPath) ? describe : describe.skip;

skipIfNoFixtures("End-to-end: real PDF → real segmentation model", () => {
  it("labels lines with the GROBID segmentation tag set and finds header/body/references", async () => {
    // Load real model (62 MB) and PDF.
    const modelBytes = readFileSync(modelPath);
    const model = loadWapitiModel(modelBytes);
    expect(model.patterns.length).toBe(111);
    expect(model.labels.length).toBeGreaterThanOrEqual(10);

    const doc = await loadPdfFromPath(pdfPath);
    const { rows, lines } = extractSegmentationFeatures(doc);
    expect(rows.length).toBeGreaterThan(50);
    expect(rows.length).toBe(lines.length);

    const out = decode(model, rows);
    expect(out.labels.length).toBe(rows.length);

    const hist = new Map<string, number>();
    for (const l of out.labels) hist.set(l, (hist.get(l) ?? 0) + 1);
    // eslint-disable-next-line no-console
    console.log("segmentation label histogram:", Object.fromEntries(hist));
    // eslint-disable-next-line no-console
    console.log("first 20 labels:", out.labels.slice(0, 20));
    // eslint-disable-next-line no-console
    console.log("first 5 rows (truncated):", rows.slice(0, 5).map((r) => r.slice(0, 12).join(" | ")));

    const baseTags = new Set(out.labels.map((l) => l.replace(/^I-/, "")));
    expect(baseTags.has("<body>")).toBe(true);

    // The first few lines should land in the header zone, since that's
    // where the title and authors live on the first page.
    const firstFew = out.labels.slice(0, 8).map((l) => l.replace(/^I-/, ""));
    const headerHits = firstFew.filter((t) => t === "<header>").length;
    expect(headerHits).toBeGreaterThanOrEqual(1);
  }, 180_000);
});
