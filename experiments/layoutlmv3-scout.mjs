#!/usr/bin/env node
// layoutlmv3-scout.mjs
//
// Scout experiment: can LayoutLMv3 (a layout-aware token classifier) be
// driven from Node via onnxruntime-node, fed (text, bbox, page-image) tuples
// out of our existing pdfalto+pdfjs pipeline, and produce a usable per-token
// signal on page-1 header structure?
//
// Scope (strict): 5 papers from fixtures/blind-corpus, page-1 only,
// zero-shot inference using the only ONNX-shipped LayoutLMv3 variant on the
// HF Hub (microsoft/layoutlmv3-base). No fine-tuning. No project integration.
//
// Run:  node experiments/layoutlmv3-scout.mjs
// Env overrides:
//   MODEL_ID=microsoft/layoutlmv3-base
//   PAPERS=179,180,218,323,429

import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { tmpdir, homedir } from "node:os";
import { performance } from "node:perf_hooks";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const CORPUS_DIR = path.join(REPO_ROOT, "fixtures", "blind-corpus");
const TRUTH_DIR = path.join(CORPUS_DIR, "vlm-truth");
const OUT_DIR = path.join(REPO_ROOT, "experiments", "out");
const PDFALTO_BIN = path.join(
  REPO_ROOT,
  "fixtures",
  "pdfalto",
  "pdfalto",
  "mac",
  "arm64",
  "pdfalto",
);

const MODEL_ID = process.env.MODEL_ID || "microsoft/layoutlmv3-base";
const PAPERS = (process.env.PAPERS || "179,180,218,323,429")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const HF_CACHE = path.join(homedir(), ".cache", "huggingface", "hub");
const SCOUT_CACHE = path.join(homedir(), ".cache", "grobid-js-scout", "layoutlmv3");

function rssMb() {
  return Math.round(process.memoryUsage().rss / (1024 * 1024));
}

// ---------------------------------------------------------------------------
// HF download helpers (model.onnx + tokenizer + config) into a local scout cache.
// We deliberately do not write into the repo nor try to use ~/.cache/huggingface
// as a structured target. We just need files on disk we can mmap.
// ---------------------------------------------------------------------------

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function downloadHfFile(repoId, file, destDir) {
  const url = `https://huggingface.co/${repoId}/resolve/main/${file}`;
  const dest = path.join(destDir, file);
  if (await exists(dest)) {
    return dest;
  }
  await mkdir(path.dirname(dest), { recursive: true });
  console.log(`[scout] downloading ${url}`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`HF download failed ${res.status}: ${url}`);
  }
  const total = Number(res.headers.get("content-length") || 0);
  const tmp = dest + ".part";
  const fileStream = createWriteStream(tmp);
  let written = 0;
  let lastReported = 0;
  const reader = res.body.getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    fileStream.write(Buffer.from(value));
    written += value.byteLength;
    if (total && written - lastReported > 25_000_000) {
      console.log(
        `[scout]   ${file}: ${(written / 1e6).toFixed(0)}/${(total / 1e6).toFixed(0)} MB`,
      );
      lastReported = written;
    }
  }
  await new Promise((r) => fileStream.end(r));
  await (await import("node:fs/promises")).rename(tmp, dest);
  console.log(`[scout]   ${file}: done (${(written / 1e6).toFixed(0)} MB)`);
  return dest;
}

async function ensureModelAssets(repoId) {
  const destDir = path.join(SCOUT_CACHE, repoId.replace("/", "__"));
  const files = [
    "model.onnx",
    "config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "preprocessor_config.json",
  ];
  const paths = {};
  for (const f of files) {
    try {
      paths[f] = await downloadHfFile(repoId, f, destDir);
    } catch (e) {
      console.warn(`[scout] optional file ${f} missing: ${e.message}`);
      paths[f] = null;
    }
  }
  // LayoutLMv3 ships only legacy tokenizer assets (vocab.json + merges.txt);
  // grab the modern tokenizer.json from the upstream roberta-base repo since
  // LayoutLMv3 uses the same vocab.
  if (!paths["tokenizer.json"]) {
    const robertaDir = path.join(SCOUT_CACHE, "roberta-base");
    try {
      paths["tokenizer.json"] = await downloadHfFile(
        "roberta-base",
        "tokenizer.json",
        robertaDir,
      );
      console.log(`[scout] tokenizer.json sourced from roberta-base`);
    } catch (e) {
      console.warn(`[scout] could not fetch roberta-base tokenizer.json: ${e.message}`);
    }
  }
  return { destDir, paths };
}

