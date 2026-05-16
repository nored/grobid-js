// Segmentation feature-row diff harness.
//
// 1. Runs our pipeline on a given PDF, capturing the segmentation feature
//    rows that get fed to the segmentation wapiti CRF, and the labels our
//    port emits.
// 2. Runs the upstream wapiti CLI on the SAME captured features (using the
//    same segmentation model), to see what upstream would label.
// 3. Diffs labels line by line and prints divergences, with the full feature
//    row text for each divergent row.
//
// Usage: node test/bench/segmentation-debug.mjs <pdf-path>

import { spawnSync } from "node:child_process";
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const buildDir = path.join(here, "wapiti-build");
const wapitiBin = path.join(buildDir, "wapiti-label");
const repoRoot = path.resolve(here, "../..");
const modelsDir = path.join(repoRoot, "fixtures/models");
const lexiconDir = path.join(repoRoot, "fixtures/lexicon");
const segModelPath = path.join(modelsDir, "segmentation/model.wapiti");

const pdfPath = process.argv[2];
if (!pdfPath) {
  console.error("Usage: node segmentation-debug.mjs <pdf-path>");
  process.exit(1);
}
const absPdf = path.resolve(pdfPath);
if (!existsSync(absPdf)) {
  console.error("PDF missing:", absPdf);
  process.exit(1);
}

// Monkey-patch WapitiModel.label to capture the segmentation features +
// the labels our port emits, then forward.
const { WapitiModel } = await import(path.join(repoRoot, "dist/grobid/jni/wapiti-model.js"));
const originalLabel = WapitiModel.prototype.label;
let segFeatures = null;
let segOurLabels = null;
WapitiModel.prototype.label = function (data) {
  const out = originalLabel.call(this, data);
  if ((this.modelFile ?? "").includes("/segmentation/") && segFeatures === null) {
    segFeatures = data;
    segOurLabels = out;
  }
  return out;
};

const { Grobid } = await import(path.join(repoRoot, "dist/node/grobid.js"));
const g = new Grobid({ modelsDir, lexiconDir });
let processed;
try {
  processed = await g.processPdf(absPdf);
} catch (e) {
  console.error("pipeline failed (we may still have captured):", e.message);
}

if (!segFeatures) {
  console.error("Segmentation features not captured (model did not run).");
  process.exit(2);
}

const segFile = path.join(buildDir, "seg-features.txt");
const segOursFile = path.join(buildDir, "seg-ours-labels.txt");
writeFileSync(segFile, segFeatures);
writeFileSync(segOursFile, segOurLabels);

// Run upstream wapiti on the same features.
const r = spawnSync(wapitiBin, ["label", "-m", segModelPath], {
  input: segFeatures, encoding: "utf8", maxBuffer: 200 * 1024 * 1024,
});
if (r.status !== 0) {
  console.error("upstream wapiti failed:", r.status, r.stderr);
  process.exit(3);
}
const segUpFile = path.join(buildDir, "seg-up-labels.txt");
writeFileSync(segUpFile, r.stdout);

// Diff labels row by row.
function parse(text) {
  const out = [];
  for (const line of text.split("\n")) {
    if (line === "") { out.push(null); continue; }
    const ix = line.lastIndexOf("\t");
    const lbl = ix === -1 ? "" : line.slice(ix + 1);
    out.push({ raw: line, lbl });
  }
  return out;
}
const upL = parse(r.stdout);
const ourL = parse(segOurLabels);
const featRows = segFeatures.split("\n");

const N = Math.min(upL.length, ourL.length);
let total = 0, diff = 0;
const diffs = [];
for (let i = 0; i < N; i++) {
  const a = upL[i], b = ourL[i];
  if (a === null || b === null) continue;
  total++;
  if (a.lbl !== b.lbl) {
    diff++;
    diffs.push({ i, up: a.lbl, ours: b.lbl, feat: featRows[i] });
  }
}
console.log(`pdf: ${absPdf}`);
console.log(`rows: ${total}; mismatches: ${diff} (${(diff/total*100).toFixed(2)}%)`);
for (const d of diffs.slice(0, 50)) {
  console.log(`row ${d.i}: upstream=${d.up}  ours=${d.ours}`);
  console.log(`  feat: ${d.feat}`);
}

// Also write a "side by side" file that shows the line text, our label and
// upstream's label for every row — useful for finding cover/header runs.
const sxsRows = [];
for (let i = 0; i < N; i++) {
  const tok = (featRows[i] ?? "").split(" ")[0] ?? "";
  const our = ourL[i]?.lbl ?? "";
  const up = upL[i]?.lbl ?? "";
  sxsRows.push(`${i}\t${tok}\t${our}\t${up}`);
}
writeFileSync(path.join(buildDir, "seg-sxs.txt"), sxsRows.join("\n") + "\n");
console.log(`\nwrote ${path.join(buildDir, "seg-sxs.txt")}`);

// Print title from our port too.
try {
  const title = processed?.getMetadata()?.getBiblio()?.getTitle?.() ?? processed?.title ?? "(unknown)";
  console.log("our pipeline title:", JSON.stringify(title));
} catch (e) { /* ignore */ }
