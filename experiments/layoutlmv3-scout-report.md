# LayoutLMv3 Header-Extraction Scout — Report

**Date:** 2026-05-16
**Author:** scout run (`experiments/layoutlmv3-scout.mjs`)
**Hardware:** macOS, Apple Silicon (M3 Pro Max), Node v22.16.0
**Model:** `microsoft/layoutlmv3-base`, ONNX float32, via `onnxruntime-node@1.26.0`
**Tokenizer:** `roberta-base/tokenizer.json` (LayoutLMv3 uses the RoBERTa vocab; the LayoutLMv3 repo ships only the legacy `vocab.json` + `merges.txt` pair, so the modern `tokenizer.json` was sourced from `roberta-base` — same vocab, same merges)
**Corpus:** 5 papers from `fixtures/blind-corpus/` — `paper_179, paper_180, paper_218, paper_323, paper_429`
**Pipeline:** `pdfalto -f 1 -l 1 -noImage` → `fast-xml-parser` → per-word `(text, x, y, w, h)` + page (W,H); `pdfjs-dist` + `@napi-rs/canvas` → 224×224 RGB render → CHW float32 normalized `(x/255-0.5)/0.5`; BPE tokenisation per word, bbox propagated to every sub-token, quantised to 0..1000; `(input_ids, attention_mask, bbox, pixel_values)` fed to the ONNX session.

Raw outputs: `experiments/out/layoutlmv3-scout-results.json`.
Console log: `experiments/out/layoutlmv3-scout.log`.

---

## 1. Architecture compatibility

