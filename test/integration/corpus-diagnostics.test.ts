// Diagnostic harness that runs the full Grobid pipeline against every PDF
// in fixtures/corpus/ and reports per-paper stats. Intentionally lenient —
// it's a measurement tool, not a pass/fail gate. Use the printed stats to
// drive targeted improvements; once a quality bar is established add real
// assertions to lock in the gains.

import { describe, it } from "vitest";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Grobid } from "../../src/node/grobid.js";
import { assembleTEI } from "../../src/core/tei/assemble.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const modelsDir = path.resolve(here, "../../fixtures/models");
const lexiconDir = path.resolve(here, "../../fixtures/lexicon");
const corpusDir = path.resolve(here, "../../fixtures/corpus");
// Prefer the pdfalto backend when a binary is available locally; fall back
// to pdfjs-dist so the test still runs on a fresh checkout without setup.
const localPdfalto = path.resolve(here, "../../fixtures/pdfalto/pdfalto/mac/arm64/pdfalto");
const envPdfalto = process.env["GROBID_PDFALTO_BIN"];
const pdfaltoBinary = envPdfalto && existsSync(envPdfalto)
  ? envPdfalto
  : existsSync(localPdfalto)
    ? localPdfalto
    : null;

const required = ["segmentation.wapiti", "header.wapiti", "fulltext.wapiti", "reference-segmenter.wapiti", "citation.wapiti"];
const haveModels = required.every((f) => existsSync(path.join(modelsDir, f)));
const haveCorpus = existsSync(corpusDir) && readdirSync(corpusDir).some((f) => f.endsWith(".pdf"));
const skipIfMissing = haveModels && haveCorpus ? describe : describe.skip;

skipIfMissing("Corpus diagnostics", () => {
  it("runs the full pipeline on every fixtures/corpus/*.pdf and reports stats", async () => {
    const g = new Grobid({
      modelsDir,
      lexiconDir,
      pdfBackend: pdfaltoBinary ? "pdfalto" : "pdfjs",
      pdfaltoOptions: pdfaltoBinary ? { binaryPath: pdfaltoBinary } : {},
    });
    // eslint-disable-next-line no-console
    console.log(`backend: ${pdfaltoBinary ? "pdfalto" : "pdfjs"}`);
    await g.loadModels();
    await g.loadLexicon();
    const pdfs = readdirSync(corpusDir).filter((f) => f.endsWith(".pdf")).sort();
    for (const name of pdfs) {
      const pdfPath = path.join(corpusDir, name);
      const t0 = Date.now();
      let parsed;
      try {
        parsed = await g.processPdf(pdfPath);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.log(`\n=== ${name} === FAILED: ${(err as Error).message}`);
        continue;
      }
      const elapsed = Date.now() - t0;

      const totalParas = parsed.body.sections.reduce((n, s) => n + s.paragraphs.length, 0);
      const markers = parsed.body.sections.flatMap((s) => s.paragraphs.flatMap((p) => p.citations));
      const resolved = markers.filter((m) => m.target).length;
      const refsWith = (k: keyof typeof parsed.references[number]) =>
        parsed.references.filter((r) => r[k]).length;
      const typedSections = new Set(parsed.body.sections.map((s) => s.type));

      // Write a TEI artifact next to the source so it can be inspected.
      const tei = assembleTEI(parsed);
      const teiPath = path.join(corpusDir, name.replace(/\.pdf$/i, ".tei.xml"));
      writeFileSync(teiPath, tei, "utf8");

      // eslint-disable-next-line no-console
      console.log(`
=== ${name}  (${elapsed} ms, TEI ${tei.length} bytes) ===
title:    ${truncate(parsed.header.title, 90)}
authors:  ${parsed.header.authors.length} parsed; names: ${parsed.header.authors.slice(0, 4).map((a) => truncate(a.name, 30)).join(" | ")}
abstract: ${parsed.header.abstract ? truncate(parsed.header.abstract, 120) : "[none]"}
sections: ${parsed.body.sections.length} (types: ${[...typedSections].join(", ")})
paragraphs: ${totalParas}
markers:  ${markers.length} total, ${resolved} resolved (${pct(resolved, markers.length)})
refs:     ${parsed.references.length} total, ${refsWith("authors")} w/author, ${refsWith("title")} w/title, ${refsWith("date")} w/date, ${refsWith("journal")} w/journal, ${refsWith("doi")} w/DOI
sample ref[0]: ${parsed.references[0] ? `authors=${truncate(parsed.references[0].authors, 60)} | title=${truncate(parsed.references[0].title, 60)} | date=${parsed.references[0].date}` : "[none]"}`);
    }
  }, 600_000);
});

function truncate(s: string | undefined, n: number): string {
  if (!s) return "[none]";
  const trimmed = s.trim().replace(/\s+/g, " ");
  return trimmed.length <= n ? trimmed : trimmed.slice(0, n - 1) + "…";
}
function pct(num: number, total: number): string {
  if (total === 0) return "n/a";
  return `${Math.round((num / total) * 100)}%`;
}
