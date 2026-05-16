import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPdfFromPath } from "../../src/node/load-pdf.js";
import { extractSegmentationFeatures } from "../../src/core/features/segmentation.js";
import { extractReferenceSegmenterFeatures } from "../../src/core/features/reference-segmenter.js";
import { extractCitationFeatures } from "../../src/core/features/citation.js";
import { loadWapitiModel } from "../../src/core/crf/wapiti-model.js";
import { decode } from "../../src/core/crf/wapiti-decoder.js";
import type { LayoutLine, LayoutToken } from "../../src/core/types/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const segPath = path.resolve(here, "../../fixtures/models/segmentation.wapiti");
const refSegPath = path.resolve(here, "../../fixtures/models/reference-segmenter.wapiti");
const citPath = path.resolve(here, "../../fixtures/models/citation.wapiti");
const pdfPath = path.resolve(here, "../../fixtures/sample-arxiv.pdf");

const have = [segPath, refSegPath, citPath, pdfPath].every(existsSync);
const skipIfMissing = have ? describe : describe.skip;

skipIfMissing("End-to-end: real PDF → segmentation → ref-segmenter → citation parser", () => {
  it("parses individual references into author/title/year/journal fields", async () => {
    const segModel = loadWapitiModel(readFileSync(segPath));
    const refSegModel = loadWapitiModel(readFileSync(refSegPath));
    const citModel = loadWapitiModel(readFileSync(citPath));
    expect(citModel.patterns.length).toBe(81);

    const doc = await loadPdfFromPath(pdfPath);
    const seg = extractSegmentationFeatures(doc);
    const segLabels = decode(segModel, seg.rows).labels;

    const refLines: LayoutLine[] = [];
    for (let i = 0; i < segLabels.length; i++) {
      if (segLabels[i]!.replace(/^I-/, "") === "<references>") {
        refLines.push(seg.lines[i]!);
      }
    }
    const refSeg = extractReferenceSegmenterFeatures(refLines);
    const refLabels = decode(refSegModel, refSeg.rows).labels;

    // Split refSeg tokens into citation spans on each I-<reference>.
    const citations: LayoutToken[][] = [];
    let cur: LayoutToken[] | null = null;
    for (let i = 0; i < refLabels.length; i++) {
      const lbl = refLabels[i]!;
      const isStart = lbl === "I-<reference>";
      const isRefBody = lbl === "I-<reference>" || lbl === "<reference>";
      if (isStart) {
        if (cur && cur.length > 0) citations.push(cur);
        cur = [refSeg.tokens[i]!];
      } else if (isRefBody && cur) {
        cur.push(refSeg.tokens[i]!);
      }
      // <label> and <other> tokens are skipped from the citation body.
    }
    if (cur && cur.length > 0) citations.push(cur);

    expect(citations.length).toBeGreaterThanOrEqual(20);

    // Parse each citation and aggregate quality signals.
    let citationsWithAuthor = 0;
    let citationsWithTitle = 0;
    let citationsWithDate = 0;
    const samples: Array<{ author?: string; title?: string; date?: string }> = [];
    for (const cit of citations) {
      const { rows, tokens } = extractCitationFeatures(cit);
      for (const r of rows) expect(r.length).toBe(29);
      const out = decode(citModel, rows);
      const fields = collectFieldSpans(out.labels, tokens);
      if (fields["<author>"]) citationsWithAuthor += 1;
      if (fields["<title>"]) citationsWithTitle += 1;
      if (fields["<date>"]) citationsWithDate += 1;
      if (samples.length < 3) samples.push({
        ...(fields["<author>"] ? { author: fields["<author>"] } : {}),
        ...(fields["<title>"] ? { title: fields["<title>"] } : {}),
        ...(fields["<date>"] ? { date: fields["<date>"] } : {}),
      });
    }

    // eslint-disable-next-line no-console
    console.log("citation parse stats: total=%d, withAuthor=%d, withTitle=%d, withDate=%d",
      citations.length, citationsWithAuthor, citationsWithTitle, citationsWithDate);
    // eslint-disable-next-line no-console
    console.log("samples:", samples);

    // Without lexicon support, most references should still produce author
    // and title spans on cue from caps/punct/year. We require at least half.
    expect(citationsWithAuthor / citations.length).toBeGreaterThanOrEqual(0.5);
    expect(citationsWithTitle / citations.length).toBeGreaterThanOrEqual(0.5);
    expect(citationsWithDate / citations.length).toBeGreaterThanOrEqual(0.4);
  }, 300_000);
});

/**
 * Collect the surface text of the first contiguous span for each label
 * value. The CRF emits labels like "<author>" / "I-<author>" — we strip
 * the BIO prefix when grouping and join token texts with spaces.
 */
function collectFieldSpans(
  labels: readonly string[],
  tokens: readonly LayoutToken[],
): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  while (i < labels.length) {
    const base = labels[i]!.replace(/^I-/, "");
    let j = i + 1;
    while (j < labels.length && labels[j]!.replace(/^I-/, "") === base && !labels[j]!.startsWith("I-")) j += 1;
    if (!(base in out)) {
      const text = tokens.slice(i, j).map((t) => t.text).join(" ");
      out[base] = text;
    }
    i = j;
  }
  return out;
}
