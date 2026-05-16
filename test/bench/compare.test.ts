// TEI vs TEI comparator. For each paper in fixtures/corpus/, load the
// grobid-js output (fixtures/corpus/grobid-js/) and the upstream output
// (fixtures/corpus/upstream/) and score four dimensions:
//
//   1. Header  — title / authors / affiliations / abstract presence & match
//   2. Section hierarchy — head texts and depth
//   3. Citation markers + linkage — bibr count, resolution rate, biblStruct linkage
//   4. References — per-field accuracy on matched pairs (first-author fuzzy)
//   5. Figures + tables — count + caption match
//   6. Coords — presence on emitted body elements
//
// Upstream is treated as the reference. This is not absolute ground truth
// (upstream itself has errors), but it's the standard we're shooting for.

import { describe, it } from "vitest";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { XMLParser } from "fast-xml-parser";

const here = path.dirname(fileURLToPath(import.meta.url));
const corpusDir = path.resolve(here, "../../fixtures/corpus");
const grobidJsDir = path.join(corpusDir, "grobid-js");
const upstreamDir = path.join(corpusDir, "upstream");
const reportPath = path.join(here, "bench-report.md");

const haveBoth =
  existsSync(grobidJsDir) &&
  existsSync(upstreamDir) &&
  readdirSync(grobidJsDir).some((f) => f.endsWith(".tei.xml")) &&
  readdirSync(upstreamDir).some((f) => f.endsWith(".tei.xml"));
const skipIfMissing = haveBoth ? describe : describe.skip;

// fast-xml-parser config. We turn off attribute-name prefix so attrs are
// just keys alongside child elements; #text holds inline text.
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  textNodeName: "#text",
  trimValues: true,
  parseAttributeValue: false,
  parseTagValue: false,
  alwaysCreateTextNode: false,
  removeNSPrefix: true,
});

type Node = Record<string, unknown>;

// Generic walker that yields every element with the given tag name, depth-
// first. fast-xml-parser flattens to arrays-or-objects, so we handle both.
function* walk(node: unknown, tag: string): Generator<Node> {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) yield* walk(child, tag);
    return;
  }
  const obj = node as Node;
  for (const [key, val] of Object.entries(obj)) {
    if (key === tag) {
      if (Array.isArray(val)) for (const v of val) yield v as Node;
      else yield val as Node;
    }
    if (typeof val === "object" && val !== null) yield* walk(val, tag);
  }
}

function textOf(node: unknown): string {
  if (node === null || node === undefined) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number" || typeof node === "boolean") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(" ");
  const obj = node as Node;
  let out = "";
  for (const [key, val] of Object.entries(obj)) {
    if (key.startsWith("@")) continue;
    if (key === "#text") out += " " + textOf(val);
    else out += " " + textOf(val);
  }
  return out;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

function tokens(s: string): Set<string> {
  return new Set(norm(s).split(" ").filter((t) => t.length > 1));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

function levenshteinRatio(a: string, b: string): number {
  a = norm(a);
  b = norm(b);
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const m = a.length;
  const n = b.length;
  const dp: number[] = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const cur = dp[j]!;
      if (a[i - 1] === b[j - 1]) dp[j] = prev;
      else dp[j] = 1 + Math.min(prev, dp[j]!, dp[j - 1]!);
      prev = cur;
    }
  }
  return 1 - dp[n]! / Math.max(m, n);
}

// ---------- Extraction ----------

interface Header {
  title: string;
  authors: { surname: string; forename: string }[];
  affiliations: string[];
  abstract: string;
  date: string;
}

function extractHeader(tei: Node): Header {
  const titleNode = [...walk(tei, "titleStmt")][0];
  const title = titleNode ? textOf((titleNode as Node)["title"]).trim() : "";
  const sourceDesc = [...walk(tei, "sourceDesc")][0];
  const authors: { surname: string; forename: string }[] = [];
  const affiliationsSet = new Set<string>();
  if (sourceDesc) {
    const analytic = [...walk(sourceDesc as Node, "analytic")][0];
    if (analytic) {
      const auNodes = [...walk(analytic as Node, "author")];
      for (const au of auNodes) {
        const persName = [...walk(au, "persName")][0];
        const surname = persName ? textOf((persName as Node)["surname"]).trim() : "";
        const forename = persName ? textOf((persName as Node)["forename"]).trim() : "";
        if (surname || forename) authors.push({ surname, forename });
        for (const aff of walk(au, "affiliation")) {
          const orgs = [...walk(aff, "orgName")].map((o) => textOf(o).trim()).filter(Boolean);
          for (const o of orgs) affiliationsSet.add(o);
        }
      }
    }
  }
  const profileDesc = [...walk(tei, "profileDesc")][0];
  let abstract = "";
  if (profileDesc) {
    const ab = [...walk(profileDesc as Node, "abstract")][0];
    if (ab) abstract = textOf(ab).replace(/\s+/g, " ").trim();
  }
  const dateNodes = [...walk(tei, "date")];
  const date = dateNodes.length > 0 ? String((dateNodes[0] as Node)["@when"] ?? textOf(dateNodes[0])).trim() : "";
  return { title, authors, affiliations: [...affiliationsSet], abstract, date };
}

