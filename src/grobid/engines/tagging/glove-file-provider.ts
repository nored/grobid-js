// File-backed GloveProvider. Loads a vocab-restricted dump produced by
// `scripts/extract-glove-vocab.py` — a vocab text file (one token per
// line, in row order) and a binary float32 matrix.
//
// Layout of glove-vectors.bin:
//   bytes 0..3  : int32 LE, token_count
//   bytes 4..7  : int32 LE, dim (e.g. 300)
//   bytes 8..   : token_count * dim float32 LE values, row-major
//
// Layout of glove-vocab.txt:
//   one UTF-8 token per line, in the SAME row order as the matrix.
//
// The full vector matrix is loaded into memory eagerly. For 100k tokens
// × 300d × 4 bytes that is ~120 MB; we accept that cost rather than
// re-implement mmap in pure JS. If the dump is much larger (>500 MB),
// callers should consider splitting by frequency band and using a
// chained provider.

import { readFileSync } from "node:fs";
import type { GloveProvider } from "./bidlstm-crf-features-tagger.js";

/**
 * Mirror of DeLFT's `_normalize_num` (preprocess.py:1063). Replaces every
 * ASCII or fullwidth digit with "0", leaving non-digit characters
 * unchanged. DeLFT applies this to every token before Glove lookup at
 * both training and inference time, so we must match.
 */
function normaliseNum(token: string): string {
  // Single regex; fullwidth digits are 0xFF10..0xFF19.
  return token.replace(/[0-9０-９]/g, "0");
}

export class GloveFileProvider implements GloveProvider {
  readonly dim: number;
  private readonly vectors: Float32Array; // token_count * dim
  private readonly index: Map<string, number>;
  private readonly zero: Float32Array;

  constructor(vocabPath: string, vectorsPath: string) {
    // Vocab is a UTF-8 text file. We don't trim — Glove tokens can
    // legitimately have leading/trailing whitespace, though that's rare.
    const vocabRaw = readFileSync(vocabPath, "utf8");
    const tokens = vocabRaw.split("\n");
    // Drop a single trailing empty line (the extractor writes a final "\n").
    if (tokens.length > 0 && tokens[tokens.length - 1] === "") tokens.pop();

    const buf = readFileSync(vectorsPath);
    if (buf.byteLength < 8) {
      throw new Error(`vectors file ${vectorsPath} too short: ${buf.byteLength} bytes`);
    }
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const tokenCount = dv.getInt32(0, true);
    const dim = dv.getInt32(4, true);
    const expected = 8 + tokenCount * dim * 4;
    if (buf.byteLength !== expected) {
      throw new Error(
        `vectors file ${vectorsPath}: header says ${tokenCount}x${dim} (=${expected} bytes), actual ${buf.byteLength}`,
      );
    }
    if (tokenCount !== tokens.length) {
      throw new Error(
        `vocab length ${tokens.length} != vector matrix token_count ${tokenCount}`,
      );
    }

    this.dim = dim;
    this.zero = new Float32Array(dim);

    // Materialise the matrix into a single contiguous Float32Array. We
    // do a manual little-endian read because Node's Buffer typed-view
    // helpers don't accept a length, and using `Float32Array(buf.buffer)`
    // would assume host endianness.
    this.vectors = new Float32Array(tokenCount * dim);
    for (let i = 0; i < tokenCount * dim; i++) {
      this.vectors[i] = dv.getFloat32(8 + i * 4, true);
    }

    this.index = new Map<string, number>();
    for (let i = 0; i < tokenCount; i++) {
      this.index.set(tokens[i]!, i);
    }
  }

  lookup(token: string): Float32Array {
    // Match DeLFT's `_normalize_num`: each digit character is mapped to "0"
    // before vocab lookup. Without this, tokens like "2024" or "GPT-4"
    // never hit Glove because the model was trained on their normalised
    // forms ("0000", "GPT-0").
    const normalised = normaliseNum(token);
    const idx = this.index.get(normalised);
    if (idx === undefined) return this.zero;
    // subarray returns a view, not a copy — callers must not mutate.
    return this.vectors.subarray(idx * this.dim, (idx + 1) * this.dim);
  }

  /** Vocabulary size; useful for diagnostics. */
  get size(): number {
    return this.index.size;
  }
}
