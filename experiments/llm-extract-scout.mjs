#!/usr/bin/env node
// llm-extract-scout.mjs
// Scout experiment: can a small instruction-tuned LLM running locally via
// @huggingface/transformers replace the GROBID CRF/BiLSTM header pipeline?
//
// Scope (strict): 5 papers, page-1 text only, single quantised ONNX model,
// no constrained decoding, JSON-mode prompt, score against vlm-truth.
//
// Run:  node experiments/llm-extract-scout.mjs
// Optional env:
//   MODEL_ID=onnx-community/Qwen2.5-1.5B-Instruct
//   DTYPE=q4
//   PAPERS=179,180,218,323,429
//   MAX_NEW_TOKENS=512

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { performance } from "node:perf_hooks";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const CORPUS_DIR = path.join(REPO_ROOT, "fixtures", "blind-corpus");
const TRUTH_DIR = path.join(CORPUS_DIR, "vlm-truth");
const OUT_DIR = path.join(REPO_ROOT, "experiments", "out");

const MODEL_ID = process.env.MODEL_ID || "onnx-community/Qwen2.5-1.5B-Instruct";
const FALLBACK_MODEL_ID =
  process.env.FALLBACK_MODEL_ID || "onnx-community/Phi-3.5-mini-instruct-onnx-web";
const DTYPE = process.env.DTYPE || "q4";
const MAX_NEW_TOKENS = Number(process.env.MAX_NEW_TOKENS || 512);
const PAPERS = (process.env.PAPERS || "179,180,218,323,429")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// ---------------------------------------------------------------------------
// 1. PDF page-1 text extraction via pdfjs-dist (legacy build = pure JS, Node)
// ---------------------------------------------------------------------------

/**
 * Extracts plain text from page 1 of a PDF. Joins items in reading order
 * (pdfjs already returns them roughly top-down, left-right). Inserts a space
 * between items, newlines between items whose y differs > 4 units.
 */
async function extractPage1Text(pdfPath) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // pdfjs needs no worker in Node legacy build
  const data = new Uint8Array(await readFile(pdfPath));
  const doc = await pdfjs.getDocument({
    data,
    disableFontFace: true,
    useSystemFonts: false,
    isEvalSupported: false,
  }).promise;
  try {
    const page = await doc.getPage(1);
    const content = await page.getTextContent();
    const items = content.items;
    let lastY = null;
    const parts = [];
    for (const it of items) {
      if (!("str" in it)) continue;
      const tr = it.transform;
      const y = tr ? tr[5] : null;
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 4) {
        parts.push("\n");
      } else if (parts.length) {
        parts.push(" ");
      }
      parts.push(it.str);
      lastY = y;
    }
    return parts.join("").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  } finally {
    await doc.destroy();
  }
}

// ---------------------------------------------------------------------------
// 2. Prompting + JSON parsing
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT =
  "You extract bibliographic metadata from the first page of scientific papers. " +
  "Respond with ONE valid JSON object and no other text. " +
  "Do not include markdown fences, comments, or explanations.";

const USER_PROMPT_TEMPLATE = (page1) =>
  `Extract the following fields from this paper's first page:
- title (string)
- authors (array of strings, full names in order of appearance)
- affiliations (array of strings, deduplicated, in order of first appearance)
- abstract (string; the full abstract text if present, otherwise an empty string)
- doi (string; the DOI if present, otherwise an empty string)

Output ONLY a JSON object with exactly these five keys.

PAGE 1 TEXT:
"""
${page1}
"""`;

function tryParseJson(raw) {
  if (typeof raw !== "string") return null;
  // 1. direct
  try {
    return JSON.parse(raw);
  } catch {
    /* fall through */
  }
  // 2. strip markdown fences
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    try {
      return JSON.parse(fence[1]);
    } catch {
      /* fall through */
    }
  }
  // 3. greedy balanced object extraction
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const slice = raw.slice(start, end + 1);
    try {
      return JSON.parse(slice);
    } catch {
      /* fall through */
    }
    // 4. try removing trailing commas
    const cleaned = slice.replace(/,(\s*[}\]])/g, "$1");
    try {
      return JSON.parse(cleaned);
    } catch {
      /* fall through */
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// 3. Scoring vs vlm-truth
// ---------------------------------------------------------------------------

function norm(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[\s ]+/g, " ")
    .replace(/[^a-z0-9 ]+/g, "")
    .trim();
}