interface Head {
  text: string;
  n: string;
}

function extractHeads(tei: Node): Head[] {
  const body = [...walk(tei, "body")][0];
  if (!body) return [];
  const out: Head[] = [];
  for (const h of walk(body as Node, "head")) {
    const text = textOf(h).trim();
    if (!text) continue;
    out.push({ text, n: String((h as Node)["@n"] ?? "") });
  }
  return out;
}

interface CitationMarker {
  text: string;
  target: string;
}

function extractCitationMarkers(tei: Node): CitationMarker[] {
  const body = [...walk(tei, "body")][0];
  if (!body) return [];
  const out: CitationMarker[] = [];
  for (const r of walk(body as Node, "ref")) {
    const type = String((r as Node)["@type"] ?? "");
    if (type !== "bibr") continue;
    const target = String((r as Node)["@target"] ?? "");
    out.push({ text: textOf(r).trim(), target });
  }
  return out;
}

interface BiblRef {
  id: string;
  authors: { surname: string }[];
  title: string;
  year: string;
  journal: string;
  doi: string;
  volume: string;
  pageFrom: string;
  pageTo: string;
}

function extractReferences(tei: Node): BiblRef[] {
  const back = [...walk(tei, "back")][0];
  if (!back) return [];
  const refs: BiblRef[] = [];
  for (const b of walk(back as Node, "biblStruct")) {
    const id = String((b as Node)["@xml:id"] ?? (b as Node)["@id"] ?? "");
    // analytic title is the paper title; monogr/title level=j is journal,
    // level=m is book/proceedings title.
    let title = "";
    const analytic = [...walk(b, "analytic")][0];
    if (analytic) {
      const t = [...walk(analytic as Node, "title")][0];
      if (t) title = textOf(t).trim();
    }
    let journal = "";
    const monogr = [...walk(b, "monogr")][0];
    if (monogr) {
      if (!title) {
        // No analytic — title may live in monogr (book / report style).
        const t = [...walk(monogr as Node, "title")][0];
        if (t) title = textOf(t).trim();
      }
      // Find a journal-level title in monogr.
      for (const t of walk(monogr as Node, "title")) {
        const lvl = String((t as Node)["@level"] ?? "");
        if (lvl === "j" || lvl === "m") {
          const text = textOf(t).trim();
          if (text && text !== title) { journal = text; break; }
        }
      }
    }
    // Authors — only collect from analytic if present, else from monogr.
    const auNodes = analytic
      ? [...walk(analytic as Node, "author")]
      : monogr ? [...walk(monogr as Node, "author")] : [];
    const authors = auNodes.map((au) => {
      const persName = [...walk(au, "persName")][0];
      const surname = persName ? textOf((persName as Node)["surname"]).trim() : "";
      return { surname };
    }).filter((a) => a.surname);
    // Year: imprint/date[@when] or text.
    let year = "";
    for (const d of walk(b, "date")) {
      const when = String((d as Node)["@when"] ?? "");
      if (when) { year = when.slice(0, 4); break; }
      const txt = textOf(d).trim();
      const m = txt.match(/\b(19|20)\d{2}\b/);
      if (m) { year = m[0]; break; }
    }
    // DOI: idno[@type=DOI].
    let doi = "";
    for (const idno of walk(b, "idno")) {
      const t = String((idno as Node)["@type"] ?? "").toLowerCase();
      if (t === "doi") { doi = textOf(idno).trim(); break; }
    }
    // Volume + pages.
    let volume = "";
    let pageFrom = "";
    let pageTo = "";
    for (const bs of walk(b, "biblScope")) {
      const unit = String((bs as Node)["@unit"] ?? "");
      if (unit === "volume") volume = textOf(bs).trim();
      if (unit === "page") {
        pageFrom = String((bs as Node)["@from"] ?? "");
        pageTo = String((bs as Node)["@to"] ?? "");
        if (!pageFrom) {
          const t = textOf(bs).trim();
          const m = t.match(/(\d+)(?:[-–](\d+))?/);
          if (m) { pageFrom = m[1] ?? ""; pageTo = m[2] ?? ""; }
        }
      }
    }
    refs.push({ id, authors, title, year, journal, doi, volume, pageFrom, pageTo });
  }
  return refs;
}

