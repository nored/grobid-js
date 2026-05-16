import { describe, it, expect } from "vitest";
import { MultiTokenMatcher, tokenize } from "../../src/core/lexicon/multi-token-matcher.js";

describe("tokenize", () => {
  it("splits on whitespace, keeps word runs together, isolates punctuation", () => {
    expect(tokenize("Apple Inc.")).toEqual(["Apple", "Inc", "."]);
    expect(tokenize("MIT")).toEqual(["MIT"]);
    expect(tokenize("Stanford  University")).toEqual(["Stanford", "University"]);
    expect(tokenize("")).toEqual([]);
  });
});

describe("MultiTokenMatcher.findAll", () => {
  it("finds a single multi-token entity", () => {
    const m = new MultiTokenMatcher();
    m.addPhraseString("Massachusetts Institute of Technology");
    const tokens = ["He", "works", "at", "the", "Massachusetts", "Institute", "of", "Technology", "."];
    expect(m.findAll(tokens)).toEqual([{ start: 4, end: 8 }]);
  });
  it("matches case-insensitively", () => {
    const m = new MultiTokenMatcher();
    m.addPhraseString("APPLE INC");
    expect(m.findAll(["apple", "inc"])).toEqual([{ start: 0, end: 2 }]);
  });
  it("picks the longest match when multiple phrases share a prefix", () => {
    const m = new MultiTokenMatcher();
    m.addPhraseString("Stanford University");
    m.addPhraseString("Stanford University School of Medicine");
    const tokens = tokenize("at Stanford University School of Medicine in Palo Alto");
    const out = m.findAll(tokens);
    expect(out.length).toBe(1);
    expect(out[0]).toEqual({ start: 1, end: 6 });
  });
  it("handles overlapping consecutive matches by greedy advance", () => {
    const m = new MultiTokenMatcher();
    m.addPhraseString("New York");
    m.addPhraseString("New York University");
    const tokens = tokenize("New York University");
    expect(m.findAll(tokens)).toEqual([{ start: 0, end: 3 }]);
  });
  it("returns no matches when nothing aligns", () => {
    const m = new MultiTokenMatcher();
    m.addPhraseString("Foo Bar");
    expect(m.findAll(["something", "else"])).toEqual([]);
  });
});

describe("MultiTokenMatcher.coveredIndices", () => {
  it("returns the union of all matched token indices", () => {
    const m = new MultiTokenMatcher();
    m.addPhraseString("National Institutes of Health");
    m.addPhraseString("FDA");
    const tokens = tokenize("Funded by the National Institutes of Health and the FDA in 2020");
    const covered = m.coveredIndices(tokens);
    // "National Institutes of Health" spans 4 tokens; "FDA" is single token
    expect(covered.size).toBe(5);
  });
});

describe("MultiTokenMatcher.size", () => {
  it("counts every added phrase", () => {
    const m = new MultiTokenMatcher();
    m.addPhraseString("A");
    m.addPhraseString("B C");
    m.addPhraseString("D E F");
    expect(m.size).toBe(3);
  });
});
