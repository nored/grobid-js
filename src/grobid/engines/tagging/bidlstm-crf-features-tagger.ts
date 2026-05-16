// JS-side runtime for upstream's `BidLSTM_CRF_FEATURES` Keras model.
// The model is exported to ONNX by `scripts/convert-bidlstm-crf-features.py`;
// this module loads the ONNX graph plus the sidecar artifacts (transition
// matrix, boundary scores, char/feature/tag vocabularies) and runs the same
// forward pass.
//
// Pipeline (matches DeLFT's `BidLSTM_CRF_FEATURES` model + CRF wrapper):
//   1. Parse input feature rows (each line: "token feat0 feat1 ... featN").
//   2. For each token:
//        - char_input[t]   = char-index padded to max_char_length
//        - features_input[t] = per-column integer indices via
//                              features_map_to_index (see vocab-features.json)
//        - word_input[t]   = 300-d Glove vector, looked up via the injected
//                              GloveProvider
//   3. Run ONNX forward pass → potentials (T, ntags).
//   4. Add CRF left/right boundary biases (sidecar bins).
//   5. Run Viterbi against the transition matrix (sidecar bin).
//   6. Emit the input rows with " LABEL" appended per row.
//
// API NOTE: Implements `GenericTagger.label()` which returns
// `Promise<string>`. The ONNX session is loaded lazily on first
// `label()` call, so construction is synchronous (matching the
// other tagger backends) and a model can be cached in
// `TaggerFactory` the same way.

import { readFileSync } from "node:fs";
import path from "node:path";
import type { GenericTagger } from "./generic-tagger.js";
import { neuralCrfViterbi } from "./neural-crf-viterbi.js";
import type { GrobidModel } from "../../grobid-model.js";

/**
 * Pluggable 300-d Glove vector lookup. Implementations can:
 *  - Read a vocab-restricted Glove dump (recommended for production)
 *  - Return zeros for every token (smoke tests; quality will degrade)
 *  - Fall back to a hash-based pseudo-vector for OOV
 *
 * `dim` is informational; the model's expected dimension is read from
 * model-config.json and must match what the provider returns.
 */
export interface GloveProvider {
  readonly dim: number;
  /** Return the 300-d float32 vector for `token`, or all-zeros if unknown. */
  lookup(token: string): Float32Array;
}

export class ZeroGloveProvider implements GloveProvider {
  readonly dim: number;
  private readonly zero: Float32Array;
  constructor(dim = 300) {
    this.dim = dim;
    this.zero = new Float32Array(dim);
  }
  lookup(_token: string): Float32Array {
    return this.zero;
  }
}

interface ModelConfig {
  architecture: string;
  word_embedding_size: number;
  char_vocab_size: number;
  char_embedding_size: number;
  num_char_lstm_units: number;
  max_char_length: number;
  features_vocabulary_size: number;
  features_indices: number[];
  features_embedding_size: number;
  features_lstm_units: number;
  num_word_lstm_units: number;
  max_sequence_length: number;
  embeddings_name: string;
  ntags: number;
}

interface FeaturePreprocessor {
  features_indices: number[];
  features_vocabulary_size: number;
  features_map_to_index: Record<string, Record<string, number>>;
}

interface TagVocab {
  vocab_tag: Record<string, number>;
  /** `indice_tag` has integer keys serialized as strings in DeLFT. */
  indice_tag: Record<string, string>;
}

/**
 * Translate a DeLFT-emitted IOB2 label back to GROBID's native label
 * format. DeLFT's `_translate_tags_grobid_to_IOB` (reader.py:510) is
 * the forward direction used at training time; this is its inverse.
 *
 *   IOB2 "O"           → GROBID "<other>"
 *   IOB2 "B-<X>"       → GROBID "I-<X>"   (GROBID's begin uses the "I-" prefix)
 *   IOB2 "I-<X>"       → GROBID "<X>"     (GROBID continuation has no prefix)
 *   anything else      → unchanged (e.g. "<PAD>" stays "<PAD>" — should not appear in real output)
 *
 * Without this translation `TaggingTokenClusteror.cluster()` reads
 * IOB2 "B-<title>" as a CONTINUATION (because GROBID_START_ENTITY_LABEL_PREFIX = "I-"),
 * which collapses entire title sequences into a single trailing-token span.
 */
