// Blind-corpus generator: produces grobid-js TEI for every PDF in
// fixtures/blind-corpus/. The 115 papers there are ones the port has
// never been run against during development; this is the generalization
// test.

import { describe, it } from "vitest";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Grobid } from "../../src/node/grobid.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const modelsDir = path.resolve(here, "../../fixtures/models");
const lexiconDir = path.resolve(here, "../../fixtures/lexicon");
const corpusDir = path.resolve(here, "../../fixtures/blind-corpus");
const outDir = path.resolve(corpusDir, "grobid-js");
const pdfaltoBin = path.resolve(here, "../../fixtures/pdfalto/pdfalto/mac/arm64/pdfalto");

const haveModels = existsSync(modelsDir);
const havePdfalto = existsSync(pdfaltoBin);
const haveCorpus = existsSync(corpusDir) && readdirSync(corpusDir).some((f) => f.endsWith(".pdf"));
const skipIfMissing = haveModels && havePdfalto && haveCorpus ? describe : describe.skip;

skipIfMissing("bench-blind: generate grobid-js TEI for blind corpus", () => {
  it("produces TEI for every blind PDF", async () => {
    mkdirSync(outDir, { recursive: true });
    const g = new Grobid({
      modelsDir,
      lexiconDir,
      pdfaltoOptions: { binaryPath: pdfaltoBin },
      // The arXiv / DOI metadata-fallback post-processor is a separate
      // feature whose behaviour is benchmarked elsewhere. Disable it here
      // so the bench-blind output reflects only the CRF pipeline (plus the
      // page-1 cleanup pass that's been baked-in since the previous run).
      fallbackMetadata: false,
    });
    const pdfs = readdirSync(corpusDir).filter((f) => f.endsWith(".pdf")).sort();
    let ok = 0;
    let fail = 0;
    for (const name of pdfs) {
      const pdfPath = path.join(corpusDir, name);
      const t0 = Date.now();
      try {
        const tei = await g.processPdf(pdfPath);
        const outPath = path.join(outDir, name.replace(/\.pdf$/i, ".tei.xml"));
        writeFileSync(outPath, tei, "utf8");
        ok++;
        // eslint-disable-next-line no-console
        console.log(`${name}: ${Date.now() - t0} ms, ${tei.length} bytes`);
      } catch (err) {
        fail++;
        // eslint-disable-next-line no-console
        console.error(`${name}: FAILED — ${(err as Error).message}`);
      }
    }
    // eslint-disable-next-line no-console
    console.log(`\nTotal: ${ok}/${pdfs.length} succeeded, ${fail} failed`);
  }, 1_800_000);
});