function scoreTitle(pred, truth) {
  if (!truth) return "n/a";
  if (!pred) return "empty";
  const a = norm(pred);
  const b = norm(truth);
  if (!a) return "empty";
  if (a === b) return "match";
  if (a.includes(b) || b.includes(a)) return "partial";
  // token overlap
  const sa = new Set(a.split(" ").filter((t) => t.length > 2));
  const sb = new Set(b.split(" ").filter((t) => t.length > 2));
  if (sb.size === 0) return "partial";
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  const j = inter / sb.size;
  if (j >= 0.7) return "partial";
  return "wrong";
}

function scoreAbstract(pred, truthPrefix) {
  if (!truthPrefix) return "n/a";
  if (!pred) return "empty";
  const a = norm(pred);
  const b = norm(truthPrefix);
  if (!b) return "n/a";
  if (a.startsWith(b)) return "match";
  // partial: prefix match on truncated truth prefix
  const shortB = b.slice(0, Math.floor(b.length * 0.6));
  if (a.includes(shortB)) return "partial";
  // weaker: contains any 40-char substring
  for (let i = 0; i + 40 <= b.length; i += 20) {
    if (a.includes(b.slice(i, i + 40))) return "partial";
  }
  return "wrong";
}

function scoreAuthors(pred, truth) {
  if (!Array.isArray(truth) || truth.length === 0) {
    if (!Array.isArray(pred) || pred.length === 0) return "match";
    return "n/a";
  }
  if (!Array.isArray(pred) || pred.length === 0) return "empty";
  const predSet = pred.map(norm).filter(Boolean);
  const truthSet = truth.map(norm).filter(Boolean);
  const hits = truthSet.filter((t) =>
    predSet.some((p) => p === t || p.includes(t) || t.includes(p)),
  );
  const recall = hits.length / truthSet.length;
  const precision =
    predSet.length === 0 ? 0 : hits.length / predSet.length;
  if (recall === 1 && precision === 1) return "match";
  if (recall >= 0.75 && precision >= 0.6) return "partial";
  if (recall === 0) return "wrong";
  return "partial";
}

function scoreAffiliations(pred, truth) {
  if (!Array.isArray(truth) || truth.length === 0) {
    if (!Array.isArray(pred) || pred.length === 0) return "match";
    return "n/a";
  }
  if (!Array.isArray(pred) || pred.length === 0) return "empty";
  const predSet = pred.map(norm).filter(Boolean);
  const truthSet = truth.map(norm).filter(Boolean);
  let hits = 0;
  for (const t of truthSet) {
    // partial substring match: take the most distinctive 25-char window
    const window =
      t.length > 25
        ? t.slice(Math.floor(t.length / 2) - 12, Math.floor(t.length / 2) + 13)
        : t;
    if (predSet.some((p) => p.includes(window) || t.includes(p))) hits++;
  }
  const recall = hits / truthSet.length;
  if (recall === 1) return "match";
  if (recall >= 0.5) return "partial";
  if (recall === 0) return "wrong";
  return "partial";
}

function scoreDoi(pred) {
  // No truth for DOI; just record what came back.
  if (!pred) return "empty";
  if (/10\.\d{4,9}\/\S+/i.test(pred)) return "present";
  return "wrong-format";
}

// ---------------------------------------------------------------------------
// 4. Pipeline driver
// ---------------------------------------------------------------------------

