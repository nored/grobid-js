// Targeted end-to-end check that:
//   - the 4 known Cyrillic papers are tagged as cyrillic in TEI output
//   - the `<note type="language" script="cyrillic">` block is present
//   - a Latin baseline paper produces output WITHOUT the note (no regression)
//
// Skipped automatically when the fixtures aren't available so this test stays
// green for contributors who haven't cached the corpus locally.

import { describe, it, expect } from "vitest";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Grobid } from "../../src/node/grobid.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const modelsDir = path.resolve(here, "../../fixtures/models");
const lexiconDir = path.resolve(here, "../../fixtures/lexicon");
const pdfaltoBin = path.resolve(here, "../../fixtures/pdfalto/pdfalto/mac/arm64/pdfalto");
const blindCorpus = path.resolve(here, "../../fixtures/blind-corpus");
const extCorpus = path.resolve(here, "../../fixtures/external-corpus");

const have = existsSync(modelsDir) && existsSync(lexiconDir) && existsSync(pdfaltoBin);
const skipIfMissing = have ? describe : describe.skip;

const cyrillicPapers: { pdf: string; label: string }[] = [
  { pdf: path.join(blindCorpus, "paper_426.pdf"), label: "paper_426 (RU)" },
  { pdf: path.join(blindCorpus, "paper_435.pdf"), label: "paper_435 (RU)" },
  { pdf: path.join(blindCorpus, "paper_443.pdf"), label: "paper_443 (UK)" },
  { pdf: path.join(extCorpus, "paper_040.pdf"), label: "paper_040 (UK)" },
];

skipIfMissing("non-Latin routing — Cyrillic tagging", () => {
  for (const p of cyrillicPapers) {
    if (!existsSync(p.pdf)) continue;
    it(`tags ${p.label} as cyrillic in TEI output`, async () => {
      const g = new Grobid({
        modelsDir,
        lexiconDir,
        pdfaltoOptions: { binaryPath: pdfaltoBin },
        // Disable network-dependent post-processing so this test is hermetic.
        fallbackMetadata: false,
        // tag (default) — should inject the <note type="language"> block.
        nonLatinHandling: "tag",
      });
      const tei = await g.processPdf(p.pdf);
      // Write next to the PDF for inspection.
      const outPath = p.pdf.replace(/\.pdf$/i, ".tag.tei.xml");
      writeFileSync(outPath, tei, "utf8");
      expect(tei).toMatch(/<note[^>]*type="language"[^>]*script="cyrillic"/);
    }, 600_000);
  }

  it("does NOT tag a Latin-script paper", async () => {
    const pdf = path.resolve(here, "../../fixtures/sample-arxiv.pdf");
    if (!existsSync(pdf)) {
      // Skip-style: skip via a passing assertion. This keeps CI green when
      // sample-arxiv isn't checked out.
      expect(true).toBe(true);
      return;
    }
    const g = new Grobid({
      modelsDir,
      lexiconDir,
      pdfaltoOptions: { binaryPath: pdfaltoBin },
      fallbackMetadata: false,
      nonLatinHandling: "tag",
    });
    const tei = await g.processPdf(pdf);
    expect(tei).not.toMatch(/<note[^>]*type="language"/);
  }, 600_000);
});

skipIfMissing("non-Latin routing — skip-header mode", () => {
  it("drops the CRF-extracted titleStmt body on a Cyrillic paper", async () => {
    const pdf = path.join(blindCorpus, "paper_443.pdf");
    if (!existsSync(pdf)) {
      expect(true).toBe(true);
      return;
    }
    const g = new Grobid({
      modelsDir,
      lexiconDir,
      pdfaltoOptions: { binaryPath: pdfaltoBin },
      fallbackMetadata: false,
      nonLatinHandling: "skip-header",
    });
    const tei = await g.processPdf(pdf);
    const outPath = pdf.replace(/\.pdf$/i, ".skip-header.tei.xml");
    writeFileSync(outPath, tei, "utf8");
    // The skip-header stub leaves an empty <title level="a" type="main"/>
    expect(tei).toMatch(/<title level="a" type="main"\/>/);
    // And the language note must be present.
    expect(tei).toMatch(/<note[^>]*type="language"[^>]*script="cyrillic"/);
  }, 600_000);
});

skipIfMissing("non-Latin routing — fallback-vlm with default (throwing) extractor", () => {
  it("falls back to 'tag' behavior when the VLM extractor throws", async () => {
    const pdf = path.join(blindCorpus, "paper_443.pdf");
    if (!existsSync(pdf)) {
      expect(true).toBe(true);
      return;
    }
    const g = new Grobid({
      modelsDir,
      lexiconDir,
      pdfaltoOptions: { binaryPath: pdfaltoBin },
      fallbackMetadata: false,
      nonLatinHandling: "fallback-vlm",
    });
    const tei = await g.processPdf(pdf);
    // Should still produce a TEI document with the language note (graceful fallback).
    expect(tei).toMatch(/<note[^>]*type="language"[^>]*script="cyrillic"/);
  }, 600_000);
});
