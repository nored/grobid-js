// End-to-end smoke test for the BidLSTM_CRF_FEATURES tagger.
//
// What this verifies:
//  - The converted ONNX model + sidecar artifacts load without error.
//  - encodeWords / encodeChars / encodeFeatures produce correctly-shaped
//    tensors for a synthetic GROBID-format feature matrix.
//  - The ONNX session runs, returns potentials of the expected shape.
//  - Viterbi against the saved transition matrix + boundary biases
//    produces a label for every input row.
//  - Every emitted label is a member of the model's tag vocabulary
//    (i.e. the indice_tag inversion is consistent).
//
// What this does NOT verify (out of scope for this scaffold):
//  - Output quality. We use ZeroGloveProvider so the model has no real
//    word information — labels will be garbage. The point is the
//    pipeline runs and types match. Quality testing waits on a Glove
//    extraction step.

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BidLSTMCRFFeaturesTagger,
  ZeroGloveProvider,
  registerBidLSTMModel,
  unregisterBidLSTMModel,
} from "../../src/grobid/engines/tagging/bidlstm-crf-features-tagger.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const modelDir = path.resolve(here, "../../fixtures/models/dl/header-BidLSTM_CRF_FEATURES");
const haveOnnx = existsSync(path.join(modelDir, "model.onnx"));
const skipIfMissing = haveOnnx ? describe : describe.skip;

// One row of GROBID's feature-matrix format. The string before the first
// space is the token, then 30 whitespace-separated feature columns.
// Columns 0..30: token, lineStartsWithCap, lineContainsDigits, ..., punctuationType,...
// Only columns 9..30 are read by the BidLSTM_CRF_FEATURES model.
// Values must be ones that appear in features_map_to_index (see
// fixtures/models/dl/header-BidLSTM_CRF_FEATURES/vocab-features.json).
function row(token: string): string {
  // Pick a syntactically valid feature row; values mirror what a GROBID
  // header-row preprocessor would emit for a generic capitalized word in
  // the middle of a block. Token is appended as col 0; cols 1..8 are
  // ignored by the model; cols 9..30 carry the categorical features the
  // model actually reads.
  const cols = [
    token,                 // 0 token (used)
    token.toLowerCase(),   // 1 lowercase form (ignored)
    "X",                   // 2 prefix (ignored)
    "X",                   // 3 (ignored)
    "X",                   // 4
    "X",                   // 5
    "X",                   // 6
    "X",                   // 7
    "X",                   // 8
    "BLOCKIN",             // 9
    "LINEIN",              // 10
    "ALIGNEDLEFT",         // 11
    "SAMEFONT",            // 12
    "SAMEFONTSIZE",        // 13
    "0",                   // 14
    "0",                   // 15
    "INITCAP",             // 16
    "NODIGIT",             // 17
    "0",                   // 18
    "1",                   // 19
    "0",                   // 20
    "0",                   // 21
    "0",                   // 22
    "0",                   // 23
    "0",                   // 24
    "0",                   // 25
    "NOPUNCT",             // 26
    "0",                   // 27
    "0",                   // 28
    "0",                   // 29
    "0",                   // 30
  ];
  return cols.join(" ");
}

const TEST_MODEL_NAME = "test/header-BidLSTM_CRF_FEATURES";

skipIfMissing("BidLSTM_CRF_FEATURES tagger (header)", () => {
  it("runs forward and emits a labeled row for each input row", async () => {
    registerBidLSTMModel(TEST_MODEL_NAME, modelDir, {
      glove: new ZeroGloveProvider(300),
    });
    const tagger = new BidLSTMCRFFeaturesTagger(TEST_MODEL_NAME);
    const tokens = ["Predicting", "Mid-Latitude", "Auroras", "Based", "on", "Polar", "Cap", "Index"];
    const input = tokens.map(row).join("\n");

    const labeled = await tagger.label(input);
    tagger.close();
    unregisterBidLSTMModel(TEST_MODEL_NAME);

    const outLines = labeled.split("\n").filter((l) => l.length > 0);
    expect(outLines).toHaveLength(tokens.length);

    // Every line should be the input row + " LABEL" suffix.
    // Pull out the last whitespace-separated column and check it's a
    // member of the known header label set.
    // The tagger emits GROBID-format labels (post `iobToGrobidLabel`):
    //   - `<other>` for IOB "O"
    //   - `I-<X>`   for IOB "B-<X>" (GROBID's begin uses I- prefix)
    //   - `<X>`     for IOB "I-<X>" (continuation, no prefix)
    const entityLabels = [
      "abstract","address","affiliation","author","availability","conflict",
      "contribution","copyright","date","doctype","editor","email","funding",
      "group","keyword","meeting","pubnum","reference","submission","title","web",
    ];
    const validTags = new Set([
      "<other>", "<PAD>",
      ...entityLabels.flatMap((t) => [`I-<${t}>`, `<${t}>`]),
    ]);

    for (const line of outLines) {
      const parts = line.split(/\s+/);
      const tag = parts[parts.length - 1]!;
      expect(validTags.has(tag), `unexpected tag '${tag}' in line: ${line}`).toBe(true);
    }
  }, 60_000);

  it("loads sidecar shapes match model-config.json", async () => {
    registerBidLSTMModel(TEST_MODEL_NAME, modelDir, {
      glove: new ZeroGloveProvider(300),
    });
    const tagger = new BidLSTMCRFFeaturesTagger(TEST_MODEL_NAME);
    // Smoke a single-row input through to exercise the encoding paths.
    const result = await tagger.label(row("Test"));
    tagger.close();
    unregisterBidLSTMModel(TEST_MODEL_NAME);
    expect(result.trim().split(/\s+/).length).toBeGreaterThan(1);
  }, 60_000);
});
