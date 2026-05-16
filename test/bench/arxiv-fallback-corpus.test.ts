// Corpus-driven smoke test for the arXiv-fallback post-processor.
//
// Picks 3 papers from `fixtures/blind-corpus/` that we know have an arXiv
// ID printed on page 1, runs `applyFallbackMetadata` against their existing
// CRF-extracted TEIs, and confirms the canonical metadata from the arXiv
// API ends up in the output. The arXiv responses are HTTP-mocked (no
// outbound traffic) so the test stays hermetic on CI.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { applyFallbackMetadata } from "../../src/node/arxiv-fallback.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const corpusDir = path.resolve(here, "../../fixtures/blind-corpus/grobid-js");

const originalFetch = globalThis.fetch;

interface Fixture {
  paper: string;
  arxivId: string;
  canonicalTitle: string;
  canonicalAbstractPrefix: string;
  canonicalAuthors: Array<{ name: string }>;
}

// Hand-curated canonical metadata for the three test papers. These values
// match the actual arXiv API output (see the response stub builder below).
const FIXTURES: readonly Fixture[] = [
  {
    paper: "paper_180",
    arxivId: "1803.05542",
    canonicalTitle:
      "A Game-Theoretic Framework for the Virtual Machines Migration Timing Problem",
    canonicalAbstractPrefix: "In a multi-tenant cloud",
    canonicalAuthors: [{ name: "Ahmed H Anwar" }, { name: "George Atia" }, { name: "Mina Guirguis" }],
  },
  {
    paper: "paper_217",
    arxivId: "2306.16384",
    canonicalTitle:
      "GIDS: Accelerating Sampling and Aggregation Operations in GNN Frameworks with GPU Initiated Direct Storage Accesses",
    canonicalAbstractPrefix: "Graph Neural Networks",
    canonicalAuthors: [{ name: "Jeongmin Park" }, { name: "Vikram Sharma Mailthody" }, { name: "Wen-mei Hwu" }],
  },
  {
    paper: "paper_215",
    arxivId: "2504.08204",
    canonicalTitle:
      "II-NVM: Enhancing Map Accuracy and Consistency with Normal Vector-Assisted Mapping",
    canonicalAbstractPrefix: "Localization and",
    canonicalAuthors: [{ name: "Chengwei Zhao" }, { name: "Yixuan Li" }],
  },
] as const;

function buildArxivAtom(f: Fixture): string {
  const authorXml = f.canonicalAuthors
    .map((a) => `    <author><name>${a.name}</name></author>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/${f.arxivId}</id>
    <updated>2026-03-08T00:00:00Z</updated>
    <published>2026-03-01T00:00:00Z</published>
    <title>${f.canonicalTitle}</title>
    <summary>${f.canonicalAbstractPrefix} this paper presents a canonical fictionalised
      abstract from the arXiv API for the corpus test. The fallback machinery
      must pick this up and replace the CRF version.</summary>
${authorXml}
    <arxiv:primary_category term="cs.CR"/>
  </entry>
</feed>`;
}

function stubFetchById(byId: Map<string, string>): void {
  globalThis.fetch = (async (url: string | URL | Request) => {
    const u = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    for (const [id, body] of byId.entries()) {
      if (u.includes(`id_list=${id}`)) {
        return {
          ok: true,
          status: 200,
          text: async () => body,
        };
      }
    }
    throw new Error(`unexpected fetch: ${u}`);
  }) as unknown as typeof fetch;
}

let prevCacheDir: string | undefined;
let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "grobid-js-corpus-arxiv-"));
  prevCacheDir = process.env["XDG_CACHE_HOME"];
  process.env["XDG_CACHE_HOME"] = tmpDir;
});

afterEach(() => {
  if (prevCacheDir === undefined) delete process.env["XDG_CACHE_HOME"];
  else process.env["XDG_CACHE_HOME"] = prevCacheDir;
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
  globalThis.fetch = originalFetch;
});

describe("arxiv-fallback against corpus papers", () => {
  for (const fixture of FIXTURES) {
    it(`${fixture.paper}: canonical arXiv metadata replaces CRF output`, async () => {
      const teiPath = path.join(corpusDir, `${fixture.paper}.tei.xml`);
      if (!existsSync(teiPath)) {
        // Corpus is optional in CI; skip gracefully.
        console.warn(`skipping ${fixture.paper}: ${teiPath} not present`);
        return;
      }
      const tei = readFileSync(teiPath, "utf8");
      stubFetchById(new Map([[fixture.arxivId, buildArxivAtom(fixture)]]));

      const before = {
        title: extractInner(tei, /<titleStmt>[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/),
        abstract: extractInner(tei, /<abstract>([\s\S]*?)<\/abstract>/),
        authors: countAuthors(tei),
      };
      const out = await applyFallbackMetadata(tei);
      const after = {
        title: extractInner(out, /<titleStmt>[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/),
        abstract: extractInner(out, /<abstract>([\s\S]*?)<\/abstract>/),
        authors: countAuthors(out),
      };

      // The canonical arXiv title must appear in the rewritten TEI.
      expect(after.title).toContain(fixture.canonicalTitle);
      // The canonical abstract prefix must appear.
      expect(after.abstract).toContain(fixture.canonicalAbstractPrefix);
      // At least one canonical surname (from the FIRST author) is present.
      const firstSurname = fixture.canonicalAuthors[0]!.name.split(" ").pop()!;
      expect(out).toContain(`<surname>${firstSurname}</surname>`);
      // Sanity log to make pass-or-fail context useful.
      console.info(
        `[${fixture.paper}] before: title=${preview(before.title)}, abstract=${preview(before.abstract)}, authors=${before.authors}`,
      );
      console.info(
        `[${fixture.paper}]  after: title=${preview(after.title)}, abstract=${preview(after.abstract)}, authors=${after.authors}`,
      );
    });
  }
});

function extractInner(xml: string, re: RegExp): string {
  const m = re.exec(xml);
  if (m === null) return "";
  return m[1]!.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function countAuthors(xml: string): number {
  // Count `<author>` inside the first `<analytic>` block only.
  const am = /<analytic>([\s\S]*?)<\/analytic>/.exec(xml);
  if (am === null) return 0;
  return (am[1]!.match(/<author\b/g) ?? []).length;
}

function preview(s: string): string {
  return s.length > 70 ? `${s.slice(0, 70)}…` : s;
}
