// Post-processor that improves the CRF-extracted TEI by looking up canonical
// metadata from the arXiv API (and CrossRef as a DOI fallback) and replacing
// the title / authors / abstract when the CRF version is missing or
// meaningfully different from the API-canonical version.
//
// Why this is default-on:
//   For any preprint with an arXiv ID, the arXiv API returns the authoritative
//   title / abstract / author list. The CRF model can mis-segment or truncate
//   the title (especially when the visual layout breaks across columns), drop
//   the abstract (when it spans columns), or miss authors. Substituting the
//   canonical metadata is a strict improvement.
//
// Implementation notes:
//   - The lookup is best-effort: any network error, malformed response, or
//     timeout falls through silently and we emit the un-modified TEI.
//   - Results are cached on disk under `<XDG_CACHE_HOME or ~/.cache>/grobid-js/metadata/`
//     keyed by arXiv ID or DOI; cached entries persist across runs.
//   - Rate-limiting is enforced defensively (250 ms between arXiv requests,
//     50 ms between CrossRef requests) — these limits are well under the
//     published quotas for both services.
//   - The TEI is mutated as a string with conservative regex replacements
//     rather than via a full DOM round-trip; coordinates and other
//     attributes on the elements we replace are preserved on the OUTER tag
//     and only the inner text is overwritten. For the title, we strip the
//     `coords="…"` attribute because the API title is verbatim and pdfalto
//     coords no longer apply.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { getLogger } from "../grobid/utilities/logger.js";

const LOGGER = getLogger("ArxivFallback");

/** Canonical metadata as returned by either arXiv (Atom XML) or CrossRef (JSON). */
export interface CanonicalMetadata {
  source: "arxiv" | "crossref";
  /** Canonical title with line-wraps collapsed and inner whitespace normalised. */
  title: string | null;
  /** Author names as printed on the document — split into forename / surname. */
  authors: Array<{ forename: string; surname: string }>;
  /** Plain-text abstract (line-wraps collapsed). */
  abstract: string | null;
  /** arXiv primary category (e.g. `cs.CR`) or CrossRef container-title — informational. */
  primaryCategory: string | null;
  /** Optional canonical DOI returned by the upstream service. */
  doi: string | null;
}

/* ───────────────────────── public entry point ─────────────────────────── */

/**
 * Apply the arXiv / DOI fallback to a freshly-emitted TEI string. The
 * operation is asynchronous (it may make at most one HTTP request); on any
 * error the input string is returned unmodified.
 *
 * The function is safe to call on any TEI — when no arXiv ID or DOI is
 * present, it returns the input unchanged after only running a couple of
 * regexes (no HTTP traffic).
 */
export async function applyFallbackMetadata(tei: string): Promise<string> {
  try {
    const arxivId = extractArxivId(tei);
    const doi = extractDoi(tei);
    if (arxivId === null && doi === null) return tei;
    let canonical: CanonicalMetadata | null = null;
    if (arxivId !== null) canonical = await fetchArxivMetadata(arxivId);
    if (canonical === null && doi !== null) canonical = await fetchCrossrefMetadata(doi);
    if (canonical === null) return tei;
    return rewriteTei(tei, canonical);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    LOGGER.warn(`arXiv/DOI fallback failed (best-effort, falling back to CRF output): ${msg}`);
    return tei;
  }
}

/* ───────────────────── arXiv ID / DOI extraction ──────────────────────── */

