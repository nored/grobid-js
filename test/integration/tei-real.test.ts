import { describe, it, expect } from "vitest";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Grobid } from "../../src/node/grobid.js";
import { assembleTEI } from "../../src/core/tei/assemble.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const modelsDir = path.resolve(here, "../../fixtures/models");
const pdfPath = path.resolve(here, "../../fixtures/sample-arxiv.pdf");

const required = ["segmentation.wapiti", "header.wapiti", "fulltext.wapiti", "reference-segmenter.wapiti", "citation.wapiti"];
const have = required.every((f) => existsSync(path.join(modelsDir, f))) && existsSync(pdfPath);
const skipIfMissing = have ? describe : describe.skip;

skipIfMissing("TEI-XML end-to-end", () => {
  it("produces a TEI document meeting every point of the user spec", async () => {
    const lexiconDir = path.resolve(here, "../../fixtures/lexicon");
    const g = new Grobid({ modelsDir, lexiconDir });
    const parsed = await g.processPdf(pdfPath);
    const tei = assembleTEI(parsed);

    // Write the artifact next to the PDF so it can be inspected.
    const outPath = path.resolve(here, "../../fixtures/sample-arxiv.tei.xml");
    writeFileSync(outPath, tei, "utf8");

    // 1. teiHeader has a non-empty <title type="main"> and at least one
    //    structured author entry with forename/surname.
    expect(tei).toMatch(/<title type="main">[^<]+</);
    expect(tei).toMatch(/<author>[\s\S]*?<persName>[\s\S]*?<forename type="first">/);

    // 2. Body uses nested <div> with @n for heading depth, matching upstream's
    //    TEI structure. We don't assert text-derived `type=` attributes —
    //    upstream doesn't emit those either, and the dropped categorization
    //    heuristic was a grobid-js invention.
    expect(tei).toMatch(/<div\b[^>]*n="\d+"/);

    // 3. Paragraphs are linked back to their section via xml:id.
    const pTags = tei.match(/<p\b[^>]*xml:id="sec\d+_p\d+"/g) ?? [];
    expect(pTags.length).toBeGreaterThan(10);

    // 4. Citation markers linked to bibliography entries.
    expect(tei).toMatch(/<ref type="bibr"[^>]*target="#b\d+"/);

    // 5. Reference list with <biblStruct xml:id="bN"> entries.
    expect(tei).toMatch(/<listBibl>/);
    const bibEntries = tei.match(/<biblStruct xml:id="b\d+"/g) ?? [];
    expect(bibEntries.length).toBeGreaterThanOrEqual(20);

    // 6. References parsed into separate fields.
    expect(tei).toMatch(/<title level="a"/);   // analytic title
    expect(tei).toMatch(/<date\b[^>]*type="published"/);

    // 7. Page + bbox coordinates on body spans.
    expect(tei).toMatch(/coords="\d+,[\d.]+,[\d.]+,[\d.]+,[\d.]+/);

    // eslint-disable-next-line no-console
    console.log("TEI artifact written:", outPath, "size=", tei.length, "bytes");
  }, 300_000);
});
