// Targeted probe: run the cleanup-enabled Grobid on the affected papers and
// log the page1-cleanup output + extracted title for manual inspection.
// Marked describe.skipIf when fixtures are missing.

import { describe, it } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Grobid } from "../../src/node/grobid.js";
import { setLogLevel } from "../../src/grobid/utilities/logger.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const modelsDir = path.resolve(here, "../../fixtures/models");
const lexiconDir = path.resolve(here, "../../fixtures/lexicon");
const pdfaltoBin = path.resolve(here, "../../fixtures/pdfalto/pdfalto/mac/arm64/pdfalto");

const haveAll = existsSync(modelsDir) && existsSync(pdfaltoBin);
const skipIf = haveAll ? describe : describe.skip;

const PAPERS = [
  "fixtures/blind-corpus/paper_184.pdf",
  "fixtures/blind-corpus/paper_467.pdf",
  "fixtures/blind-corpus/paper_585.pdf",
  "fixtures/blind-corpus/paper_608.pdf",
  "fixtures/blind-corpus/paper_340.pdf",
  "fixtures/blind-corpus/paper_429.pdf",
  "fixtures/external-corpus/paper_059.pdf",
  "fixtures/external-corpus/paper_102.pdf",
];

skipIf("page1-cleanup probe: log cleanup decisions on known-affected papers", () => {
  it("processes each paper and prints cleanup output + extracted title", async () => {
    setLogLevel("info");
    const g = new Grobid({
      modelsDir,
      lexiconDir,
      pdfaltoOptions: { binaryPath: pdfaltoBin },
      fallbackMetadata: false,
      page1Cleanup: true,
    });
    const root = path.resolve(here, "../..");
    for (const rel of PAPERS) {
      const p = path.resolve(root, rel);
      if (!existsSync(p)) {
        // eslint-disable-next-line no-console
        console.log(`SKIP (missing): ${rel}`);
        continue;
      }
      try {
        const tei = await g.processPdf(p);
        const m = /<title[^>]*type="main"[^>]*>([\s\S]*?)<\/title>/.exec(tei);
        const title = (m?.[1] ?? "")
          .replace(/<[^>]+>/g, "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 140);
        // eslint-disable-next-line no-console
        console.log(`OK   ${rel}: title="${title}"`);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.log(`FAIL ${rel}: ${(e as Error).message}`);
      }
    }
  }, 900_000);
});
