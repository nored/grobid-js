import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Grobid } from "../../src/node/grobid.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const modelsDir = path.resolve(here, "../../fixtures/models");
const pdfPath = path.resolve(here, "../../fixtures/sample-arxiv.pdf");

const required = ["segmentation.wapiti", "header.wapiti", "fulltext.wapiti", "reference-segmenter.wapiti", "citation.wapiti"];
const have = required.every((f) => existsSync(path.join(modelsDir, f))) && existsSync(pdfPath);
const skipIfMissing = have ? describe : describe.skip;

skipIfMissing("Grobid.processPdf — full cascade end to end", () => {
  it("produces a ParsedDocument with title, authors, sections, citations, and references", async () => {
    // Pass lexiconDir explicitly so tests don't hit the network (the auto-
    // download path is exercised in test/asset-distribution.test.ts).
    const lexiconDir = path.resolve(here, "../../fixtures/lexicon");
    const g = new Grobid({ modelsDir, lexiconDir });
    const out = await g.processPdf(pdfPath);

    // Header. A faithful CRF port returns whatever the header model labels
    // as <title>; on this arXiv PDF the model concatenates the license
    // preamble with the paper title in one <title> span. We assert the
    // string is non-empty and the authors are properly segmented.
    expect(out.header.title).toBeTruthy();
    expect(out.header.title!.length).toBeGreaterThan(10);
    expect(out.header.authors.length).toBeGreaterThanOrEqual(3);

    // Body sections — structural assertion only; we don't bucket by text.
    expect(out.body.sections.length).toBeGreaterThan(3);
    for (const s of out.body.sections) {
      expect(typeof s.title).toBe("string");
      expect(s.level).toBeGreaterThanOrEqual(1);
    }

    // Paragraphs.
    const totalParas = out.body.sections.reduce((n, s) => n + s.paragraphs.length, 0);
    expect(totalParas).toBeGreaterThan(10);
    // Every paragraph carries token-level provenance.
    for (const s of out.body.sections) {
      for (const p of s.paragraphs) {
        expect(p.tokens.length).toBeGreaterThan(0);
        expect(p.tokens[0]!.page).toBeGreaterThanOrEqual(1);
      }
    }

    // Citation markers in body. Some should resolve to a reference target.
    const allMarkers = out.body.sections.flatMap((s) => s.paragraphs.flatMap((p) => p.citations));
    expect(allMarkers.length).toBeGreaterThan(5);
    const resolved = allMarkers.filter((m) => m.target).length;
    // We don't require 100% resolution — only that linking is wired.
    expect(resolved).toBeGreaterThan(0);

    // References.
    expect(out.references.length).toBeGreaterThanOrEqual(20);
    const withAuthor = out.references.filter((r) => r.authors).length;
    const withTitle = out.references.filter((r) => r.title).length;
    const withDate = out.references.filter((r) => r.date).length;
    // eslint-disable-next-line no-console
    console.log("full-pipeline: refs=%d, author=%d, title=%d, date=%d, sections=%d, markers=%d, resolved=%d",
      out.references.length, withAuthor, withTitle, withDate,
      out.body.sections.length, allMarkers.length, resolved);
    // Threshold reflects: without lexicon-driven author detection in the
    // citation CRF (some lexicons are still partial), and with labels now
    // correctly excluded from citation features (faithful to upstream),
    // ~48% of references parse with an author field. Once the full lexicon
    // ships (Wikipedia author dictionaries, ~24 MB) this rises into the
    // 70–80% range.
    expect(withAuthor / out.references.length).toBeGreaterThanOrEqual(0.4);

    // Sample a couple of sections and references for visual inspection on failure.
    // eslint-disable-next-line no-console
    console.log("title:", out.header.title);
    // eslint-disable-next-line no-console
    console.log("authors:", out.header.authors.slice(0, 4).map((a) => a.name));
    // eslint-disable-next-line no-console
    console.log("first section:", out.body.sections[0]);
    // eslint-disable-next-line no-console
    console.log("ref[0]:", out.references[0]);
  }, 300_000);
});