// ---------------------------------------------------------------------------
// pdfalto: run binary, parse ALTO XML for page 1 -> [{token, x, y, w, h}, ...]
// ---------------------------------------------------------------------------

function runPdfalto(pdfPath, outXml) {
  return new Promise((resolve, reject) => {
    const args = ["-f", "1", "-l", "1", "-noImage", pdfPath, outXml];
    const proc = spawn(PDFALTO_BIN, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`pdfalto exit ${code}: ${stderr.slice(0, 500)}`));
      } else {
        resolve();
      }
    });
  });
}

async function parseAltoPage1(xmlPath) {
  const { XMLParser } = await import("fast-xml-parser");
  const xml = await readFile(xmlPath, "utf8");
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    allowBooleanAttributes: true,
    parseAttributeValue: true,
    isArray: (name) => ["String", "TextLine", "TextBlock", "Page"].includes(name),
  });
  const doc = parser.parse(xml);
  const layout = doc?.alto?.Layout || doc?.Layout;
  if (!layout) return { tokens: [], pageWidth: 0, pageHeight: 0 };
  const pages = layout.Page || [];
  const page = pages[0];
  if (!page) return { tokens: [], pageWidth: 0, pageHeight: 0 };
  const pageWidth = Number(page.WIDTH || 612);
  const pageHeight = Number(page.HEIGHT || 792);
  const tokens = [];
  const printSpace = page.PrintSpace || page;
  const blocks = Array.isArray(printSpace.TextBlock)
    ? printSpace.TextBlock
    : printSpace.TextBlock
      ? [printSpace.TextBlock]
      : [];
  for (const blk of blocks) {
    const lines = Array.isArray(blk.TextLine)
      ? blk.TextLine
      : blk.TextLine
        ? [blk.TextLine]
        : [];
    for (const line of lines) {
      const strings = Array.isArray(line.String)
        ? line.String
        : line.String
          ? [line.String]
          : [];
      for (const s of strings) {
        const text = s.CONTENT;
        if (typeof text !== "string" || text.length === 0) continue;
        tokens.push({
          text,
          x: Number(s.HPOS || 0),
          y: Number(s.VPOS || 0),
          w: Number(s.WIDTH || 0),
          h: Number(s.HEIGHT || 0),
          font: s.STYLEREFS || null,
        });
      }
    }
  }
  return { tokens, pageWidth, pageHeight };
}

// ---------------------------------------------------------------------------
// Render PDF page 1 to 224x224 RGB float32 normalized to (img/255 - 0.5)/0.5
// ---------------------------------------------------------------------------

async function renderPage1To224(pdfPath) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { createCanvas } = await import("@napi-rs/canvas");
  const data = new Uint8Array(await readFile(pdfPath));
  const doc = await pdfjs.getDocument({
    data,
    disableFontFace: true,
    useSystemFonts: false,
    isEvalSupported: false,
  }).promise;
  try {
    const page = await doc.getPage(1);
    // First render at native scale to a canvas, then downsample.
    const viewport = page.getViewport({ scale: 1.0 });
    const targetSize = 224;
    // Scale so the longer side matches 224 to preserve aspect; pad with white.
    const scale = targetSize / Math.max(viewport.width, viewport.height);
    const scaledViewport = page.getViewport({ scale });
    const renderW = Math.ceil(scaledViewport.width);
    const renderH = Math.ceil(scaledViewport.height);
    const canvas = createCanvas(targetSize, targetSize);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, targetSize, targetSize);
    // Offset to center
    const offX = Math.floor((targetSize - renderW) / 2);
    const offY = Math.floor((targetSize - renderH) / 2);
    // Translate so pdf renders inside the centered region.
    ctx.translate(offX, offY);
    await page.render({
      canvasContext: ctx,
      viewport: scaledViewport,
      canvas, // some pdfjs versions want this
    }).promise;
    ctx.translate(-offX, -offY);

    const imgData = ctx.getImageData(0, 0, targetSize, targetSize);
    const px = imgData.data; // RGBA uint8 width*height*4
    // Build CHW float32, normalized (x/255 - 0.5)/0.5 = x/127.5 - 1
    const pixels = new Float32Array(3 * targetSize * targetSize);
    const HW = targetSize * targetSize;
    for (let i = 0; i < HW; i++) {
      const r = px[i * 4] / 255;
      const g = px[i * 4 + 1] / 255;
      const b = px[i * 4 + 2] / 255;
      pixels[i] = (r - 0.5) / 0.5;
      pixels[HW + i] = (g - 0.5) / 0.5;
      pixels[2 * HW + i] = (b - 0.5) / 0.5;
    }
    return { pixels, size: targetSize };
  } finally {
    await doc.destroy();
  }
}

