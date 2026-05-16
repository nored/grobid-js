// Port of `org.grobid.core.jni.WapitiModel` (Java) + the C `model` module
// from upstream Wapiti (v1.5.0). The Java class is a thin JNI bridge over
// the C decoder; in this port we collapse both layers — the `WapitiModel`
// class exposes the same Java-facing API, and the model file is parsed
// directly with the ported C loader (no JNI, no SWIG).
//
// Upstream:
//   - grobid-core/src/main/java/org/grobid/core/jni/WapitiModel.java
//   - upstream/wapiti/model.{c,h}
//
// The `.wapiti` file is *text*-formatted (mdl_save writes `fprintf`s with
// `%la` hex-float weights, see model.c:267-279). Loading is therefore done
// by stepping through the byte buffer with the same `fscanf`/`fgets`/
// `ns_readstr` primitives the C code uses. We reuse `BufferNsReader` from
// `wapiti-quark.ts` for the netstring layer.

import { readFileSync } from "node:fs";
import { GrobidException } from "../exceptions/grobid-exception.js";
import { getLogger } from "../utilities/logger.js";
import type { GrobidModel } from "../grobid-model.js";
import { BufferNsReader } from "./wapiti-quark.js";
import { RdrT } from "./wapiti-reader.js";
import { WapitiWrapper } from "./wapiti-wrapper.js";

const LOGGER = getLogger("WapitiModel");

/**
 * Minimal `opt_t` (options.h) — GROBID's labelling path only reads the
 * options that gate decoder behaviour. We default everything off; the model
 * file does not encode options (it inherits them from the runtime).
 */
export interface OptT {
  /** posterior-scoring via forward-backward — unsupported here. */
  lblpost: boolean;
  /** force decoding to respect known reference labels — unsupported here. */
  force: boolean;
  /** number of best paths to return; >1 triggers `tag_nbviterbi`. */
  nbest: number;
  /** sparse forward-backward — unused. */
  sparse: boolean;
  /** when true, do not echo input columns back when labelling. */
  label: boolean;
  /** when true, emit per-token scores. */
  outsc: boolean;
  /** when true, check predicted labels against reference. */
  check: boolean;
}

/**
 * Port of `mdl_t` (model.h:62-94) — only the fields touched by the labelling
 * path. We drop `werr`, `wcnt`, `wpos`, `timer`, `total`, `train`, `devel`
 * since those are training-only.
 */
export interface MdlT {
  opt: OptT;
  type: number;       // uint32_t — 0 for CRF (GROBID default), 1 for MEMM
  nlbl: number;       // Y
  nobs: number;       // O
  nftr: number;       // F
  kind: Uint8Array;   // [O] — bit 0 = unigram, bit 1 = bigram
  uoff: Float64Array; // [O] — uint64 offsets stored as f64 (safe up to 2^53)
  boff: Float64Array; // [O]
  theta: Float64Array;// [F]
  reader: RdrT;
}

// =====================================================================
//  Hex-float parsing (port of `strtod` for `%la` format)
// =====================================================================

/**
 * Parse C99 hex-float literal (`0x1.fp+3`) — the format `fprintf("%la", v)`
 * produces. Falls back to `parseFloat` for plain decimal (the model file
 * could in principle be hand-edited but the loader emits hex).
 *
 * Format: `[-]0x<hex>[.<hex>][p[+-]<dec>]`.
 *   The mantissa is interpreted as a hexadecimal fraction; the exponent (if
 *   present) is binary, base-2.
 */
export function parseHexFloat(s: string): number {
  const t = s.trim();
  // Plain decimals fall through to parseFloat (handles 0, NaN, inf, etc.).
  const m = /^([-+]?)0x([0-9a-fA-F]*)(?:\.([0-9a-fA-F]*))?(?:p([-+]?\d+))?$/.exec(t);
  if (!m) {
    const f = parseFloat(t);
    if (isNaN(f) && t !== "nan" && t !== "NaN") {
      throw new Error("invalid floating-point literal: " + s);
    }
    return f;
  }
  const sign = m[1] === "-" ? -1 : 1;
  const intHex = m[2] ?? "";
  const fracHex = m[3] ?? "";
  const exp = m[4] !== undefined ? parseInt(m[4], 10) : 0;
  let mantissa = 0;
  for (let i = 0; i < intHex.length; i++) {
    mantissa = mantissa * 16 + parseInt(intHex[i]!, 16);
  }
  if (fracHex.length > 0) {
    let frac = 0;
    let scale = 1 / 16;
    for (let i = 0; i < fracHex.length; i++) {
      frac += parseInt(fracHex[i]!, 16) * scale;
      scale /= 16;
    }
    mantissa += frac;
  }
  return sign * mantissa * Math.pow(2, exp);
}