function iobToGrobidLabel(label: string): string {
  if (label === "O") return "<other>";
  if (label.startsWith("B-")) return "I-" + label.substring(2);
  if (label.startsWith("I-")) return label.substring(2);
  return label;
}

function readMatrixBin(p: string): {
  rows: number;
  cols: number;
  data: Float32Array;
} {
  const buf = readFileSync(p);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const rows = dv.getInt32(0, true);
  const cols = dv.getInt32(4, true);
  const expected = 8 + rows * cols * 4;
  if (buf.byteLength !== expected) {
    throw new Error(
      `matrix ${p}: header says ${rows}x${cols} (=${expected} bytes), file is ${buf.byteLength}`,
    );
  }
  const data = new Float32Array(rows * cols);
  for (let i = 0; i < rows * cols; i++) {
    data[i] = dv.getFloat32(8 + i * 4, true);
  }
  return { rows, cols, data };
}

function readVecBin(p: string): Float32Array {
  const buf = readFileSync(p);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const n = dv.getInt32(0, true);
  const expected = 4 + n * 4;
  if (buf.byteLength !== expected) {
    throw new Error(`vec ${p}: header says ${n} (=${expected} bytes), file is ${buf.byteLength}`);
  }
  const data = new Float32Array(n);
  for (let i = 0; i < n; i++) data[i] = dv.getFloat32(4 + i * 4, true);
  return data;
}

export interface BidLSTMTaggerOptions {
  glove: GloveProvider;
  /** Onnxruntime providers, defaults to ['cpu']. */
  providers?: string[];
}

/**
 * Static registry of (model name → BidLSTM artifact directory + glove
 * provider). `TaggerFactory` constructs a `BidLSTMCRFFeaturesTagger` by
 * looking up the model name here. Callers populate this from
 * `src/node/grobid.ts` (or wherever they assemble the engine).
 *
 * Registering before the TaggerFactory builds a tagger is required —
 * the factory throws if no registration is found.
 */
const REGISTRY = new Map<string, { modelDir: string; opts: BidLSTMTaggerOptions }>();

export function registerBidLSTMModel(
  modelName: string,
  modelDir: string,
  opts: BidLSTMTaggerOptions,
): void {
  REGISTRY.set(modelName, { modelDir, opts });
}

export function unregisterBidLSTMModel(modelName: string): void {
  REGISTRY.delete(modelName);
}

export function isBidLSTMModelRegistered(modelName: string): boolean {
  return REGISTRY.has(modelName);
}

/**
 * Minimal shape we use from onnxruntime-node. Avoids a hard import-time
 * dependency so users who only need the Wapiti path can omit the
 * optional `onnxruntime-node` package.
 */
interface OrtTensor {
  data: Float32Array | Int32Array;
}
interface OrtSession {
  outputNames: string[];
  run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>;
}

export class BidLSTMCRFFeaturesTagger implements GenericTagger {
  private readonly modelDir: string;
  private readonly config: ModelConfig;
  private readonly charVocab: Record<string, number>;
  private readonly tagVocab: TagVocab;
  private readonly indiceTag: string[]; // index → tag string, dense array
  private readonly featurePrep: FeaturePreprocessor;
  private readonly transitions: Float32Array; // (ntags*ntags)
  private readonly leftBoundary: Float32Array; // (ntags,)
  private readonly rightBoundary: Float32Array; // (ntags,)
  private readonly glove: GloveProvider;
  private readonly providers: string[];
  private sessionP: Promise<OrtSession> | null = null;
  private closed = false;

