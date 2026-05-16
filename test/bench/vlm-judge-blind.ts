// VLM-as-judge quality scoring harness.
//
// Compares grobid-js TEI and upstream Java GROBID TEI against ground truth
// extracted by Claude (the VLM) directly from each PDF's page 1. Unlike
// compare-external.test.ts, which treats upstream as the reference, this
// harness treats what's actually printed in the PDF as the reference —
// because upstream itself has bugs (extracts intro as abstract, picks up an
// institutional banner as the title, etc.).
//
// Inputs:
//   fixtures/blind-corpus/vlm-truth/paper_NNN.json — VLM-extracted truth
//   fixtures/blind-corpus/upstream/paper_NNN.tei.xml — Java GROBID output
//   fixtures/blind-corpus/grobid-js/paper_NNN.tei.xml — our output
//
// Output: test/bench/vlm-judge-report-blind.md
//
// Re-run with: `npx tsx test/bench/vlm-judge-blind.ts`
// or via vitest by importing main() from the .test.ts wrapper.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { XMLParser } from "fast-xml-parser";

const here = path.dirname(fileURLToPath(import.meta.url));
const corpusDir = path.resolve(here, "../../fixtures/blind-corpus");
const truthDir = path.join(corpusDir, "vlm-truth");
// `GROBID_JS_DIR` env var overrides the grobid-js output directory; useful
// for comparing alternative engine pipelines (e.g. BiLSTM) without
// regenerating the upstream/truth sides. Set `REPORT_SUFFIX` to write the
// report under a different name so multiple runs don't overwrite each other.
const grobidJsDir = process.env.GROBID_JS_DIR
  ? path.resolve(process.env.GROBID_JS_DIR)
  : path.join(corpusDir, "grobid-js");
const upstreamDir = path.join(corpusDir, "upstream");
const reportSuffix = process.env.REPORT_SUFFIX ?? "";
const reportPath = path.join(here, `vlm-judge-report-blind${reportSuffix}.md`);

// ---------- VLM truth schema ----------

interface VlmTruth {
  title: string | null;
  authors: string[] | null;
  affiliations: string[] | null;
  abstract_prefix: string | null;
  note?: string;
}

function loadTruth(paper: string): VlmTruth | null {
  const p = path.join(truthDir, `${paper}.json`);
  if (!existsSync(p)) return null;
  const raw = readFileSync(p, "utf8");
  return JSON.parse(raw) as VlmTruth;
}

// ---------- TEI parsing (mirrors compare-external.test.ts) ----------

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

interface TeiHeader {
  title: string;
  authorSurnames: string[];
  authorNames: string[];
  affiliations: string[];
  abstract: string;
}

function extractTeiHeader(xml: string): TeiHeader {
  const tei = parser.parse(xml) as Node;
  // Title — analytic title preferred, then titleStmt.
  let title = "";
  const sourceDesc = [...walk(tei, "sourceDesc")][0];
  if (sourceDesc) {
    const analytic = [...walk(sourceDesc as Node, "analytic")][0];
    if (analytic) {
      const t = [...walk(analytic as Node, "title")][0];
      if (t) title = textOf(t).trim();
    }
  }
  if (!title) {
    const titleStmt = [...walk(tei, "titleStmt")][0];
    if (titleStmt) {
      const t = [...walk(titleStmt as Node, "title")][0];
      if (t) title = textOf(t).trim();
    }
  }
  // Authors + affiliations.
  const authorSurnames: string[] = [];
  const authorNames: string[] = [];
  const affiliationsSet = new Set<string>();
  if (sourceDesc) {
    const analytic = [...walk(sourceDesc as Node, "analytic")][0];
    if (analytic) {
      for (const au of walk(analytic as Node, "author")) {
        const persName = [...walk(au, "persName")][0];
        if (persName) {
          const sn = textOf((persName as Node)["surname"]).trim();
          const fn = textOf((persName as Node)["forename"]).trim();
          if (sn) authorSurnames.push(sn);
          if (sn || fn) authorNames.push(`${fn} ${sn}`.trim());
        }
        for (const aff of walk(au, "affiliation")) {
          // Prefer raw_affiliation note, else assembled orgName.
          let raw = "";
          for (const note of walk(aff, "note")) {
            const type = String((note as Node)["@type"] ?? "");
            if (type === "raw_affiliation") {
              raw = textOf(note).trim();
              break;
            }
          }
          if (raw) affiliationsSet.add(raw);
          else {
            const orgs = [...walk(aff, "orgName")].map((o) => textOf(o).trim()).filter(Boolean);
            if (orgs.length > 0) affiliationsSet.add(orgs.join(", "));
          }
        }
      }
    }
  }
  // Abstract — text under profileDesc/abstract.
  let abstract = "";
  const profileDesc = [...walk(tei, "profileDesc")][0];
  if (profileDesc) {
    const ab = [...walk(profileDesc as Node, "abstract")][0];
    if (ab) abstract = textOf(ab).replace(/\s+/g, " ").trim();
  }
  return {
    title,
    authorSurnames,
    authorNames,
    affiliations: [...affiliationsSet],
    abstract,
  };
}

