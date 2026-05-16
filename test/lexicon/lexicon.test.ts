import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadLexiconFromDir } from "../../src/node/load-lexicon.js";
import {
  emptyLexicon,
  inDictionary,
  inFirstNames,
  inLastNames,
  isCountry,
  parseCelexDictionary,
  parseCountryCodesXml,
  parseCountryList,
  parseMultextDictionary,
  parseNameList,
  parseNewlineList,
} from "../../src/core/lexicon/index.js";

describe("lexicon parsers", () => {
  it("parses a multext-format wordform file (first column, tab-separated)", () => {
    const text = "apple\tnoun\nbanana\tnoun\n\ncherry\tnoun";
    expect(parseMultextDictionary(text)).toEqual(["apple", "banana", "cherry"]);
  });
  it("parses a name list, splitting on tab/newline/hyphen and lowercasing", () => {
    const text = "John\nJane-Marie\nGopal\tK";
    expect(parseNameList(text)).toEqual(["john", "jane", "gopal"]);
  });
  it("parses a country list, ignoring comments and blank lines", () => {
    const text = "# header comment\nGermany\nFrance\n\nIreland";
    expect(parseCountryList(text)).toEqual(["germany", "france", "ireland"]);
  });
  it("parses CountryCodes.xml, accepting both <english> and <alpha2>", () => {
    const xml = `<root><country><alpha2>DE</alpha2><english>Germany</english></country>
                 <country><alpha2>FR</alpha2><english>France</english></country></root>`;
    const out = parseCountryCodesXml(xml);
    expect(out).toContain("de");
    expect(out).toContain("germany");
    expect(out).toContain("fr");
    expect(out).toContain("france");
  });
  it("parses a CELEX-format German wordform with umlaut escapes", () => {
    const text = "1\\sch\"on\\ad\nü2\\m\"adchen\\n";
    const out = parseCelexDictionary(text);
    expect(out).toContain("schön");
    expect(out).toContain("mädchen");
  });
  it("parses a generic newline list", () => {
    const text = "Springer\nElsevier\n# skip\n\nWiley";
    expect(parseNewlineList(text)).toEqual(["springer", "elsevier", "wiley"]);
  });
});

describe("empty lexicon", () => {
  it("returns false for every predicate", () => {
    const lex = emptyLexicon();
    expect(inFirstNames(lex, "John")).toBe(false);
    expect(inLastNames(lex, "Doe")).toBe(false);
    expect(isCountry(lex, "Germany")).toBe(false);
    expect(inDictionary(lex, "apple")).toBe(false);
  });
});

const here = path.dirname(fileURLToPath(import.meta.url));
const lexiconDir = path.resolve(here, "../../fixtures/lexicon");
const have = existsSync(lexiconDir);
const skipIfMissing = have ? describe : describe.skip;

skipIfMissing("loadLexiconFromDir against the shipped fixture", () => {
  it("loads all the essential dictionaries to plausible sizes and serves canonical lookups", async () => {
    const lex = await loadLexiconFromDir({ lexiconDir });
    // Size sanity (these are minimums — actual counts are higher).
    expect(lex.firstNames.size).toBeGreaterThan(5_000);
    // Tier 2 people.person.lastnames adds ~400K surnames on top of the
    // ~15K base; we now expect at least 100K when Tier 2 is shipped.
    expect(lex.lastNames.size).toBeGreaterThan(100_000);
    expect(lex.dictionaryEN.size).toBeGreaterThan(10_000);
    expect(lex.countries.size).toBeGreaterThan(100);
    expect(lex.cities.size).toBeGreaterThan(5_000);
    expect(lex.journals.size).toBeGreaterThan(1_000);
    expect(lex.publishers.size).toBeGreaterThan(100);
    // Tier 1: titles + suffixes.
    expect(lex.personTitles.size).toBeGreaterThan(50);
    expect(lex.personSuffixes.size).toBeGreaterThan(2);
    // Tier 2: organisation matcher carries hundreds of thousands of entries.
    expect(lex.organizations.size).toBeGreaterThan(10_000);

    // Canonical lookups.
    expect(inFirstNames(lex, "John")).toBe(true);
    expect(inFirstNames(lex, "Jane")).toBe(true);
    expect(inLastNames(lex, "Smith")).toBe(true);
    expect(isCountry(lex, "Germany")).toBe(true);
    expect(isCountry(lex, "DE")).toBe(true);
    expect(inDictionary(lex, "compute")).toBe(true);
    expect(inDictionary(lex, "the")).toBe(true);
    // A made-up token shouldn't match.
    expect(inFirstNames(lex, "Xyzqwerty")).toBe(false);
    expect(isCountry(lex, "Atlantis")).toBe(false);
  });
});