  /**
   * Public constructor: looks up the model in the static registry. The
   * model must have been registered via `registerBidLSTMModel(...)`
   * before construction. The ONNX session itself is loaded lazily on
   * the first `label()` call so that construction can be synchronous
   * and `TaggerFactory` keeps its existing caching shape.
   */
  constructor(model: GrobidModel | string) {
    const modelName = typeof model === "string" ? model : model.getModelName();
    const reg = REGISTRY.get(modelName);
    if (!reg) {
      throw new Error(
        `BidLSTMCRFFeaturesTagger: no registration for model '${modelName}'. ` +
          `Call registerBidLSTMModel('${modelName}', modelDir, { glove }) before constructing.`,
      );
    }
    this.modelDir = reg.modelDir;
    this.glove = reg.opts.glove;
    this.providers = reg.opts.providers ?? ["cpu"];

    this.config = JSON.parse(readFileSync(path.join(this.modelDir, "model-config.json"), "utf8"));
    this.charVocab = JSON.parse(readFileSync(path.join(this.modelDir, "vocab-char.json"), "utf8"));
    this.tagVocab = JSON.parse(readFileSync(path.join(this.modelDir, "vocab-tag.json"), "utf8"));
    this.featurePrep = JSON.parse(
      readFileSync(path.join(this.modelDir, "vocab-features.json"), "utf8"),
    );

    if (this.glove.dim !== this.config.word_embedding_size) {
      throw new Error(
        `GloveProvider.dim=${this.glove.dim} doesn't match model.word_embedding_size=${this.config.word_embedding_size}`,
      );
    }

    // Dense int→tag array. indice_tag keys are int-as-string in DeLFT.
    this.indiceTag = new Array(this.config.ntags);
    for (const [k, v] of Object.entries(this.tagVocab.indice_tag)) {
      const idx = Number(k);
      if (!Number.isInteger(idx) || idx < 0 || idx >= this.config.ntags) {
        throw new Error(`indice_tag index out of range: ${k}`);
      }
      this.indiceTag[idx] = v;
    }
    for (let i = 0; i < this.config.ntags; i++) {
      if (this.indiceTag[i] === undefined) {
        throw new Error(`indice_tag missing entry for index ${i}`);
      }
    }

    const tx = readMatrixBin(path.join(this.modelDir, "crf-transitions.bin"));
    if (tx.rows !== this.config.ntags || tx.cols !== this.config.ntags) {
      throw new Error(
        `transition matrix shape ${tx.rows}x${tx.cols} != ntags=${this.config.ntags}`,
      );
    }
    this.transitions = tx.data;
    this.leftBoundary = readVecBin(path.join(this.modelDir, "crf-left-boundary.bin"));
    this.rightBoundary = readVecBin(path.join(this.modelDir, "crf-right-boundary.bin"));
    if (
      this.leftBoundary.length !== this.config.ntags ||
      this.rightBoundary.length !== this.config.ntags
    ) {
      throw new Error(
        `boundary lengths ${this.leftBoundary.length}/${this.rightBoundary.length} != ntags=${this.config.ntags}`,
      );
    }
  }

  /** Lazy ONNX session loader. Cached on the instance. */
  private getSession(): Promise<OrtSession> {
    if (this.sessionP === null) {
      this.sessionP = (async () => {
        // Dynamic import so users who only use the Wapiti path don't
        // need onnxruntime-node installed.
        const ort = await import("onnxruntime-node");
        const session = (await ort.InferenceSession.create(
          path.join(this.modelDir, "model.onnx"),
          { executionProviders: this.providers },
        )) as unknown as OrtSession;
        return session;
      })();
    }
    return this.sessionP;
  }

  label(data: Iterable<string>): Promise<string>;
  label(data: string): Promise<string>;
  async label(data: Iterable<string> | string): Promise<string> {
    if (this.closed) throw new Error("BidLSTMCRFFeaturesTagger: tagger is closed");

    const text = typeof data === "string" ? data : Array.from(data).join("\n");
    const { rows, T } = this.parseRows(text);
    if (T === 0) return "";


    const wordIn = this.encodeWords(rows);
    const charIn = this.encodeChars(rows);
    const featIn = this.encodeFeatures(rows);

    const session = await this.getSession();
    const ort = await import("onnxruntime-node");
    const D = this.config.word_embedding_size;
    const L = this.config.max_char_length;
    const N = this.config.features_indices.length;
    const feeds: Record<string, OrtTensor> = {
      word_input: new ort.Tensor("float32", wordIn, [1, T, D]) as unknown as OrtTensor,
      char_input: new ort.Tensor("int32", charIn, [1, T, L]) as unknown as OrtTensor,
      features_input: new ort.Tensor("int32", featIn, [1, T, N]) as unknown as OrtTensor,
    };
    const results = await session.run(feeds);
    const outName = session.outputNames[0]!;
    const out = results[outName]!.data as Float32Array;
    if (out.length !== T * this.config.ntags) {
      throw new Error(`ONNX output length ${out.length} != T*ntags (${T}*${this.config.ntags})`);
    }

    const { labels } = neuralCrfViterbi(
      out,
      this.transitions,
      T,
      this.config.ntags,
      this.leftBoundary,
      this.rightBoundary,
    );

    const lines: string[] = new Array(T);
    for (let i = 0; i < T; i++) {
      lines[i] = `${rows[i]!.raw} ${iobToGrobidLabel(this.indiceTag[labels[i]!]!)}`;
    }
    return lines.join("\n") + "\n";
  }