// ---------------------------------------------------------------------------
// Tokenisation via @huggingface/tokenizers using HF's tokenizer.json
// LayoutLMv3 uses RoBERTa-style BPE.
// ---------------------------------------------------------------------------

async function loadTokenizer(tokenizerJsonPath, tokenizerConfigPath) {
  const tok = await import("@huggingface/tokenizers");
  const Tokenizer = tok.Tokenizer || tok.default?.Tokenizer;
  if (!Tokenizer) {
    throw new Error(
      "@huggingface/tokenizers: Tokenizer class not exported as expected; got keys=" +
        Object.keys(tok).join(","),
    );
  }
  const tokenizerObj = JSON.parse(await readFile(tokenizerJsonPath, "utf8"));
  let configObj = {};
  if (tokenizerConfigPath) {
    try {
      configObj = JSON.parse(await readFile(tokenizerConfigPath, "utf8"));
    } catch {
      configObj = {};
    }
  }
  return new Tokenizer(tokenizerObj, configObj);
}

// Quantise raw ALTO bbox (in page-pixel units) to LayoutLMv3's 0..1000 range.
function quantizeBbox(box, pageW, pageH) {
  const { x, y, w, h } = box;
  const x0 = Math.max(0, Math.min(1000, Math.round((x / pageW) * 1000)));
  const y0 = Math.max(0, Math.min(1000, Math.round((y / pageH) * 1000)));
  const x1 = Math.max(0, Math.min(1000, Math.round(((x + w) / pageW) * 1000)));
  const y1 = Math.max(0, Math.min(1000, Math.round(((y + h) / pageH) * 1000)));
  return [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
}

/**
 * Build LayoutLMv3 inputs from per-word tokens.
 *
 * For each whitespace-level "word" we get its bbox (quantised). We tokenise
 * each word independently with the BPE tokenizer (no special tokens) so we
 * can propagate the word's bbox to every sub-token. Then we wrap the whole
 * sequence with [BOS] ... [EOS] using the bbox [0,0,0,0] and [1000,1000,1000,1000]
 * respectively, mirroring what the LayoutLMv3 processor does upstream.
 */
async function buildModelInputs(tokenizer, words, pageW, pageH, maxLen = 512) {
  const inputIds = [];
  const bboxes = [];
  const wordIds = []; // for mapping back

  // BOS / EOS / PAD ids
  // LayoutLMv3 uses RoBERTa tokenizer: <s>=0, <pad>=1, </s>=2
  const BOS = 0;
  const EOS = 2;
  const PAD = 1;

  inputIds.push(BOS);
  bboxes.push([0, 0, 0, 0]);
  wordIds.push(-1);

  for (let wi = 0; wi < words.length; wi++) {
    const w = words[wi];
    // RoBERTa-style BPE: leading space implies a new word start; we prefix
    // every word after the first with a space.
    const text = wi === 0 ? w.text : " " + w.text;
    const enc = tokenizer.encode(text, { add_special_tokens: false });
    // enc is an Encoding-like object: { ids, tokens, attention_mask }
    const ids = enc?.ids;
    if (!ids || !ids.length) continue;
    const qb = quantizeBbox(w, pageW, pageH);
    for (const id of ids) {
      if (inputIds.length >= maxLen - 1) break;
      inputIds.push(id);
      bboxes.push(qb);
      wordIds.push(wi);
    }
    if (inputIds.length >= maxLen - 1) break;
  }

  inputIds.push(EOS);
  bboxes.push([1000, 1000, 1000, 1000]);
  wordIds.push(-1);

  // Pad to maxLen
  while (inputIds.length < maxLen) {
    inputIds.push(PAD);
    bboxes.push([0, 0, 0, 0]);
    wordIds.push(-1);
  }

  const attentionMask = inputIds.map((id) => (id === PAD ? 0 : 1));
  return { inputIds, bboxes, attentionMask, wordIds };
}

// ---------------------------------------------------------------------------
// onnxruntime-node inference
// ---------------------------------------------------------------------------

async function loadOnnxModel(modelPath) {
  const ort = await import("onnxruntime-node");
  const t0 = performance.now();
  const session = await ort.InferenceSession.create(modelPath, {
    executionProviders: ["cpu"],
    graphOptimizationLevel: "all",
  });
  const t1 = performance.now();
  return { ort, session, loadMs: t1 - t0 };
}

async function runInference(ort, session, inputs) {
  const seqLen = inputs.inputIds.length;
  const bboxFlat = new BigInt64Array(seqLen * 4);
  for (let i = 0; i < seqLen; i++) {
    for (let j = 0; j < 4; j++) {
      bboxFlat[i * 4 + j] = BigInt(inputs.bboxes[i][j]);
    }
  }
  const idsFlat = BigInt64Array.from(inputs.inputIds.map((x) => BigInt(x)));
  const attnFlat = BigInt64Array.from(inputs.attentionMask.map((x) => BigInt(x)));

  // pixel_values: 1 x 3 x 224 x 224 float32
  const pixelTensor = new ort.Tensor("float32", inputs.pixels, [1, 3, 224, 224]);

  const feeds = {};
  // We dynamically choose feed names based on what the model declares.
  const candidateMap = {
    input_ids: new ort.Tensor("int64", idsFlat, [1, seqLen]),
    attention_mask: new ort.Tensor("int64", attnFlat, [1, seqLen]),
    bbox: new ort.Tensor("int64", bboxFlat, [1, seqLen, 4]),
    pixel_values: pixelTensor,
  };
  for (const name of session.inputNames) {
    if (candidateMap[name]) feeds[name] = candidateMap[name];
  }

  const t0 = performance.now();
  const out = await session.run(feeds);
  const t1 = performance.now();
  return { out, latencyMs: t1 - t0 };
}

// ---------------------------------------------------------------------------
// Heuristic "title" extraction from LayoutLMv3-base hidden states.
//
// The base model has no classification head, so we can't read off
// "this token is a TITLE". What we *can* do as a sanity probe:
//   - The first contentful word(s) in reading order, at the top of the page,
//     are statistically the title. We'll join all words on the same line as
//     the topmost large-font word as a baseline (NOT a model prediction —
//     a layout heuristic, included only to demonstrate the data we feed the
//     model is sane).
//   - We compare that heuristic to vlm-truth as a *floor* for what
//     LayoutLMv3 needs to beat after fine-tuning.
// ---------------------------------------------------------------------------

function heuristicTitle(words) {
  if (!words.length) return "";
  // Pick the largest font height in the top half of the page
  const topHalfY = Math.min(...words.map((w) => w.y)) + 250; // ALTO units rough
  const topWords = words.filter((w) => w.y < topHalfY);
  if (!topWords.length) return "";
  let maxH = 0;
  for (const w of topWords) if (w.h > maxH) maxH = w.h;
  const bigWords = topWords.filter((w) => w.h >= maxH * 0.9);
  if (!bigWords.length) return "";
  // Sort by y then x
  bigWords.sort((a, b) => a.y - b.y || a.x - b.x);
  // Group by line (similar y within 2 ALTO units of each successive line)
  const lines = [];
  let cur = [bigWords[0]];
  for (let i = 1; i < bigWords.length; i++) {
    if (Math.abs(bigWords[i].y - cur[cur.length - 1].y) < bigWords[i].h * 0.5) {
      cur.push(bigWords[i]);
    } else {
      lines.push(cur);
      cur = [bigWords[i]];
    }
  }
  lines.push(cur);
  // Take the first few lines that are spatially close as the title
  const titleLines = [lines[0]];
  for (let i = 1; i < lines.length; i++) {
    const prev = titleLines[titleLines.length - 1];
    const prevBottom = Math.max(...prev.map((w) => w.y + w.h));
    const top = lines[i][0].y;
    const lineH = lines[i][0].h;
    if (top - prevBottom < lineH * 1.2) {
      titleLines.push(lines[i]);
    } else {
      break;
    }
  }
  const out = titleLines
    .map((ln) => ln.map((w) => w.text).join(" "))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return out;
}

function norm(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
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
  const sa = new Set(a.split(" ").filter((t) => t.length > 2));
  const sb = new Set(b.split(" ").filter((t) => t.length > 2));
  if (sb.size === 0) return "partial";
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  const j = inter / sb.size;
  if (j >= 0.7) return "partial";
  return "wrong";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(SCOUT_CACHE, { recursive: true });

  console.log(`[scout] node=${process.version}`);
  console.log(`[scout] model=${MODEL_ID}`);
  console.log(`[scout] papers=${PAPERS.join(",")}`);
  console.log(`[scout] initial rss=${rssMb()} MB`);

  // 0. Architecture-compat: confirm @huggingface/transformers has no LayoutLMv3 path.
  // We check specifically for LayoutLMv3 model classes, not generic AutoModel hubs.
  const transformersHasLayoutLmv3 = await (async () => {
    try {
      const tx = await import("@huggingface/transformers");
      const layoutLmKeys = Object.keys(tx).filter((k) =>
        /layoutlm/i.test(k),
      );
      return layoutLmKeys.length > 0 ? layoutLmKeys : false;
    } catch {
      return false;
    }
  })();
  console.log(
    `[scout] @huggingface/transformers LayoutLMv3 model exports = ${
      transformersHasLayoutLmv3
        ? `PRESENT (${transformersHasLayoutLmv3.join(",")})`
        : "ABSENT (using direct onnxruntime-node)"
    }`,
  );

  // 1. Ensure model assets locally
  const tFetchStart = performance.now();
  const { destDir, paths } = await ensureModelAssets(MODEL_ID);
  const tFetchEnd = performance.now();
  console.log(
    `[scout] assets ready in ${((tFetchEnd - tFetchStart) / 1000).toFixed(1)}s at ${destDir}`,
  );
  if (!paths["model.onnx"]) {
    throw new Error("model.onnx missing — cannot proceed");
  }
  if (!paths["tokenizer.json"]) {
    throw new Error("tokenizer.json missing — cannot tokenise");
  }

  // 2. Load tokenizer
  const tokenizer = await loadTokenizer(
    paths["tokenizer.json"],
    paths["tokenizer_config.json"],
  );
  console.log(`[scout] tokenizer loaded`);

  // 3. Load ONNX model
  const { ort, session, loadMs } = await loadOnnxModel(paths["model.onnx"]);
  console.log(`[scout] onnx session created in ${loadMs.toFixed(0)}ms`);
  console.log(`[scout] inputs=${session.inputNames.join(",")}`);
  console.log(`[scout] outputs=${session.outputNames.join(",")}`);
  console.log(`[scout] rss after load=${rssMb()} MB`);

  let peakRss = rssMb();
  const samplePeak = () => {
    const r = rssMb();
    if (r > peakRss) peakRss = r;
  };

  // 4. Per-paper pipeline
  const results = [];
  for (let i = 0; i < PAPERS.length; i++) {
    const id = PAPERS[i];
    const pdf = path.join(CORPUS_DIR, `paper_${id}.pdf`);
    const truthPath = path.join(TRUTH_DIR, `paper_${id}.json`);
    let truth = null;
    try {
      truth = JSON.parse(await readFile(truthPath, "utf8"));
    } catch (e) {
      console.warn(`[scout] no vlm-truth for paper_${id}: ${e.message}`);
    }

    const xmlPath = path.join(tmpdir(), `scout-paper-${id}.xml`);
    const r = { id, truth, error: null };
    try {
      // 4a. pdfalto -> ALTO XML page 1
      const tAlto0 = performance.now();
      await runPdfalto(pdf, xmlPath);
      const tAlto1 = performance.now();
      const { tokens: words, pageWidth, pageHeight } = await parseAltoPage1(xmlPath);
      const tAlto2 = performance.now();

      // 4b. Render to 224x224
      const tImg0 = performance.now();
      const { pixels } = await renderPage1To224(pdf);
      const tImg1 = performance.now();

      // 4c. Tokenise + build inputs
      const tTok0 = performance.now();
      const built = await buildModelInputs(tokenizer, words, pageWidth, pageHeight, 512);
      const tTok1 = performance.now();

      const inputs = {
        inputIds: built.inputIds,
        bboxes: built.bboxes,
        attentionMask: built.attentionMask,
        pixels,
      };

      // 4d. Run inference
      const { out, latencyMs } = await runInference(ort, session, inputs);
      samplePeak();

      // 4e. Inspect output shape (no classifier head — last_hidden_state)
      const firstOutName = session.outputNames[0];
      const tensor = out[firstOutName];
      const outShape = tensor.dims;
      // sanity: norm of hidden states for the first content-token, just to
      // prove the network actually ran on (text+bbox+image) and the embedding
      // is non-degenerate
      const data = tensor.data;
      let firstTokNorm = 0;
      const hidden = outShape[outShape.length - 1];
      // first content token is index 1 (after BOS); sum first 768 dims
      for (let j = 0; j < hidden; j++) {
        const v = data[1 * hidden + j];
        firstTokNorm += v * v;
      }
      firstTokNorm = Math.sqrt(firstTokNorm);

      // 4f. Heuristic title baseline (NOT a model prediction; this is the floor)
      const heurTitle = heuristicTitle(words);
      const titleScore = scoreTitle(heurTitle, truth?.title);

      r.timings = {
        pdfalto: Math.round(tAlto1 - tAlto0),
        altoParse: Math.round(tAlto2 - tAlto1),
        renderImage: Math.round(tImg1 - tImg0),
        tokenise: Math.round(tTok1 - tTok0),
        inference: Math.round(latencyMs),
      };
      r.pageWidth = pageWidth;
      r.pageHeight = pageHeight;
      r.numWords = words.length;
      r.numSubtokens = built.inputIds.filter((id) => id !== 1).length; // excl pad
      r.outputName = firstOutName;
      r.outputShape = outShape;
      r.hiddenStateNorm = firstTokNorm;
      r.heuristicTitle = heurTitle;
      r.heuristicTitleScore = titleScore;
      r.coldCall = i === 0;
      console.log(
        `[scout] paper_${id}: words=${words.length} subtokens=${r.numSubtokens} ` +
          `inf=${r.timings.inference}ms heurTitle=${titleScore}`,
      );
    } catch (e) {
      console.error(`[scout] paper_${id} FAIL: ${e.stack || e.message}`);
      r.error = String(e.stack || e.message);
    }
    samplePeak();
    results.push(r);
  }

  const finalRss = rssMb();
  if (finalRss > peakRss) peakRss = finalRss;

  const inferenceLatencies = results.filter((r) => r.timings).map((r) => r.timings.inference);
  const summary = {
    node: process.version,
    model: MODEL_ID,
    transformersJsLayoutLmv3Exports: transformersHasLayoutLmv3,
    onnxSessionLoadMs: Math.round(loadMs),
    onnxInputs: session.inputNames,
    onnxOutputs: session.outputNames,
    peakRssMb: peakRss,
    finalRssMb: finalRss,
    papers: PAPERS,
    inferenceLatencyMs: inferenceLatencies.length
      ? {
          first: inferenceLatencies[0],
          warmAvg:
            inferenceLatencies.slice(1).length === 0
              ? null
              : Math.round(
                  inferenceLatencies.slice(1).reduce((a, b) => a + b, 0) /
                    inferenceLatencies.slice(1).length,
                ),
          min: Math.min(...inferenceLatencies),
          max: Math.max(...inferenceLatencies),
        }
      : null,
    results,
  };

  await writeFile(
    path.join(OUT_DIR, "layoutlmv3-scout-results.json"),
    JSON.stringify(summary, null, 2),
  );
  console.log(`[scout] wrote ${path.join(OUT_DIR, "layoutlmv3-scout-results.json")}`);
  console.log(`[scout] peak rss=${peakRss} MB`);
}

main().catch((e) => {
  console.error("[scout] fatal:", e.stack || e.message);
  process.exit(1);
});
