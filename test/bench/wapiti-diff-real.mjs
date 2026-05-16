// Real diff harness. Loads a captured features file (from wapiti-capture.mjs),
// runs both the upstream wapiti binary and our JS port on it, then diffs.

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const buildDir = path.join(here, "wapiti-build");
const wapitiBin = path.join(buildDir, "wapiti-label");

const args = process.argv.slice(2);
if (args.length < 1) {
  console.error("Usage: node wapiti-diff-real.mjs <features-file>");
  console.error("Example: node wapiti-diff-real.mjs features-fulltext-1.txt");
  process.exit(1);
}
const featuresFile = path.join(buildDir, args[0]);
if (!existsSync(featuresFile)) {
  console.error("features file missing:", featuresFile);
  process.exit(1);
}

// Determine model from features file name. "features-<name>-N.txt" → name maps
// to a fixtures/models/<name>/model.wapiti path. fulltext, citation, etc.
const m = path.basename(featuresFile).match(/^features-(.+)-\d+\.txt$/);
if (!m) {
  console.error("cannot infer model from filename:", featuresFile);
  process.exit(1);
}
const modelName = m[1];
const modelPath = path.resolve(here, `../../fixtures/models/${modelName}/model.wapiti`);
if (!existsSync(modelPath)) {
  console.error("model file missing:", modelPath);
  process.exit(1);
}
console.log(`features: ${featuresFile}`);
console.log(`model:    ${modelPath}`);

const featuresText = readFileSync(featuresFile, "utf8");
console.log(`input:    ${featuresText.length} bytes, ${featuresText.split("\n").length} lines`);

// ---- upstream ----
const r = spawnSync(wapitiBin, ["label", "-m", modelPath], {
  input: featuresText, encoding: "utf8", maxBuffer: 200 * 1024 * 1024,
});
if (r.status !== 0) {
  console.error("upstream wapiti failed:", r.status);
  console.error(r.stderr);
  process.exit(2);
}
const upstreamOut = r.stdout;
writeFileSync(path.join(buildDir, "upstream-labels.txt"), upstreamOut);

// ---- ours ----
const { WapitiModel } = await import("../../dist/grobid/jni/wapiti-model.js");
const { WapitiWrapper } = await import("../../dist/grobid/jni/wapiti-wrapper.js");
const model = new WapitiModel(modelPath);
const oursOut = WapitiWrapper.label(model.getTagger(), featuresText);
writeFileSync(path.join(buildDir, "ours-labels.txt"), oursOut);

// ---- diff ----
function parseLabels(text) {
  const out = [];
  for (const line of text.split("\n")) {
    if (line === "") { out.push(null); continue; }
    const ix = line.lastIndexOf("\t");
    if (ix === -1) { out.push({ tok: line.split(" ")[0], lbl: "" }); continue; }
    const lbl = line.slice(ix + 1);
    const tok = line.split(" ")[0] ?? "";
    out.push({ tok, lbl });
  }
  return out;
}

const upL = parseLabels(upstreamOut);
const ourL = parseLabels(oursOut);

if (upL.length !== ourL.length) {
  console.log(`!! row count differs: upstream=${upL.length} ours=${ourL.length}`);
}

let total = 0, diff = 0;
const diffs = [];
const N = Math.min(upL.length, ourL.length);
for (let i = 0; i < N; i++) {
  const a = upL[i], b = ourL[i];
  if (a === null || b === null) continue;
  total++;
  if (a.lbl !== b.lbl) {
    diff++;
    if (diffs.length < 30) diffs.push({ i, tok: a.tok, up: a.lbl, ours: b.lbl });
  }
}
console.log(`tokens compared: ${total}`);
console.log(`mismatches:      ${diff} (${(diff/total*100).toFixed(2)}%)`);
if (diffs.length > 0) {
  console.log("first divergences:");
  for (const d of diffs) console.log(`  row ${d.i}: token=${JSON.stringify(d.tok)}  upstream=${d.up}  ours=${d.ours}`);
}
