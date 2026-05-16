// Port of the C `reader` module from upstream Wapiti (v1.5.0).
// Upstream: upstream/wapiti/reader.{c,h}
//
// The reader owns the patterns + label/observation quarks and converts input
// rows into the interned `seq_t` form used by the decoder. The label-time
// pipeline goes `string -> raw_t -> tok_t -> seq_t`; here we expose the
// chained call as `rdrReadRaw` + `rdrRaw2Seq`, identical to upstream.

import { QrkT, QRK_NONE, type NsReader } from "./wapiti-quark.js";
import { patComp, patExec, type PatT, type TokT } from "./wapiti-pattern.js";

/** Mirrors `raw_t` (sequence.h:62-78). */
export interface RawT {
  len: number;
  lines: string[];
}

/** Mirrors `pos_t` (sequence.h:122-131). */
export interface PosT {
  lbl: number;        // (uint32_t)-1 if unknown
  ucnt: number;
  bcnt: number;
  uobs: number[];     // length ucnt — actually a window into seq.raw
  bobs: number[];     // length bcnt
}

/** Mirrors `seq_t` (sequence.h:123-132). */
export interface SeqT {
  len: number;
  raw: number[];
  pos: PosT[];
}

/**
 * Port of `rdr_t` (reader.h:46-55). Holds the compiled patterns and the
 * label/observation quarks loaded from the model file.
 */
export class RdrT {
  autouni: boolean;
  npats: number = 0;
  nuni: number = 0;
  nbi: number = 0;
  ntoks: number = 0;
  pats: PatT[] = [];
  lbl: QrkT = new QrkT();
  obs: QrkT = new QrkT();

  /** Port of `rdr_new` (reader.c:68-77). */
  constructor(autouni: boolean) {
    this.autouni = autouni;
  }

  /** Port of `rdr_load` (reader.c:527-557). */
  load(reader: NsReader): void {
    // Header line. Two variants:
    //   "#rdr#<npats>/<ntoks>/<autouni>"  (modern)
    //   "#rdr#<npats>/<ntoks>"            (legacy)
    // We try modern first; if it doesn't parse, fall back to legacy. The C
    // code does an `fpos_t` save/restore via `fgetpos`/`fsetpos`. We do the
    // same with the buffer reader cursor below if `reader` exposes one — but
    // because `RdrT.load` is only called with a `BufferNsReader` in practice,
    // we attempt a single regex match against the line we read.
    const header = reader.readLine();
    let m: RegExpExecArray | null = /^#rdr#(\d+)\/(\d+)\/(\d+)$/.exec(header);
    let autouni = this.autouni ? 1 : 0;
    if (m) {
      this.npats = Number(m[1]);
      this.ntoks = Number(m[2]);
      autouni = Number(m[3]);
    } else {
      m = /^#rdr#(\d+)\/(\d+)$/.exec(header);
      if (!m) throw new Error("broken file, invalid reader format");
      this.npats = Number(m[1]);
      this.ntoks = Number(m[2]);
    }
    this.autouni = autouni !== 0;
    this.nuni = 0;
    this.nbi = 0;
    if (this.npats !== 0) {
      this.pats = [];
      for (let p = 0; p < this.npats; p++) {
        const patSrc = reader.readNetstring();
        const compiled = patComp(patSrc);
        this.pats.push(compiled);
        // C: switch (tolower(pat[0])) {...}
        switch (patSrc.charAt(0).toLowerCase()) {
          case "u": this.nuni++; break;
          case "b": this.nbi++; break;
          case "*": this.nuni++; this.nbi++; break;
        }
      }
    }
    this.lbl.load(reader);
    this.obs.load(reader);
  }

  /** Port of `rdr_mapobs` (reader.c:259-266). */
  private mapObs(str: string): number {
    if (!this.autouni) return this.obs.str2id(str);
    return this.obs.str2id("u" + str);
  }

  /**
   * Port of `rdr_pattok2seq` (reader.c:336-391). Applies the loaded patterns
   * to a tokenized sequence to build the interned `seq_t`.
   */
  private patTok2Seq(tok: TokT): SeqT | null {
    const T = tok.len;
    // Allocate seq.raw with capacity (nuni+nbi)*T (upstream uses the same
    // over-allocation pattern).
    const seq: SeqT = {
      len: T,
      raw: [],
      pos: [],
    };
    for (let t = 0; t < T; t++) {
      seq.pos.push({
        lbl: 0xffffffff,
        ucnt: 0,
        bcnt: 0,
        uobs: [],
        bobs: [],
      });
    }
    for (let t = 0; t < T; t++) {
      const pos = seq.pos[t]!;
      pos.ucnt = 0;
      pos.bcnt = 0;
      for (let x = 0; x < this.npats; x++) {
        const obs = patExec(this.pats[x]!, tok, t);
        if (obs === null) {
          // Upstream: rdr_freeseq(seq); return NULL;
          return null;
        }
        const id = this.mapObs(obs);
        if (id === QRK_NONE) continue;
        let kind = 0;
        switch (obs.charAt(0)) {
          case "u": kind = 1; break;
          case "b": kind = 2; break;
          case "*": kind = 3; break;
        }
        if (kind & 1) pos.uobs.push(id), pos.ucnt++;
        if (kind & 2) pos.bobs.push(id), pos.bcnt++;
      }
    }
    if (tok.lbl !== null) {
      for (let t = 0; t < T; t++) {
        const l = tok.lbl[t]!;
        seq.pos[t]!.lbl = this.lbl.str2id(l);
      }
    }
    return seq;
  }

