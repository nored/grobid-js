// Non-Latin script detection helper.
//
// NOTE: This module has NO upstream Java equivalent. GROBID's Java pipeline is
// English/Latin-trained at the CRF level and silently degrades on Cyrillic,
// CJK, Arabic, Greek and similar inputs (garbled author names, polluted
// reference lists). To beat upstream on these papers we detect the dominant
// script of the document text up front via Unicode block ranges, then route
// or annotate accordingly (see `Grobid.nonLatinHandling` in `src/node/grobid.ts`).
//
// Detection is conservative: we tally the script of each non-whitespace
// character in a sample (default ~200 chars), then return whichever script
// has the plurality. We deliberately ignore single-character matches (a Greek
// letter in an otherwise Latin-script formula must not flip the document to
// Greek).
//
// The script vocabulary covers every block we have a credible business reason
// to handle: Latin (the trained baseline), Cyrillic (Russian/Ukrainian/etc.),
// Greek, Arabic, Hebrew, CJK (Chinese/Japanese/Korean unified), Devanagari,
// Thai. The "unknown" sentinel covers documents that are mostly digits,
// punctuation or rare scripts we haven't enumerated.
//
// Anything in the ASCII range — letters, digits, punctuation, whitespace — is
// considered Latin for the purposes of plurality voting; on a mostly-numeric
// page (e.g. a table of figures) the sample falls through to whichever non-
// digit characters happen to be present, which is the right behavior.

import type { LayoutToken } from "../layout/layout-token.js";

/**
 * Script identifiers. Values are stable strings safe to embed in TEI
 * (e.g. `<note type="language" script="cyrillic">`). Lowercase, ASCII,
 * no spaces — matches the `script="..."` convention used by ISO 15924 in
 * lower form (TEI itself permits any token; we don't claim ISO compliance).
 */
export type Script =
  | "latin"
  | "cyrillic"
  | "greek"
  | "arabic"
  | "hebrew"
  | "cjk"
  | "devanagari"
  | "thai"
  | "unknown";

/** All non-Latin scripts we currently recognize. Used by the router. */
export const NON_LATIN_SCRIPTS: ReadonlySet<Script> = new Set<Script>([
  "cyrillic",
  "greek",
  "arabic",
  "hebrew",
  "cjk",
  "devanagari",
  "thai",
]);

/** Default sample size in non-whitespace characters. */
export const DEFAULT_SAMPLE_SIZE = 200;
/**
 * Minimum number of non-Latin characters we require before we'll classify
 * the document as a non-Latin script. Below this threshold (e.g. one Greek
 * variable in an otherwise-Latin formula), we always fall back to "latin".
 *
 * Tied to DEFAULT_SAMPLE_SIZE: 8 / 200 = 4% of the sample. Lower than that
 * and we treat the non-Latin characters as incidental.
 */
export const MIN_NON_LATIN_COUNT = 8;

/**
 * Classify a single character into its script bucket. Returns "unknown" for
 * code points outside any of the recognized blocks (digits, ASCII punctuation,
 * geometric shapes, math symbols and so on all go here). We classify ASCII
 * letters [A-Za-z] and Latin Extended ranges as `latin`; everything else
 * dispatches via Unicode block range.
 *
 * Whitespace returns "unknown" so callers can simply skip it before sampling.
 */
export function classifyChar(ch: string): Script {
  if (ch.length === 0) return "unknown";
  const code = ch.codePointAt(0);
  if (code === undefined) return "unknown";
  // Whitespace: skip — caller filters this out.
  if (
    code === 0x09 ||
    code === 0x0a ||
    code === 0x0b ||
    code === 0x0c ||
    code === 0x0d ||
    code === 0x20 ||
    code === 0xa0 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000
  ) {
    return "unknown";
  }
  // ── Latin and Latin-extended ─────────────────────────────────────────
  // Basic Latin letters
  if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) return "latin";
  // Latin-1 Supplement letters (À-ÿ minus the punctuation gaps)
  if (code >= 0xc0 && code <= 0xff && code !== 0xd7 && code !== 0xf7) return "latin";
  // Latin Extended-A / B / Additional
  if (code >= 0x0100 && code <= 0x024f) return "latin";
  // Latin Extended Additional
  if (code >= 0x1e00 && code <= 0x1eff) return "latin";
  // ── Greek ─ Greek and Coptic + Greek Extended ────────────────────────
  if (code >= 0x0370 && code <= 0x03ff) return "greek";
  if (code >= 0x1f00 && code <= 0x1fff) return "greek";
  // ── Cyrillic ─ Cyrillic + Supplement + Extended-A/B/C/D ──────────────
  if (code >= 0x0400 && code <= 0x04ff) return "cyrillic";
  if (code >= 0x0500 && code <= 0x052f) return "cyrillic";
  if (code >= 0x2de0 && code <= 0x2dff) return "cyrillic";
  if (code >= 0xa640 && code <= 0xa69f) return "cyrillic";
  if (code >= 0x1c80 && code <= 0x1c8f) return "cyrillic";
  // ── Hebrew + Alphabetic Presentation Forms (Hebrew range) ────────────
  if (code >= 0x0590 && code <= 0x05ff) return "hebrew";
  if (code >= 0xfb1d && code <= 0xfb4f) return "hebrew";
  // ── Arabic + Supplement + Extended-A + Presentation Forms A/B ────────
  if (code >= 0x0600 && code <= 0x06ff) return "arabic";
  if (code >= 0x0750 && code <= 0x077f) return "arabic";
  if (code >= 0x08a0 && code <= 0x08ff) return "arabic";
  if (code >= 0xfb50 && code <= 0xfdff) return "arabic";
  if (code >= 0xfe70 && code <= 0xfeff) return "arabic";
  // ── Devanagari ───────────────────────────────────────────────────────
  if (code >= 0x0900 && code <= 0x097f) return "devanagari";
  // ── Thai ─────────────────────────────────────────────────────────────
  if (code >= 0x0e00 && code <= 0x0e7f) return "thai";
  // ── CJK ─ Han + Kana + Hangul + extensions ───────────────────────────
  // CJK Unified Ideographs (basic + extensions A through G via surrogate-paired ranges)
  if (code >= 0x4e00 && code <= 0x9fff) return "cjk";
  // CJK Unified Ideographs Extension A
  if (code >= 0x3400 && code <= 0x4dbf) return "cjk";
  // CJK Compatibility Ideographs
  if (code >= 0xf900 && code <= 0xfaff) return "cjk";
  // Hiragana / Katakana
  if (code >= 0x3040 && code <= 0x30ff) return "cjk";
  // Katakana Phonetic Extensions
  if (code >= 0x31f0 && code <= 0x31ff) return "cjk";
  // Hangul Syllables / Jamo
  if (code >= 0xac00 && code <= 0xd7af) return "cjk";
  if (code >= 0x1100 && code <= 0x11ff) return "cjk";
  if (code >= 0x3130 && code <= 0x318f) return "cjk";
  if (code >= 0xa960 && code <= 0xa97f) return "cjk";
  if (code >= 0xd7b0 && code <= 0xd7ff) return "cjk";
  // CJK extensions B..G (supplementary plane)
  if (code >= 0x20000 && code <= 0x2ffff) return "cjk";
  if (code >= 0x30000 && code <= 0x3134f) return "cjk";
  return "unknown";
}

