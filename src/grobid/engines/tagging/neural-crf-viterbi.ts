// Viterbi decode for a linear-chain CRF where the per-token emission
// scores come from a neural model (i.e. one score per (timestep, label),
// not Wapiti's per-(timestep, prev_label, label) lattice).
//
// Input shapes match the convention used by tf_addons.layers.CRF and
// DeLFT's BidLSTM_CRF_FEATURES:
//
//   potentials  : Float32Array of length T*Y, row-major (T = seq len,
//                 Y = nlabels). potentials[t*Y + y] is the unary score
//                 for label y at timestep t.
//   transitions : Float32Array of length Y*Y, row-major.
//                 transitions[yp*Y + y] is the score for moving from
//                 label yp to label y.
//   leftBoundary, rightBoundary : Float32Array of length Y. Per-label
//                 bias for the first and last timesteps. (DeLFT's CRF
//                 wrapper splices these into `add_boundary_energy`.)
//
// Returns: Uint32Array of length T with the argmax label at each timestep,
// plus the total Viterbi score (log-space).
//
// We intentionally do NOT depend on `src/grobid/jni/wapiti-decoder.ts` —
// the Wapiti decoder consumes Wapiti's `seq_t` and `MdlT` structures with
// per-position observation lists, which are a different shape from neural
// emissions. Sharing would mean a lossy adapter; a 30-line bespoke decoder
// is cleaner.

const NEG_INFINITY = -Infinity;

export function neuralCrfViterbi(
  potentials: Float32Array,
  transitions: Float32Array,
  T: number,
  Y: number,
  leftBoundary?: Float32Array | null,
  rightBoundary?: Float32Array | null,
): { labels: Uint32Array; score: number } {
  if (potentials.length !== T * Y) {
    throw new Error(`potentials length ${potentials.length} != T*Y (${T}*${Y})`);
  }
  if (transitions.length !== Y * Y) {
    throw new Error(`transitions length ${transitions.length} != Y*Y (${Y}*${Y})`);
  }
  if (T === 0) return { labels: new Uint32Array(0), score: 0 };

  const alpha = new Float64Array(T * Y);
  const back = new Uint32Array(T * Y);

  // Initial step: alpha[0][y] = potentials[0][y] (+ leftBoundary[y])
  for (let y = 0; y < Y; y++) {
    alpha[y] = potentials[y]! + (leftBoundary ? leftBoundary[y]! : 0);
  }

  for (let t = 1; t < T; t++) {
    const tY = t * Y;
    const tm1Y = (t - 1) * Y;
    for (let y = 0; y < Y; y++) {
      let bst = NEG_INFINITY;
      let arg = 0;
      for (let yp = 0; yp < Y; yp++) {
        const v = alpha[tm1Y + yp]! + transitions[yp * Y + y]!;
        if (v > bst) {
          bst = v;
          arg = yp;
        }
      }
      alpha[tY + y] = bst + potentials[tY + y]!;
      back[tY + y] = arg;
    }
  }

  // Right boundary applied to the final step (T-1).
  if (rightBoundary) {
    const lastY = (T - 1) * Y;
    for (let y = 0; y < Y; y++) alpha[lastY + y] = alpha[lastY + y]! + rightBoundary[y]!;
  }

  // Find best last-label.
  let bst = 0;
  const lastBase = (T - 1) * Y;
  for (let y = 1; y < Y; y++) {
    if (alpha[lastBase + y]! > alpha[lastBase + bst]!) bst = y;
  }
  const score = alpha[lastBase + bst]!;
  const labels = new Uint32Array(T);
  labels[T - 1] = bst;
  for (let t = T - 1; t > 0; t--) {
    bst = back[t * Y + bst]!;
    labels[t - 1] = bst;
  }
  return { labels, score };
}
