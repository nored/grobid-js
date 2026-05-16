import { describe, it, expect } from "vitest";
import { loadWapitiModel, parseHexFloat } from "../../src/core/crf/wapiti-model.js";
import { decode } from "../../src/core/crf/wapiti-decoder.js";

describe("parseHexFloat", () => {
  const cases: Array<[string, number]> = [
    ["0x1p+0", 1],
    ["-0x1p+0", -1],
    ["0x1.8p+1", 3],
    ["0x0p+0", 0],
    ["-0x1.fffffffffffffp+1023", -Number.MAX_VALUE],
    ["0x1p-1074", Number.MIN_VALUE],
  ];
  for (const [s, want] of cases) {
    it(`parses ${s}`, () => {
      expect(parseHexFloat(s)).toBe(want);
    });
  }
  it("accepts decimal-shaped zero as a fallback", () => {
    expect(parseHexFloat("0")).toBe(0);
  });
});

/** Build a tiny synthetic Wapiti model file in-memory. */
function buildSyntheticModel(): string {
  // Two patterns: one unigram on column 0, one bigram on columns 0 and 0 of t-1/t.
  const patterns = ["u01:%x[0,0]", "b07:%x[-1,0]/%x[0,0]"];
  // Two labels.
  const labels = ["A", "B"];
  // Observations that we'll wire up with weights.
  const obs = [
    "u01:up",       // unigram: prefer label A when token == "up"
    "u01:down",     // unigram: prefer label B when token == "down"
    "b07:up/down",  // bigram: prefer A→B transition
  ];
  // Build offsets like mdl_sync.
  const Y = labels.length;
  let F = 0;
  const offsets: number[] = [];
  const kinds: number[] = [];
  for (const o of obs) {
    const h = o[0];
    const k = h === "u" ? 1 : h === "b" ? 2 : 3;
    kinds.push(k);
    offsets.push(F);
    if (k & 1) F += Y;
    if (k & 2) F += Y * Y;
  }
  // Weights: feature_id => double
  const weights = new Map<number, number>();
  // u01:up -> A (offset 0, label A=0): weight 2
  weights.set(0, 2);
  // u01:up -> B (offset 0, label B=1): weight -1
  weights.set(1, -1);
  // u01:down -> A (offset 2 = F_after_u01:up=2, label A=0): weight -1
  weights.set(2, -1);
  // u01:down -> B (offset 3, label B=1): weight 2
  weights.set(3, 2);
  // b07:up/down bigram offsets start at 4 (after both unigrams), Y*Y = 4 entries.
  // Order is [yp=0,y=0], [yp=0,y=1], [yp=1,y=0], [yp=1,y=1].
  // Reward A->B transition: position yp=0, y=1 = base+1.
  weights.set(4 + 1, 3);
  const nact = weights.size;
  const lines: string[] = [];
  lines.push(`#mdl#1#${nact}`);
  lines.push(`#rdr#${patterns.length}/1/0`);
  for (const p of patterns) lines.push(`${p.length}:${p},`);
  lines.push(`#qrk#${labels.length}`);
  for (const l of labels) lines.push(`${l.length}:${l},`);
  lines.push(`#qrk#${obs.length}`);
  for (const o of obs) lines.push(`${o.length}:${o},`);
  // Sparse weights in hex-float (use a representation parseHexFloat handles).
  for (const [fid, v] of weights) {
    const hex = doubleToHex(v);
    lines.push(`${fid}=${hex}`);
  }
  return lines.join("\n") + "\n";
}

/** Encode a number using a representation parseHexFloat understands (C99 %a). */
function doubleToHex(v: number): string {
  if (v === 0) return "0x0p+0";
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  const exp = Math.floor(Math.log2(abs));
  const mantissa = abs / Math.pow(2, exp);
  // mantissa is in [1, 2). Encode 13 hex digits of the fractional part.
  let intPart = Math.floor(mantissa);
  let frac = mantissa - intPart;
  let hex = intPart.toString(16);
  if (frac > 0) {
    hex += ".";
    for (let i = 0; i < 13 && frac > 0; i++) {
      frac *= 16;
      const d = Math.floor(frac);
      hex += d.toString(16);
      frac -= d;
    }
  }
  return `${sign}0x${hex}p${exp >= 0 ? "+" : ""}${exp}`;
}

describe("loadWapitiModel", () => {
  it("parses the synthetic model header, patterns, vocabs and weights", () => {
    const m = loadWapitiModel(buildSyntheticModel());
    expect(m.labels).toEqual(["A", "B"]);
    expect(m.obs).toEqual(["u01:up", "u01:down", "b07:up/down"]);
    expect(m.patterns.length).toBe(2);
    expect(m.nact).toBe(5);
    // Verify a couple of weights round-tripped.
    // theta[uoff[u01:up] + 0] should equal 2.
    const upId = m.obsIndex.get("u01:up")!;
    expect(m.theta[m.uoff[upId]! + 0]).toBeCloseTo(2, 12);
    expect(m.theta[m.uoff[upId]! + 1]).toBeCloseTo(-1, 12);
    const bigId = m.obsIndex.get("b07:up/down")!;
    expect(m.theta[m.boff[bigId]! + 1]).toBeCloseTo(3, 12);
  });
});

describe("decode", () => {
  it("predicts the label sequence that maximizes the lattice score", () => {
    const m = loadWapitiModel(buildSyntheticModel());
    // Sequence: ["up", "down"] in column 0. Pattern u01:%x[0,0] fires for
    // "u01:up" and "u01:down"; pattern b07:%x[-1,0]/%x[0,0] fires for
    // "b07:up/down" at t=1. Expected best path: A at t=0, B at t=1, total
    // score = 2 (unigram A|up) + 2 (unigram B|down) + 3 (bigram A→B) = 7.
    const r = decode(m, [["up"], ["down"]]);
    expect(r.labels).toEqual(["A", "B"]);
    expect(r.score).toBeCloseTo(7, 12);
  });
  it("handles a single-token sequence", () => {
    const m = loadWapitiModel(buildSyntheticModel());
    const r = decode(m, [["up"]]);
    expect(r.labels).toEqual(["A"]);
    expect(r.score).toBeCloseTo(2, 12);
  });
  it("returns empty for empty input", () => {
    const m = loadWapitiModel(buildSyntheticModel());
    expect(decode(m, [])).toEqual({ labels: [], score: 0 });
  });
});
