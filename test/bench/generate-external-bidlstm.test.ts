// External-corpus regen with BiLSTM header. Mirrors generate-blind-bidlstm but
// targets fixtures/external-corpus/.

import { describe, it } from "vitest";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Grobid } from "../../src/node/grobid.js";
import { GloveFileProvider } from "../../src/grobid/engines/tagging/glove-file-provider.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const modelsDir = path.resolve(here, "../../fixtures/models");
const lexiconDir = path.resolve(here, "../../fixtures/lexicon");
const corpusDir = path.resolve(here, "../../fixtures/external-corpus");
const outDir = path.resolve(corpusDir, "grobid-js-bidlstm");
const pdfaltoBin = path.resolve(here, "../../fixtures/pdfalto/pdfalto/mac/arm64/pdfalto");
const dlModelDir = path.resolve(here, "../../fixtures/models/dl/header-BidLSTM_CRF_FEATURES");

const haveAll =
  existsSync(modelsDir) &&
  existsSync(pdfaltoBin) &&
  existsSync(corpusDir) &&
  existsSync(path.join(dlModelDir, "model.onnx")) &&
  existsSync(path.join(dlModelDir, "glove-vocab.txt"));
const skipIfMissing = haveAll ? describe : describe.skip;

skipIfMissing("bench-external-bidlstm", () => {
  it("regenerates external corpus with BiLSTM header", async () => {
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
    for (const name of pdfs) {
      const pdfPath = path.join(corpusDir, name);
      try {
        const tei = await g.processPdf(pdfPath);
        writeFileSync(path.join(outDir, name.replace(/\.pdf$/i, ".tei.xml")), tei, "utf8");
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`${name}: ${(err as Error).message}`);
      }
    }
  }, 3_600_000);
});
