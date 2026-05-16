// Side-by-side comparison: same PDF, two runs — once with Wapiti for the
// header model, once with BiLSTM_CRF_FEATURES. Both write their TEIs and
// extract the <teiHeader>/<fileDesc>/<titleStmt>+<sourceDesc> region for
// diffing. The point isn't to assert one is "correct" (that's the VLM-judge
// harness's job) — just to confirm the two engines produce structurally
// similar output and that BiLSTM is actually classifying tokens
// non-trivially (not collapsing everything to one label).

import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Grobid } from "../../src/node/grobid.js";
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
  existsSync(path.join(dlModelDir, "model.onnx")) &&
  existsSync(path.join(dlModelDir, "glove-vocab.txt")) &&
  existsSync(path.join(dlModelDir, "glove-vectors.bin")) &&
  existsSync(pdfaltoBin) &&
  existsSync(corpusDir);
const skipIfMissing = haveAll ? describe : describe.skip;

function extractHeaderBlock(tei: string): string {
  // Pull out the teiHeader block for comparison (the parts the header
  // model decides: <titleStmt>, <publicationStmt>, <sourceDesc>).
  const m = tei.match(/<teiHeader[\s\S]*?<\/teiHeader>/);
  return m ? m[0] : "(no teiHeader)";
}

skipIfMissing("BidLSTM vs Wapiti — header model A/B", () => {
  it("processes the same PDF on both engines and writes diffable outputs", async () => {
    const pdfs = readdirSync(corpusDir).filter((f) => f.endsWith(".pdf")).sort();
    const pdfPath = path.join(corpusDir, pdfs[0]!);
    const outDir = path.resolve(projectRoot, "test-output/bidlstm-vs-wapiti");
    mkdirSync(outDir, { recursive: true });

    // Wapiti baseline.
    const gWap = new Grobid({
      modelsDir,
      lexiconDir,
      pdfaltoOptions: { binaryPath: pdfaltoBin },
    });
    const teiWap = await gWap.processPdf(pdfPath);

    // BiLSTM for header only.
    const gBi = new Grobid({
      modelsDir,
      lexiconDir,
      pdfaltoOptions: { binaryPath: pdfaltoBin },
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
    const teiBi = await gBi.processPdf(pdfPath);

    writeFileSync(path.join(outDir, "wapiti.tei.xml"), teiWap, "utf8");
    writeFileSync(path.join(outDir, "bidlstm.tei.xml"), teiBi, "utf8");

    const blockWap = extractHeaderBlock(teiWap);
    const blockBi = extractHeaderBlock(teiBi);
    writeFileSync(path.join(outDir, "wapiti-header.xml"), blockWap, "utf8");
    writeFileSync(path.join(outDir, "bidlstm-header.xml"), blockBi, "utf8");

    // eslint-disable-next-line no-console
    console.log(`\nWapiti  teiHeader (${blockWap.length} bytes):\n${blockWap.slice(0, 1500)}\n`);
    // eslint-disable-next-line no-console
    console.log(`\nBiLSTM  teiHeader (${blockBi.length} bytes):\n${blockBi.slice(0, 1500)}\n`);
    // eslint-disable-next-line no-console
    console.log(`\nWrote outputs to ${outDir}/{wapiti,bidlstm}{,-header}.{tei.xml,xml}`);

    // Both must produce SOME teiHeader. We don't assert equality.
    expect(blockWap.length).toBeGreaterThan(100);
    expect(blockBi.length).toBeGreaterThan(100);
  }, 180_000);
});
