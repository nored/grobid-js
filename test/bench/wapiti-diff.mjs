// Side-by-side diff harness for the Wapiti decoder. Compares the labels
// produced by our JS port (src/grobid/jni/wapiti-*) against the labels
// produced by an upstream wapiti binary compiled from upstream/wapiti/ via
// test/bench/wapiti-build/build.mjs.
//
// Usage: node test/bench/wapiti-diff.mjs
//
// We generate a synthetic feature input that exercises real model patterns,
// then diff line-by-line.

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WapitiModel } from "../../dist/grobid/jni/wapiti-model.js";
import { WapitiWrapper } from "../../dist/grobid/jni/wapiti-wrapper.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const buildDir = path.join(here, "wapiti-build");
const wapitiBin = path.join(buildDir, "wapiti-label");
const modelPath = path.resolve(here, "../../fixtures/models/fulltext/model.wapiti");
const featuresPath = path.join(buildDir, "features.txt");
const upstreamOutPath = path.join(buildDir, "upstream-labels.txt");
const oursOutPath = path.join(buildDir, "ours-labels.txt");

if (!existsSync(wapitiBin)) {
  console.error("wapiti-label binary missing — run: node test/bench/wapiti-build/build.mjs");
  process.exit(1);
}
if (!existsSync(modelPath)) {
  console.error("model missing:", modelPath);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 1. Construct a feature input. We use a few tokens that appear verbatim in
//    the model's observation vocab so the decoder exercises real weights.
//    Each row has 27 whitespace-separated columns.
// ---------------------------------------------------------------------------
function rowOf(tok, prevTok, nextTok, extras = {}) {
  const lower = tok.toLowerCase();
  const p1 = tok.slice(0, 1);
  const p2 = tok.slice(0, 2);
  const p3 = tok.slice(0, 3);
  const p4 = tok.slice(0, 4);
  const s1 = tok.slice(-1);
  const s2 = tok.slice(-2);
  const s3 = tok.slice(-3);
  const s4 = tok.slice(-4);
  const cols = [
    tok,                                  // 0: token
    lower,                                // 1: lower
    p1, p2, p3, p4,                       // 2-5: prefixes
    s1, s2, s3, s4,                       // 6-9: suffixes
    extras.block ?? "BLOCKIN",            // 10
    extras.line ?? "LINEIN",              // 11
    extras.align ?? "ALIGNEDLEFT",        // 12
    extras.font ?? "SAMEFONT",            // 13
    extras.fontSize ?? "SAMEFONTSIZE",    // 14
    extras.bold ?? "0",                   // 15
    extras.italic ?? "0",                 // 16
    extras.caps ?? "INITCAP",             // 17
    extras.digit ?? "NODIGIT",            // 18
    extras.single ?? "0",                 // 19
    extras.punct ?? "NOPUNCT",            // 20
    extras.docPos ?? "5",                 // 21
    extras.pagePos ?? "5",                // 22
    extras.bitmap ?? "0",                 // 23
    extras.callout ?? "UNKNOWN",          // 24
    extras.calloutKnown ?? "0",           // 25
    extras.superscript ?? "0",            // 26
  ];
  return cols.join(" ");
}

const sequences = [];

// Sequence 1: a short paragraph-like sequence with a parenthesised citation
// callout in the middle ("(Smith et al. 2020)") — a strong I-<citation_marker>
// test.
{
  const tokens = [
    "Recent", "work", "in", "this", "area",
    "(", "Smith", "et", "al", ".", "2020", ")",
    "has", "shown", "that", "the", "results",
    "are", "consistent", ".",
  ];
  const rows = tokens.map((t, i) =>
    rowOf(t, tokens[i - 1] ?? null, tokens[i + 1] ?? null, {
      caps: t === t.toUpperCase() ? "ALLCAP" : t[0] === t[0].toUpperCase() ? "INITCAP" : "NOCAPS",
      punct: /^[(),.]$/.test(t) ? t === "(" ? "OPENBRACKET" : t === ")" ? "ENDBRACKET" : t === "." ? "DOT" : t === "," ? "COMMA" : "PUNCT" : "NOPUNCT",
      digit: /\d/.test(t) ? (/^\d+$/.test(t) ? "ALLDIGIT" : "CONTAINDIGIT") : "NODIGIT",
      single: t.length === 1 ? "1" : "0",
      callout: "AUTHOR",
      calloutKnown: t === "Smith" ? "1" : "0",
    }),
  );
  sequences.push(rows);
}

// Sequence 2: numbered citation context "[3]" appears between text — exercises
// the OPENBRACKET / ENDBRACKET features.
{
  const tokens = [
    "Earlier", "studies", "[", "3", "]", "found", "a", "similar", "effect", ".",
  ];
  const rows = tokens.map((t, i) =>
    rowOf(t, tokens[i - 1] ?? null, tokens[i + 1] ?? null, {
      caps: t === t.toUpperCase() ? "ALLCAP" : t[0] === t[0].toUpperCase() ? "INITCAP" : "NOCAPS",
      punct: t === "[" ? "OPENBRACKET" : t === "]" ? "ENDBRACKET" : t === "." ? "DOT" : "NOPUNCT",
      digit: /^\d+$/.test(t) ? "ALLDIGIT" : "NODIGIT",
      single: t.length === 1 ? "1" : "0",
      callout: "NUMBER",
      calloutKnown: t === "3" ? "1" : "0",
    }),
  );
  sequences.push(rows);
}

// Sequence 3: a section heading.
{
  const tokens = [
    "1", ".", "Introduction",
  ];
  const rows = tokens.map((t, i) =>
    rowOf(t, tokens[i - 1] ?? null, tokens[i + 1] ?? null, {
      block: i === 0 ? "BLOCKSTART" : "BLOCKIN",
      line: i === 0 ? "LINESTART" : "LINEIN",
      caps: t === t.toUpperCase() ? "ALLCAP" : "INITCAP",
      bold: "1",
      fontSize: "HIGHERFONT",
      punct: t === "." ? "DOT" : "NOPUNCT",
      digit: /^\d+$/.test(t) ? "ALLDIGIT" : "NODIGIT",
      single: t.length === 1 ? "1" : "0",
    }),
  );
  sequences.push(rows);
}

// Sequence 4-N: a long paragraph stretch (50 tokens) to stress-test bigram
// transitions; mixes plain text with multiple citation callouts and a figure
// reference.
{
  const tokens = [
    "In", "previous", "experiments", ",", "the", "authors", "of",
    "[", "1", ",", "2", "]", "demonstrated", "a", "significant", "result",
    ".", "However", ",", "as", "noted", "by", "Jones", "(", "2018", ")",
    ",", "the", "method", "has", "limitations", ".", "Figure", "3", "shows",
    "the", "comparison", "of", "approaches", "discussed", "in", "Section", "2",
    ".", "Brown", "et", "al", ".", "(", "2019", ")",
  ];
  const rows = tokens.map((t, i) =>
    rowOf(t, tokens[i - 1] ?? null, tokens[i + 1] ?? null, {
      caps: t === t.toUpperCase() ? "ALLCAP" : t[0] === t[0].toUpperCase() ? "INITCAP" : "NOCAPS",
      punct: /^[(),.\[\]]$/.test(t) ? (t === "(" ? "OPENBRACKET" : t === ")" ? "ENDBRACKET" : t === "[" ? "OPENBRACKET" : t === "]" ? "ENDBRACKET" : t === "." ? "DOT" : t === "," ? "COMMA" : "PUNCT") : "NOPUNCT",
      digit: /\d/.test(t) ? (/^\d+$/.test(t) ? "ALLDIGIT" : "CONTAINDIGIT") : "NODIGIT",
      single: t.length === 1 ? "1" : "0",
      callout: /^\d+$/.test(t) ? "NUMBER" : "AUTHOR",
      calloutKnown: ["1", "2", "3", "Jones", "Brown"].includes(t) ? "1" : "0",
    }),
  );
  sequences.push(rows);
}

// Sequence 5: equation context with an inline math reference "Eq. (4)".
{
  const tokens = [
    "Combining", "Eq", ".", "(", "4", ")", "with", "the", "constraint",
    ",", "we", "obtain", "Equation", "5", ":",
  ];
  const rows = tokens.map((t, i) =>
    rowOf(t, tokens[i - 1] ?? null, tokens[i + 1] ?? null, {
      caps: t[0] === t[0].toUpperCase() ? "INITCAP" : "NOCAPS",
      punct: /^[(),.:]$/.test(t) ? (t === "(" ? "OPENBRACKET" : t === ")" ? "ENDBRACKET" : t === "." ? "DOT" : t === "," ? "COMMA" : "PUNCT") : "NOPUNCT",
      digit: /^\d+$/.test(t) ? "ALLDIGIT" : "NODIGIT",
      single: t.length === 1 ? "1" : "0",
    }),
  );
  sequences.push(rows);
}

// Sequence 6.5: a sequence with non-ASCII tokens (German + math symbols) —
// would expose the JS Unicode toLowerCase vs C ASCII tolower divergence if
// the model used %X / %T / %M caps patterns. The fulltext model only uses %x
// so this should still match, but it's a worthwhile stress.
{
  const tokens = [
    "Schäfer", "et", "al", ".", "studied", "the", "Ω-function",
    "in", "ÄRGER", "and", "found", "α", "≥", "0.5", ".",
  ];
  const rows = tokens.map((t, i) =>
    rowOf(t, tokens[i - 1] ?? null, tokens[i + 1] ?? null, {
      caps: t === t.toUpperCase() ? "ALLCAP" : t[0] === t[0].toUpperCase() ? "INITCAP" : "NOCAPS",
      punct: /^[.]$/.test(t) ? "DOT" : "NOPUNCT",
      digit: /\d/.test(t) ? (/^[\d.]+$/.test(t) ? "ALLDIGIT" : "CONTAINDIGIT") : "NODIGIT",
      single: t.length === 1 ? "1" : "0",
    }),
  );
  sequences.push(rows);
}

// Sequence 6: a Table-marker context "(Table 1)".
{
  const tokens = [
    "Results", "are", "summarised", "in", "Table", "1", ".", "All", "values",
    "are", "averages", "over", "five", "trials", ".",
  ];
  const rows = tokens.map((t, i) =>
    rowOf(t, tokens[i - 1] ?? null, tokens[i + 1] ?? null, {
      caps: t[0] === t[0].toUpperCase() ? "INITCAP" : "NOCAPS",
      punct: /^[.]$/.test(t) ? "DOT" : "NOPUNCT",
      digit: /^\d+$/.test(t) ? "ALLDIGIT" : "NODIGIT",
      single: t.length === 1 ? "1" : "0",
    }),
  );
  sequences.push(rows);
}

// Join into a single input file (sequences separated by blank lines).
const featuresText = sequences.map((rows) => rows.join("\n")).join("\n\n") + "\n";
writeFileSync(featuresPath, featuresText);

// ---------------------------------------------------------------------------
// 2. Run upstream wapiti.
// ---------------------------------------------------------------------------
const r = spawnSync(wapitiBin, ["label", "-m", modelPath], {
  input: featuresText,
  encoding: "utf8",
});
if (r.status !== 0) {
  console.error("upstream wapiti failed:", r.status, r.stderr);
  process.exit(2);
}
writeFileSync(upstreamOutPath, r.stdout);

// ---------------------------------------------------------------------------
// 3. Run our JS port.
// ---------------------------------------------------------------------------
const model = new WapitiModel(modelPath);
const oursOut = WapitiWrapper.label(model.getTagger(), featuresText);
writeFileSync(oursOutPath, oursOut);

// ---------------------------------------------------------------------------
// 4. Diff line by line. The wapiti output format is `<input row>\t<label>\n`
//    so we just compare the last column.
// ---------------------------------------------------------------------------
function labels(text) {
  return text.split("\n").map((l) => {
    if (l === "") return null; // sequence separator
    const ix = l.lastIndexOf("\t");
    return ix === -1 ? "" : l.slice(ix + 1);
  });
}
function tokensOf(text) {
  return text.split("\n").map((l) => {
    if (l === "") return null;
    const space = l.indexOf(" ");
    return space === -1 ? l : l.slice(0, space);
  });
}

const upLines = r.stdout.split("\n");
const ourLines = oursOut.split("\n");
const upToks = tokensOf(r.stdout);
const upLbls = labels(r.stdout);
const ourLbls = labels(oursOut);

const N = Math.min(upLbls.length, ourLbls.length);
let diff = 0;
const diffs = [];
for (let i = 0; i < N; i++) {
  if (upLbls[i] !== ourLbls[i]) {
    diff++;
    if (diffs.length < 20) {
      diffs.push({
        i,
        tok: upToks[i],
        up: upLbls[i],
        ours: ourLbls[i],
      });
    }
  }
}
const total = N - upLbls.filter((l) => l === null).length;
console.log(`tokens diffed: ${total}`);
console.log(`mismatches:    ${diff}`);
console.log(`length diff:   upstream=${upLines.length}, ours=${ourLines.length}`);
if (diffs.length > 0) {
  console.log("first divergences:");
  for (const d of diffs) {
    console.log(`  line ${d.i}: token=${JSON.stringify(d.tok)}  upstream=${d.up}  ours=${d.ours}`);
  }
} else {
  console.log("no divergences");
}