interface FigureLike {
  type: "figure" | "table";
  caption: string;
  hasCoords: boolean;
}

function extractFigures(tei: Node): FigureLike[] {
  const body = [...walk(tei, "body")][0];
  if (!body) return [];
  const out: FigureLike[] = [];
  for (const f of walk(body as Node, "figure")) {
    const type = String((f as Node)["@type"] ?? "") === "table" ? "table" : "figure";
    const headTxt = [...walk(f, "head")].map((h) => textOf(h)).join(" ");
    const figDescTxt = [...walk(f, "figDesc")].map((h) => textOf(h)).join(" ");
    const caption = (headTxt + " " + figDescTxt).replace(/\s+/g, " ").trim();
    const hasCoords = !!(f as Node)["@coords"];
    out.push({ type, caption, hasCoords });
  }
  return out;
}

function countElementsWithCoords(tei: Node, tag: string): { total: number; withCoords: number } {
  const body = [...walk(tei, "body")][0];
  if (!body) return { total: 0, withCoords: 0 };
  let total = 0;
  let withCoords = 0;
  for (const el of walk(body as Node, tag)) {
    total++;
    if ((el as Node)["@coords"]) withCoords++;
  }
  return { total, withCoords };
}

// ---------- Scoring ----------

interface PaperReport {
  paper: string;
  header: {
    titleSim: number;
    authorsUpstream: number;
    authorsGrobidJs: number;
    authorMatchRate: number;
    affiliationsUpstream: number;
    affiliationsGrobidJs: number;
    affiliationMatchRate: number;
    abstractSim: number;
  };
  hierarchy: {
    headsUpstream: number;
    headsGrobidJs: number;
    headMatchRate: number;
  };
  markers: {
    upstream: number;
    grobidJs: number;
    resolvedUpstream: number;
    resolvedGrobidJs: number;
    validLinkUpstream: number;
    validLinkGrobidJs: number;
  };
  references: {
    upstream: number;
    grobidJs: number;
    matched: number;
    titleAvgSim: number;
    fieldHitRates: {
      author: { upstream: number; grobidJs: number };
      title: { upstream: number; grobidJs: number };
      year: { upstream: number; grobidJs: number };
      journal: { upstream: number; grobidJs: number };
      doi: { upstream: number; grobidJs: number };
      volume: { upstream: number; grobidJs: number };
      pages: { upstream: number; grobidJs: number };
    };
  };
  figures: {
    upstreamFigures: number;
    grobidJsFigures: number;
    upstreamTables: number;
    grobidJsTables: number;
    captionMatchRate: number;
  };
  coords: {
    p: { upstream: number; grobidJs: number; upstreamPct: number; grobidJsPct: number };
    head: { upstream: number; grobidJs: number; upstreamPct: number; grobidJsPct: number };
    ref: { upstream: number; grobidJs: number; upstreamPct: number; grobidJsPct: number };
    figure: { upstream: number; grobidJs: number; upstreamPct: number; grobidJsPct: number };
  };
}