  close(): void {
    this.closed = true;
    this.sessionP = null;
  }

  // ---------------------------------------------------------------- parse

  private parseRows(text: string): { rows: { raw: string; cols: string[] }[]; T: number } {
    const lines = text.split(/\r?\n/);
    const rows: { raw: string; cols: string[] }[] = [];
    for (const line of lines) {
      if (line.length === 0) continue;
      const cols = line.split(/\s+/);
      rows.push({ raw: line, cols });
    }
    return { rows, T: rows.length };
  }

  // ---------------------------------------------------------------- encoders

  private encodeWords(rows: { cols: string[] }[]): Float32Array {
    const T = rows.length;
    const D = this.config.word_embedding_size;
    const out = new Float32Array(T * D);
    for (let t = 0; t < T; t++) {
      const tok = rows[t]!.cols[0]!;
      const v = this.glove.lookup(tok);
      if (v.length !== D) {
        throw new Error(`GloveProvider returned dim ${v.length}, expected ${D}`);
      }
      out.set(v, t * D);
    }
    return out;
  }

  private encodeChars(rows: { cols: string[] }[]): Int32Array {
    const T = rows.length;
    const L = this.config.max_char_length;
    const out = new Int32Array(T * L); // zero-padded by default
    const unk = this.charVocab["<UNK>"] ?? 1;
    for (let t = 0; t < T; t++) {
      const tok = rows[t]!.cols[0]!;
      const lim = Math.min(tok.length, L);
      for (let i = 0; i < lim; i++) {
        const ch = tok[i]!;
        out[t * L + i] = this.charVocab[ch] ?? unk;
      }
      // remaining positions stay 0 (<PAD>)
    }
    return out;
  }

  private encodeFeatures(rows: { cols: string[] }[]): Int32Array {
    const T = rows.length;
    const featureColumns = this.config.features_indices; // e.g. [9, 10, …, 30]
    const N = featureColumns.length;
    const out = new Int32Array(T * N); // 0 = padding (reserved)
    const mapToIndex = this.featurePrep.features_map_to_index;
    // DeLFT's `load_data_and_labels_crf_content` does `pieces[1:-1]` —
    // it drops column 0 (the token) AND the trailing column (a label
    // placeholder). The model's `features_indices` then index into the
    // reduced 30-element list. So the raw-row column for
    // `features_indices[i]` is `colIdx + 1` (shifted by the dropped
    // token), AND must be < cols.length - 1 (otherwise we'd be reading
    // the label as a feature; the DeLFT model was trained with that
    // slot as padding).
    for (let t = 0; t < T; t++) {
      const cols = rows[t]!.cols;
      const lastFeatureIdx = cols.length - 2; // index of the final feature in the raw row
      for (let i = 0; i < N; i++) {
        const colIdx = featureColumns[i]!;
        const rawCol = colIdx + 1;
        if (rawCol > lastFeatureIdx) continue; // beyond the [1:-1] slice — leave as padding (0)
        const raw = cols[rawCol];
        if (raw === undefined) continue;
        const colMap = mapToIndex[String(colIdx)];
        if (!colMap) continue;
        const v = colMap[raw];
        if (v !== undefined) out[t * N + i] = v;
        // unknown values fall back to 0 (mask/padding slot)
      }
    }
    return out;
  }
}
