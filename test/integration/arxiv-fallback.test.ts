// Unit tests for `src/node/arxiv-fallback.ts`.
//
// These exercise the *rewriting* logic (regex-driven TEI surgery) and the
// *parsing* logic (arXiv Atom and CrossRef JSON adapters) directly. We
// stub out `globalThis.fetch` so no real network traffic happens — the
// goal is to lock down the contract: an arXiv ID in the TEI's
// `<idno type="arXiv">` tag round-trips into a corrected title / abstract /
// author list on the output TEI.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { applyFallbackMetadata } from "../../src/node/arxiv-fallback.js";

// ---------- fetch stub ----------

type FetchStub = (url: string) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

const originalFetch = globalThis.fetch;

function stubFetch(responses: Record<string, string | { status: number; body: string }>): void {
  const handler: FetchStub = async (url: string) => {
    for (const [pattern, body] of Object.entries(responses)) {
      if (url.includes(pattern)) {
        const resolved = typeof body === "string" ? { status: 200, body } : body;
        return {
          ok: resolved.status >= 200 && resolved.status < 300,
          status: resolved.status,
          text: async () => resolved.body,
        };
      }
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  };
  globalThis.fetch = handler as unknown as typeof fetch;
}

// Re-route the on-disk cache to a per-test tmpdir so writes don't leak.
let prevCacheDir: string | undefined;
let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "grobid-js-fallback-test-"));
  prevCacheDir = process.env["XDG_CACHE_HOME"];
  process.env["XDG_CACHE_HOME"] = tmpDir;
});

afterEach(() => {
  if (prevCacheDir === undefined) delete process.env["XDG_CACHE_HOME"];
  else process.env["XDG_CACHE_HOME"] = prevCacheDir;
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
  globalThis.fetch = originalFetch;
});

// ---------- arXiv response fixtures ----------

const ARXIV_RESPONSE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/2602.08668v3</id>
    <updated>2026-03-08T00:00:00Z</updated>
    <published>2026-03-01T00:00:00Z</published>
    <title>Canonical Retrieval Pivot Attacks in Hybrid RAG: A Definitive Study</title>
    <summary>The CANONICAL arXiv abstract for this preprint, containing
      the authoritative description of the paper's contributions.</summary>
    <author><name>Scott Thornton</name></author>
    <author><name>Jane Q Smith</name></author>
    <arxiv:primary_category term="cs.CR"/>
    <arxiv:doi>10.1234/example.doi</arxiv:doi>
  </entry>
