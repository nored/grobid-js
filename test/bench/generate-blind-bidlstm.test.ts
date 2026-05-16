// Variant of generate-blind that routes the header model through the
// BiLSTM_CRF_FEATURES ONNX tagger instead of Wapiti. Output goes to
// `fixtures/blind-corpus/grobid-js-bidlstm/` so it doesn't clobber the
// Wapiti TEIs in `grobid-js/`, allowing vlm-judge-blind to score both
// engines (set `GROBID_JS_DIR` env to switch).

import { describe, it } from "vitest";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Grobid } from "../../src/node/grobid.js";
import { GloveFileProvider } from "../../src/grobid/engines/tagging/glove-file-provider.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const modelsDir = path.resolve(here, "../../fixtures/models");
const lexiconDir = path.resolve(here, "../../fixtures/lexicon");
const corpusDir = path.resolve(here, "../../fixtures/blind-corpus");
const outDir = path.resolve(corpusDir, "grobid-js-bidlstm");
const pdfaltoBin = path.resolve(here, "../../fixtures/pdfalto/pdfalto/mac/arm64/pdfalto");
const dlModelDir = path.resolve(
  here,
  process.env.DL_MODEL_DIR ??
    "../../fixtures/models/dl/header-BidLSTM_CRF_FEATURES",
);

const haveModels = existsSync(modelsDir);
const havePdfalto = existsSync(pdfaltoBin);
const haveCorpus = existsSync(corpusDir) && readdirSync(corpusDir).some((f) => f.endsWith(".pdf"));
const haveDl =
  existsSync(path.join(dlModelDir, "model.onnx")) &&
  existsSync(path.join(dlModelDir, "glove-vocab.txt")) &&
  existsSync(path.join(dlModelDir, "glove-vectors.bin"));
const skipIfMissing = haveModels && havePdfalto && haveCorpus && haveDl ? describe : describe.skip;

skipIfMissing("bench-blind-bidlstm: generate grobid-js TEI with BiLSTM header for blind corpus", () => {
  it("produces TEI for every blind PDF", async () => {
    mkdirSync(outDir, { recursive: true });
    const g = new Grobid({
      modelsDir,
      lexiconDir,
      pdfaltoOptions: { binaryPath: pdfaltoBin },
      fallbackMetadata: false,
      bidlstmModels: {
        header: {
          modelDir: dlModelDir,
          glove: new GloveFileProvider(
            path.join(dlModelDir, "glove-vocab.txt"),
            path.join(dlModelDir, "glove-vectors.bin"),
          ),
        },
      },
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
  }, 3_600_000);
});