const ARXIV_NEW_FORMAT = /(\d{4}\.\d{4,5})(?:v\d+)?/;
const ARXIV_OLD_FORMAT = /([a-zA-Z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?/;
// Match `<idno type="arXiv">arXiv:2602.08668v3[cs.CR]</idno>` and capture the
// bare ID (without `arXiv:` prefix, version suffix, or category bracket).
const TEI_ARXIV_IDNO = /<idno[^>]*type="arXiv"[^>]*>\s*(?:arXiv:)?\s*([^<\s[]+)/i;
// Match `<idno type="DOI">10.xxxx/yyy</idno>` — case-insensitive.
const TEI_DOI_IDNO = /<idno[^>]*type="DOI"[^>]*>\s*(10\.\d{3,9}\/[^<\s]+)/i;
// Body-text fallback for arXiv IDs printed on page 1.
const BODY_ARXIV = /arXiv:\s*(\d{4}\.\d{4,5})/;

/**
 * Pull the arXiv ID out of the TEI's `<idno type="arXiv">` tag (the most
 * common location — GROBID's header parser usually catches it from the
 * banner on page 1). Falls back to a body-text regex for the older format.
 *
 * Only matches the FIRST occurrence to ensure we pick up the paper's OWN
 * arXiv ID (typically in the `<sourceDesc>` block) rather than a reference's
 * arXiv ID.
 */
function extractArxivId(tei: string): string | null {
  // Restrict the search to the `<teiHeader>` so we don't accidentally pick
  // up a reference's arXiv ID. The first `<sourceDesc>` is where the paper's
  // own arXiv ID lives.
  const headerEnd = tei.indexOf("</teiHeader>");
  const headerSlice = headerEnd >= 0 ? tei.slice(0, headerEnd) : tei;
  const m = TEI_ARXIV_IDNO.exec(headerSlice);
  if (m !== null && m[1]) {
    const raw = m[1].trim();
    // Strip a possible `v3` version suffix and `[cs.CR]` category bracket.
    return canonicaliseArxivId(raw);
  }
  // Last-ditch: scan the first 8 KiB of body text for the new-style ID.
  const bodyEnd = Math.min(tei.length, 8192);
  const bodyMatch = BODY_ARXIV.exec(tei.slice(0, bodyEnd));
  if (bodyMatch !== null && bodyMatch[1]) return bodyMatch[1];
  return null;
}

/**
 * Normalise an arXiv ID by stripping the optional `arXiv:` prefix, a `v<N>`
 * version suffix, and a trailing category bracket like `[cs.CR]`. Returns
 * `null` for inputs that don't look like either the new (`NNNN.NNNNN`) or
 * the old (`category/NNNNNNN`) ID format.
 */
function canonicaliseArxivId(raw: string): string | null {
  let id = raw;
  if (id.toLowerCase().startsWith("arxiv:")) id = id.slice(6);
  id = id.replace(/\[.*$/, "").trim();
  const newMatch = ARXIV_NEW_FORMAT.exec(id);
  if (newMatch !== null && newMatch[1]) return newMatch[1];
  const oldMatch = ARXIV_OLD_FORMAT.exec(id);
  if (oldMatch !== null && oldMatch[1]) return oldMatch[1];
  return null;
}

/** Same idea for DOIs — restricted to the `<teiHeader>` block. */
function extractDoi(tei: string): string | null {
  const headerEnd = tei.indexOf("</teiHeader>");
  const slice = headerEnd >= 0 ? tei.slice(0, headerEnd) : tei;
  const m = TEI_DOI_IDNO.exec(slice);
  if (m !== null && m[1]) return m[1].replace(/[.,;]+$/, "");
  return null;
}

/* ─────────────────────────── HTTP + cache ─────────────────────────────── */

interface RateLimiter {
  intervalMs: number;
  lastRequest: number;
}

const arxivRate: RateLimiter = { intervalMs: 250, lastRequest: 0 };
const crossrefRate: RateLimiter = { intervalMs: 50, lastRequest: 0 };

async function rateLimit(limiter: RateLimiter): Promise<void> {
  const now = Date.now();
  const delta = now - limiter.lastRequest;
  if (delta < limiter.intervalMs) {
    await new Promise<void>((res) => setTimeout(res, limiter.intervalMs - delta));
  }
  limiter.lastRequest = Date.now();
}

function cacheDir(): string {
  const xdg = process.env["XDG_CACHE_HOME"];
  const base = xdg && xdg.length > 0 ? xdg : path.join(os.homedir(), ".cache");
  return path.join(base, "grobid-js", "metadata");
}

function cachePath(kind: "arxiv" | "doi", id: string): string {
  // Hash-flatten the ID so DOIs with `/` and `.` characters don't blow up
  // the filesystem layout.
  const safe = id.replace(/[^A-Za-z0-9._-]/g, "_");
  return path.join(cacheDir(), `${kind}-${safe}.json`);
}

function readCache(file: string): CanonicalMetadata | null {
  try {
    if (!existsSync(file)) return null;
    const raw = readFileSync(file, "utf-8");
    return JSON.parse(raw) as CanonicalMetadata;
  } catch {
    return null;
  }
}

function writeCache(file: string, value: CanonicalMetadata): void {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(value, null, 2), "utf-8");
  } catch {
    // Cache write failures are non-fatal — we'll just refetch next time.
  }
}

/**
 * Fetch with a hard timeout (defaults to 8 s) using AbortController.
 * Returns `null` on timeout, network error, or non-2xx HTTP status.
 */
async function fetchText(url: string, timeoutMs: number = 8000): Promise<string | null> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: {
        // arXiv requests a UA so they can identify well-behaved clients.
        "user-agent":
          "grobid-js/0.x (+https://github.com/anthropics; mailto:noreply@anthropic.com)",
        accept: "application/atom+xml, application/json, */*",
      },
    });
    if (!res.ok) {
      LOGGER.warn(`Fallback HTTP ${res.status} for ${url}`);
      return null;
    }
    return await res.text();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    LOGGER.warn(`Fallback HTTP failed for ${url}: ${msg}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* ─────────────────────────── arXiv adapter ────────────────────────────── */

export async function fetchArxivMetadata(id: string): Promise<CanonicalMetadata | null> {
  const cache = cachePath("arxiv", id);
  const cached = readCache(cache);
  if (cached !== null) return cached;
  await rateLimit(arxivRate);
  const url = `http://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`;
  const xml = await fetchText(url);
  if (xml === null) return null;
  const parsed = parseArxivAtom(xml);
  if (parsed === null) return null;
  writeCache(cache, parsed);
  return parsed;
}