/**
 * Detect the dominant non-Latin script of a text sample.
 *
 * Algorithm:
 *   1. Walk the input one code point at a time.
 *   2. Skip whitespace, digits and ASCII punctuation (all classified "unknown").
 *   3. Tally each character's script bucket.
 *   4. Stop after `sampleSize` non-whitespace characters have been classified.
 *   5. Return the plurality winner, EXCEPT: if non-Latin total is below
 *      MIN_NON_LATIN_COUNT, force-return "latin" (the Latin-trained CRF path
 *      handles a stray Greek letter just fine — don't over-trigger).
 *
 * The threshold is deliberately conservative: Latin-script papers (the vast
 * majority of any real corpus) must produce identical output to before, with
 * no spurious script="..." tags.
 */
export function detectScript(text: string, sampleSize: number = DEFAULT_SAMPLE_SIZE): Script {
  if (text.length === 0) return "latin";
  // Tally by bucket. We iterate code points (not UTF-16 units) so surrogate
  // pairs for CJK Extension B and friends are counted as one character each.
  const counts: Map<Script, number> = new Map<Script, number>();
  let total = 0;
  for (const ch of text) {
    const s = classifyChar(ch);
    if (s === "unknown") continue;
    counts.set(s, (counts.get(s) ?? 0) + 1);
    total++;
    if (total >= sampleSize) break;
  }
  if (total === 0) return "latin";
  // Sum non-Latin counts.
  let nonLatin = 0;
  for (const [k, v] of counts) {
    if (k !== "latin") nonLatin += v;
  }
  if (nonLatin < MIN_NON_LATIN_COUNT) return "latin";
  // Plurality among non-Latin scripts (Latin handled above as the fallback).
  let best: Script = "latin";
  let bestCount = counts.get("latin") ?? 0;
  for (const [k, v] of counts) {
    if (v > bestCount) {
      bestCount = v;
      best = k;
    }
  }
  return best;
}

/**
 * Convenience: detect the dominant script from a stream of `LayoutToken`s.
 * Concatenates token text with a single space until `sampleSize` non-whitespace
 * characters have been collected (we deliberately over-collect by stopping at
 * the *first* token that crosses the threshold — bounded but not exact).
 */
export function detectScriptFromTokens(
  tokens: ReadonlyArray<LayoutToken> | null,
  sampleSize: number = DEFAULT_SAMPLE_SIZE,
): Script {
  if (tokens === null || tokens.length === 0) return "latin";
  const parts: string[] = [];
  let collected = 0;
  for (const t of tokens) {
    const text = t.getText();
    if (text === null || text.length === 0) continue;
    parts.push(text);
    // Count non-whitespace characters approximately — the precise tally is
    // done in detectScript over the full joined string.
    for (const ch of text) {
      if (classifyChar(ch) !== "unknown") collected++;
    }
    if (collected >= sampleSize) break;
  }
  return detectScript(parts.join(" "), sampleSize);
}

/**
 * BCP-47/TEI-style language hint for a known script. We never claim a specific
 * language (that would require a real LID model — the only LID factory wired
 * by default is the always-English stub). Callers may treat the result as
 * a coarse fallback when `doc.getLanguage()` is "en" but the script clearly
 * isn't Latin.
 */
export function hintLanguageForScript(script: Script): string | null {
  switch (script) {
    case "cyrillic": return "ru";
    case "greek": return "el";
    case "arabic": return "ar";
    case "hebrew": return "he";
    case "cjk": return "zh";
    case "devanagari": return "hi";
    case "thai": return "th";
    case "latin":
    case "unknown":
    default:
      return null;
  }
}
