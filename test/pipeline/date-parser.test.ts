import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadWapitiModel } from "../../src/core/crf/index.js";
import { parseDate, pickBest } from "../../src/core/pipeline/date-parser.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const modelPath = path.resolve(here, "../../fixtures/models/date.wapiti");

describe("pickBest", () => {
  it("returns the earliest year, tiebreak by specificity", () => {
    expect(pickBest([{ year: "2020" }, { year: "2018" }])).toEqual({ year: "2018" });
    expect(pickBest([{ year: "2020" }, { year: "2020", month: "3" }]))
      .toEqual({ year: "2020", month: "3" });
    expect(pickBest([])).toBe(null);
  });
});

const skip = !existsSync(modelPath) ? describe.skip : describe;

skip("parseDate against the real date CRF", () => {
  const model = loadWapitiModel(readFileSync(modelPath));
  it("extracts year/month/day from a typical bibliography date", () => {
    const dates = parseDate("23 July 2008", model);
    expect(dates.length).toBeGreaterThanOrEqual(1);
    const best = pickBest(dates)!;
    expect(best.year).toBe("2008");
    expect(best.month).toBe("7");
    expect(best.day).toBe("23");
  });
  it("extracts a year-only date", () => {
    const dates = parseDate("2014", model);
    const best = pickBest(dates)!;
    expect(best.year).toBe("2014");
    expect(best.month).toBeUndefined();
    expect(best.day).toBeUndefined();
  });
  it("normalizes month abbreviations", () => {
    const dates = parseDate("Mar. 2016", model);
    const best = pickBest(dates)!;
    expect(best.year).toBe("2016");
    expect(best.month).toBe("3");
  });
});