function scorePaper(name: string, gjTei: Node, upTei: Node): PaperReport {
  // ---- Header
  const gjH = extractHeader(gjTei);
  const upH = extractHeader(upTei);
  const titleSim = levenshteinRatio(gjH.title, upH.title);
  // Author match: by surname, set intersection over upstream count.
  const gjSur = new Set(gjH.authors.map((a) => norm(a.surname)).filter(Boolean));
  const upSur = new Set(upH.authors.map((a) => norm(a.surname)).filter(Boolean));
  let surInter = 0;
  for (const s of gjSur) if (upSur.has(s)) surInter++;
  const authorMatchRate = upSur.size > 0 ? surInter / upSur.size : 0;
  // Affiliation match: token-jaccard against best upstream affiliation.
  let affHits = 0;
  for (const a of gjH.affiliations) {
    const at = tokens(a);
    let best = 0;
    for (const b of upH.affiliations) best = Math.max(best, jaccard(at, tokens(b)));
    if (best >= 0.5) affHits++;
  }
  const affiliationMatchRate = upH.affiliations.length > 0
    ? affHits / upH.affiliations.length
    : (gjH.affiliations.length === 0 ? 1 : 0);
  // Abstract: token-jaccard.
  const abstractSim = jaccard(tokens(gjH.abstract), tokens(upH.abstract));

  // ---- Heads (section hierarchy)
  const gjHeads = extractHeads(gjTei);
  const upHeads = extractHeads(upTei);
  // Match each upstream head to its best grobid-js head by title similarity ≥0.7.
  const usedGj = new Set<number>();
  let headHits = 0;
  for (const up of upHeads) {
    let bestIdx = -1;
    let bestSim = 0;
    for (let i = 0; i < gjHeads.length; i++) {
      if (usedGj.has(i)) continue;
      const sim = levenshteinRatio(up.text, gjHeads[i]!.text);
      if (sim > bestSim) { bestSim = sim; bestIdx = i; }
    }
    if (bestIdx >= 0 && bestSim >= 0.7) { headHits++; usedGj.add(bestIdx); }
  }
  const headMatchRate = upHeads.length > 0 ? headHits / upHeads.length : 0;

  // ---- Citation markers
  const gjM = extractCitationMarkers(gjTei);
  const upM = extractCitationMarkers(upTei);
  const gjRefIds = new Set(extractReferences(gjTei).map((r) => r.id));
  const upRefIds = new Set(extractReferences(upTei).map((r) => r.id));
  const validLink = (markers: CitationMarker[], refIds: Set<string>): number => {
    let n = 0;
    for (const m of markers) {
      if (!m.target) continue;
      const id = m.target.replace(/^#/, "");
      if (refIds.has(id)) n++;
    }
    return n;
  };
  const resolvedUp = upM.filter((m) => m.target).length;
  const resolvedGj = gjM.filter((m) => m.target).length;

  // ---- References
  const gjR = extractReferences(gjTei);
  const upR = extractReferences(upTei);
  // Greedy matching: for each upstream ref, find best grobid-js ref by
  // composite score = 0.5*title-sim + 0.5*surname-overlap. Require ≥0.4.
  const usedR = new Set<number>();
  type MatchPair = { up: BiblRef; gj: BiblRef; sim: number };
  const matches: MatchPair[] = [];
  for (const up of upR) {
    let bestIdx = -1;
    let bestSim = 0;
    for (let i = 0; i < gjR.length; i++) {
      if (usedR.has(i)) continue;
      const titleSim = levenshteinRatio(up.title, gjR[i]!.title);
      const upSur = new Set(up.authors.map((a) => norm(a.surname)));
      const gjSur = new Set(gjR[i]!.authors.map((a) => norm(a.surname)));
      let surOverlap = 0;
      if (upSur.size > 0) {
        let inter = 0;
        for (const s of upSur) if (gjSur.has(s)) inter++;
        surOverlap = inter / upSur.size;
      }
      const sim = 0.5 * titleSim + 0.5 * surOverlap;
      if (sim > bestSim) { bestSim = sim; bestIdx = i; }
    }
    if (bestIdx >= 0 && bestSim >= 0.4) {
      matches.push({ up, gj: gjR[bestIdx]!, sim: bestSim });
      usedR.add(bestIdx);
    }
  }
  const titleAvgSim = matches.length > 0
    ? matches.reduce((s, m) => s + levenshteinRatio(m.up.title, m.gj.title), 0) / matches.length
    : 0;
  const fieldHit = (pick: (r: BiblRef) => string) => {
    let up = 0, gj = 0;
    for (const r of upR) if (pick(r)) up++;
    for (const r of gjR) if (pick(r)) gj++;
    return { upstream: up / Math.max(upR.length, 1), grobidJs: gj / Math.max(gjR.length, 1) };
  };

  // ---- Figures + tables
  const gjF = extractFigures(gjTei);
  const upF = extractFigures(upTei);
  const upFigures = upF.filter((f) => f.type === "figure");
  const gjFigures = gjF.filter((f) => f.type === "figure");
  const upTables = upF.filter((f) => f.type === "table");
  const gjTables = gjF.filter((f) => f.type === "table");
  let capHits = 0;
  for (const up of upF) {
    let best = 0;
    for (const gj of gjF) {
      if (gj.type !== up.type) continue;
      best = Math.max(best, jaccard(tokens(up.caption), tokens(gj.caption)));
    }
    if (best >= 0.5) capHits++;
  }
  const captionMatchRate = upF.length > 0 ? capHits / upF.length : 0;

  // ---- Coords
  const tagsToCheck: ("p" | "head" | "ref" | "figure")[] = ["p", "head", "ref", "figure"];
  const coords = {} as PaperReport["coords"];
  for (const t of tagsToCheck) {
    const u = countElementsWithCoords(upTei, t);
    const g = countElementsWithCoords(gjTei, t);
    coords[t] = {
      upstream: u.total,
      grobidJs: g.total,
      upstreamPct: u.total > 0 ? u.withCoords / u.total : 0,
      grobidJsPct: g.total > 0 ? g.withCoords / g.total : 0,
    };
  }

  return {
    paper: name,
    header: {
      titleSim,
      authorsUpstream: upH.authors.length,
      authorsGrobidJs: gjH.authors.length,
      authorMatchRate,
      affiliationsUpstream: upH.affiliations.length,
      affiliationsGrobidJs: gjH.affiliations.length,
      affiliationMatchRate,
      abstractSim,
    },
    hierarchy: {
      headsUpstream: upHeads.length,
      headsGrobidJs: gjHeads.length,
      headMatchRate,
    },
    markers: {
      upstream: upM.length,
      grobidJs: gjM.length,
      resolvedUpstream: resolvedUp,
      resolvedGrobidJs: resolvedGj,
      validLinkUpstream: validLink(upM, upRefIds),
      validLinkGrobidJs: validLink(gjM, gjRefIds),
    },
    references: {
      upstream: upR.length,
      grobidJs: gjR.length,
      matched: matches.length,
      titleAvgSim,
      fieldHitRates: {
        author: fieldHit((r) => (r.authors.length > 0 ? "y" : "")),
        title: fieldHit((r) => r.title),
        year: fieldHit((r) => r.year),
        journal: fieldHit((r) => r.journal),
        doi: fieldHit((r) => r.doi),
        volume: fieldHit((r) => r.volume),
        pages: fieldHit((r) => r.pageFrom),
      },
    },
    figures: {
      upstreamFigures: upFigures.length,
      grobidJsFigures: gjFigures.length,
      upstreamTables: upTables.length,
      grobidJsTables: gjTables.length,
      captionMatchRate,
    },
    coords,
  };
}

skipIfMissing("bench: compare grobid-js vs upstream", () => {
  it("scores each corpus paper and writes a markdown report", () => {
    const pdfs = readdirSync(corpusDir).filter((f) => f.endsWith(".pdf")).sort();
    const reports: PaperReport[] = [];
    for (const pdf of pdfs) {
      const name = pdf.replace(/\.pdf$/i, "");
      const gjPath = path.join(grobidJsDir, `${name}.tei.xml`);
      const upPath = path.join(upstreamDir, `${name}.tei.xml`);
      if (!existsSync(gjPath) || !existsSync(upPath)) {
        // eslint-disable-next-line no-console
        console.warn(`skip ${name}: missing TEI on one side`);
        continue;
      }
      const gj = parser.parse(readFileSync(gjPath, "utf8"));
      const up = parser.parse(readFileSync(upPath, "utf8"));
      reports.push(scorePaper(name, gj, up));
    }
    const md = renderMarkdown(reports);
    writeFileSync(reportPath, md, "utf8");
    // eslint-disable-next-line no-console
    console.log(md);
  });
});

function pct(x: number): string {
  return `${(x * 100).toFixed(0)}%`;
}

function renderMarkdown(reports: PaperReport[]): string {
  const lines: string[] = [];
  lines.push(`# grobid-js vs upstream GROBID 0.9.0-crf — corpus comparison`);
  lines.push(``);
  lines.push(`Corpus: ${reports.length} papers. Upstream is treated as reference.`);
  lines.push(``);
  // ---- Header
  lines.push(`## 1. Header (title / authors / affiliations / abstract)`);
  lines.push(``);
  lines.push(`| Paper | title sim | authors (up/js, match) | affil (up/js, match) | abstract sim |`);
  lines.push(`|---|---|---|---|---|`);
  for (const r of reports) {
    lines.push(`| ${r.paper} | ${pct(r.header.titleSim)} | ${r.header.authorsUpstream}/${r.header.authorsGrobidJs}, ${pct(r.header.authorMatchRate)} | ${r.header.affiliationsUpstream}/${r.header.affiliationsGrobidJs}, ${pct(r.header.affiliationMatchRate)} | ${pct(r.header.abstractSim)} |`);
  }
  const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(xs.length, 1);
  lines.push(`| **avg** | ${pct(avg(reports.map((r) => r.header.titleSim)))} | — , ${pct(avg(reports.map((r) => r.header.authorMatchRate)))} | — , ${pct(avg(reports.map((r) => r.header.affiliationMatchRate)))} | ${pct(avg(reports.map((r) => r.header.abstractSim)))} |`);
  lines.push(``);
  // ---- Hierarchy
  lines.push(`## 2. Section hierarchy (head text match @ ≥0.7 Lev. ratio)`);
  lines.push(``);
  lines.push(`| Paper | heads up | heads js | matched |`);
  lines.push(`|---|---|---|---|`);
  for (const r of reports) {
    lines.push(`| ${r.paper} | ${r.hierarchy.headsUpstream} | ${r.hierarchy.headsGrobidJs} | ${pct(r.hierarchy.headMatchRate)} |`);
  }
  lines.push(`| **avg** | — | — | ${pct(avg(reports.map((r) => r.hierarchy.headMatchRate)))} |`);
  lines.push(``);
  // ---- Markers
  lines.push(`## 3. Citation markers & linkage to <biblStruct>`);
  lines.push(``);
  lines.push(`| Paper | bibr up/js | resolved up/js | valid-link up/js |`);
  lines.push(`|---|---|---|---|`);
  for (const r of reports) {
    lines.push(`| ${r.paper} | ${r.markers.upstream}/${r.markers.grobidJs} | ${r.markers.resolvedUpstream}/${r.markers.resolvedGrobidJs} | ${r.markers.validLinkUpstream}/${r.markers.validLinkGrobidJs} |`);
  }
  const totUp = reports.reduce((s, r) => s + r.markers.upstream, 0);
  const totJs = reports.reduce((s, r) => s + r.markers.grobidJs, 0);
  lines.push(`| **total** | ${totUp}/${totJs} (${pct(totJs / Math.max(totUp, 1))}) | — | — |`);
  lines.push(``);
  // ---- References
  lines.push(`## 4. References — per-field hit rate (fraction of refs with field populated)`);
  lines.push(``);
  lines.push(`| Paper | refs up/js | matched | title sim | auth up/js | title up/js | year up/js | journal up/js | DOI up/js |`);
  lines.push(`|---|---|---|---|---|---|---|---|---|`);
  for (const r of reports) {
    const f = r.references.fieldHitRates;
    lines.push(`| ${r.paper} | ${r.references.upstream}/${r.references.grobidJs} | ${r.references.matched} | ${pct(r.references.titleAvgSim)} | ${pct(f.author.upstream)}/${pct(f.author.grobidJs)} | ${pct(f.title.upstream)}/${pct(f.title.grobidJs)} | ${pct(f.year.upstream)}/${pct(f.year.grobidJs)} | ${pct(f.journal.upstream)}/${pct(f.journal.grobidJs)} | ${pct(f.doi.upstream)}/${pct(f.doi.grobidJs)} |`);
  }
  lines.push(``);
  // ---- Figures
  lines.push(`## 5. Figures + tables`);
  lines.push(``);
  lines.push(`| Paper | figures up/js | tables up/js | caption match |`);
  lines.push(`|---|---|---|---|`);
  for (const r of reports) {
    lines.push(`| ${r.paper} | ${r.figures.upstreamFigures}/${r.figures.grobidJsFigures} | ${r.figures.upstreamTables}/${r.figures.grobidJsTables} | ${pct(r.figures.captionMatchRate)} |`);
  }
  lines.push(`| **avg** | — | — | ${pct(avg(reports.map((r) => r.figures.captionMatchRate)))} |`);
  lines.push(``);
  // ---- Coords
  lines.push(`## 6. Coordinate-attribute coverage on body elements`);
  lines.push(``);
  lines.push(`| Paper | p (up%/js%) | head (up%/js%) | ref (up%/js%) | figure (up%/js%) |`);
  lines.push(`|---|---|---|---|---|`);
  for (const r of reports) {
    const c = r.coords;
    lines.push(`| ${r.paper} | ${pct(c.p.upstreamPct)}/${pct(c.p.grobidJsPct)} | ${pct(c.head.upstreamPct)}/${pct(c.head.grobidJsPct)} | ${pct(c.ref.upstreamPct)}/${pct(c.ref.grobidJsPct)} | ${pct(c.figure.upstreamPct)}/${pct(c.figure.grobidJsPct)} |`);
  }
  lines.push(``);
  return lines.join("\n");
}
