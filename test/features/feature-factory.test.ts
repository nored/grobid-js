import { describe, it, expect } from "vitest";
import {
  classifyPunct,
  getPattern,
  linearScaling,
  logScaling,
  prefix,
  punctuationProfile,
  suffix,
  testAllCapital,
  testComplexNumber,
  testCountryCode,
  testDigit,
  testFirstCapital,
  testMonth,
  testNumber,
} from "../../src/core/features/feature-factory.js";

describe("string predicates", () => {
  it("testFirstCapital", () => {
    expect(testFirstCapital("Yarom")).toBe(true);
    expect(testFirstCapital("yarom")).toBe(false);
    expect(testFirstCapital("Über")).toBe(true);
    expect(testFirstCapital("")).toBe(false);
    expect(testFirstCapital(null)).toBe(false);
  });
  it("testAllCapital — true unless a lowercase letter appears", () => {
    expect(testAllCapital("NASA")).toBe(true);
    expect(testAllCapital("AES-128")).toBe(true);
    expect(testAllCapital("Yarom")).toBe(false);
    expect(testAllCapital("USENIX")).toBe(true);
  });
  it("testDigit / testNumber / testComplexNumber", () => {
    expect(testDigit("AES-128")).toBe(true);
    expect(testDigit("hello")).toBe(false);
    expect(testNumber("128")).toBe(true);
    expect(testNumber("128a")).toBe(false);
    expect(testComplexNumber("3.14")).toBe(true);
    expect(testComplexNumber("3,140.5")).toBe(true);
    expect(testComplexNumber("3.14a")).toBe(false);
  });
  it("testMonth handles full names and abbreviations", () => {
    expect(testMonth("January")).toBe(true);
    expect(testMonth("january")).toBe(true);
    expect(testMonth("Jul")).toBe(true);
    expect(testMonth("Schmul")).toBe(false);
  });
  it("testCountryCode matches the GROBID list", () => {
    expect(testCountryCode("US")).toBe(true);
    expect(testCountryCode("DE")).toBe(true);
    expect(testCountryCode("Zz")).toBe(false);
  });
});

describe("classifyPunct", () => {
  const cases: Array<[string, string | null]> = [
    ["(", "OPENBRACKET"],
    ["[", "OPENBRACKET"],
    [")", "ENDBRACKET"],
    ["]", "ENDBRACKET"],
    [".", "DOT"],
    [",", "COMMA"],
    ["-", "HYPHEN"],
    ['"', "QUOTE"],
    [";", "PUNCT"],
    [":;", "PUNCT"],
    ["abc", null],
  ];
  for (const [input, want] of cases) {
    it(`classifies ${JSON.stringify(input)} as ${want}`, () => {
      expect(classifyPunct(input)).toBe(want);
    });
  }
});

describe("prefix / suffix", () => {
  it("returns the requested number of chars, or the whole string if shorter", () => {
    expect(prefix("hello", 3)).toBe("hel");
    expect(prefix("hi", 5)).toBe("hi");
    expect(suffix("hello", 3)).toBe("llo");
    expect(suffix("hi", 5)).toBe("hi");
  });
});

describe("punctuationProfile", () => {
  it("keeps only punctuation characters in input order", () => {
    expect(punctuationProfile("As shown in [14], we ran X.")).toBe("[],.");
    expect(punctuationProfile("plain text")).toBe("");
  });
});

describe("scaling and patterns", () => {
  it("linearScaling buckets a position into [0, nbBins]", () => {
    expect(linearScaling(0, 100, 10)).toBe(0);
    expect(linearScaling(50, 100, 10)).toBe(5);
    expect(linearScaling(100, 100, 10)).toBe(10);
    expect(linearScaling(150, 100, 10)).toBe(10);
  });
  it("logScaling is monotone and saturates at nbBins", () => {
    const a = logScaling(1, 1000, 5);
    const b = logScaling(50, 1000, 5);
    const c = logScaling(900, 1000, 5);
    expect(a).toBeLessThanOrEqual(b);
    expect(b).toBeLessThanOrEqual(c);
    expect(logScaling(1000, 1000, 5)).toBe(5);
  });
  it("getPattern strips non-letters and lowercases", () => {
    expect(getPattern("Yarom 2014 USENIX")).toBe("yaromusenix");
  });
});