// ---------- Normalisation + similarity ----------

function norm(s: string): string {
  // Lowercase; strip diacritics; collapse non-alphanumerics to space.
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9Ѐ-ӿ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
  const na = norm(a);
  const nb = norm(b);
  if (na === nb) return 1;
  if (na.length === 0 || nb.length === 0) return 0;
  const m = na.length;
  const n = nb.length;
  const dp: number[] = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const cur = dp[j]!;
      if (na[i - 1] === nb[j - 1]) dp[j] = prev;
      else dp[j] = 1 + Math.min(prev, dp[j]!, dp[j - 1]!);
      prev = cur;
    }
  }
  return 1 - dp[n]! / Math.max(m, n);
}

// Extract a likely surname from a "First Middle Last" string.
function surnameOf(fullName: string): string {
  const cleaned = fullName.replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
  const parts = cleaned.split(" ").filter(Boolean);
  if (parts.length === 0) return "";
  // Use the last whitespace-separated token as a heuristic. Works for the
  // bulk of Western names; ground-truth files already split on the printed
  // boundary, so for "Mr. Loganathan. R" the surname token ends up as "R" —
  // we handle that by also keeping the second-to-last token as a fallback
  // when the last is very short.
  const last = parts[parts.length - 1]!;
  if (last.length <= 2 && parts.length >= 2) return parts[parts.length - 2]!;
  return last;
}

// ---------- Scoring ----------

interface MetricScore {
  upstream: number;
  grobidJs: number;
}

interface PaperScore {
  paper: string;
  truth: VlmTruth;
  title: MetricScore & { upstreamValue: string; grobidJsValue: string };
  authors: MetricScore & {
    upstreamFound: string[];
    grobidJsFound: string[];
    truthSurnames: string[];
  };
  affiliations: MetricScore;
  abstract: MetricScore;
  hasAbstractTruth: boolean;
}

function scoreTitle(truth: string, candidate: string): number {
  if (!truth) return 1;
  if (!candidate) return 0;
  if (norm(truth) === norm(candidate)) return 1;
  const r = levenshteinRatio(truth, candidate);
  if (r >= 0.85) return 0.5;
  return 0;
}

function scoreAuthors(truthSurnames: string[], teiSurnames: string[]): {
  score: number;
  found: string[];
} {
  if (truthSurnames.length === 0) return { score: 1, found: [] };
  const teiNormSet = new Set(teiSurnames.map(norm).filter(Boolean));
  const found: string[] = [];
  for (const s of truthSurnames) {
    const ns = norm(s);
    if (!ns) continue;
    if (teiNormSet.has(ns)) {
      found.push(s);
      continue;
    }
    // Fuzzy: any TEI surname is a substring of, or contains, the truth surname.
    let matched = false;
    for (const t of teiNormSet) {
      if (t.length < 3 || ns.length < 3) continue;
      if (t === ns || t.includes(ns) || ns.includes(t)) {
        matched = true;
        break;
      }
    }
    if (matched) found.push(s);
  }
  return { score: found.length / truthSurnames.length, found };
}

function scoreAffiliations(truthAff: string[] | null, teiAff: string[]): number {
  if (truthAff === null || truthAff.length === 0) return Number.NaN;
  if (teiAff.length === 0) return 0;
  // Token-overlap per truth affiliation; we score with the best-matching
  // TEI candidate; sum and divide by truth count.
  let total = 0;
  for (const t of truthAff) {
    const tt = tokens(t);
    let best = 0;
    for (const c of teiAff) {
      const j = jaccard(tt, tokens(c));
      if (j > best) best = j;
    }
    total += best;
  }
  return total / truthAff.length;
}

