// End-to-end test: spawn the real pdfalto binary, parse its ALTO output,
// drive the full GROBID-js cascade on top. Skipped if the binary isn't
// installed locally — the test does NOT trigger an auto-download to keep
// CI runs hermetic; set GROBID_PDFALTO_BIN or vendor a binary under
// fixtures/pdfalto/ to enable it.

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPdfAltoFromPath } from "../../src/node/load-pdf-alto.js";
import { Grobid } from "../../src/node/grobid.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const modelsDir = path.resolve(here, "../../fixtures/models");
const lexiconDir = path.resolve(here, "../../fixtures/lexicon");
const pdfPath = path.resolve(here, "../../fixtures/sample-arxiv.pdf");
// Local-vendored binary path (the one we extracted into fixtures/pdfalto/ for
// development). Tests prefer this over the env var so they work in a fresh
// clone after `npm test` if the binary is already laid down.
const localBinary = path.resolve(here, "../../fixtures/pdfalto/pdfalto/mac/arm64/pdfalto");
const envBinary = process.env["GROBID_PDFALTO_BIN"];
const binaryPath = envBinary && existsSync(envBinary)
  ? envBinary
  : existsSync(localBinary)
    ? localBinary
    : null;

const skipIfNoFixtures =
  binaryPath !== null &&
  existsSync(pdfPath) &&
  existsSync(path.join(modelsDir, "segmentation.wapiti"))
    ? describe
    : describe.skip;

skipIfNoFixtures("pdfalto end-to-end", () => {
  it("tokenizes a real PDF and returns RawPages + illustrations", async () => {
    const { layout, illustrations } = await loadPdfAltoFromPath(pdfPath, {
      binaryPath: binaryPath!,
    });
    expect(layout.pages.length).toBeGreaterThan(5);
    expect(layout.tokens.length).toBeGreaterThan(2_000);
    // Spot-check the first page picks up the paper title.
    const p1 = layout.tokens.filter((t) => t.page === 1).map((t) => t.text).join(" ");
    expect(p1.toLowerCase()).toMatch(/attention/);
    // Illustrations are detected (the paper has figures).
    expect(illustrations.length).toBeGreaterThan(0);
    expect(illustrations[0]!.page).toBeGreaterThanOrEqual(1);
  }, 120_000);

  it("drives the full cascade with the pdfalto backend (default)", async () => {
    const g = new Grobid({
      modelsDir,
      lexiconDir,
      pdfBackend: "pdfalto",
      pdfaltoOptions: { binaryPath: binaryPath! },
    });
    const out = await g.processPdf(pdfPath);
    expect(out.header.title).toBeTruthy();
    expect(out.header.title!.toLowerCase()).toMatch(/attention is all you need/);
    expect(out.header.authors.length).toBeGreaterThanOrEqual(3);
    expect(out.references.length).toBeGreaterThanOrEqual(20);
    // No small-caps glyph artifacts in titles — pdfalto delivers proper words.
    expect(out.header.title!).not.toMatch(/\bF LUSH\b/);
  }, 180_000);
});
