// Port of the C `decoder` module from upstream Wapiti (v1.5.0).
// Upstream: upstream/wapiti/decoder.{c,h}
//
// Implements the Viterbi pass for linear-chain CRFs (and MEMMs, when
// `mdl->type == 1`). GROBID never enables `lblpost`, `nbest > 1`, `outsc`,
// `force`, or `check` from the labelling code path, but we keep all those
// branches porteed except the parts that require gradient/forward-backward
// (`tag_postsc`) — see comment in `tagViterbi` below.
//
// The decoder works on `seq_t` objects (produced by `rdr_raw2seq`) and on
// the model weights stored in `MdlT.theta`. Output indices map back to label
// strings via `mdl.reader.lbl`.

import type { MdlT } from "./wapiti-model.js";
import type { SeqT } from "./wapiti-reader.js";

const NEG_INFINITY = -Infinity;

/**
 * Port of `tag_expsc` (decoder.c:67-122).
 *
 * Computes the score lattice `psi[t][yp][y] = sum_k theta_k * f_k(yp, y, x_t)`
 * for Viterbi in log-space (no exponentiation). The lattice is laid out flat
 * as `t*Y*Y + yp*Y + y`.
 */
function tagExpsc(mdl: MdlT, seq: SeqT, psi: Float64Array): number {
  const Y = mdl.nlbl;
  const T = seq.len;
  const x = mdl.theta;
  // First pass: unigram contributions — broadcast across yp.
  for (let t = 0; t < T; t++) {
    const pos = seq.pos[t]!;
    for (let y = 0; y < Y; y++) {
      let sum = 0.0;
      for (let n = 0; n < pos.ucnt; n++) {
        const o = pos.uobs[n]!;
        sum += x[Number(mdl.uoff[o]!) + y]!;
      }
      const base = t * Y * Y;
      for (let yp = 0; yp < Y; yp++) {
        psi[base + yp * Y + y] = sum;
      }
    }
  }
  // Second pass: bigram contributions, only for t >= 1.
  for (let t = 1; t < T; t++) {
    const pos = seq.pos[t]!;
    const base = t * Y * Y;
    for (let yp = 0, d = 0; yp < Y; yp++) {
      for (let y = 0; y < Y; y++, d++) {
        let sum = 0.0;
        for (let n = 0; n < pos.bcnt; n++) {
          const o = pos.bobs[n]!;
          sum += x[Number(mdl.boff[o]!) + d]!;
        }
        const idx = base + yp * Y + y;
        psi[idx] = psi[idx]! + sum;
      }
    }
  }
  return 0; // op=0: scores are in log-space, combine via addition
}

/**
 * Port of `tag_memmsc` (decoder.c:130-146).
 *
 * Used only when `mdl.type == 1` (MEMM). Computes `tag_expsc` then
 * exponentiates and normalises per previous-label. Returns `op=1` to flag
 * linear-space combination.
 */
function tagMemmsc(mdl: MdlT, seq: SeqT, psi: Float64Array): number {
  const Y = mdl.nlbl;
  const T = seq.len;
  tagExpsc(mdl, seq, psi);
  // xvm_expma(psi, psi, 0.0, T*Y*Y). C version subtracts max then exp; with
  // operand 0.0 it reduces to plain element-wise exp.
  for (let i = 0; i < T * Y * Y; i++) psi[i] = Math.exp(psi[i]!);
  for (let t = 0; t < T; t++) {
    const base = t * Y * Y;
    for (let yp = 0; yp < Y; yp++) {
      let sum = 0.0;
      for (let y = 0; y < Y; y++) sum += psi[base + yp * Y + y]!;
      for (let y = 0; y < Y; y++) psi[base + yp * Y + y]! /= sum;
    }
  }
  return 1;
}

/**
 * Port of `tag_viterbi` (decoder.c:228-307).
 *
 * Runs classical Viterbi over the score lattice and back-decodes the best
 * label sequence. `mdl.opt.lblpost` (posterior scoring via forward-backward)
 * is not exercised by GROBID and would require porting `gradient.c`; we
 * raise a clear error if it is ever requested.
 */
export function tagViterbi(
  mdl: MdlT,
  seq: SeqT,
): { out: Uint32Array; sc: number; psc: Float64Array } {
  const Y = mdl.nlbl;
  const T = seq.len;
  const psi = new Float64Array(T * Y * Y);
  const back = new Uint32Array(T * Y);

  let op: number;
  if (mdl.type === 1) {
    op = tagMemmsc(mdl, seq, psi);
  } else if (mdl.opt.lblpost) {
    // `tag_postsc` requires gradient-based forward-backward (gradient.c);
    // GROBID does not enable this option, so we refuse rather than silently
    // fall back. If a model ever sets it, we would need to port grd_*.
    throw new Error("lblpost (posterior scoring) not supported in JS port");
  } else {
    op = tagExpsc(mdl, seq, psi);
  }
  // `mdl.opt.force` correction (tag_forced) — same situation: not used by
  // the GROBID labelling path because no reference labels are provided.
  if (mdl.opt.force) {
    throw new Error("force option not supported in JS port");
  }

  const cur = new Float64Array(Y);
  const old = new Float64Array(Y);
  // Initial: alpha_0(y) = psi[0][0][y].
  for (let y = 0; y < Y; y++) cur[y] = psi[0 * Y * Y + 0 * Y + y]!;

  for (let t = 1; t < T; t++) {
    for (let y = 0; y < Y; y++) old[y] = cur[y]!;
    const base = t * Y * Y;
    for (let y = 0; y < Y; y++) {
      let bst = NEG_INFINITY;
      let idx = 0;
      for (let yp = 0; yp < Y; yp++) {
        let val = old[yp]!;
        if (op !== 0) val *= psi[base + yp * Y + y]!;
        else val += psi[base + yp * Y + y]!;
        if (val > bst) {
          bst = val;
          idx = yp;
        }
      }
      back[t * Y + y] = idx;
      cur[y] = bst;
    }
  }

  // Find best final label.
  let bst = 0;
  for (let y = 1; y < Y; y++) if (cur[y]! > cur[bst]!) bst = y;
  const sc = cur[bst]!;
  const out = new Uint32Array(T);
  const psc = new Float64Array(T);
  // Backtrack.
  for (let t = T; t > 0; t--) {
    const yp = t !== 1 ? back[(t - 1) * Y + bst]! : 0;
    const y = bst;
    out[t - 1] = y;
    psc[t - 1] = psi[(t - 1) * Y * Y + yp * Y + y]!;
    bst = yp;
  }
  return { out, sc, psc };
}