function scoreAbstract(truthPrefix: string | null, teiAbstract: string): number {
  // Sentinel: null truthPrefix or only the literal keyword "ABSTRACT" means
  // there was nothing visible on page 1 (cover sheets, thesis title pages,
  // preprint covers). Skip — not the system's fault.
  if (truthPrefix === null || truthPrefix === "") return Number.NaN;
  if (norm(truthPrefix) === "abstract") return Number.NaN;
  if (!teiAbstract) return 0;
  // Compare token-overlap on the truth prefix vs the start of the TEI
  // abstract that is at least as long as the prefix.
  const prefixLen = Math.max(truthPrefix.length, 80);
  const teiSlice = teiAbstract.slice(0, prefixLen + 80);
  return jaccard(tokens(truthPrefix), tokens(teiSlice));
}

function scorePaper(paper: string, truth: VlmTruth, teiPath: string): {
  title: number;
  titleValue: string;
  authors: { score: number; found: string[] };
  affiliations: number;
  abstract: number;
} {
  const xml = readFileSync(teiPath, "utf8");
  const header = extractTeiHeader(xml);
  const titleScore = truth.title === null ? Number.NaN : scoreTitle(truth.title, header.title);
  const truthSurnames = (truth.authors ?? []).map(surnameOf).filter(Boolean);
  const authors = scoreAuthors(truthSurnames, header.authorSurnames);
  const affs = scoreAffiliations(truth.affiliations, header.affiliations);
  const abs = scoreAbstract(truth.abstract_prefix, header.abstract);
  return {
    title: titleScore,
    titleValue: header.title,
    authors,
    affiliations: affs,
    abstract: abs,
  };
}

// ---------- Driver ----------

