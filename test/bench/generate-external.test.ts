// External validation: produces grobid-js TEI for every PDF in
// fixtures/external-corpus/ into fixtures/external-corpus/grobid-js/.
// Mirrors generate.test.ts but points at the external corpus (not in fixtures/corpus/).

import { describe, it } from "vitest";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Grobid } from "../../src/node/grobid.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const modelsDir = path.resolve(here, "../../fixtures/models");
const lexiconDir = path.resolve(here, "../../fixtures/lexicon");
const corpusDir = path.resolve(here, "../../fixtures/external-corpus");
const outDir = path.resolve(corpusDir, "grobid-js");
const pdfaltoBin = path.resolve(here, "../../fixtures/pdfalto/pdfalto/mac/arm64/pdfalto");

const haveModels = existsSync(modelsDir);
const havePdfalto = existsSync(pdfaltoBin);
const haveCorpus = existsSync(corpusDir) && readdirSync(corpusDir).some((f) => f.endsWith(".pdf"));
const skipIfMissing = haveModels && havePdfalto && haveCorpus ? describe : describe.skip;

skipIfMissing("bench-external: generate grobid-js TEI for external corpus", () => {
  it("produces TEI for every PDF using the upstream-faithful pipeline", async () => {
    mkdirSync(outDir, { recursive: true });
    const g = new Grobid({
      modelsDir,
      lexiconDir,
      pdfaltoOptions: { binaryPath: pdfaltoBin },
      // The arXiv / DOI metadata-fallback post-processor is benchmarked
      // separately; disable it here so the bench-external output reflects
      // only the CRF pipeline.
      fallbackMetadata: false,
    });
    const pdfs = readdirSync(corpusDir).filter((f) => f.endsWith(".pdf")).sort();
    for (const name of pdfs) {
      const pdfPath = path.join(corpusDir, name);
      const t0 = Date.now();
      try {
        const tei = await g.processPdf(pdfPath);
        const outPath = path.join(outDir, name.replace(/\.pdf$/i, ".tei.xml"));
        writeFileSync(outPath, tei, "utf8");
        // eslint-disable-next-line no-console
        console.log(`${name}: ${Date.now() - t0} ms, ${tei.length} bytes`);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`${name}: FAILED — ${(err as Error).message}`);
      }
    }
  }, 1_800_000);
});