  /**
   * Port of `rdr_rawtok2seq` (reader.c:272-331). Used when no patterns are
   * loaded — each token is taken as an observation verbatim.
   */
  private rawTok2Seq(tok: TokT): SeqT {
    const T = tok.len;
    const seq: SeqT = { len: T, raw: [], pos: [] };
    for (let t = 0; t < T; t++) {
      seq.pos.push({
        lbl: 0xffffffff,
        ucnt: 0,
        bcnt: 0,
        uobs: [],
        bobs: [],
      });
      const pos = seq.pos[t]!;
      // Pass 1: unigram bucket (skip bigrams when not autouni).
      for (let n = 0; n < tok.cnts[t]!; n++) {
        const o = tok.toks[t]![n]!;
        if (!this.autouni && o.charAt(0) === "b") continue;
        const id = this.mapObs(o);
        if (id !== QRK_NONE) {
          pos.uobs.push(id);
          pos.ucnt++;
        }
      }
      pos.bcnt = 0;
      if (this.autouni) continue;
      // Pass 2: bigram bucket (skip unigrams).
      for (let n = 0; n < tok.cnts[t]!; n++) {
        const o = tok.toks[t]![n]!;
        if (o.charAt(0) === "u") continue;
        const id = this.mapObs(o);
        if (id !== QRK_NONE) {
          pos.bobs.push(id);
          pos.bcnt++;
        }
      }
    }
    if (tok.lbl !== null) {
      for (let t = 0; t < T; t++) {
        const l = tok.lbl[t]!;
        seq.pos[t]!.lbl = this.lbl.str2id(l);
      }
    }
    return seq;
  }

  /**
   * Port of `rdr_raw2seq` (reader.c:398-461). Splits each raw line into
   * whitespace-separated tokens, optionally consumes the last column as a
   * label, then dispatches to the pattern-based or pattern-less conversion.
   */
  raw2seq(raw: RawT, lbl: boolean): SeqT | null {
    const T = raw.len;
    const tok: TokT = {
      len: T,
      lbl: lbl ? [] : null,
      cnts: [],
      toks: [],
    };
    for (let t = 0; t < T; t++) {
      // Strip leading whitespace then split on runs of whitespace.
      const src = raw.lines[t]!.replace(/^[\s]+/, "");
      const cols = src.length === 0 ? [] : src.split(/\s+/);
      if (lbl) {
        if (cols.length === 0) {
          // Empty row but caller asked for labels — upstream would
          // dereference `toks[cnt-1]` and crash. We mirror by throwing.
          throw new Error("empty row while reading labelled sequence");
        }
        tok.lbl!.push(cols[cols.length - 1]!);
        cols.pop();
      }
      tok.cnts.push(cols.length);
      tok.toks.push(cols);
    }
    if (this.npats === 0) return this.rawTok2Seq(tok);
    return this.patTok2Seq(tok);
  }
}

/**
 * Port of `rdr_readraw` (reader.c:205-253). Splits the input text into the
 * `raw_t` form: an array of non-empty lines, with the first blank line
 * marking the end of a sequence. Used by tagger to feed `rdr_raw2seq`.
 *
 * The caller supplies the *whole* sequence text upfront (matching how
 * `WapitiWrapper.label` is invoked from `WapitiTagger`). Multiple sequences
 * separated by blank lines are not expected at this call site in GROBID but
 * we accept them — only the first sequence is returned (caller iterates).
 */
export function rdrReadRaw(text: string): { raw: RawT | null; rest: string } {
  // Split into lines on '\n' but keep behaviour matching `rdr_readline`
  // (trailing CR is preserved in C and we mirror that).
  const lines: string[] = [];
  let cur = text;
  // Skip leading blank lines (mirrors the cnt==0 continue).
  while (true) {
    const nlIdx = cur.indexOf("\n");
    const line = nlIdx === -1 ? cur : cur.slice(0, nlIdx);
    const remaining = nlIdx === -1 ? "" : cur.slice(nlIdx + 1);
    if (cur.length === 0) {
      // EOF
      if (lines.length === 0) return { raw: null, rest: "" };
      break;
    }
    // Check if line is empty (after right-trimming whitespace, like C does).
    const trimmed = line.replace(/[\s]+$/, "");
    if (trimmed.length === 0) {
      cur = remaining;
      if (lines.length === 0) {
        // skip blank-line lead-in
        if (nlIdx === -1) return { raw: null, rest: "" };
        continue;
      }
      break;
    }
    lines.push(line);
    cur = remaining;
    if (nlIdx === -1) break;
  }
  if (lines.length === 0) return { raw: null, rest: cur };
  return { raw: { len: lines.length, lines }, rest: cur };
}