| Question | Answer |
|---|---|
| Does `@huggingface/transformers@4.2.0` ship a LayoutLMv3 model class? | **No.** A grep of `node_modules/@huggingface/transformers/src/` for `/layoutlm/i` returns zero hits. No tokenizer, no processor, no model. The probe in the scout (`Object.keys(tx).filter(k => /layoutlm/i.test(k))`) returns `false` at runtime. |
| Does `microsoft/layoutlmv3-base` ship `model.onnx` directly on the HF Hub? | **Yes** (502 MB, fp32, exported by the model authors). No `optimum-cli` conversion needed for the base checkpoint. |
| Does the ONNX model load and run in `onnxruntime-node@1.26.0`? | **Yes.** Session creation 262 ms on warm disk; CPU EP only. |
| What are the model's I/O signatures? | Inputs: `input_ids` (int64 \[1,512]), `bbox` (int64 \[1,512,4]), `attention_mask` (int64 \[1,512]), `pixel_values` (float32 \[1,3,224,224]). Output: `last_hidden_state` (float32 \[1,709,768]). The 709 = 512 text positions + 197 visual patch tokens (14×14 patches + 1 visual CLS), confirming the model fuses text and image embeddings as designed. |
| Can the existing pdfalto pipeline drive it? | **Yes.** The `pdfalto -f 1 -l 1` output is parsed in 7–30 ms and gives `(token, x, y, w, h)` plus page dimensions directly. The bbox quantisation to 0..1000 is a one-liner per word. |
| Does the visual stream require special handling in Node? | The scout uses `pdfjs-dist` + `@napi-rs/canvas` to render page 1 to 224×224, normalised the same way the HF `LayoutLMv3ImageProcessor` does (mean=0.5, std=0.5). Both are already present in `node_modules`. Render time 21–247 ms per page (the 247 ms outlier is paper_179's first call and is pdfjs library-init cost, not per-page cost). |

**Architecture verdict: works.** The only missing piece is a token-classification head with our 22-label GROBID header schema — the base checkpoint's output is contextualised hidden states, not class logits.

## 2. Latency / memory

All numbers from the 5-paper run on M3 Pro Max, fp32 weights, CPU EP, no warm-up:

| Stage | Latency |
|---|---|
| ONNX session creation (warm disk; first run also pays a ~26 s HF download) | **262 ms** |
| `pdfalto` page-1 spawn + write XML | 11–20 ms |
| ALTO XML parse (fast-xml-parser) | 1–30 ms |
| 224×224 page render (pdfjs + canvas) | 21–247 ms (247 is first-call lib init) |
| BPE tokenise per page | 0–8 ms |
| **Model inference, per page (cold and warm — see note below)** | **627–647 ms** |

| Memory | RSS |
|---|---|
| Initial Node RSS | 41 MB |
| After ONNX session create | 962 MB |
| Peak across 5-paper run | **2 057 MB** |
| End of run | 2 057 MB |

**Notes:**

- **Inference latency is flat regardless of text length.** Paper_429 (54 words, 77 sub-tokens) and paper_218 (666 words, 512 sub-tokens, saturated) both ran in ~640 ms. The visual stream and the 512-position attention dominate; the model isn't a generative loop. This is the property that matters for shipping — predictable, sub-second per page, no dependence on author-list cardinality.
- **No meaningful cold-start penalty inside the run.** The first inference call (paper_179, 641 ms) and the warm average over papers 180/218/323/429 (637 ms) differ by 4 ms.
- **Memory is fp32-driven.** A q8 ONNX export (one-shot, 30 lines of `optimum` Python) would land around **800 MB–1 GB RSS**. Browser deployment via `onnxruntime-web` + `wasm` would dominate from the 502 MB model file itself; the **q8 path is the gating item** for browser viability.
- **vs the LLM scout (Qwen2.5-1.5B q4):** **77× faster** per page (640 ms vs ~50 s), **2× lower peak RSS** (2.1 GB vs 4.0 GB), and the latency is *constant* in input length rather than scaling with output length. All three of those are the qualitative wins LayoutLMv3 was supposed to deliver, and the numbers confirm them.

## 3. What we could *not* measure: per-token class accuracy

The user asked specifically: "what does it predict zero-shot on a few real corpus papers — title/author/abstract token classification?"

**The honest answer: nothing usable, because the base checkpoint has no classification head.** The output of `microsoft/layoutlmv3-base/model.onnx` is `last_hidden_state` — a `[1, 709, 768]` tensor of contextualised embeddings. Reading "this token is a `<title>`" off those requires a trained `LayoutLMv3ForTokenClassification` head, which the base model does not contain.

I evaluated three candidate "pre-finetuned" variants that the GROBID-adjacent task could conceivably reuse zero-shot, and none of them work:

| Variant | Task | ONNX shipped? | Suitable for our schema? |
|---|---|---|---|
| `microsoft/layoutlmv3-base` | masked-LM pretraining (no head) | yes (502 MB) | architecture only; no class outputs |
| `HYPJUDY/layoutlmv3-base-finetuned-publaynet` | document-image **object detection** (PubLayNet bboxes: text, title, list, table, figure) | no | wrong task — predicts bounding boxes on a rendered page, not per-text-token labels. Even if we wanted to consume bbox predictions, no ONNX export exists. |
| `HYPJUDY/layoutlmv3-base-finetuned-funsd`, `nielsr/layoutlmv3-finetuned-funsd` | FUNSD token classification (question, answer, header, other) | no | right task shape, wrong label set (form-understanding), and the config.json ships generic `LABEL_0..LABEL_6` so the labels aren't even self-documenting. No ONNX export. |

The architectural fit (PubLayNet's `title` → our `<title>`, FUNSD's `header` → our `<title>` as a rough proxy) is real, but **no off-the-shelf ONNX checkpoint maps directly to GROBID's 22-class header schema**. Producing one requires either:

1. Exporting one of the existing PyTorch-finetuned variants to ONNX via `optimum-cli` (one-shot Python script, ~5 min on this hardware) and accepting a *closely-related* label set, or
2. **Fine-tuning** a `LayoutLMv3ForTokenClassification` on our existing GROBID header training corpus and exporting that to ONNX. This is the production path.

Per the scout's "no fine-tuning" hard constraint, option (2) was not run. The scout produces signal on every other question.

## 4. Heuristic floor (not the model — the data sanity check)

To prove that the `(text, bbox)` feed actually reaches the model in a coherent shape, the scout also computes a non-model heuristic-title: "the largest font in the top half of the page, joined across consecutive visually-close lines." This is *not* a LayoutLMv3 prediction — it's a layout-only baseline using the same data we feed the model. It's a useful sanity check: if even this heuristic can't get the title right, the data pipeline is broken; if it does get it right on some papers, the data is at least in the right format for the model to consume.

| Paper | Heuristic title | vs truth |
|------:|---|---|
| 179 | `[cs.CR]` | **wrong** (picked the arXiv corner tag) |
| 180 | `[cs.CR]` | **wrong** (same arXiv corner-tag issue) |
| **218** | `A face template protection scheme based on chaotic map, error correction code and locality sensitive hashing` | **match** — full title in one heuristic emission, banner cleanly excluded |
| 323 | `[cs.DB]` | **wrong** (arXiv corner tag) |
| 429 | `In-Network Key-Value Cache with Linearizability` | **match** |

The "wrong" papers all share the same failure mode: arXiv's `[cs.XX]` watermark tag is rendered at a font size that happens to fall within 90% of the page's max font height in its top-half slice. A trained model would use the spatial position of that tag (top-right corner, narrow bbox, ~10pt) plus its content (square-bracketed category code) to reject it as title; the heuristic can't. This is exactly the kind of disambiguation LayoutLMv3 is built for, and exactly the failure mode that motivates training a head.

## 5. Banner-vs-title on paper_218 (the BiLSTM bench-killer)

**The heuristic — which uses pdfalto's font-height field plus spatial position — gets paper_218 right on the first try.** It picks the four-line title `"A face template protection scheme based on chaotic map, error correction code and locality sensitive hashing"` and skips the Cybersecurity-banner above it.

Why this matters for the LayoutLMv3 hypothesis: the BiLSTM's failure on paper_218 was that it had only token sequence + (in some configurations) line-break features, with no native concept of "this token's bbox is in the top-half of the page in a large font." The heuristic shows that the bbox + font-size signal is *sufficient by itself* on this case. A LayoutLMv3-base + finetuned head, which gets bbox quantised to 0..1000 *and* sub-token-level attention over the full page layout *and* the actual rendered pixels, should comfortably beat the heuristic. The architecture's design assumption — that a banner-vs-title decision is fundamentally a position-aware decision — is empirically validated on this paper at the data level.

What the scout can't tell us, because there's no head: whether the model would *additionally* get the three papers with arXiv tags right, where the heuristic loses. That's the open question that fine-tuning answers.

## 6. Verdict

**LayoutLMv3 clears every infrastructure bar that killed the LLM scout, and the pipeline plumbing works end-to-end.**

- Architecture compatibility: works (direct `onnxruntime-node`; `@huggingface/transformers` cannot drive it today).
- Latency: **640 ms per page, constant in input length.** 77× faster than the LLM scout.
- Memory: **2 GB peak fp32**, with a clear q8 path to ~1 GB. Half the LLM's footprint.
- Data pipeline: pdfalto + pdfjs + canvas already in-tree produce the exact `(text, bbox, pixel_values)` LayoutLMv3 expects; no new C deps, no native PDF rendering surprises.
- Banner-vs-title: paper_218's layout features alone are sufficient at the heuristic level — the architectural premise is validated.

**The one thing it doesn't do is predict labels, because no pretrained checkpoint exists that maps onto GROBID's 22-class header schema.** That is a fine-tuning workstream, not a scouting problem.

## 7. Recommendation

**Spawn a fine-tuning workstream.** Specifically:

1. **Use the existing GROBID header training data** (Wapiti CRF training set, `src/grobid/...`, already a 22-class labelled token sequence with bbox/font features) and reformat it as a `LayoutLMv3ForTokenClassification` HuggingFace dataset (token + word_label + word_bbox per page).
2. **Fine-tune `microsoft/layoutlmv3-base` (~125 M params)** for 5–10 epochs on a single H100 or even M3 (full fp32 fits in 24 GB, batch=4). Estimate: 1–2 hours wall-clock on a workstation GPU, longer on CPU but trivially backgroundable.
3. **Export to ONNX with `optimum-cli export onnx --model <ckpt> --task token-classification`**, then optionally quantise to int8 with `optimum`'s ORT quantiser. The export step is well-trodden — the HF docs explicitly list LayoutLMv3 + token-classification as a supported combo.
4. **Drop the resulting `model.onnx` + `config.json` (with our id2label) + `tokenizer.json` into the existing model-distribution pipeline** alongside the Wapiti weights. The runtime cost in Node is what this scout measured: ~640 ms per page on CPU, 2 GB RSS fp32 (1 GB q8).

**Do not pursue:**

- HYPJUDY/PubLayNet (wrong task — object detection on rendered image).
- FUNSD-finetuned LayoutLMv3 variants as drop-ins (wrong label schema, no ONNX, label names not preserved in shipped configs).
- LayoutLMv3-large (3× weights for ~2-pt F1 gain on FUNSD upstream; the base size wins on a Node-ship budget).

**Open browser-bundle question (not a scout blocker, but flag for later):** the 502 MB fp32 model is too big for a routine browser bundle. q8 → ~250 MB, still chunky. A WebGPU-backed `onnxruntime-web` path is plausible, but bundle size and first-load cost will be the gating concern when this lands.

---

### Reproducing the scout

```sh
node experiments/layoutlmv3-scout.mjs
# env overrides:
#   MODEL_ID=microsoft/layoutlmv3-base
#   PAPERS=179,180,218,323,429
```

Model + tokenizer are cached under `~/.cache/grobid-js-scout/layoutlmv3/` (not in the repo). The scout uses `onnxruntime-node` (already in `optionalDependencies`) and `@huggingface/tokenizers` (already in `node_modules`); the only LayoutLMv3-specific weights are the 502 MB `model.onnx` + 1 MB `tokenizer.json` (the latter pulled from `roberta-base`).
