# Post-parity todo

Items to pick up **after** grobid-js reaches upstream GROBID's Wapiti-baseline
parity. As of the current commit, all originally-listed Wapiti-parity work
is complete:

- ✅ Strip non-upstream heuristics (#10)
- ✅ Lexicon — Tier 1+2+3 shipped, ~75 MB across 17 files (#11, #18, #19)
- ✅ pdfalto (#12)
- ✅ AffiliationAddressParser + author/affiliation marker linking (#13)
- ✅ CitationMatcher (#14)
- ✅ name-citation sub-model (#15)
- ✅ date sub-model with month polyglot normalization (#16)
- ✅ Engine post-processors (cleanField, cleanTitle, cleanAbstract, cleanKeywords,
  dehyphenize, stripBibliographySectionKeyword) (#17)
- ✅ Model asset distribution with auto-download + SHA verification (#8)
- ✅ Figure / table marker linking in body (#19)
- ✅ Long-author-list recovery — resolved by Tier 1+2 lexicon activation
  (Mixtral 24-author paper now correctly produces 28 author entries)

## Post-parity work (deferred)

### DeLFT / BERT model variants

Upstream optionally runs deep-learning models in place of the Wapiti CRFs.
Two architectures with very different availability:

**BidLSTM_CRF_FEATURES** — Keras BiLSTM + feature channel + Glove
embeddings + CRF Viterbi. Weights are publicly shipped in
`kermitt2/grobid/grobid-home/models/*-BidLSTM_CRF_FEATURES/`. Upstream's
own benchmark files (`grobid-trainer/doc/`) report **+3-5 F1 over Wapiti
on citation**; gains on header are documented as "slightly better than
CRF". This is the variant upstream's `grobid-full.yaml` DL config
actually selects. **In flight — Phase 14b agent.**

**BERT_CRF (SciBERT)** — `allenai/scibert_scivocab_cased` + DeLFT's CRF
head. **No public weights exist.** Upstream doc
`Deep-Learning-models.md:95` explicitly says only the BidLSTM variants
are shipped "given the size of BERT transformer models (400MB)." For
citation, upstream notes SciBERT performs **worse** than the BiLSTM
variants. No header SciBERT benchmarks have been published. To use it
we'd need to train from scratch — see next item.

### Local BERT_CRF training on Apple Silicon

Future overnight job for the M3 Pro Max MacBook. GROBID itself ships
the training data in `kermitt2/grobid/grobid-trainer/resources/dataset/`
(per-task: `header/corpus/`, `citation/corpus/`,
`reference-segmenter/corpus/`, etc., BSD-licensed, XML-tagged).

To set up:

1. **Environment.** `scripts/train-bert-crf/` with a venv recipe pinning
   TF 2.7-2.9 + `tensorflow-metal` + DeLFT v0.4.x. Expect a half-day of
   tooling friction — DeLFT's TF pin and its custom Keras-CRF layer
   need to play nicely with MPS.

2. **Smoke test.** A 1-epoch run on the header corpus that verifies the
   training loop reaches the CRF layer without OOM or NaN, before
   committing to the full run.

3. **Training order.** Header first (smallest corpus, most impactful
   for output quality), then citation, then reference-segmenter. Skip
   the structural models — Wapiti is already competitive there.

4. **Estimated wall-clock.** Per task: ~overnight on M3 Pro Max via MPS
   (2-4× slower than NVIDIA CUDA quotes of 4-12 hours, but the
   per-task dataset is small enough to fit in one sleep cycle).

5. **Resulting weights** would be unique to this project — no public
   mirror exists. Stage in `fixtures/models/dl/` alongside the
   BidLSTM_CRF_FEATURES weights and route via the same
   `GrobidCRFEngine.BERT_CRF` opt-in.

### JS DL inference runtime (shared by both DL paths above)

1. **Runtime.** `onnxruntime-node` server-side, `onnxruntime-web` (~25 MB
   WASM) for browser/Electron.

2. **DeLFT tokenizer + sequence-labeler decoder port.**
   - Token preprocessing (subword tokenization for BERT variants,
     character-level features for BiLSTM).
   - Label sequence decoder: CRF Viterbi reusing the proven
     `src/grobid/jni/wapiti-*.ts` Viterbi pattern.
   - Subword-span → `LayoutToken` granularity mapping.

3. **Model conversion.** Upstream BiLSTM models are Keras HDF5. Convert
   to ONNX once via `tf2onnx`; export the CRF transition matrix
   separately so we can run Viterbi in JS.

4. **Asset distribution.** Each DL model is 100–400 MB. Same approach as
   pdfalto: optional download on first use, or env var override for
   Electron-bundled assets. Per-model swap behind the `PipelineModels`
   interface.

### ~~CrossRef consolidation~~ ✅ shipped

Implemented in `src/core/consolidate/crossref.ts`. Opt-in via
`processOptions.consolidateReferences: true` (or an options object for
polite-pool mailto, concurrency, similarity threshold). Off by default
so offline deployments are unaffected. Live-tested DOI recovery on the
corpus: 0% → 29% on arXiv, 0% → 46% on USENIX. Faithful port of
upstream's `Consolidation.postValidation` Ratcliff-Obershelp surname
similarity check (≥0.8 threshold).

### Browser pdfalto (WASM)

The Node + Electron path uses the native pdfalto binary. For
browser-only deployment without Electron, the binary can be replaced
with a WASM build of pdfalto + patched Xpdf via Emscripten. Same JS
parser on the consuming side; only the transport changes. Multi-week
project; deferred until there's a concrete browser-only deployment ask.