</feed>`;

// A minimal TEI carrying the CRF-extracted output the fallback should fix.
const CRF_TEI = `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
\t<teiHeader xml:lang="en">
\t\t<fileDesc>
\t\t\t<titleStmt>
\t\t\t\t<title level="a" type="main" coords="1,184,114,245,12">Bad CRF Title (mis-segmented)</title>
\t\t\t</titleStmt>
\t\t\t<sourceDesc>
\t\t\t\t<biblStruct status="extracted">
\t\t\t\t\t<analytic>
\t\t\t\t\t\t<author>
\t\t\t\t\t\t\t<persName coords="1,269,193,72,10"><forename type="first">Scotty</forename><surname>Throntopher</surname></persName>
\t\t\t\t\t\t</author>
\t\t\t\t\t\t<title level="a" type="main" coords="1,184,114,245,12">Bad CRF Title (mis-segmented)</title>
\t\t\t\t\t</analytic>
\t\t\t\t\t<monogr><imprint><date type="published" when="2026-03-08">8 Mar 2026</date></imprint></monogr>
\t\t\t\t\t<idno type="arXiv">arXiv:2602.08668v3[cs.CR]</idno>
\t\t\t\t</biblStruct>
\t\t\t</sourceDesc>
\t\t</fileDesc>
\t\t<profileDesc>
\t\t\t<abstract>
<div xmlns="http://www.tei-c.org/ns/1.0"><p coords="1,54,307,240,8">Short broken abstract.</p></div>
\t\t\t</abstract>
\t\t</profileDesc>
\t</teiHeader>
\t<text xml:lang="en"><body><div><p>Body text.</p></div></body></text>
</TEI>`;

// ---------- tests ----------

describe("applyFallbackMetadata", () => {
  it("replaces title, abstract, and authors from arXiv when CRF is broken", async () => {
    stubFetch({ "export.arxiv.org": ARXIV_RESPONSE });
    const out = await applyFallbackMetadata(CRF_TEI);
    expect(out).toContain("Canonical Retrieval Pivot Attacks in Hybrid RAG");
    expect(out).toContain("The CANONICAL arXiv abstract");
    expect(out).toContain("<surname>Thornton</surname>");
    expect(out).toContain("<surname>Smith</surname>");
    // CRF title's coords attribute is stripped on replacement.
    expect(out).not.toMatch(/<title[^>]*coords[^>]*>Canonical/);
    // Wrong author names are gone.
    expect(out).not.toContain("Throntopher");
  });

  it("is a no-op when the TEI has no arXiv ID and no DOI", async () => {
    // No stub — any fetch call would throw "unexpected fetch".
    stubFetch({});
    const tei = CRF_TEI.replace(/<idno type="arXiv">[^<]+<\/idno>/, "");
    const out = await applyFallbackMetadata(tei);
    expect(out).toBe(tei);
  });

  it("falls through silently on a 503 response", async () => {
    stubFetch({ "export.arxiv.org": { status: 503, body: "" } });
    const out = await applyFallbackMetadata(CRF_TEI);
    expect(out).toBe(CRF_TEI);
  });

  it("falls through silently on malformed Atom XML", async () => {
    stubFetch({ "export.arxiv.org": "<not><real><xml>" });
    const out = await applyFallbackMetadata(CRF_TEI);
    expect(out).toBe(CRF_TEI);
  });

  it("does not replace the title when CRF already matches canonical", async () => {
    const matchTei = CRF_TEI.replace(
      /Bad CRF Title \(mis-segmented\)/g,
      "Canonical Retrieval Pivot Attacks in Hybrid RAG: A Definitive Study",
    );
    stubFetch({ "export.arxiv.org": ARXIV_RESPONSE });
    const out = await applyFallbackMetadata(matchTei);
    // Title coords preserved (no replacement happened).
    expect(out).toMatch(/<title[^>]*coords="[^"]+"[^>]*>Canonical Retrieval/);
  });

  it("caches the canonical metadata across calls", async () => {
    let callCount = 0;
    globalThis.fetch = (async () => {
      callCount++;
      return {
        ok: true,
        status: 200,
        text: async () => ARXIV_RESPONSE,
      };
    }) as unknown as typeof fetch;
    await applyFallbackMetadata(CRF_TEI);
    await applyFallbackMetadata(CRF_TEI);
    // Second call must hit disk cache, not the network.
    expect(callCount).toBe(1);
  });

  it("handles CrossRef DOI when no arXiv ID is present", async () => {
    const doiTei = CRF_TEI.replace(
      /<idno type="arXiv">[^<]+<\/idno>/,
      '<idno type="DOI">10.1234/example.doi</idno>',
    );
    const crossrefJson = JSON.stringify({
      message: {
        title: ["CrossRef-canonical Title"],
        abstract: "<jats:p>CrossRef abstract here.</jats:p>",
        author: [
          { given: "Alice", family: "Adams" },
          { given: "Bob", family: "Brown" },
        ],
        DOI: "10.1234/example.doi",
        "container-title": ["Journal of Examples"],
      },
    });
    stubFetch({ "api.crossref.org": crossrefJson });
    const out = await applyFallbackMetadata(doiTei);
    expect(out).toContain("CrossRef-canonical Title");
    expect(out).toContain("CrossRef abstract here");
    expect(out).toContain("<surname>Adams</surname>");
  });
});