/**
 * Lightweight Atom parser. We deliberately avoid pulling in a runtime XML
 * dep: the arXiv response shape is fixed enough (single `<entry>` with
 * `<title>`, `<summary>`, `<author><name>…`, and `<arxiv:primary_category
 * term="…"/>`) that a targeted regex pass is fast and has zero dependencies.
 */
function parseArxivAtom(xml: string): CanonicalMetadata | null {
  // Locate the first <entry> — the arXiv API wraps each lookup result in one
  // entry per matched ID.
  const entryStart = xml.indexOf("<entry>");
  if (entryStart < 0) return null;
  const entryEnd = xml.indexOf("</entry>", entryStart);
  const entry = entryEnd > entryStart ? xml.slice(entryStart, entryEnd) : xml.slice(entryStart);

  const title = normaliseWhitespace(stripTags(extractTagText(entry, "title") ?? ""));
  const summary = normaliseWhitespace(stripTags(extractTagText(entry, "summary") ?? ""));
  const category =
    extractAttr(entry, "arxiv:primary_category", "term") ??
    extractAttr(entry, "primary_category", "term");
  const doiMatch = /<arxiv:doi[^>]*>([^<]+)<\/arxiv:doi>/i.exec(entry);
  const doi = doiMatch && doiMatch[1] ? doiMatch[1].trim() : null;

  const authors: Array<{ forename: string; surname: string }> = [];
  const authorRe = /<author[^>]*>([\s\S]*?)<\/author>/gi;
  let am: RegExpExecArray | null;
  while ((am = authorRe.exec(entry)) !== null) {
    const inner = am[1] ?? "";
    const nameRaw = stripTags(extractTagText(inner, "name") ?? "").trim();
    if (nameRaw.length === 0) continue;
    authors.push(splitAuthorName(nameRaw));
  }

  // Reject responses with neither a title nor a summary — they're useless.
  if (title === null && summary === null) return null;

  return {
    source: "arxiv",
    title,
    authors,
    abstract: summary,
    primaryCategory: category,
    doi,
  };
}