// =====================================================================
//  Model loader (port of `mdl_load` + `mdl_sync`)
// =====================================================================

/**
 * Port of `mdl_sync` (model.c:125-194) — populates `kind`, `uoff`, `boff`,
 * and `nftr` from the loaded observations.
 *
 * Unlike the C version (which supports incremental expansion of an existing
 * model), here we assume a fresh model loaded from disk: `mdl.nlbl == 0`
 * and `mdl.nobs == 0` on entry. The "old labels mismatch" warning path is
 * therefore unreachable.
 */
function mdlSync(mdl: MdlT): void {
  const Y = mdl.reader.lbl.count();
  const O = mdl.reader.obs.count();
  if (mdl.nlbl === Y && mdl.nobs === O) return;
  if (Y === 0 || O === 0) throw new Error("cannot synchronize an empty model");
  mdl.nlbl = Y;
  mdl.nobs = O;
  mdl.kind = new Uint8Array(O);
  mdl.uoff = new Float64Array(O);
  mdl.boff = new Float64Array(O);
  let F = 0;
  for (let o = 0; o < O; o++) {
    const obs = mdl.reader.obs.id2str(o);
    switch (obs.charAt(0)) {
      case "u": mdl.kind[o] = 1; break;
      case "b": mdl.kind[o] = 2; break;
      case "*": mdl.kind[o] = 3; break;
    }
    if (mdl.kind[o]! & 1) { mdl.uoff[o] = F; F += Y; }
    if (mdl.kind[o]! & 2) { mdl.boff[o] = F; F += Y * Y; }
  }
  mdl.nftr = F;
  mdl.theta = new Float64Array(F);
  // Lock the quarks so accidental queries don't grow them.
  mdl.reader.lbl.lock(true);
  mdl.reader.obs.lock(true);
}

/**
 * Port of `mdl_load` (model.c:286-310).
 *
 * The file starts with one of two headers:
 *   "#mdl#<type>#<nact>\n"  (current format, since v1.4 — see model.c:292)
 *   "#mdl#<nact>\n"         (legacy format)
 * then the reader (`rdr_save` output: header + netstring patterns + label
 * quark + obs quark), then `<nact>` lines of `f=value` where `value` is in
 * `%la` hex-float format.
 */
function mdlLoad(mdl: MdlT, reader: BufferNsReader): void {
  const errMsg = "invalid model format";
  const saved = reader.position();
  const header = reader.readLine();
  let m = /^#mdl#(\d+)#(\d+)$/.exec(header);
  let nact: number;
  if (m) {
    mdl.type = Number(m[1]);
    nact = Number(m[2]);
  } else {
    // Rewind and try legacy format.
    reader.seek(saved);
    const legacy = reader.readLine();
    m = /^#mdl#(\d+)$/.exec(legacy);
    if (!m) throw new Error(errMsg);
    mdl.type = 0;
    nact = Number(m[1]);
  }
  mdl.reader.load(reader);
  mdlSync(mdl);
  for (let i = 0; i < nact; i++) {
    const line = reader.readLine();
    const eq = line.indexOf("=");
    if (eq === -1) throw new Error(errMsg);
    const f = Number(line.slice(0, eq));
    const v = parseHexFloat(line.slice(eq + 1));
    if (!Number.isInteger(f)) throw new Error(errMsg);
    mdl.theta[f] = v;
  }
}

// =====================================================================
//  WapitiModel — Java surface
// =====================================================================

/**
 * Port of `org.grobid.core.jni.WapitiModel`.
 *
 * The Java class wraps a SWIG-generated `SWIGTYPE_p_mdl_t` pointer obtained
 * via `Wapiti.loadModel(...)`. Here we instead parse the model file in JS
 * and hold the in-memory `MdlT`. The public API matches upstream:
 *   - `new WapitiModel(GrobidModel | File)` — loads eagerly.
 *   - `label(data)` — runs the decoder, returns the labelled string.
 *   - `close()` — releases the in-memory model.
 *   - `train(...)` — preserved as a static throw (training not supported).
 */
