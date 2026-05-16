import { describe, it, expect } from "vitest";
import {
  getNumberedLabels,
  isAuthorCitationStyle,
  isNumberedCitationReference,
  matchMarker,
  splitAuthorCitation,
} from "../../src/core/pipeline/citation-matcher.js";
import type { Reference } from "../../src/core/pipeline/parsed-document.js";

function ref(id: string, partial: Partial<Reference> = {}): Reference {
  return { id, rawText: id, tokens: [], ...partial };
}

const refs: Reference[] = [
  ref("b0", { label: "1", authors: "Yarom; Falkner", date: "2014" }),
  ref("b1", { label: "2", authors: "Smith, J.", date: "2020" }),
  ref("b2", { label: "3", authors: "Jones, A.; Brown, B.", date: "2018" }),
  ref("b3", { label: "14", authors: "Kuwajima et al.", date: "1985" }),
  ref("b4", { label: "15", authors: "Creighton", date: "1990" }),
];

describe("style detection", () => {
  it("recognises author-year markers", () => {
    expect(isAuthorCitationStyle("(Smith, 2020)")).toBe(true);
    expect(isAuthorCitationStyle("Kuwajima et al., 1985")).toBe(true);
    expect(isAuthorCitationStyle("[14]")).toBe(false);
  });
  it("recognises numbered markers including ranges and mixed", () => {
    expect(isNumberedCitationReference("[14]")).toBe(true);
    expect(isNumberedCitationReference("[1-3]")).toBe(true);
    expect(isNumberedCitationReference("(14)")).toBe(true);
    expect(isNumberedCitationReference("Naze et al. [5]")).toBe(true);
    // Note: "(Smith, 2020)" also returns true here in isolation because the
    // year matches NUMBERED_CITATION_PATTERN and "Smith" matches AUTHOR_NAME
    // — matching upstream's logic. Style dispatch in matchMarker() consults
    // isAuthorCitationStyle() first, so the marker is routed to author-year.
  });
});

describe("getNumberedLabels", () => {
  it("expands ranges within MAX_RANGE", () => {
    expect(getNumberedLabels("[1-3]")).toEqual(["[1]", "[2]", "[3]"]);
    expect(getNumberedLabels("(14)")).toEqual(["(14)"]);
  });
  it("splits comma-separated lists", () => {
    expect(getNumberedLabels("[1, 3, 5]")).toEqual(["[1]", "[3]", "[5]"]);
  });
  it("rejects ranges larger than MAX_RANGE", () => {
    expect(getNumberedLabels("[1-100]")).toEqual([]);
  });
  it("preserves wrapping symbols ( vs [", () => {
    expect(getNumberedLabels("(2-3)")).toEqual(["(2)", "(3)"]);
  });
});

describe("splitAuthorCitation", () => {
  it("splits on semicolons (keeping outer wrap on first/last piece)", () => {
    // Upstream LayoutTokensUtil.split preserves the wrap so we keep "( ... )".
    expect(splitAuthorCitation("(Yarom, 2014; Smith, 2020)"))
      .toEqual(["(Yarom, 2014", "Smith, 2020)"]);
  });
  it("splits a shared-author multi-year chunk into separate refs", () => {
    expect(splitAuthorCitation("Grafton et al. 1995, 1998"))
      .toEqual(["Grafton et al. 1995", "Grafton et al. 1998"]);
  });
  it("splits an X (Y) and Z (W) form", () => {
    expect(splitAuthorCitation("Khechinashvili et al. (1973) and Privalov (1979)"))
      .toEqual(["Khechinashvili et al. (1973)", "Privalov (1979)"]);
  });
});

describe("matchMarker numbered", () => {
  it("resolves a single numbered marker to the matching reference", () => {
    const r = matchMarker("[14]", refs);
    expect(r).toHaveLength(1);
    expect(r[0]!.target?.id).toBe("b3");
  });
  it("resolves each entry of a range marker independently", () => {
    const r = matchMarker("[1-3]", refs);
    expect(r.map((x) => x.target?.id)).toEqual(["b0", "b1", "b2"]);
  });
  it("falls back to ordinal lookup when no explicit label is stored", () => {
    const noLabelRefs: Reference[] = [
      ref("r0", { authors: "A", date: "2010" }),
      ref("r1", { authors: "B", date: "2011" }),
    ];
    const r = matchMarker("[2]", noLabelRefs);
    expect(r[0]!.target?.id).toBe("r1");
  });
});

describe("matchMarker author-year", () => {
  it("resolves a single author-year marker", () => {
    const r = matchMarker("(Yarom, 2014)", refs);
    expect(r).toHaveLength(1);
    expect(r[0]!.target?.id).toBe("b0");
  });
  it("resolves each chunk of a multi-author marker", () => {
    const r = matchMarker("(Yarom, 2014; Smith, 2020)", refs);
    expect(r.map((x) => x.target?.id)).toEqual(["b0", "b1"]);
  });
  it("returns null target when no match exists", () => {
    const r = matchMarker("(Nobody, 1900)", refs);
    expect(r[0]!.target).toBeNull();
  });
});