/** Extract the inner text of the first matching tag (namespace-agnostic). */
function extractTagText(xml: string, tagName: string): string | null {
  // `(?:[a-zA-Z]+:)?` allows namespace prefixes like `arxiv:` to match
  // `tagName="primary_category"` against `<arxiv:primary_category>`.
  const re = new RegExp(
    `<(?:[a-zA-Z]+:)?${escapeRegex(tagName)}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[a-zA-Z]+:)?${escapeRegex(tagName)}>`,
    "i",
  );
  const m = re.exec(xml);
  if (m === null) return null;
  return m[1] ?? null;
}

/** Extract the value of an attribute on the first self-closing-or-opening tag. */
function extractAttr(xml: string, tagName: string, attrName: string): string | null {
  const re = new RegExp(
    `<${escapeRegex(tagName)}(?:\\s[^>]*)?\\s${escapeRegex(attrName)}="([^"]*)"`,
    "i",
  );
  const m = re.exec(xml);
  if (m === null) return null;
  return m[1] ?? null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "");
}

function normaliseWhitespace(s: string): string | null {
  const collapsed = s.replace(/\s+/g, " ").trim();
  return collapsed.length === 0 ? null : collapsed;
}

/**
 * Split an arXiv "Firstname Middle Lastname" string into a `{forename, surname}`
 * pair. Multi-word surnames (e.g. `van der Burg`) are kept together; the
 * heuristic is "last whitespace-delimited token is the surname unless a
 * connective particle (de/del/della/van/von/der/...) appears earlier".
 */
function splitAuthorName(raw: string): { forename: string; surname: string } {
  // Normalize odd whitespace and trailing commas/periods.
  const cleaned = raw.replace(/\s+/g, " ").trim().replace(/[.,]+$/, "");
  if (cleaned.length === 0) return { forename: "", surname: "" };
  // arXiv often returns "Lastname, Firstname Middle" — detect and flip.
  if (cleaned.includes(",")) {
    const parts = cleaned.split(",").map((p) => p.trim());
    const last = parts[0] ?? "";
    const fore = parts.slice(1).join(" ").trim();
    return { forename: fore, surname: last };
  }
  const parts = cleaned.split(" ");
  if (parts.length === 1) return { forename: "", surname: parts[0]! };
  const connectives = new Set([
    "de",
    "del",
    "della",
    "di",
    "da",
    "do",
    "dos",
    "du",
    "van",
    "von",
    "der",
    "den",
    "ten",
    "ter",
    "la",
    "le",
    "les",
    "el",
    "al",
    "bin",
    "ibn",
  ]);
  // Look for a connective particle: if found, the surname starts there.
  for (let i = 1; i < parts.length - 1; i++) {
    if (connectives.has(parts[i]!.toLowerCase())) {
      return {
        forename: parts.slice(0, i).join(" "),
        surname: parts.slice(i).join(" "),
      };
    }
  }
  return {
    forename: parts.slice(0, -1).join(" "),
    surname: parts[parts.length - 1]!,
  };
}

/* ────────────────────────── CrossRef adapter ──────────────────────────── */

