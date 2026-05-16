// Author-name post-processor (grobid-js port-only — not present in upstream).
//
// Cleans the common artefacts the CRF leaves attached to a header / citation
// author name:
//
//   * honorifics glued to forenames ("Dr. Rakesh Pandit", "Mr. Loganathan");
//   * footnote markers glued to surnames ("Atharv Pandit1", "Holger Fehske*",
//     "Soichiro Kobayashi†", "Collaborators* †");
//   * stray surrounding whitespace / punctuation;
//   * collapsed runs of internal whitespace.
//
// Invariants:
//
//   * Idempotent: `f(f(x)) === f(x)`. Running the cleaner twice produces the
//     same result as running it once.
//   * Unicode-clean: preserves letters from all scripts (`García-Márquez`,
//     `Müller-Lyer`, `李 明`, `Кобылянський`).
//   * Compound-preserving: does NOT split or alter `van der Waals`,
//     `García-Márquez`, `O'Brien`, `Müller-Lyer`, CJK names, etc.
//   * Conservative on trailing suffixes: "Jr." / "Sr." at the END of a name
//     are treated as name suffixes (not honorifics) and left in place. Only
//     when "Jr."/"Sr." appears as the FIRST token do we strip it as part of
//     the honorific scan.
//
// This module lives outside `person.ts` to avoid pulling Person's transitive
// import graph (which today reaches TEIFormatter → Engine → EngineParsers →
// AffiliationAddressParser → Affiliation, all of which static-initialise off
// TextUtilities.fullPunctuations) into harnesses that just want to exercise
// the string-cleaning logic.

/**
 * Minimal shape of a `Person` for the cleaner's purposes. Anything that
 * exposes get/set for the three name components plus an optional title slot
 * is compatible.
 */
export interface PersonNameFields {
  getFirstName(): string | null;
  getMiddleName(): string | null;
  getLastName(): string | null;
  getTitle(): string | null;
  setFirstName(v: string | null): void;
  setMiddleName(v: string | null): void;
  setLastName(v: string | null): void;
  setTitle(v: string | null): void;
}

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

// Leading honorifics. Case-insensitive, optional trailing dot, then a
// whitespace separator (which we consume so the residue starts on the real
// name). Sr./Jr. ARE in this list — they're stripped only at the LEAD; a
// trailing "Jr." would not match this anchor.
const HONORIFIC_LEADING_RE: RegExp =
  /^(?:mr|mrs|ms|miss|dr|prof|professor|sir|sr|jr|mister|mistress)\.?(?:[\s ]+|$)/i;

// Trailing footnote markers: digit runs, asterisk, dagger, double-dagger,
// section, paragraph, plus, hash, with optional embedded spaces (so we also
// catch "Collaborators* †").
const TRAILING_MARKER_RE: RegExp =
  /[\s ]*[\*†‡§¶+#0-9]+(?:[\s ]*[\*†‡§¶+#0-9]+)*[\s ]*$/;

// Surrounding stray punctuation. Hyphens, dots and apostrophes are NOT in
// this set — they're internal-name carriers ("O'Brien", "García-Márquez",
// initials "J.").
const STRAY_EDGE_RE: RegExp =
  /^[\s .,;:_‐‐-―]+|[\s ,;:_‐‐-―]+$/g;

// Internal whitespace collapse.
const INTERNAL_WS_RE: RegExp = /[\s ]+/g;

// ---------------------------------------------------------------------------
// Component-level cleaner
// ---------------------------------------------------------------------------

/**
 * Clean a single name component (first / middle / last). Idempotent.
 * Returns `null` for inputs that reduce to nothing after cleaning.
 */
export function cleanNameComponent(value: string | null): string | null {
  if (value === null) return null;
  let s = value;

  // Strip ALL leading honorifics. The loop handles chains like "Prof. Dr.".
  let prev: string;
  do {
    prev = s;
    s = s.replace(HONORIFIC_LEADING_RE, "");
  } while (s !== prev && s.length > 0);

  // Strip trailing markers (single greedy pass — the regex itself eats runs).
  s = s.replace(TRAILING_MARKER_RE, "");

  // Trim stray surrounding punctuation / whitespace.
  s = s.replace(STRAY_EDGE_RE, "");

  // Collapse internal whitespace runs to single spaces.
  s = s.replace(INTERNAL_WS_RE, " ").trim();

  return s.length === 0 ? null : s;
}

/**
 * Probe for a leading honorific on a name component. Returns the matched
 * honorific (without the trailing space) suitable for promoting into a
 * `title` slot, or `null` if no honorific was present. Probing is read-only.
 */
export function probeHonorific(value: string | null): string | null {
  if (value === null) return null;
  const m = value.match(HONORIFIC_LEADING_RE);
  if (m === null) return null;
  const t = m[0].replace(/[\s ]+$/, "");
  return t.length > 0 ? t : null;
}

// ---------------------------------------------------------------------------
// Person-level entry point
// ---------------------------------------------------------------------------

/**
 * Post-process a Person's name fields in place. See module-doc for
 * invariants. Safe to call multiple times.
 */
export function normalizePersonName(p: PersonNameFields): void {
  // Probe the firstName for an honorific FIRST so we can promote it into the
  // title slot before cleaning erases it. We only set the title when one is
  // not already present (don't clobber a parser-extracted roleName).
  if (p.getTitle() === null) {
    const t = probeHonorific(p.getFirstName());
    if (t !== null) p.setTitle(t);
  }

  p.setFirstName(cleanNameComponent(p.getFirstName()));
  p.setMiddleName(cleanNameComponent(p.getMiddleName()));
  p.setLastName(cleanNameComponent(p.getLastName()));
}

/**
 * Apply `normalizePersonName` across a list. Returns the same list reference
 * (mutates in place); accepts and returns `null` unchanged for caller
 * convenience.
 */
export function normalizePersonNames<T extends PersonNameFields>(
  persons: T[] | null,
): T[] | null {
  if (persons === null) return null;
  for (const p of persons) normalizePersonName(p);
  return persons;
}