async function loadGenerator(modelId, dtype) {
  const t0 = performance.now();
  const tx = await import("@huggingface/transformers");
  const { pipeline, env } = tx;
  // Be explicit: allow remote download to default HF cache; do not write into repo.
  env.allowRemoteModels = true;
  env.allowLocalModels = true;
  // Belt and braces: silence warnings.
  if (env.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.numThreads = Math.max(
      1,
      Math.min(4, (await import("node:os")).cpus().length - 1),
    );
  }
  const generator = await pipeline("text-generation", modelId, { dtype });
  const t1 = performance.now();
  return { generator, tx, loadMs: t1 - t0 };
}

async function generateJson(generator, tx, page1Text) {
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: USER_PROMPT_TEMPLATE(page1Text) },
  ];
  const t0 = performance.now();
  const out = await generator(messages, {
    max_new_tokens: MAX_NEW_TOKENS,
    do_sample: false,
    temperature: 0,
    return_full_text: false,
  });
  const t1 = performance.now();

  let text = "";
  if (Array.isArray(out) && out.length) {
    const first = out[0];
    if (typeof first?.generated_text === "string") {
      text = first.generated_text;
    } else if (Array.isArray(first?.generated_text)) {
      // chat-style: array of {role, content}; take last assistant
      const last = first.generated_text[first.generated_text.length - 1];
      text = typeof last?.content === "string" ? last.content : JSON.stringify(last);
    } else {
      text = JSON.stringify(first);
    }
  } else if (typeof out?.generated_text === "string") {
    text = out.generated_text;
  } else {
    text = JSON.stringify(out);
  }

  return { text, latencyMs: t1 - t0 };
}

