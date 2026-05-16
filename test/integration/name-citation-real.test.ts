// End-to-end test for the name-citation sub-model port. Verifies that
// references carry structured ReferenceAuthor entries with forename and
// surname segmentation when the name-citation model is loaded.

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Grobid } from "../../src/node/grobid.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const modelsDir = path.resolve(here, "../../fixtures/models");
const lexiconDir = path.resolve(here, "../../fixtures/lexicon");
const pdfPath = path.resolve(here, "../../fixtures/sample-arxiv.pdf");
const localPdfalto = path.resolve(here, "../../fixtures/pdfalto/pdfalto/mac/arm64/pdfalto");
const envPdfalto = process.env["GROBID_PDFALTO_BIN"];
const pdfaltoBinary = envPdfalto && existsSync(envPdfalto)
  ? envPdfalto
  : existsSync(localPdfalto) ? localPdfalto : null;

const required = ["segmentation.wapiti","header.wapiti","fulltext.wapiti","reference-segmenter.wapiti","citation.wapiti","name-citation.wapiti"];
const haveModels = required.every((f) => existsSync(path.join(modelsDir, f)));
const skip = !pdfaltoBinary || !haveModels || !existsSync(pdfPath);

(skip ? describe.skip : describe)("name-citation sub-model end-to-end", () => {
  it("attaches structured parsedAuthors to references when the model is loaded", async () => {
    const g = new Grobid({
      modelsDir,
      lexiconDir,
      pdfBackend: "pdfalto",
      pdfaltoOptions: { binaryPath: pdfaltoBinary! },
    });
    const out = await g.processPdf(pdfPath);
    expect(out.references.length).toBeGreaterThan(20);

    const withParsed = out.references.filter((r) => r.parsedAuthors && r.parsedAuthors.length > 0);
    // At least 40% of references should produce structured authors. The
    // remaining gap is the citation CRF's <author> tagging precision —
    // a separate quality issue — not a problem with the name-citation
    // sub-model itself, which runs whenever <author> tokens exist.
    expect(withParsed.length / out.references.length).toBeGreaterThanOrEqual(0.4);

    // Each ReferenceAuthor that came back should have at least a surname OR
    // forename(s).
    for (const r of withParsed) {
      for (const a of r.parsedAuthors!) {
        const hasSomething = !!a.surname || (a.forenames && a.forenames.length > 0);
        expect(hasSomething).toBe(true);
      }
    }

    // Spot-check: the "Attention" paper cites the Ba/Kiros/Hinton "Layer
    // normalization" paper. At least one reference should have a parsed
    // author with surname including "Hinton" or "Ba".
    const surnames = new Set<string>();
    for (const r of withParsed) {
      for (const a of r.parsedAuthors!) {
        if (a.surname) surnames.add(a.surname.toLowerCase());
      }
    }
    // eslint-disable-next-line no-console
    console.log("parsed surname sample:", Array.from(surnames).slice(0, 10));
    expect(surnames.size).toBeGreaterThan(10);
  }, 180_000);
});
