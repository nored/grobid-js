// Regression test: confirms a Latin-script PDF produces identical TEI output
// (modulo timestamps / non-deterministic IDs) regardless of the
// `nonLatinHandling` knob. This guarantees we haven't regressed on the 95%+
// majority of papers in our corpora.

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Grobid } from "../../src/node/grobid.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const modelsDir = path.resolve(here, "../../fixtures/models");
const lexiconDir = path.resolve(here, "../../fixtures/lexicon");
const pdfaltoBin = path.resolve(here, "../../fixtures/pdfalto/pdfalto/mac/arm64/pdfalto");
const samplePdf = path.resolve(here, "../../fixtures/sample-arxiv.pdf");

const have = existsSync(modelsDir) && existsSync(lexiconDir) && existsSync(pdfaltoBin) && existsSync(samplePdf);
const skipIfMissing = have ? describe : describe.skip;

/** Strip non-deterministic fields (timestamps) before comparison. */
function normalize(tei: string): string {
  return tei
    .replace(/when="[^"]*"/g, 'when="X"')
    .replace(/xml:id="_[a-z0-9]+"/g, 'xml:id="_X"');
}

skipIfMissing("non-Latin routing — Latin baseline regression", () => {
  it("Latin paper output is identical across all nonLatinHandling modes", async () => {
    const modes: Array<"auto" | "tag" | "skip-header" | "fallback-vlm"> = [
      "auto",
      "tag",
      "skip-header",
      "fallback-vlm",
    ];
    const results: string[] = [];
    for (const mode of modes) {
      const g = new Grobid({
        modelsDir,
        lexiconDir,
        pdfaltoOptions: { binaryPath: pdfaltoBin },
        fallbackMetadata: false,
        nonLatinHandling: mode,
      });
      const tei = await g.processPdf(samplePdf);
      results.push(normalize(tei));
      // Each mode's output must not contain a language note.
      expect(tei).not.toMatch(/<note[^>]*type="language"/);
    }
    // All four results must be byte-identical (after normalizing timestamps).
    expect(results[1]).toBe(results[0]);
    expect(results[2]).toBe(results[0]);
    expect(results[3]).toBe(results[0]);
  }, 600_000);
});
