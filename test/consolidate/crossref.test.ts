import { describe, it, expect } from "vitest";
import {
  consolidateReferences,
  lookupReference,
  ratcliffObershelp,
} from "../../src/core/consolidate/crossref.js";
import type { Reference } from "../../src/core/pipeline/parsed-document.js";

function ref(overrides: Partial<Reference> = {}): Reference {
  return { id: "b0", rawText: "", tokens: [], ...overrides };
}

describe("ratcliffObershelp", () => {
  it("returns 1.0 for identical strings", () => {
    expect(ratcliffObershelp("smith", "smith")).toBe(1);
  });
  it("returns 0 for completely disjoint strings", () => {
    expect(ratcliffObershelp("abc", "xyz")).toBe(0);
  });
  it("rates near-identical surnames high", () => {
    expect(ratcliffObershelp("yarom", "yaorm")).toBeGreaterThan(0.6);
    expect(ratcliffObershelp("smith", "smyth")).toBeGreaterThan(0.6);
  });
  it("rates same string with slight prefix change", () => {
    expect(ratcliffObershelp("johnson", "johansson")).toBeGreaterThan(0.5);
  });
  it("treats empty strings as 0", () => {
    expect(ratcliffObershelp("", "smith")).toBe(0);
  });
});

describe("lookupReference (mocked network)", () => {
  const originalFetch = globalThis.fetch;
  function mockFetch(response: unknown, status = 200): void {
    globalThis.fetch = (async () => ({
      ok: status === 200,
      status,
      statusText: "OK",
      json: async () => response,
    })) as never;
  }
  function restoreFetch(): void {
    globalThis.fetch = originalFetch;
  }

  it("resolves a /works/{doi} response and returns canonical fields", async () => {
    mockFetch({
      message: {
        DOI: "10.1145/2638728.2641561",
        title: ["FLUSH+RELOAD: a High Resolution Side-Channel Attack"],
        "container-title": ["USENIX Security"],
        author: [{ given: "Yuval", family: "Yarom" }, { given: "Katrina", family: "Falkner" }],
        issued: { "date-parts": [[2014, 8]] },
        publisher: "USENIX",
        page: "719-732",
        volume: "23",
      },
    });
    try {
      const r = ref({ doi: "10.1145/2638728.2641561", authors: "Yuval Yarom" });
      const out = await lookupReference(r);
      expect(out?.doi).toBe("10.1145/2638728.2641561");
      expect(out?.title).toMatch(/FLUSH\+RELOAD/);
      expect(out?.journal).toBe("USENIX Security");
      expect(out?.normalizedDate?.year).toBe("2014");
      expect(out?.normalizedDate?.month).toBe("8");
      expect(out?.authors).toContain("Yarom");
    } finally {
      restoreFetch();
    }
  });

  it("returns null when CrossRef returns no items", async () => {
    mockFetch({ message: { items: [] } });
    try {
      const r = ref({ authors: "Nonexistent", date: "1800", title: "Made up" });
      const out = await lookupReference(r);
      expect(out).toBe(null);
    } finally {
      restoreFetch();
    }
  });

  it("rejects matches whose first author surname is too dissimilar", async () => {
    mockFetch({
      message: {
        items: [{
          DOI: "10.0/wrong",
          title: ["Other Paper"],
          author: [{ given: "Different", family: "Person" }],
          issued: { "date-parts": [[2020]] },
        }],
      },
    });
    try {
      const r = ref({ authors: "Yarom", title: "Search query", normalizedDate: { year: "2014" } });
      const out = await lookupReference(r);
      expect(out).toBe(null);
    } finally {
      restoreFetch();
    }
  });

  it("accepts matches above the similarity threshold", async () => {
    mockFetch({
      message: {
        items: [{
          DOI: "10.0/ok",
          title: ["Some Paper"],
          author: [{ given: "Yuval", family: "Yaorm" }], // misspelled surname
          issued: { "date-parts": [[2014]] },
        }],
      },
    });
    try {
      const r = ref({ authors: "Yarom", title: "Some Paper", normalizedDate: { year: "2014" } });
      const out = await lookupReference(r, { minSimilarity: 0.6 });
      expect(out?.doi).toBe("10.0/ok");
    } finally {
      restoreFetch();
    }
  });
});

describe("consolidateReferences (mocked network)", () => {
  it("mutates each reference in place with canonical fields", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => {
        // The DOI is URL-encoded in the path: "10.0%2Fa".
        if (decodeURIComponent(url).includes("works/10.0/a")) {
          return {
            message: { DOI: "10.0/a", title: ["A Paper"], author: [{ family: "Alpha" }] },
          };
        }
        return { message: { items: [] } };
      },
    })) as never;
    try {
      const refs: Reference[] = [
        ref({ id: "b0", doi: "10.0/a", authors: "Alpha" }),
        ref({ id: "b1", authors: "Bravo", title: "Unknown" }),
      ];
      const count = await consolidateReferences(refs);
      expect(count).toBe(1);
      expect(refs[0]!.doi).toBe("10.0/a");
      // CrossRef title doesn't overwrite an existing CRF-parsed title
      // (which was empty here, so it's filled).
      expect(refs[0]!.title).toBe("A Paper");
      expect(refs[1]!.doi).toBeUndefined();
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

const liveNet = process.env["GROBID_JS_LIVE_NETWORK"] === "1";
(liveNet ? describe : describe.skip)("live CrossRef lookup", () => {
  it("resolves a known DOI to its canonical metadata", async () => {
    const r = ref({ doi: "10.1145/3065386" });
    const out = await lookupReference(r, { mailto: "test@grobid-js.example" });
    expect(out?.doi?.toLowerCase()).toBe("10.1145/3065386");
    expect(out?.title?.toLowerCase()).toContain("imagenet");
  }, 30_000);
});
