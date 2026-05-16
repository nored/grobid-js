# LLM Header-Extraction Scout — Report

**Date:** 2026-05-16
**Author:** scout run (`experiments/llm-extract-scout.mjs`)
**Hardware:** macOS, Apple Silicon (M3 Pro Max), Node v22.16.0
**Model:** `onnx-community/Qwen2.5-1.5B-Instruct`, `dtype: "q4"`, via `@huggingface/transformers@4.2.0` (ONNX Runtime / WASM backend)
**Corpus:** 5 papers from `fixtures/blind-corpus/` — `paper_179, paper_180, paper_218, paper_323, paper_429`
**Pipeline:** `pdfjs-dist` page-1 text → chat-template prompt (system + user) → text-generation, `do_sample=false`, `max_new_tokens=512` → JSON parse with regex/fence-strip fallback → score vs `vlm-truth/paper_NNN.json`

Raw outputs and per-paper traces: `experiments/out/scout-results.json`. Console log: `experiments/out/scout.log`.

---

## 1. Quality table

Scoring (vs `vlm-truth/paper_NNN.json`):

- **match** = normalised equality, or for authors/affiliations: 100% recall and ≥60% precision
- **partial** = substring containment or token overlap (≥70% Jaccard for titles, ≥75% recall for authors, ≥50% recall for affs)
- **wrong** = none of the above
- **empty** = model returned empty/missing where truth was non-empty
- **n/a** = truth was empty/absent
- DOI has no truth field; "present" = matches `10.\d{4,9}/...`, "empty" = none returned

| Paper | Title | Authors | Affiliations | Abstract | DOI | JSON OK | Latency |
|------:|-------|---------|--------------|----------|-----|---------|--------:|
| 179 | partial | match | n/a | empty | empty | yes | 49.9 s |
| 180 | match   | match | match | empty | empty | yes | 46.4 s |
| 218 | partial | partial | partial | empty | present | yes | 63.7 s |
| 323 | match   | partial | partial | empty | empty | yes | 91.2 s |
| 429 | match   | match | match | n/a | empty | yes | 20.2 s |

