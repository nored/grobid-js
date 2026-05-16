import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadWapitiModel } from "../../src/core/crf/wapiti-model.js";
import { decode } from "../../src/core/crf/wapiti-decoder.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const modelPath = path.resolve(here, "../../fixtures/models/date.wapiti");

/**
 * Build a minimal row vector matching FeaturesVectorDate.printVector():
 *   string, lowercase, prefix1..4, suffix1..4, lineStatus,
 *   capitalisation, digit, singleChar, year, month, punctType
 */
function dateRow(text: string, opts: { lineStatus: string; year?: boolean; month?: boolean }): string[] {
  const prefix = (s: string, n: number) => s.length >= n ? s.slice(0, n) : s;
  const suffix = (s: string, n: number) => s.length >= n ? s.slice(-n) : s;
  let capitalisation = "NOCAPS";
  if (/^[A-Z]/.test(text)) capitalisation = "INITCAP";
  if (/^[A-Z]+$/.test(text)) capitalisation = "ALLCAP";
  let digit = "NODIGIT";
  if (/^[0-9]+$/.test(text)) digit = "ALLDIGIT";
  else if (/[0-9]/.test(text)) digit = "CONTAINSDIGITS";
  let punctType = "NOPUNCT";
  if (/^[\p{P}]$/u.test(text)) punctType = "PUNCT";
  return [
    text,
    text.toLowerCase(),
    prefix(text, 1),
    prefix(text, 2),
    prefix(text, 3),
    prefix(text, 4),
    suffix(text, 1),
    suffix(text, 2),
    suffix(text, 3),
    suffix(text, 4),
    opts.lineStatus,
    digit === "ALLDIGIT" ? "NOCAPS" : capitalisation,
    digit,
    text.length === 1 ? "1" : "0",
    opts.year ? "1" : "0",
    opts.month ? "1" : "0",
    punctType,
  ];
}

describe("real GROBID date model", () => {
  it("loads the 111 KB date model and tags '23 Jul 2008' as day/month/year", () => {
    const text = readFileSync(modelPath, "utf8");
    const model = loadWapitiModel(text);
    // Header expectations from `awk` inspection.
    expect(model.labels.length).toBe(7);
    expect(model.labels).toContain("I-<day>");
    expect(model.labels).toContain("I-<month>");
    expect(model.labels).toContain("I-<year>");
    expect(model.obs.length).toBe(7098);
    expect(model.patterns.length).toBe(50);

    const rows = [
      dateRow("23", { lineStatus: "LINESTART" }),
      dateRow("Jul", { lineStatus: "LINEIN", month: true }),
      dateRow("2008", { lineStatus: "LINEEND", year: true }),
    ];
    const out = decode(model, rows);
    // The exact label strings the model emits (BIO 'I-' for span starts,
    // bare tag for continuations). For a 3-token sequence each token starts
    // its own span, so we expect I-<...> on every position.
    expect(out.labels[0]).toBe("I-<day>");
    expect(out.labels[1]).toBe("I-<month>");
    expect(out.labels[2]).toBe("I-<year>");
  });
});
