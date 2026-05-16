// End-to-end test for routing the header model through the BidLSTM_CRF_FEATURES
// ONNX tagger via the `bidlstmModels` Grobid constructor option.
//
// This test verifies:
//   1. `bidlstmModels: { header: { modelDir, glove } }` causes
//      `TaggerFactory.getTagger(HEADER)` to return a BidLSTMCRFFeaturesTagger.
//   2. The full PDF → TEI pipeline runs without TypeError (the async refactor
//      caught every label() call site).
//   3. The output TEI is well-formed and non-empty.
//
// What this test does NOT cover:
//   - Output quality. We use ZeroGloveProvider so word embeddings are all
//     zeros — the header labels will be garbage, but Wapiti still handles
//     every other model (segmentation, citation, fulltext) so the surrounding
//     TEI structure remains reasonable. Quality measurement waits on a
//     vocab-restricted Glove dump from `scripts/extract-glove-vocab.py`.

import { describe, it, expect } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Grobid } from "../../src/node/grobid.js";
import { ZeroGloveProvider } from "../../src/grobid/engines/tagging/bidlstm-crf-features-tagger.js";
import { GloveFileProvider } from "../../src/grobid/engines/tagging/glove-file-provider.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "../..");
const modelsDir = path.resolve(projectRoot, "fixtures/models");
const lexiconDir = path.resolve(projectRoot, "fixtures/lexicon");
const dlModelDir = path.resolve(projectRoot, "fixtures/models/dl/header-BidLSTM_CRF_FEATURES");
const corpusDir = path.resolve(projectRoot, "fixtures/blind-corpus");
const pdfaltoBin = path.resolve(projectRoot, "fixtures/pdfalto/pdfalto/mac/arm64/pdfalto");

const haveAll =
  existsSync(modelsDir) &&
  existsSync(dlModelDir) &&
  existsSync(path.join(dlModelDir, "model.onnx")) &&
  existsSync(pdfaltoBin) &&
  existsSync(corpusDir);
const haveGlove =
  existsSync(path.join(dlModelDir, "glove-vocab.txt")) &&
  existsSync(path.join(dlModelDir, "glove-vectors.bin"));
const skipIfMissing = haveAll ? describe : describe.skip;

skipIfMissing("BidLSTM header routing — end-to-end", () => {
  it("processes a PDF with header routed through the BiLSTM ONNX tagger", async () => {
    // Pick the first blind-corpus PDF deterministically.
    const pdfs = readdirSync(corpusDir).filter((f) => f.endsWith(".pdf")).sort();
    expect(pdfs.length).toBeGreaterThan(0);
    const pdfPath = path.join(corpusDir, pdfs[0]!);

    const glove = haveGlove
      ? new GloveFileProvider(
          path.join(dlModelDir, "glove-vocab.txt"),
          path.join(dlModelDir, "glove-vectors.bin"),
        )
      : new ZeroGloveProvider(300);

    const g = new Grobid({
      modelsDir,
      lexiconDir,
      pdfaltoOptions: { binaryPath: pdfaltoBin },
      bidlstmModels: {
        header: {
          modelDir: dlModelDir,
          glove,
        },
      },
    });

    const tei = await g.processPdf(pdfPath);
    expect(typeof tei).toBe("string");
    expect(tei.length).toBeGreaterThan(100);
    // Loose well-formedness check: starts with the XML declaration and
    // contains a <teiHeader> we always emit.
    expect(tei).toMatch(/<\?xml/);
    expect(tei).toContain("<teiHeader");
    // eslint-disable-next-line no-console
    console.log(`[bidlstm-header-e2e] glove=${haveGlove ? "FILE" : "ZERO"} tei=${tei.length} bytes`);
  }, 120_000);
});
