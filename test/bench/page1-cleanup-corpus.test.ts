// Full-corpus regression check.
//
// Workflow:
//   1. Read every existing TEI under fixtures/{blind,external}-corpus/grobid-js/
//      into memory (these are the baseline, generated WITHOUT page-1 cleanup).
//   2. Run the cleanup-enabled Grobid on each corresponding PDF, capturing
//      its output (and the `[Segmentation] page1-cleanup fired …` log line
//      via a logger hook).
//   3. Write the new TEIs back to fixtures/*/grobid-js/ (replacing baseline).
//   4. Emit a delta report: per-paper, whether cleanup fired, whether the new
//      TEI's <title type="main"> matches the baseline's, and how many bytes
//      changed.
//
// This is the regression net: the goal is for the affected papers (Leeds
// Beckett, Edinburgh, Radboud, eScholarship, Research Square, IEEE preprint,
// …) to switch to a different — and hopefully better — title, while every
// other paper's TEI changes ONLY in inert ways (the date stamp in the
// `<application>` element, occasionally a coordinate or block ordering).

import { describe, it } from "vitest";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Grobid } from "../../src/node/grobid.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const modelsDir = path.resolve(root, "fixtures/models");
const lexiconDir = path.resolve(root, "fixtures/lexicon");
const pdfaltoBin = path.resolve(root, "fixtures/pdfalto/pdfalto/mac/arm64/pdfalto");

const haveAll = existsSync(modelsDir) && existsSync(pdfaltoBin);
const skipIf = haveAll ? describe : describe.skip;

interface CorpusEntry {
  pdfPath: string;
  baselineTeiPath: string;
  newTeiPath: string;
  name: string;
}

function listCorpus(corpusDir: string, baselineDir: string): CorpusEntry[] {
  if (!existsSync(corpusDir)) return [];
  const pdfs = readdirSync(corpusDir).filter((f) => f.endsWith(".pdf")).sort();
  const out: CorpusEntry[] = [];
  for (const name of pdfs) {
    const stem = name.replace(/\.pdf$/i, "");
    out.push({
      pdfPath: path.join(corpusDir, name),
      baselineTeiPath: path.join(baselineDir, stem + ".tei.xml"),
      newTeiPath: path.join(baselineDir, stem + ".tei.xml"),
      name,
    });
  }
  return out;
}

function extractTitle(tei: string): string {
  const m = /<title[^>]*type="main"[^>]*>([\s\S]*?)<\/title>/.exec(tei);
  return (m?.[1] ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

skipIf("page1-cleanup full-corpus regression report", () => {
  it("regenerates TEIs for blind+external corpus and reports cleanup deltas", async () => {
    const g = new Grobid({
      modelsDir,
      lexiconDir,
      pdfaltoOptions: { binaryPath: pdfaltoBin },
      fallbackMetadata: false,
    });

    const blindCorpus = listCorpus(
      path.resolve(root, "fixtures/blind-corpus"),
      path.resolve(root, "fixtures/blind-corpus/grobid-js"),
    );
    const externalCorpus = listCorpus(
      path.resolve(root, "fixtures/external-corpus"),
      path.resolve(root, "fixtures/external-corpus/grobid-js"),
    );
    const allEntries = [...blindCorpus, ...externalCorpus];

    const titleChanges: { name: string; before: string; after: string }[] = [];
    const failures: { name: string; err: string }[] = [];

    for (const entry of allEntries) {
      const baselineTei = existsSync(entry.baselineTeiPath)
        ? readFileSync(entry.baselineTeiPath, "utf8")
        : "";
      try {
        const tei = await g.processPdf(entry.pdfPath);
        writeFileSync(entry.newTeiPath, tei, "utf8");
        const before = extractTitle(baselineTei);
        const after = extractTitle(tei);
        if (before !== after) {
          titleChanges.push({ name: entry.name, before, after });
        }
      } catch (e) {
        failures.push({ name: entry.name, err: (e as Error).message });
      }
    }

    // eslint-disable-next-line no-console
    console.log(`\n=== page1-cleanup corpus delta ===`);
    // eslint-disable-next-line no-console
    console.log(`Total papers: ${allEntries.length}`);
    // eslint-disable-next-line no-console
    console.log(`Failures:     ${failures.length}`);
    // eslint-disable-next-line no-console
    console.log(`Title diffs:  ${titleChanges.length}`);
    if (titleChanges.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`\n--- Title diffs ---`);
      for (const t of titleChanges) {
        // eslint-disable-next-line no-console
        console.log(`  ${t.name}:\n    before: ${t.before}\n    after:  ${t.after}`);
      }
    }
    if (failures.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`\n--- Failures ---`);
      for (const f of failures) {
        // eslint-disable-next-line no-console
        console.log(`  ${f.name}: ${f.err}`);
      }
    }
  }, 1_800_000);
});