Aggregates over the 5 papers (excluding `n/a`):
- Title: 3 match, 2 partial, 0 wrong, 0 empty
- Authors: 3 match, 2 partial, 0 wrong, 0 empty
- Affiliations: 2 match, 2 partial, 0 wrong, 0 empty (1 n/a)
- Abstract: **0 match, 0 partial, 0 wrong, 4 empty** (1 n/a) — systematic failure, see §3
- DOI: 1 present, 4 empty (paper_218 has a visible DOI on page 1; the others legitimately don't)

## 2. Latency, cold-start, memory

- **Model load (cold, first run, includes download from HF Hub):** **74.6 s**. Pre-cached subsequent loads will be substantially less but were not measured this run.
- **PDF page-1 extraction (`pdfjs-dist`):** 29–921 ms per paper (first call paid library init cost, then ≤135 ms).
- **Per-paper generation (greedy, `max_new_tokens=512`):**
  - first call (cold model state): **49.9 s**
  - warm average (papers 180/218/323/429): **55.4 s**
  - min: **20.2 s** (paper_429, smallest output)
  - max: **91.2 s** (paper_323, longest output — ByteHouse with 16 authors)
- **Memory (`process.memoryUsage().rss`):**
  - initial: 40 MB
  - after `pipeline()` load: **4 024 MB**
  - peak observed: **4 024 MB**
  - end of run: 3 869 MB

On generation throughput this works out to roughly **5–10 tokens/sec** on this machine via the WASM ONNX backend — consistent with Qwen2.5-1.5B q4 in transformers.js on Apple Silicon when no `webgpu` device is available in Node. A GGUF/llama.cpp Metal path would be roughly 10× faster on the same hardware but is out of scope here.

## 3. Failure modes

### 3.1 JSON robustness — fine
JSON parsed on the first attempt for **5/5 papers**. No markdown fences, no preamble, no trailing prose, no schema drift on the five top-level keys. The forgiving fallback path (fence strip → balanced-brace slice → trailing-comma fix) never triggered. Qwen2.5-1.5B-Instruct with a "respond with one JSON object, no other text" system prompt is well-behaved enough on this prompt that constrained decoding is *not required to get parseable output*.

### 3.2 Abstract — systematic empty
**Every paper returned `"abstract": ""`** even when the page-1 text clearly contained the abstract (verified for 179, 180, 218, 323). Likely causes, in order of likelihood:

1. **`max_new_tokens=512` too low when authors+affiliations are long.** ByteHouse (paper_323) used the full 512 tokens just on authors+affiliations and the model truncated *before* getting to the abstract — note its output drops the 16th author (`Fan Wu`) and the `ByteDance, Singapore` affiliation, suggesting an output-length cutoff. Raising to 1500–2000 is the obvious next step.
2. **Prompt ordering / field-order incentive.** With the field list as `title, authors, affiliations, abstract, doi`, the model commits the budget to authors/affiliations first. Reordering or emitting abstract first would help.
3. **Instruction interpretation.** The "if present, otherwise empty string" wording may bias toward empty for borderline cases. Less likely than (1) given the visible truncation pattern.

This is the headline issue, but it's a **prompt/decoding tuning problem, not a capability problem.** The model clearly reads the page (titles and authors prove it).

### 3.3 Title — silent truncation on some papers
- **paper_179:** truth = `"Retrieval Pivot Attacks in Hybrid RAG: Measuring and Mitigating Amplified Leakage from Vector Seeds to Graph Expansion"`. Predicted = `"Retrieval Pivot Attacks in Hybrid RAG"`. The model returned only the head before the colon. PDF page-1 text was 4 543 chars; the rest of the title is present in the source.
- **paper_218:** truth = `"A face template protection scheme based on chaotic map, error correction code and locality sensitive hashing"`. Predicted = `"A face template protection scheme"`. Same head-truncation pattern. The full title is split across three visual lines in the PDF and the model picked only the first line.

These look like a *line-break sensitivity* issue inside the model — once it sees a newline after a plausible noun phrase it stops the title field. Mitigations: normalise page-1 newlines before the prompt (collapse soft wraps), or add a one-shot example showing a multi-line title joined.

### 3.4 Banner / boilerplate handling (paper_218)
The Cybersecurity-banner paper survived without catastrophic confusion: the model correctly skipped the licence-block boilerplate and the journal banner, found the DOI (`https://doi.org/10.1186/s42400-025-00373-6`), and identified the right authors. However it kept the affiliation footnote marker `*` on `"*Yong Wang"` and only returned 2 of 4 authors (missed Kun Wang, Zhuo Liu) and 2 of 4 affiliations. This is partly an output-length issue (it ran for 63.7 s producing the longest list it could fit) and partly a prompt issue — telling it explicitly to strip leading punctuation/superscripts from author names would have helped.

### 3.5 Author / affiliation ordering and stripping
- Author markers like `*`, numeric superscripts (`Liu^{1,2,4}`) are sometimes carried over verbatim (paper_218). The CRF pipeline currently handles these via the affiliation-address engine; the LLM would need a more prescriptive prompt to match GROBID's normalisation contract.
- Affiliations are well-clustered when the PDF text lays them out as separate lines (paper_180, paper_429), but get partial-matched when one logical institution is split across lines (paper_218, paper_323).

### 3.6 Hallucinations
**None observed in the five samples.** Authors/affiliations that appeared in the output were all present in the source. The only marginal case was paper_179 inventing `"perfecxion.ai"` as an affiliation when the page-1 footer/email contained that string — that's not a hallucination, it's a misclassification of a domain as an affiliation. The ground truth marks `affiliations: []` for paper_179, so this scored `n/a` here but would be a false positive at strict scoring.

## 4. Verdict

**Viable in principle, not viable as a drop-in replacement at this size/quantisation.**

The good:
- JSON discipline is rock-solid even without constrained decoding (5/5 parses, zero schema drift, zero markdown fences). Constrained decoding is a *nice-to-have*, not a blocker, for this model on this task.
- Title and authors land in the **match/partial** band on 5/5 papers with zero hallucinated content.
- The "hard" paper (paper_218 with its CC-BY banner) didn't catastrophically derail — the model skipped boilerplate and pulled the DOI.
- pdfjs-dist page-1 text is sufficient — no need for pdfalto layout features for this experiment's scope.

The bad / blocking issues:
- **Latency is unacceptable for a header-extraction step.** 20–91 s per paper on WASM/ORT is 2–3 orders of magnitude slower than the existing CRF pipeline. Even a 10× speedup from a Metal/GGUF backend (out of scope here) would still leave it slower than CRF on a per-doc basis.
- **Memory: 4 GB RSS** for a "small" 1.5 B q4 model. That's a hard non-starter for the browser bundle. For Node it's tolerable on a workstation but rules out CI / serverless deployments.
- **Abstract field returns empty on 4/4 papers that had one.** Almost certainly a `max_new_tokens` cap + field-ordering artefact — the longer-output paper (ByteHouse) was truncated *during* its author list — but until that's fixed end-to-end, the LLM extracts strictly *less* than the existing pipeline.
- **Title-head truncation** on multi-line titles (179, 218) is a real recall gap that would need either a softening prompt rewrite or layout-aware preprocessing (i.e. the very thing we're trying to avoid by leaving pdfalto behind).

## 5. Recommendation

**Do not pursue the LLM path as a CRF/BiLSTM replacement in its current shape.** Specifically:

1. **Drop the in-process transformers.js LLM path for the header step.** The 4 GB RSS and >20 s/doc throughput on WASM-ORT make this unshippable for both Node (CI) and browser (bundle size + runtime), even before parity work. Apple-Silicon-only Metal acceleration would help on this dev machine but doesn't solve the cross-platform story.
2. **Recommended next step: try LayoutLMv3 (or a similar layout-aware token classifier).** LayoutLMv3-base is ~125 M params, runs comfortably in ONNX Runtime web/Node at sub-second per page, and is the natural fit for header-field tagging since it consumes the same `(text, bbox)` features the current CRF/BiLSTM stack already produces. The scout confirms that a small model *can* pick the right tokens on page 1 — the problem is the autoregressive decode budget and the >1 B parameter footprint, both of which a token-classifier model sidesteps.
3. **Park "constrained decoding library" work.** It would solve a problem we don't have (5/5 JSON parses), at the cost of solving none of the problems we *do* have (latency, memory, abstract truncation, multi-line title recall).
4. **If revisited later:** an LLM path becomes interesting again only on a path that gives ≥10× speedup *and* ≤500 MB resident footprint (e.g. a 0.5 B model via llama.cpp/Metal or a 1.5 B model via WebGPU with int4 weight-only quant in the browser). Until one of those backends is mature and shippable cross-platform, the token-classifier route is strictly better for this codebase.

---

### Reproducing the scout

```sh
node experiments/llm-extract-scout.mjs
# env overrides:
#   MODEL_ID=onnx-community/Phi-3.5-mini-instruct-onnx-web
#   DTYPE=q4   # or q8, fp16
#   PAPERS=179,180,218,323,429
#   MAX_NEW_TOKENS=512
```

Model weights are cached by `@huggingface/transformers` under `~/.cache/huggingface/` (not in the repo). Optional dependency only: `@huggingface/transformers` is in `package.json` under `dependencies` from this scout run — feel free to move it to `optionalDependencies` if the LLM path is dropped, or remove it entirely.
