import { describe, it, expect } from "vitest";
import { compilePattern, evalPattern, wapitiRegexMatch, wapitiRegexExtract } from "../../src/core/crf/wapiti-pattern.js";

const rows: string[][] = [
  ["The", "DT"],
  ["quick", "JJ"],
  ["brown", "JJ"],
  ["fox", "NN"],
];

describe("compilePattern", () => {
  it("compiles a simple x pattern and preserves the u/b/* prefix as literal", () => {
    const p = compilePattern("u01:%x[0,0]");
    expect(p.kind).toBe("u");
    expect(p.items[0]).toMatchObject({ kind: "literal", literal: "u01:" });
    expect(p.items[1]).toMatchObject({ kind: "x", offset: 0, column: 0, absolute: false });
    expect(p.ntoks).toBe(0);
  });
  it("compiles a bigram pattern across two offsets", () => {
    const p = compilePattern("b07:%x[-1,1]/%x[0,1]");
    expect(p.kind).toBe("b");
    const kinds = p.items.map((i) => i.kind);
    expect(kinds).toEqual(["literal", "x", "literal", "x"]);
  });
  it("compiles an absolute offset", () => {
    const p = compilePattern("u02:%x[@0,0]");
    expect(p.items[1]).toMatchObject({ kind: "x", absolute: true, offset: 0 });
  });
  it("compiles a t pattern with a regex argument", () => {
    const p = compilePattern('u17:%t[0,0,"^\\u"]');
    expect(p.items[1]).toMatchObject({ kind: "t", regexSrc: "^\\u" });
  });
  it("compiles an uppercase X command and marks caps", () => {
    const p = compilePattern("u03:%X[0,0]");
    expect(p.items[1]).toMatchObject({ kind: "x", caps: true });
  });
});

describe("evalPattern", () => {
  it("expands %x[off,col] to the cell value", () => {
    const p = compilePattern("u01:%x[0,0]");
    expect(evalPattern(p, rows, 1)).toBe("u01:quick");
  });
  it("expands %X[off,col] with lowercased value", () => {
    const p = compilePattern("u02:%X[0,0]");
    expect(evalPattern(p, rows, 0)).toBe("u02:the");
  });
  it("uses _x-N sentinels when offset goes before the start", () => {
    const p = compilePattern("u01:%x[-2,0]");
    expect(evalPattern(p, rows, 0)).toBe("u01:_x-2");
  });
  it("uses _x+N sentinels when offset goes past the end", () => {
    const p = compilePattern("u01:%x[2,0]");
    expect(evalPattern(p, rows, 3)).toBe("u01:_x+2");
  });
  it("clamps to _x-# beyond the supported window", () => {
    const p = compilePattern("u01:%x[-9,0]");
    expect(evalPattern(p, rows, 0)).toBe("u01:_x-#");
  });
  it("concatenates literal segments and multiple captures", () => {
    const p = compilePattern("b07:%x[-1,0]/%x[0,0]");
    expect(evalPattern(p, rows, 2)).toBe("b07:quick/brown");
  });
  it("returns null when the column is missing on a row", () => {
    const p = compilePattern("u01:%x[0,5]");
    expect(evalPattern(p, rows, 0)).toBeNull();
  });
});

describe("wapitiRegexMatch", () => {
  it("matches plain characters", () => {
    expect(wapitiRegexMatch("cat", "concatenate")).toBe(true);
    expect(wapitiRegexMatch("dog", "concatenate")).toBe(false);
  });
  it("supports the dot metacharacter", () => {
    expect(wapitiRegexMatch("c.t", "cat")).toBe(true);
  });
  it("supports the \\d character class", () => {
    expect(wapitiRegexMatch("\\d", "abc1xyz")).toBe(true);
    expect(wapitiRegexMatch("\\d", "abcxyz")).toBe(false);
  });
  it("supports the uppercase complement classes", () => {
    expect(wapitiRegexMatch("\\D", "1")).toBe(false);
    expect(wapitiRegexMatch("\\D", "a")).toBe(true);
  });
  it("supports anchors", () => {
    expect(wapitiRegexMatch("^cat", "cat sat")).toBe(true);
    expect(wapitiRegexMatch("^cat", "the cat")).toBe(false);
    expect(wapitiRegexMatch("cat$", "the cat")).toBe(true);
    expect(wapitiRegexMatch("cat$", "the cats")).toBe(false);
  });
  it("supports star repetition", () => {
    expect(wapitiRegexMatch("a*b", "aaab")).toBe(true);
    expect(wapitiRegexMatch("a*b", "b")).toBe(true);
  });
});

describe("wapitiRegexExtract", () => {
  it("returns the matched substring", () => {
    expect(wapitiRegexExtract("\\d\\d\\d\\d", "Yarom 2014 USENIX")).toBe("2014");
  });
  it("returns the empty string when there is no match", () => {
    expect(wapitiRegexExtract("\\d", "abcdef")).toBe("");
  });
});
