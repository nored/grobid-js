// Captures the actual feature input that the fulltext CRF receives when
// running the real pipeline on fixtures/sample-arxiv.pdf, then writes it to
// test/bench/wapiti-build/features-real.txt so wapiti-diff-real.mjs can run
// upstream wapiti and the JS port on identical input.

import { writeFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "wapiti-build");

// Monkey-patch WapitiModel.label to capture feature inputs *before* the
// upstream JS port processes them. The original label call still runs, so the
// pipeline keeps going.
const { WapitiModel } = await import("../../dist/grobid/jni/wapiti-model.js");
const originalLabel = WapitiModel.prototype.label;
const capture = new Map(); // modelFile -> [features]
WapitiModel.prototype.label = function (data) {
  const key = this.modelFile ?? "(unknown)";
  if (!capture.has(key)) capture.set(key, []);
  capture.get(key).push(data);
  return originalLabel.call(this, data);
};

// Run the pipeline.
const modelsDir = path.resolve(here, "../../fixtures/models");
const pdfPath = path.resolve(here, "../../fixtures/sample-arxiv.pdf");
const lexiconDir = path.resolve(here, "../../fixtures/lexicon");

if (!existsSync(pdfPath)) {
  console.error("PDF missing:", pdfPath);
  process.exit(1);
}

const { Grobid } = await import("../../dist/node/grobid.js");
const g = new Grobid({ modelsDir, lexiconDir });
try {
  await g.processPdf(pdfPath);
} catch (e) {
  console.error("pipeline failed (we may have still captured features):", e.message);
}

// Dump each model's captured features as a separate file.
for (const [key, datas] of capture) {
  const base = path.basename(path.dirname(key));
  for (let i = 0; i < datas.length; i++) {
    const filename = `features-${base}-${i}.txt`;
    const filePath = path.join(outDir, filename);
    writeFileSync(filePath, datas[i]);
    console.log(`wrote ${filePath} (${datas[i].length} bytes, ${datas[i].split("\n").length} lines)`);
  }
}