function listPapers(): string[] {
  if (!existsSync(truthDir)) return [];
  return readdirSync(truthDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
}

interface WinTallies {
  metric: string;
  grobidJsWins: number;
  upstreamWins: number;
  bothCorrect: number;
  bothWrong: number;
  notApplicable: number;
}

function classify(upstream: number, grobidJs: number, threshold: number): "up" | "js" | "both" | "neither" {
  const upOk = !Number.isNaN(upstream) && upstream >= threshold;
  const jsOk = !Number.isNaN(grobidJs) && grobidJs >= threshold;
  if (upOk && jsOk) return "both";
  if (upOk) return "up";
  if (jsOk) return "js";
  return "neither";
}

interface PerPaperRow {
  paper: string;
  truthTitleHead: string;
  titleUp: number;
  titleJs: number;
  authorsUp: number;
  authorsJs: number;
  affUp: number;
  affJs: number;
  absUp: number;
  absJs: number;
  classTitle: "up" | "js" | "both" | "neither";
  classAuthors: "up" | "js" | "both" | "neither";
  classAff: "up" | "js" | "both" | "neither";
  classAbs: "up" | "js" | "both" | "neither" | "na";
  note?: string;
}

export function runVlmJudge(): { rows: PerPaperRow[]; tallies: Record<string, WinTallies>; ambiguous: { paper: string; note: string }[] } {
  const papers = listPapers();
  const rows: PerPaperRow[] = [];
  const ambiguous: { paper: string; note: string }[] = [];
  for (const paper of papers) {
    const truth = loadTruth(paper);
    if (!truth) continue;
    if (truth.note) ambiguous.push({ paper, note: truth.note });
    const upPath = path.join(upstreamDir, `${paper}.tei.xml`);
    const jsPath = path.join(grobidJsDir, `${paper}.tei.xml`);
    if (!existsSync(upPath) || !existsSync(jsPath)) continue;
    const up = scorePaper(paper, truth, upPath);
    const js = scorePaper(paper, truth, jsPath);
    const row: PerPaperRow = {
      paper,
      truthTitleHead: (truth.title ?? "?").slice(0, 60),
      titleUp: up.title,
      titleJs: js.title,
      authorsUp: up.authors.score,
      authorsJs: js.authors.score,
      affUp: up.affiliations,
      affJs: js.affiliations,
      absUp: up.abstract,
      absJs: js.abstract,
      classTitle: classify(up.title, js.title, 1.0),
      classAuthors: classify(up.authors.score, js.authors.score, 0.99),
      classAff: classify(up.affiliations, js.affiliations, 0.5),
      classAbs: Number.isNaN(up.abstract) && Number.isNaN(js.abstract)
        ? "na"
        : classify(up.abstract, js.abstract, 0.5),
      ...(truth.note ? { note: truth.note } : {}),
    };
    rows.push(row);
  }

  const tallies: Record<string, WinTallies> = {};
  for (const metric of ["title", "authors", "affiliations", "abstract"] as const) {
    const t: WinTallies = {
      metric,
      grobidJsWins: 0,
      upstreamWins: 0,
      bothCorrect: 0,
      bothWrong: 0,
      notApplicable: 0,
    };
    for (const r of rows) {
      const key =
        metric === "title" ? r.classTitle
        : metric === "authors" ? r.classAuthors
        : metric === "affiliations" ? r.classAff
        : r.classAbs;
      if (key === "na") t.notApplicable++;
      else if (key === "both") t.bothCorrect++;
      else if (key === "js") t.grobidJsWins++;
      else if (key === "up") t.upstreamWins++;
      else t.bothWrong++;
    }
    tallies[metric] = t;
  }
  return { rows, tallies, ambiguous };
}

// ---------- Report formatting ----------

function pct(x: number): string {
  if (Number.isNaN(x)) return "—";
  return `${Math.round(x * 100)}%`;
}

function cls(c: "up" | "js" | "both" | "neither" | "na"): string {
  switch (c) {
    case "both": return "tie+";
    case "js": return "js";
    case "up": return "up";
    case "neither": return "tie-";
    case "na": return "—";
  }
}

export function writeReport(): void {
  const { rows, tallies, ambiguous } = runVlmJudge();
  const out: string[] = [];
  out.push("# VLM-as-judge: grobid-js vs upstream GROBID against PDF truth");
  out.push("");
  out.push(
    "Ground truth was extracted by Claude (vision-language model) directly from page 1 of each PDF in `fixtures/blind-corpus/`.",
  );
  out.push(
    `Both TEIs are scored against that truth. ${rows.length} papers scored. Re-run: \`npx tsx test/bench/vlm-judge-blind.ts\`.`,
  );
  out.push("");
  out.push("## Per-paper scores");
  out.push("");
  out.push(
    "| Paper | Truth title (head) | Title up/js | Authors up/js | Affil up/js | Abstract up/js | Title W | Authors W | Affil W | Abstract W |",
  );
  out.push("|---|---|---|---|---|---|---|---|---|---|");
  for (const r of rows) {
    out.push(
      `| ${r.paper} | ${r.truthTitleHead.replace(/\|/g, "/")} | ${pct(r.titleUp)} / ${pct(r.titleJs)} | ${pct(r.authorsUp)} / ${pct(r.authorsJs)} | ${pct(r.affUp)} / ${pct(r.affJs)} | ${pct(r.absUp)} / ${pct(r.absJs)} | ${cls(r.classTitle)} | ${cls(r.classAuthors)} | ${cls(r.classAff)} | ${cls(r.classAbs)} |`,
    );
  }
  out.push("");
  out.push("Legend: `js` = grobid-js wins; `up` = upstream wins; `tie+` = both correct; `tie-` = both wrong; `—` = not applicable.");
  out.push("");
  out.push("## Head-to-head tallies");
  out.push("");
  out.push("| Metric | grobid-js wins | upstream wins | both correct | both wrong | n/a |");
  out.push("|---|---|---|---|---|---|");
  for (const m of ["title", "authors", "affiliations", "abstract"] as const) {
    const t = tallies[m]!;
    out.push(`| ${m} | ${t.grobidJsWins} | ${t.upstreamWins} | ${t.bothCorrect} | ${t.bothWrong} | ${t.notApplicable} |`);
  }
  out.push("");
  out.push("## Ambiguous / noted papers");
  out.push("");
  if (ambiguous.length === 0) out.push("None.");
  else {
    for (const a of ambiguous) out.push(`- ${a.paper}: ${a.note}`);
  }
  out.push("");
  out.push("## Bottom line");
  out.push("");
  const total = rows.length;
  for (const m of ["title", "authors", "affiliations", "abstract"] as const) {
    const t = tallies[m]!;
    out.push(
      `- On ${m}: grobid-js wins ${t.grobidJsWins}, upstream wins ${t.upstreamWins}, both correct ${t.bothCorrect}, both wrong ${t.bothWrong} (out of ${total}, n/a ${t.notApplicable}).`,
    );
  }
  writeFileSync(reportPath, out.join("\n") + "\n", "utf8");
}

// Allow `npx tsx test/bench/vlm-judge-blind.ts` to drive the report directly.
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  writeReport();
  // eslint-disable-next-line no-console
  console.log(`wrote ${reportPath}`);
}