export class WapitiModel {
  private model: MdlT | null = null;
  private readonly modelFile: string;

  constructor(modelOrFile: GrobidModel | string) {
    if (typeof modelOrFile === "string") {
      this.modelFile = modelOrFile;
    } else {
      this.modelFile = modelOrFile.getModelPath();
    }
    this.init();
  }

  /** Port of `WapitiModel.init` (WapitiModel.java:30-39). */
  private init(): void {
    if (this.model !== null) return;
    // Existence check is the embedder's responsibility (Node `fs` will throw
    // ENOENT below); we still preserve the upstream message shape.
    let bytes: Uint8Array;
    try {
      bytes = readFileSync(this.modelFile);
    } catch (e) {
      throw new GrobidException(
        "Model file does not exists or is a directory: " + this.modelFile,
        e,
      );
    }
    this.model = WapitiModel.loadModelFromBytes(bytes);
  }

  /**
   * Port of `WapitiWrapper.getModel` (no `checkLabels` since `--check` is
   * unused by GROBID at label time). Exposed as static for callers that
   * already have the bytes (tests, embedders).
   */
  static loadModelFromBytes(bytes: Uint8Array): MdlT {
    const opt: OptT = {
      lblpost: false,
      force: false,
      nbest: 1,
      sparse: false,
      label: false,
      outsc: false,
      check: false,
    };
    const mdl: MdlT = {
      opt,
      type: 0,
      nlbl: 0,
      nobs: 0,
      nftr: 0,
      kind: new Uint8Array(0),
      uoff: new Float64Array(0),
      boff: new Float64Array(0),
      theta: new Float64Array(0),
      reader: new RdrT(false),
    };
    const reader = new BufferNsReader(bytes);
    mdlLoad(mdl, reader);
    return mdl;
  }

  /**
   * Returns the labels known to the model, in id order.
   * Mirrors what upstream callers reach via the SWIG pointer + Wapiti API;
   * not present in the Java class but specified in the JS port task.
   */
  getLabels(): readonly string[] {
    if (this.model === null) this.init();
    const lbl = this.model!.reader.lbl;
    const out: string[] = [];
    for (let i = 0; i < lbl.count(); i++) out.push(lbl.id2str(i));
    return out;
  }

  /**
   * Returns the underlying `MdlT` for direct decoder use. Mirrors the
   * `getTagger()` accessor described in the JS port task.
   */
  getTagger(): MdlT {
    if (this.model === null) this.init();
    return this.model!;
  }

  /**
   * Port of `WapitiModel.label` (WapitiModel.java:41-51).
   *
   * GROBID expects tabs as feature separators while the C decoder writes
   * spaces, so the upstream code applies `replaceAll(" ", "\t")` at the very
   * end. We mirror exactly, including the early auto-reopen if the model was
   * closed.
   */
  label(data: string): string {
    if (this.model === null) {
      LOGGER.warn("Model has been already closed, reopening: " + this.modelFile);
      this.init();
    }
    // Delegate to `WapitiWrapper.label`, preserving the upstream call chain
    // (`WapitiModel.label` -> `WapitiWrapper.label` -> C decoder). The
    // wrapper handles the empty-input guard and the GrobidException-on-null
    // failure mode verbatim.
    const rawResult = WapitiWrapper.label(this.model!, data);
    let label = (rawResult ?? "").trim();
    // TODO: VZ: Grobid currently expects tabs as separators whereas wapiti
    // uses spaces for separating features. (Verbatim comment from upstream.)
    label = label.split(" ").join("\t");
    return label;
  }

  /** Port of `WapitiModel.close` (WapitiModel.java:53-58). */
  close(): void {
    if (this.model !== null) {
      // Release the references; JS GC handles the rest. Mirrors
      // `Wapiti.freeModel` in spirit (no native pointer to free).
      this.model = null;
    }
  }

  /**
   * Port of `WapitiModel.train` (WapitiModel.java:60-68). Training requires
   * the gradient code path which we don't port — the JS runtime is for
   * inference only.
   */
  static train(
    _template: string,
    _trainingData: string,
    _outputModel: string,
    _params: string = "",
  ): void {
    throw new GrobidException(
      "Wapiti training is not supported in the JS port (inference-only).",
    );
  }
}