function rssMb() {
  return Math.round(process.memoryUsage().rss / (1024 * 1024));
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  console.log(`[scout] node=${process.version} model=${MODEL_ID} dtype=${DTYPE}`);
  console.log(`[scout] papers=${PAPERS.join(",")}`);
  console.log(`[scout] initial rss=${rssMb()} MB`);

  // 1. Extract page-1 text for all papers first (cheap, fail fast if missing)
  const docs = [];
  for (const id of PAPERS) {
    const pdf = path.join(CORPUS_DIR, `paper_${id}.pdf`);
    const truthPath = path.join(TRUTH_DIR, `paper_${id}.json`);
    let truth = null;
    try {
      truth = JSON.parse(await readFile(truthPath, "utf8"));
    } catch (e) {
      console.warn(`[scout] no vlm-truth for paper_${id}: ${e.message}`);
    }
    try {
      const tStart = performance.now();
      const text = await extractPage1Text(pdf);
      const tEnd = performance.now();
      docs.push({ id, pdf, truth, text, pdfMs: tEnd - tStart });
      console.log(
        `[scout] paper_${id}: page1 ${text.length} chars in ${(tEnd - tStart).toFixed(0)}ms`,
      );
    } catch (e) {
      console.error(`[scout] paper_${id} pdf extract failed: ${e.stack || e.message}`);
      docs.push({ id, pdf, truth, text: null, pdfErr: String(e.message || e) });
    }
  }

  // 2. Load model
  let modelUsed = MODEL_ID;
  let generator, tx, loadMs;
  try {
    ({ generator, tx, loadMs } = await loadGenerator(MODEL_ID, DTYPE));
  } catch (primaryErr) {
    console.error(
      `[scout] primary model load failed: ${primaryErr.stack || primaryErr.message}`,
    );
    console.error(`[scout] trying fallback ${FALLBACK_MODEL_ID}`);
    try {
      ({ generator, tx, loadMs } = await loadGenerator(FALLBACK_MODEL_ID, DTYPE));
      modelUsed = FALLBACK_MODEL_ID;
    } catch (fallbackErr) {
      console.error(
        `[scout] fallback model load failed: ${fallbackErr.stack || fallbackErr.message}`,
      );
      // Persist failure report and exit
      await writeFile(
        path.join(OUT_DIR, "scout-failure.json"),
        JSON.stringify(
          {
            node: process.version,
            primaryModel: MODEL_ID,
            primaryError: String(primaryErr.stack || primaryErr.message),
            fallbackModel: FALLBACK_MODEL_ID,
            fallbackError: String(fallbackErr.stack || fallbackErr.message),
          },
          null,
          2,
        ),
      );
      process.exit(2);
    }
  }
  console.log(`[scout] model loaded in ${loadMs.toFixed(0)}ms (${modelUsed})`);
  console.log(`[scout] rss after load=${rssMb()} MB`);

  let peakRss = rssMb();
  const sampleRss = () => {
    const r = rssMb();
    if (r > peakRss) peakRss = r;
  };

  const results = [];
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i];
    if (!d.text) {
      results.push({
        id: d.id,
        truth: d.truth,
        error: d.pdfErr || "no page-1 text",
      });
      continue;
    }
    // Truncate very long page-1 text (Qwen2.5 ctx 32k but be polite)
    const page1 = d.text.length > 12000 ? d.text.slice(0, 12000) : d.text;

    let attempt = 0;
    let parsed = null;
    let lastText = "";
    let totalLatency = 0;
    let firstLatency = 0;
    while (attempt < 2 && !parsed) {
      attempt++;
      try {
        const { text, latencyMs } = await generateJson(generator, tx, page1);
        if (attempt === 1) firstLatency = latencyMs;
        totalLatency += latencyMs;
        lastText = text;
        parsed = tryParseJson(text);
        sampleRss();
        if (!parsed) {
          console.warn(
            `[scout] paper_${d.id}: JSON parse failed on attempt ${attempt}; ` +
              `head="${text.slice(0, 120).replace(/\n/g, " ")}"`,
          );
        }
      } catch (e) {
        console.error(
          `[scout] paper_${d.id} generation error: ${e.stack || e.message}`,
        );
        break;
      }
    }

    const r = {
      id: d.id,
      coldCall: i === 0,
      truth: d.truth,
      raw: lastText,
      parsed,
      latencyMs: firstLatency,
      totalLatencyMs: totalLatency,
      attempts: attempt,
      scores: null,
    };
    if (parsed && d.truth) {
      r.scores = {
        title: scoreTitle(parsed.title, d.truth.title),
        authors: scoreAuthors(parsed.authors, d.truth.authors),
        affiliations: scoreAffiliations(parsed.affiliations, d.truth.affiliations),
        abstract: scoreAbstract(parsed.abstract, d.truth.abstract_prefix),
        doi: scoreDoi(parsed.doi),
      };
    }
    results.push(r);
    console.log(
      `[scout] paper_${d.id}: ${firstLatency.toFixed(0)}ms ` +
        `parse=${parsed ? "ok" : "FAIL"} ` +
        `scores=${r.scores ? JSON.stringify(r.scores) : "n/a"}`,
    );
  }

  const finalRss = rssMb();
  if (finalRss > peakRss) peakRss = finalRss;

  const latencies = results.filter((r) => r.latencyMs).map((r) => r.latencyMs);
  const summary = {
    node: process.version,
    model: modelUsed,
    dtype: DTYPE,
    loadMs,
    peakRssMb: peakRss,
    rssAtEndMb: finalRss,
    papers: PAPERS,
    latencyMs: latencies.length
      ? {
          first: results[0]?.latencyMs ?? null,
          warmAvg:
            latencies.slice(1).length === 0
              ? null
              : Math.round(
                  latencies.slice(1).reduce((a, b) => a + b, 0) /
                    latencies.slice(1).length,
                ),
          min: Math.round(Math.min(...latencies)),
          max: Math.round(Math.max(...latencies)),
        }
      : null,
    results,
  };

  await writeFile(
    path.join(OUT_DIR, "scout-results.json"),
    JSON.stringify(summary, null, 2),
  );
  console.log(`[scout] wrote ${path.join(OUT_DIR, "scout-results.json")}`);
  console.log(`[scout] peak rss=${peakRss} MB`);
}

main().catch((e) => {
  console.error("[scout] fatal:", e.stack || e.message);
  process.exit(1);
});