export async function fetchCrossrefMetadata(doi: string): Promise<CanonicalMetadata | null> {
  const cache = cachePath("doi", doi);
  const cached = readCache(cache);
  if (cached !== null) return cached;
  await rateLimit(crossrefRate);
  const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}`;
  const body = await fetchText(url);
  if (body === null) return null;
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return null;
  }
  const parsed = parseCrossrefJson(json);
  if (parsed === null) return null;
  writeCache(cache, parsed);
  return parsed;
}

function parseCrossrefJson(json: unknown): CanonicalMetadata | null {
  if (!isPlainObject(json)) return null;
  const message = (json as { message?: unknown }).message;
  if (!isPlainObject(message)) return null;
  const msg = message as Record<string, unknown>;
  const titleArr = msg["title"];
  const title =
    Array.isArray(titleArr) && typeof titleArr[0] === "string"
      ? normaliseWhitespace(titleArr[0])
      : null;
  const abstractRaw =
    typeof msg["abstract"] === "string" ? (msg["abstract"] as string) : null;
  const abstractText =
    abstractRaw !== null ? normaliseWhitespace(stripTags(abstractRaw)) : null;
  const containerArr = msg["container-title"];
  const container =
    Array.isArray(containerArr) && typeof containerArr[0] === "string"
      ? (containerArr[0] as string)
      : null;
  const doiVal = typeof msg["DOI"] === "string" ? (msg["DOI"] as string) : null;

  const authors: Array<{ forename: string; surname: string }> = [];
  const arr = msg["author"];
  if (Array.isArray(arr)) {
    for (const a of arr) {
      if (!isPlainObject(a)) continue;
      const given =
        typeof (a as { given?: unknown }).given === "string" ? (a as { given: string }).given : "";
      const family =
        typeof (a as { family?: unknown }).family === "string"
          ? (a as { family: string }).family
          : "";
      if (family.length === 0 && given.length === 0) continue;
      authors.push({ forename: given, surname: family });
    }
  }
  if (title === null && abstractText === null && authors.length === 0) return null;
  return {
    source: "crossref",
    title,
    authors,
    abstract: abstractText,
    primaryCategory: container,
    doi: doiVal,
  };
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/* ─────────────────────────── TEI rewriting ────────────────────────────── */

/**
 * Apply the canonical metadata to the TEI string. Only fields that meaningfully
 * differ from the CRF output get rewritten — for example, if the CRF title
 * already exactly matches the arXiv title, we leave the `coords="…"` attribute
 * untouched so PDF-coordinate lookups in the consuming application still work.
 *
 * Element-level surgery rather than DOM replacement: this preserves all the
 * surrounding TEI structure (namespaces, attribute ordering, indentation) and
 * keeps the patch minimal.
 */
function rewriteTei(tei: string, meta: CanonicalMetadata): string {
  let out = tei;
  // The `<teiHeader>` block is where titleStmt / author / abstract live. We
  // restrict every replacement to that slice to avoid touching, e.g., a
  // reference's `<title>` inside the body's `<listBibl>`.
  const headerEnd = out.indexOf("</teiHeader>");
  if (headerEnd < 0) return out;
  let header = out.slice(0, headerEnd);
  const tail = out.slice(headerEnd);

  if (meta.title !== null) header = maybeReplaceTitle(header, meta.title);
  if (meta.abstract !== null) header = maybeReplaceAbstract(header, meta.abstract);
  if (meta.authors.length > 0) header = maybeReplaceAuthors(header, meta.authors);

  out = header + tail;
  return out;
}

/**
 * Replace the title only if the CRF title is empty, much shorter than the
 * canonical title, or differs by more than a trivial whitespace / casing tweak.
 * Otherwise leave it alone — the CRF title already carries `coords="…"` which
 * is useful for downstream tooling.
 */
function maybeReplaceTitle(header: string, canonical: string): string {
  // The "main" title appears twice in upstream TEIs: once inside
  // `<titleStmt><title>` and once inside `<sourceDesc><analytic><title>`.
  // We rewrite BOTH so they stay consistent.
  const titleStmt = /<titleStmt>([\s\S]*?)<\/titleStmt>/;
  const tsMatch = titleStmt.exec(header);
  if (tsMatch === null) return header;
  const innerStart = tsMatch.index + "<titleStmt>".length;
  const innerEnd = tsMatch.index + tsMatch[0].length - "</titleStmt>".length;
  const inner = tsMatch[1] ?? "";
  const crf = extractFirstTitleText(inner);
  if (!shouldReplaceText(crf, canonical)) return header;
  const newInner = replaceFirstTitleInner(inner, canonical);
  const updated = header.slice(0, innerStart) + newInner + header.slice(innerEnd);
  // Also patch the analytic title (which appears between `<analytic>` and `</analytic>`).
  return patchAnalyticTitle(updated, canonical);
}

function extractFirstTitleText(xml: string): string | null {
  const m = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(xml);
  if (m === null) return null;
  return stripTags(m[1] ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Replace the inner text of the first `<title …>...</title>` in `xml`. The
 * `coords="…"` attribute is stripped because the canonical title no longer
 * corresponds to the original PDF token layout.
 */
function replaceFirstTitleInner(xml: string, newText: string): string {
  return xml.replace(
    /<title(\b[^>]*)>([\s\S]*?)<\/title>/i,
    (_, attrs: string) => {
      const cleanedAttrs = stripCoordsAttr(attrs);
      return `<title${cleanedAttrs}>${escapeXmlText(newText)}</title>`;
    },
  );
}

function patchAnalyticTitle(header: string, newText: string): string {
  return header.replace(
    /(<analytic>[\s\S]*?)<title(\b[^>]*)>([\s\S]*?)<\/title>/,
    (_, before: string, attrs: string) => {
      const cleanedAttrs = stripCoordsAttr(attrs);
      return `${before}<title${cleanedAttrs}>${escapeXmlText(newText)}</title>`;
    },
  );
}

function stripCoordsAttr(attrs: string): string {
  return attrs.replace(/\s+coords="[^"]*"/i, "");
}

function escapeXmlText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Whether canonical strictly improves on the CRF text. */
function shouldReplaceText(crf: string | null, canonical: string): boolean {
  if (crf === null || crf.length === 0) return true;
  const crfNorm = crf.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
  const canNorm = canonical.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
  if (crfNorm === canNorm) return false;
  // If the CRF version is < 80% as long, replace.
  if (crfNorm.length < canNorm.length * 0.8) return true;
  // Otherwise, if normalized texts differ by more than 10% (rough Jaccard),
  // replace.
  const aTokens = new Set(crfNorm.split(/\s+/));
  const bTokens = new Set(canNorm.split(/\s+/));
  const inter = new Set<string>();
  for (const t of aTokens) if (bTokens.has(t)) inter.add(t);
  const uni = aTokens.size + bTokens.size - inter.size;
  const jaccard = uni === 0 ? 1 : inter.size / uni;
  return jaccard < 0.9;
}

/**
 * Replace the abstract paragraph's inner text. We keep the wrapping
 * `<abstract>` element and its single child `<div xmlns="…"><p …>…</p></div>`
 * but overwrite the `<p>` content. This loses paragraph coords but preserves
 * the namespace decl GROBID emits.
 */
function maybeReplaceAbstract(header: string, canonical: string): string {
  const m = /<abstract>([\s\S]*?)<\/abstract>/i.exec(header);
  if (m === null) {
    // No abstract emitted by the CRF — inject one after `<profileDesc>` opening.
    const inject = `<abstract>\n<div xmlns="http://www.tei-c.org/ns/1.0"><p>${escapeXmlText(canonical)}</p></div>\n\t\t\t</abstract>`;
    return header.replace(/<profileDesc>/i, `<profileDesc>\n\t\t\t${inject}`);
  }
  const crf = stripTags(m[1] ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!shouldReplaceText(crf.length > 0 ? crf : null, canonical)) return header;
  const newBody = `\n<div xmlns="http://www.tei-c.org/ns/1.0"><p>${escapeXmlText(canonical)}</p></div>\n\t\t\t`;
  return (
    header.slice(0, m.index) +
    "<abstract>" +
    newBody +
    "</abstract>" +
    header.slice(m.index + m[0].length)
  );
}

/**
 * Replace the `<author>` list inside `<analytic>` with the canonical author
 * order. We ONLY replace if:
 *   - the CRF emitted zero authors, OR
 *   - the CRF emitted a meaningfully different count (off by >1), OR
 *   - the surname sets disagree on > 30% of entries.
 *
 * Otherwise we keep the CRF output, which carries affiliations / emails the
 * arXiv API doesn't supply.
 */
function maybeReplaceAuthors(
  header: string,
  canonical: Array<{ forename: string; surname: string }>,
): string {
  const analyticRe = /<analytic>([\s\S]*?)<\/analytic>/i;
  const am = analyticRe.exec(header);
  if (am === null) return header;
  const analytic = am[1] ?? "";
  const crfSurnames = extractCrfSurnames(analytic);
  const canSurnames = canonical.map((a) => normaliseSurname(a.surname));
  if (!shouldReplaceAuthors(crfSurnames, canSurnames)) return header;
  // Drop ALL existing `<author …>…</author>` blocks and replace them with
  // synthesised ones positioned BEFORE the `<title>` element that closes the
  // `<analytic>` block. We do not synthesise affiliation entries — the arXiv
  // API doesn't carry them in a parseable form.
  const withoutAuthors = analytic.replace(/<author\b[\s\S]*?<\/author>\s*/gi, "");
  const newAuthors = canonical.map((a) => synthesiseAuthor(a)).join("\n\t\t\t\t\t\t");
  // Inject before `<title` inside `<analytic>`. If there's no title, prepend.
  const injected = /<title\b/.test(withoutAuthors)
    ? withoutAuthors.replace(/<title\b/, `${newAuthors}\n\t\t\t\t\t\t<title`)
    : `${newAuthors}\n${withoutAuthors}`;
  return (
    header.slice(0, am.index) +
    "<analytic>" +
    injected +
    "</analytic>" +
    header.slice(am.index + am[0].length)
  );
}

function extractCrfSurnames(analytic: string): string[] {
  const surnames: string[] = [];
  const re = /<author\b[\s\S]*?<surname>([\s\S]*?)<\/surname>[\s\S]*?<\/author>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(analytic)) !== null) {
    if (m[1]) surnames.push(normaliseSurname(stripTags(m[1])));
  }
  return surnames;
}

function normaliseSurname(s: string): string {
  return s.toLowerCase().replace(/[^a-z]/g, "");
}

function shouldReplaceAuthors(crf: string[], canonical: string[]): boolean {
  if (canonical.length === 0) return false;
  if (crf.length === 0) return true;
  if (Math.abs(crf.length - canonical.length) > 1) return true;
  const crfSet = new Set(crf);
  let agree = 0;
  for (const c of canonical) if (crfSet.has(c)) agree++;
  const ratio = agree / canonical.length;
  return ratio < 0.7;
}

function synthesiseAuthor(a: { forename: string; surname: string }): string {
  // We split the forename into <forename type="first"> + zero or more
  // <forename type="middle">. The shape mirrors what TEIFormatter emits.
  const forenameParts = a.forename.split(/\s+/).filter((s) => s.length > 0);
  let fragments = "";
  if (forenameParts.length > 0) {
    fragments += `<forename type="first">${escapeXmlText(forenameParts[0]!)}</forename>`;
    for (let i = 1; i < forenameParts.length; i++) {
      fragments += `<forename type="middle">${escapeXmlText(forenameParts[i]!)}</forename>`;
    }
  }
  if (a.surname.length > 0) {
    fragments += `<surname>${escapeXmlText(a.surname)}</surname>`;
  }
  return `<author>\n\t\t\t\t\t\t\t<persName>${fragments}</persName>\n\t\t\t\t\t\t</author>`;
}
