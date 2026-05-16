import { describe, it, expect } from "vitest";
import { wordShape } from "../../src/core/features/feature-factory.js";

// Cross-checked against upstream TextUtilities.wordShape by hand-tracing
// the Java algorithm on each input. The shapes feel non-intuitive at a
// glance (the middle is run-length-compressed but with a trailing
// "ch != middle.last → append" rule that preserves a final transition)
// — these are the byte-for-byte expected outputs.

describe("wordShape", () => {
  it("returns empty string on empty input", () => {
    expect(wordShape("")).toBe("");
  });
  it("returns the shape directly for length-1 input", () => {
    expect(wordShape("X")).toBe("X");
  });
  it("preserves the per-character shape on a length-3 word", () => {
    // shape.length > 3 is false → middle stays empty, result = first + suffix.
    expect(wordShape("USA")).toBe("XXX");
  });
  it("collapses runs of the same shape character in the middle", () => {
    // "Bachelor" → "Xxxxxxxx" → first 'X', middle collapses run of x's to 'x',
    // suffix "xx".
    expect(wordShape("Bachelor")).toBe("Xxxx");
    expect(wordShape("John")).toBe("Xxxx");
  });
  it("preserves transitions between shape characters in the middle", () => {
    // "USA123" → "XXXddd" → first 'X', middle "Xd" (X-run collapsed then d
    // appended on transition), suffix "dd". Total "XXddd".
    expect(wordShape("USA123")).toBe("XXddd");
  });
  it("keeps non-letter / non-digit characters verbatim", () => {
    // "Ph.D." → shape "Xx.X." length 5; first='X', suffix="X." (last 2),
    // middle traces to "x." (collapses the first x then transitions on '.').
    expect(wordShape("Ph.D.")).toBe("Xx.X.");
  });
});
