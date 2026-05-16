// Regenerate the 4 known Cyrillic test papers under fixtures/*/grobid-js so
// the next vlm-judge run scores the script-aware output. Intentionally limited
// to the 4 papers we changed routing for — full-corpus regeneration is
// handled by `generate-blind.test.ts`.

import { describe, it } from "vitest";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Grobid } from "../../src/node/grobid.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const modelsDir = path.resolve(here, "../../fixtures/models");
const lexiconDir = path.resolve(here, "../../fixtures/lexicon");
const pdfaltoBin = path.resolve(here, "../../fixtures/pdfalto/pdfalto/mac/arm64/pdfalto");
const blindCorpus = path.resolve(here, "../../fixtures/blind-corpus");
const blindOut = path.join(blindCorpus, "grobid-js");
const extCorpus = path.resolve(here, "../../fixtures/external-corpus");
const extOut = path.join(extCorpus, "grobid-js");

const have = existsSync(modelsDir) && existsSync(lexiconDir) && existsSync(pdfaltoBin);
const skipIfMissing = have ? describe : describe.skip;

const targets: Array<{ pdf: string; out: string }> = [
  { pdf: path.join(blindCorpus, "paper_426.pdf"), out: path.join(blindOut, "paper_426.tei.xml") },
  { pdf: path.join(blindCorpus, "paper_435.pdf"), out: path.join(blindOut, "paper_435.tei.xml") },
  { pdf: path.join(blindCorpus, "paper_443.pdf"), out: path.join(blindOut, "paper_443.tei.xml") },
  { pdf: path.join(extCorpus, "paper_040.pdf"), out: path.join(extOut, "paper_040.tei.xml") },
];

skipIfMissing("regenerate Cyrillic TEIs with non-Latin handling", () => {
  it("rewrites fixtures/*/grobid-js/paper_{426,435,443,040}.tei.xml in tag mode (the default)", async () => {
    const g = new Grobid({
      modelsDir,
      lexiconDir,
      pdfaltoOptions: { binaryPath: pdfaltoBin },
      // Use the default 'tag' mode: keep CRF output as-is and only add the
      // <note type="language" script="cyrillic"> so consumers can flag it.
      // Skip-header is available for stricter pipelines (it drops the noisy
      // CRF author guesses entirely) but defaulting to 'tag' avoids
      // regressing on papers where the CRF actually got the author right
      // (paper_426 / paper_435 are surprisingly close to truth, even though
      // the abstract is mis-extracted).
      nonLatinHandling: "tag",
      fallbackMetadata: false,
    });
    for (const t of targets) {
      if (!existsSync(t.pdf)) continue;
      const tei = await g.processPdf(t.pdf);
      writeFileSync(t.out, tei, "utf8");
      // eslint-disable-next-line no-console
      console.log(`wrote ${t.out} (${tei.length} bytes)`);
    }
  }, 1_200_000);
});
