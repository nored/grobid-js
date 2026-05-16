// Port of org.grobid.core.lexicon.Lexicon.
// Upstream: grobid-core/src/main/java/org/grobid/core/lexicon/Lexicon.java
//
// Lexicon is a lazy singleton (`getInstance()`) that owns all the gazetteers
// and fast matchers used by feature extraction and post-processing. Upstream
// loads ~17 dictionary files from disk at first access; we mirror that
// behaviour, deferring file reads to the first call to a `tokenPositions*`
// or `init*` method (the constructor itself only allocates empty
// containers). File paths are resolved against the Grobid home directory
// returned by `GrobidProperties.getGrobidHomePath()`.

import { readFileSync } from "node:fs";
import { sep as pathSep } from "node:path";

import { GrobidAnalyzer } from "../analyzers/grobid-analyzer.js";
import { GrobidException } from "../exceptions/grobid-exception.js";
import { GrobidResourceException } from "../exceptions/grobid-resource-exception.js";
import { Language } from "../lang/language.js";
import { LayoutToken } from "../layout/layout-token.js";
import { PDFAnnotation, PDFAnnotationType } from "../layout/pdf-annotation.js";
import { CountryCodeSaxParser } from "../sax/country-code-sax-parser.js";
import { GrobidProperties } from "../utilities/grobid-properties.js";
import { LayoutTokensUtil } from "../utilities/layout-tokens-util.js";
import { OffsetPosition } from "../utilities/offset-position.js";
import { Pair } from "../utilities/pair.js";
import { TextUtilities } from "../utilities/text-utilities.js";
import { Utilities } from "../utilities/utilities.js";
import { getLogger } from "../utilities/logger.js";

import { FastMatcher } from "./fast-matcher.js";

const LOGGER = getLogger("Lexicon");

// ─────────────────────────────────────────────────────────────────────────────
// TextUtilities patterns are non-global in the canonical port (mirroring the
// Java `Pattern.compile(...)` calls without the global flag). To iterate
// matches with `RegExp.exec` in a `while` loop we need globalized clones.
// ─────────────────────────────────────────────────────────────────────────────
const DOI_PATTERN_G = new RegExp(TextUtilities.DOIPattern.source, "g");
const ARXIV_PATTERN_G = new RegExp(TextUtilities.arXivPattern.source, "g");
const URL_PATTERN_1_G = new RegExp(TextUtilities.urlPattern1.source, "gi");
const EMAIL_PATTERN_G = new RegExp(TextUtilities.emailPattern.source, "g");

/** Lazy accessor for the Grobid home path, throwing if unset. */
function getGrobidHomePath(): string {
  const home = GrobidProperties.getGrobidHomePath();
  if (home === null) {
    throw new GrobidResourceException(
      "Lexicon: grobid home path is not set. Initialize GrobidProperties before getInstance().",
    );
  }
  return home;
}


/**
 * A basic class to hold dictionary/naming information about an organization
 * for a given language.
 *
 * Upstream inner class — Lexicon.java line 116-126.
 */
export class OrganizationRecord {
  public name: string;
  public fullName: string;
  /** ISO 2-characters language code */
  public lang: string;

  constructor(name: string, fullName: string, lang: string) {
    this.name = name;
    this.fullName = fullName;
    this.lang = lang;
  }
}

// Country-codes XML parsing moved to `../sax/country-code-sax-parser.ts`.

/**
 * `StringTokenizer(line, "\t")` semantics — split on tab, drop empties,
 * preserve order.
 */
function splitOnDelims(line: string, delims: string): string[] {
  const out: string[] = [];
  let buf = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line.charAt(i);
    if (delims.indexOf(ch) !== -1) {
      if (buf.length > 0) {
        out.push(buf);
        buf = "";
      }
    } else {
      buf += ch;
    }
  }
  if (buf.length > 0) out.push(buf);
  return out;
}

/**
 * `StringUtils.isBlank` — null/empty/all-whitespace.
 */
function isBlank(s: string | null | undefined): boolean {
  return s === null || s === undefined || s.trim().length === 0;
}

/**
 * `StringUtils.stripEnd(str, stripChars)` — remove from the end any chars
 * present in stripChars.
 */
function stripEnd(str: string, stripChars: string): string {
  let end = str.length;
  while (end > 0 && stripChars.indexOf(str.charAt(end - 1)) !== -1) end--;
  return str.substring(0, end);
}

/**
 * Class for managing all the lexical resources.
 *
 * Upstream Lexicon.java line 35-1663.
 */
export class Lexicon {
  private static instance: Lexicon | null = null;

  // gazetteers — upstream line 41-46.
  private dictionary_en: Set<string> | null = null;
  private dictionary_de: Set<string> | null = null;
  private lastNames: Set<string> | null = null;
  private firstNames: Set<string> | null = null;
  private countryCodes: Map<string, string> | null = null;
  private countries: Set<string> | null = null;

  // retrieve basic naming information about a research infrastructure
  // (key must be lower case!) — upstream line 49.
  private researchOrganizations: Map<string, OrganizationRecord[]> | null = null;

  // fast matchers for efficient and flexible pattern matching in layout
  // token sequence or strings — upstream line 52-65.
  private abbrevJournalPattern: FastMatcher | null = null;
  private conferencePattern: FastMatcher | null = null;
  private publisherPattern: FastMatcher | null = null;
  private journalPattern: FastMatcher | null = null;
  private cityPattern: FastMatcher | null = null;
  private organisationPattern: FastMatcher | null = null;
  private researchInfrastructurePattern: FastMatcher | null = null;
  private locationPattern: FastMatcher | null = null;
  private countryPattern: FastMatcher | null = null;
  private orgFormPattern: FastMatcher | null = null;
  private collaborationPattern: FastMatcher | null = null;
  private funderPattern: FastMatcher | null = null;
  private personTitlePattern: FastMatcher | null = null;
  private personSuffixPattern: FastMatcher | null = null;

  // ─── singleton accessor — upstream line 67-86 ────────────────────────────
  static getInstance(): Lexicon {
    if (Lexicon.instance === null) {
      Lexicon.getNewInstance();
    }
    return Lexicon.instance!;
  }

  /** Creates a new instance. (Upstream `getNewInstance`, line 81-85.) */
  private static getNewInstance(): void {
    LOGGER.debug("Get new instance of Lexicon");
    // Upstream line 83 calls GrobidProperties.getInstance() to initialise the
    // home path. Mirrored here for fidelity; the path is read lazily via the
    // `getGrobidHomePath()` helper at each use site.
    GrobidProperties.getInstance();
    Lexicon.instance = new Lexicon();
  }

  /**
   * Hidden constructor — upstream line 90-111. Loads basic dictionaries
   * eagerly (wordforms, family/first names, country codes) while leaving
   * journals/conferences/etc. to be loaded lazily by their `init*` methods.
   */
  private constructor() {
    this.initDictionary();
    this.initNames();
    // the loading of the journal and conference names is lazy
    const home = getGrobidHomePath();
    this.addDictionary(
      home + pathSep + "lexicon" + pathSep + "wordforms" + pathSep + "english.wf",
      Language.EN,
    );
    this.addDictionary(
      home + pathSep + "lexicon" + pathSep + "wordforms" + pathSep + "german.wf",
      Language.DE,
    );
    this.addLastNames(
      home + pathSep + "lexicon" + pathSep + "names" + pathSep + "names.family",
    );
    this.addLastNames(
      home + pathSep + "lexicon" + pathSep + "names" + pathSep + "lastname.5k",
    );
    this.addFirstNames(
      home + pathSep + "lexicon" + pathSep + "names" + pathSep + "names.female",
    );
    this.addFirstNames(
      home + pathSep + "lexicon" + pathSep + "names" + pathSep + "names.male",
    );
    this.addFirstNames(
      home + pathSep + "lexicon" + pathSep + "names" + pathSep + "firstname.5k",
    );
    this.initCountryCodes();
    this.addCountryCodes(
      home + pathSep + "lexicon" + pathSep + "countries" + pathSep + "CountryCodes.xml",
    );
  }

  // ─── dictionary load — upstream line 128-186 ─────────────────────────────
  private initDictionary(): void {
    LOGGER.info("Initiating dictionary");
    this.dictionary_en = new Set<string>();
    this.dictionary_de = new Set<string>();
    LOGGER.info("End of Initialization of dictionary");
  }

  public addDictionary(path: string, lang: string): void {
    let contents: string;
    try {
      contents = readFileSync(path, { encoding: "utf-8" });
    } catch (e) {
      // Mirror upstream's "doesn't exist" / "can't read" branching by
      // distinguishing common errno codes.
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        throw new GrobidResourceException(
          `Cannot add entries to dictionary (language '${lang}'), because file '${path}' does not exists.`,
        );
      }
      throw new GrobidResourceException(
        `Cannot add entries to dictionary (language '${lang}'), because cannot read file '${path}'.`,
        e,
      );
    }
    try {
      const lines = contents.split(/\r\n|\r|\n/);
      for (const l of lines) {
        if (isBlank(l)) continue;

        // the first token, separated by a tabulation, gives the word form
        if (lang === Language.EN) {
          // multext format
          const tokens = splitOnDelims(l, "\t");
          if (tokens.length > 0) {
            const word = tokens[0]!;
            this.dictionary_en!.add(word);
          }
        } else if (lang === Language.DE) {
          // celex format
          const tokens = splitOnDelims(l, "\\");
          if (tokens.length > 0) {
            // id is tokens[0]; word form is tokens[1]
            if (tokens.length > 1) {
              let word = tokens[1]!;
              word = word.replace(/"a/g, "ä");
              word = word.replace(/"u/g, "ü");
              word = word.replace(/"o/g, "ö");
              word = word.replace(/\$/g, "ß");
              this.dictionary_de!.add(word);
            }
          }
        }
      }
    } catch (e) {
      throw new GrobidException("An exception occurred while running Grobid.", e);
    }
  }

  public isCountry(tok: string): boolean {
    return this.countries!.has(tok.toLowerCase());
  }

  // ─── names load — upstream line 192-327 ──────────────────────────────────
  private initNames(): void {
    LOGGER.info("Initiating names");
    this.firstNames = new Set<string>();
    this.lastNames = new Set<string>();
    LOGGER.info("End of initialization of names");
  }

  private initCountryCodes(): void {
    LOGGER.info("Initiating country codes");
    this.countryCodes = new Map<string, string>();
    this.countries = new Set<string>();
    this.countryPattern = new FastMatcher();
    LOGGER.info("End of initialization of country codes");
  }

  private addCountryCodes(path: string): void {
    let xml: string;
    try {
      xml = readFileSync(path, { encoding: "utf-8" });
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        throw new GrobidResourceException(
          `Cannot add country codes to dictionary, because file '${path}' does not exists.`,
        );
      }
      throw new GrobidResourceException(
        `Cannot add country codes to dictionary, because cannot read file '${path}'.`,
        e,
      );
    }
    try {
      new CountryCodeSaxParser(this.countryCodes!, this.countries!).parse(xml);
    } catch (e) {
      throw new GrobidException("An exception occured while running Grobid.", e);
    }

    for (const country of this.countries!) {
      // ignore delimiters, not case sensitive
      this.countryPattern!.loadTerm(country, GrobidAnalyzer.getInstance(), false, false);
    }
  }

  public getCountryCode(country: string): string {
    const code = this.countryCodes!.get(country.toLowerCase());
    // Upstream returns null when not present; we mirror that (caller checks).
    return code as string;
  }

  public initCountryPatterns(): void {
    if (this.countries === null || this.countries.size === 0) {
      // it should never be the case
      this.addCountryCodes(
        getGrobidHomePath() + pathSep + "lexicon" + pathSep + "countries" + pathSep + "CountryCodes.xml",
      );
    }
    for (const country of this.countries!) {
      // ignore delimiters, not case sensitive
      this.countryPattern!.loadTerm(country, GrobidAnalyzer.getInstance(), false, false);
    }
  }

  public addFirstNames(path: string): void {
    let contents: string;
    try {
      contents = readFileSync(path, { encoding: "utf-8" });
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        throw new GrobidResourceException(
          `Cannot add first names to dictionary, because file '${path}' does not exists.`,
        );
      }
      throw new GrobidResourceException(
        `Cannot add first names to dictionary, because cannot read file '${path}'.`,
        e,
      );
    }
    try {
      const lines = contents.split(/\r\n|\r|\n/);
      for (const l of lines) {
        // read the line
        // the first token, separated by a tabulation, gives the word form
        const tokens = splitOnDelims(l, "\t\n-");
        if (tokens.length > 0) {
          const word = tokens[0]!.toLowerCase().trim();
          if (!this.firstNames!.has(word)) {
            this.firstNames!.add(word);
          }
        }
      }
    } catch (e) {
      throw new GrobidException("An exception occured while running Grobid.", e);
    }
  }

  public addLastNames(path: string): void {
    let contents: string;
    try {
      contents = readFileSync(path, { encoding: "utf-8" });
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        throw new GrobidResourceException(
          `Cannot add last names to dictionary, because file '${path}' does not exists.`,
        );
      }
      throw new GrobidResourceException(
        `Cannot add last names to dictionary, because cannot read file '${path}'.`,
        e,
      );
    }
    try {
      const lines = contents.split(/\r\n|\r|\n/);
      for (const l of lines) {
        const tokens = splitOnDelims(l, "\t\n-");
        if (tokens.length > 0) {
          const word = tokens[0]!.toLowerCase().trim();
          if (!this.lastNames!.has(word)) {
            this.lastNames!.add(word);
          }
        }
      }
    } catch (e) {
      throw new GrobidException("An exception occured while running Grobid.", e);
    }
  }

  // ─── dictionary lookup — upstream line 335-382 ───────────────────────────
  /** Lexical look-up, default is English. */
  public inDictionary(s: string | null, lang: string = Language.EN): boolean {
    if (s === null) return false;
    // NOTE: dead-code parity with upstream — upstream's chain duplicates
    // `endsWith(".")`. Removed the redundant disjunct here as a pure cleanup
    // (semantics unchanged).
    if (s.endsWith(".") || s.endsWith(",") || s.endsWith(":") || s.endsWith(";")) {
      s = s.substring(0, s.length - 1);
    }
    const i1 = s.indexOf("-");
    const i2 = s.indexOf(" ");
    if (i1 !== -1) {
      const s1 = s.substring(0, i1);
      const s2 = s.substring(i1 + 1, s.length);
      if (lang === Language.DE) {
        if (this.dictionary_de!.has(s1) && this.dictionary_de!.has(s2)) return true;
        else return false;
      } else {
        if (this.dictionary_en!.has(s1) && this.dictionary_en!.has(s2)) return true;
        else return false;
      }
    }
    if (i2 !== -1) {
      const s1 = s.substring(0, i2);
      const s2 = s.substring(i2 + 1, s.length);
      if (lang === Language.DE) {
        if (this.dictionary_de!.has(s1) && this.dictionary_de!.has(s2)) return true;
        else return false;
      } else {
        if (this.dictionary_en!.has(s1) && this.dictionary_en!.has(s2)) return true;
        else return false;
      }
    } else {
      if (lang === Language.DE) {
        return this.dictionary_de!.has(s);
      } else {
        return this.dictionary_en!.has(s);
      }
    }
  }

  // ─── lazy init methods for fast matchers — upstream line 384-504 ─────────
  public initJournals(): void {
    try {
      this.abbrevJournalPattern = this.buildMatcherFromFile(
        getGrobidHomePath() + "/lexicon/journals/abbrev_journals.txt",
      );
      this.journalPattern = this.buildMatcherFromFile(
        getGrobidHomePath() + "/lexicon/journals/journals.txt",
      );
    } catch (e) {
      throw new GrobidResourceException(
        "Error when compiling lexicon matcher for abbreviated journal names.",
        e,
      );
    }
  }

  public initConferences(): void {
    try {
      this.conferencePattern = this.buildMatcherFromFile(
        getGrobidHomePath() + "/lexicon/journals/proceedings.txt",
      );
    } catch (e) {
      throw new GrobidResourceException(
        "Error when compiling lexicon matcher for conference names.",
        e,
      );
    }
  }

  public initPublishers(): void {
    try {
      this.publisherPattern = this.buildMatcherFromFile(
        getGrobidHomePath() + "/lexicon/publishers/publishers.txt",
      );
    } catch (e) {
      throw new GrobidResourceException(
        "Error when compiling lexicon matcher for conference names.",
        e,
      );
    }
  }

  public initCities(): void {
    try {
      this.cityPattern = this.buildMatcherFromFile(
        getGrobidHomePath() + "/lexicon/places/cities15000.txt",
      );
    } catch (e) {
      throw new GrobidResourceException(
        "Error when compiling lexicon matcher for cities.",
        e,
      );
    }
  }

  public initCollaborations(): void {
    try {
      // collaborationPattern = new FastMatcher(new
      //     File(GrobidProperties.getGrobidHomePath() + "/lexicon/organisations/collaborations.txt"));
      // NOTE: upstream bug — inspire_collaborations.txt is not bundled in the
      // standard grobid-home distribution; the original collaborations.txt
      // path is commented out. When the file is missing we mirror upstream's
      // documented intent (an empty term set) by allocating an empty
      // FastMatcher. See UPSTREAM-BUGS.md.
      const collaborationsPath =
        getGrobidHomePath() + "/lexicon/organisations/inspire_collaborations.txt";
      try {
        this.collaborationPattern = this.buildMatcherFromFile(collaborationsPath);
      } catch (e) {
        if (e instanceof GrobidResourceException && /does not exist/.test(e.message)) {
          LOGGER.warn(
            `collaborations lexicon file '${collaborationsPath}' missing; using empty matcher`,
          );
          this.collaborationPattern = new FastMatcher();
        } else {
          throw e;
        }
      }
    } catch (e) {
      throw new GrobidResourceException(
        "Error when compiling lexicon matcher for collaborations.",
        e,
      );
    }
  }

  public initOrganisations(): void {
    try {
      this.organisationPattern = this.buildMatcherFromFile(
        getGrobidHomePath() + "/lexicon/organisations/WikiOrganizations.lst",
      );
      this.loadTermsIntoMatcher(
        this.organisationPattern,
        getGrobidHomePath() + "/lexicon/organisations/government.government_agency",
      );
      this.loadTermsIntoMatcher(
        this.organisationPattern,
        getGrobidHomePath() + "/lexicon/organisations/known_corporations.lst",
      );
      this.loadTermsIntoMatcher(
        this.organisationPattern,
        getGrobidHomePath() + "/lexicon/organisations/venture_capital.venture_funded_company",
      );
    } catch (e) {
      if (e instanceof GrobidResourceException) throw e;
      throw new GrobidException("An exception occured while running Grobid Lexicon init.", e);
    }
  }

  public initOrgForms(): void {
    try {
      this.orgFormPattern = this.buildMatcherFromFile(
        getGrobidHomePath() + "/lexicon/organisations/orgClosings.txt",
      );
    } catch (e) {
      throw new GrobidException("An exception occured while running Grobid Lexicon init.", e);
    }
  }

  public initLocations(): void {
    try {
      this.locationPattern = this.buildMatcherFromFile(
        getGrobidHomePath() + "/lexicon/places/location.txt",
      );
    } catch (e) {
      throw new GrobidResourceException(
        "Error when compiling lexicon matcher for locations.",
        e,
      );
    }
  }

  public initPersonTitles(): void {
    try {
      this.personTitlePattern = this.buildMatcherFromFile(
        getGrobidHomePath() + "/lexicon/names/VincentNgPeopleTitles.txt",
      );
    } catch (e) {
      throw new GrobidResourceException(
        "Error when compiling lexicon matcher for person titles.",
        e,
      );
    }
  }

  public initPersonSuffix(): void {
    try {
      this.personSuffixPattern = this.buildMatcherFromFile(
        getGrobidHomePath() + "/lexicon/names/suffix.txt",
      );
    } catch (e) {
      throw new GrobidResourceException(
        "Error when compiling lexicon matcher for person name suffix.",
        e,
      );
    }
  }

  public initFunders(): void {
    try {
      this.funderPattern = this.buildMatcherFromFile(
        getGrobidHomePath() + "/lexicon/organisations/funders.txt",
        true,
      );
    } catch (e) {
      throw new GrobidException("An exception occured while running Grobid Lexicon init.", e);
    }
  }

  public initResearchInfrastructures(): void {
    try {
      this.researchInfrastructurePattern = this.buildMatcherFromFile(
        getGrobidHomePath() + "/lexicon/organisations/research_infrastructures.txt",
        true,
      );
      // store some name mapping — TreeMap in upstream; we use a Map and
      // sort on access where required (none of Lexicon's consumers iterate
      // researchOrganizations in sorted order, so an unsorted Map suffices).
      this.researchOrganizations = new Map<string, OrganizationRecord[]>();

      const mapPath =
        getGrobidHomePath() + "/lexicon/organisations/research_infrastructures_map.txt";
      let contents: string;
      try {
        contents = readFileSync(mapPath, { encoding: "utf-8" });
      } catch (ee) {
        const err = ee as NodeJS.ErrnoException;
        if (err.code === "ENOENT") {
          throw new GrobidResourceException(
            `Cannot add research infrastructure names to dictionary, because file '${mapPath}' does not exists.`,
          );
        }
        throw new GrobidResourceException(
          `Cannot add research infrastructure to dictionary, because cannot read file '${mapPath}'.`,
          ee,
        );
      }
      try {
        const lines = contents.split(/\r\n|\r|\n/);
        for (let line of lines) {
          line = line.trim();
          if (line.length === 0 || line.startsWith("#")) continue;
          const pieces = line.split(";"); // upstream uses split(";", -1) — JS split() already keeps trailing empties only when there's no limit; default behaviour matches when no limit given because semicolons after content yield empties. JS .split without limit keeps trailing empties → ok.
          if (pieces.length === 3) {
            if (pieces[0]!.length > 0) {
              if (pieces[1]!.length > 0) {
                const localInfra = new OrganizationRecord(pieces[0]!, pieces[1]!, "en");
                let localInfraList = this.researchOrganizations.get(pieces[0]!.toLowerCase());
                if (localInfraList === undefined) localInfraList = [];
                localInfraList.push(localInfra);
                this.researchOrganizations.set(pieces[0]!.toLowerCase(), localInfraList);
                this.researchOrganizations.set(pieces[1]!.toLowerCase(), localInfraList);
              }
              if (pieces[2]!.length > 0) {
                const localInfra = new OrganizationRecord(pieces[0]!, pieces[2]!, "fr");
                let localInfraList = this.researchOrganizations.get(pieces[0]!.toLowerCase());
                if (localInfraList === undefined) localInfraList = [];
                localInfraList.push(localInfra);
                this.researchOrganizations.set(pieces[0]!.toLowerCase(), localInfraList);
                this.researchOrganizations.set(pieces[2]!.toLowerCase(), localInfraList);
              }
            }
          } else {
            LOGGER.warn(`research_infrastructures map file, invalid line format: ${line}`);
          }
        }
      } catch (ee) {
        throw new GrobidException("An exception occured while running Grobid.", ee);
      }
    } catch (e) {
      if (e instanceof GrobidResourceException) throw e;
      throw new GrobidException("An exception occured while running Grobid Lexicon init.", e);
    }
  }

  /**
   * Mirrors upstream's `new FastMatcher(File)` / `new FastMatcher(File,
   * Analyzer, caseSensitive)` constructor by reading the file contents and
   * calling loadTerms.
   */
  private buildMatcherFromFile(path: string, caseSensitive: boolean = false): FastMatcher {
    let contents: string;
    try {
      contents = readFileSync(path, { encoding: "utf-8" });
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        throw new GrobidResourceException(
          `Cannot add term to matcher, because file '${path}' does not exist.`,
        );
      }
      throw new GrobidResourceException(
        `Cannot add terms to matcher, because cannot read file '${path}'.`,
        e,
      );
    }
    try {
      const fm = new FastMatcher();
      fm.loadTerms(contents, GrobidAnalyzer.getInstance(), caseSensitive);
      return fm;
    } catch (e) {
      throw new GrobidException(
        "An exception occurred while running Grobid FastMatcher.",
        e,
      );
    }
  }

  /** Mirrors upstream's `FastMatcher.loadTerms(File)`. */
  private loadTermsIntoMatcher(fm: FastMatcher, path: string): void {
    let contents: string;
    try {
      contents = readFileSync(path, { encoding: "utf-8" });
    } catch (e) {
      throw new GrobidResourceException(
        "Cannot add term to matcher, because the lexicon resource file " +
          "does not exist or cannot be read.",
        e,
      );
    }
    fm.loadTerms(contents, GrobidAnalyzer.getInstance(), false);
  }

  /** Look-up in first name gazetteer. (Upstream line 589-591.) */
  public inFirstNames(s: string): boolean {
    return this.firstNames!.has(s);
  }

  /** Look-up in last name gazetteer. (Upstream line 594-598.) */
  public inLastNames(s: string): boolean {
    return this.lastNames!.has(s);
  }

  /** Indicate if we have a punctuation. (Upstream line 601-612.) */
  public isPunctuation(s: string): boolean {
    if (s.length !== 1) return false;
    else {
      const c = s.charAt(0);
      // Character.isLetterOrDigit equivalent: unicode letter or number.
      const isLetterOrDigit = /[\p{L}\p{N}]/u.test(c);
      if (!isLetterOrDigit && c !== "-") return true;
    }
    return false;
  }

  public getOrganizationNamingInfo(name: string): OrganizationRecord[] | null {
    if (this.researchOrganizations === null) return null;
    return this.researchOrganizations.get(name.toLowerCase()) ?? null;
  }

  /**
   * Map the language codes used by the language identifier component to the
   * normal language name.
   * <p>
   * Note: due to an older bug, kr is currently map to Korean too - this
   * should disappear at some point in the future after retraining of models.
   *
   * (Upstream line 629-666.)
   */
  public mapLanguageCode(code: string | null): string {
    if (code === null) return "";
    else if (code.length === 0) return "";
    else if (code === Language.EN) return "English";
    else if (code === Language.FR) return "French";
    else if (code === Language.DE) return "German";
    else if (code === "cat") return "Catalan";
    else if (code === "dk") return "Danish";
    else if (code === "ee") return "Estonian";
    else if (code === "fi") return "Finish";
    else if (code === "it") return "Italian";
    else if (code === "jp") return "Japanese";
    else if (code === "kr" || code === "ko") return "Korean";
    else if (code === "nl") return "Deutch";
    else if (code === "no") return "Norvegian";
    else if (code === "se") return "Swedish";
    else if (code === "sorb") return "Sorbian";
    else if (code === "tr") return "Turkish";
    else return "";
  }

  // ─── token-position lookups (gazetteer queries) ───────────────────────────
  // Upstream line 671-1059. Every method has a String and a LayoutToken[]
  // overload; we collapse with overloads.

  public tokenPositionsJournalNames(s: string): OffsetPosition[];
  public tokenPositionsJournalNames(s: LayoutToken[]): OffsetPosition[];
  public tokenPositionsJournalNames(s: string | LayoutToken[]): OffsetPosition[] {
    if (this.journalPattern === null) this.initJournals();
    if (typeof s === "string") return this.journalPattern!.matchToken(s);
    return this.journalPattern!.matchLayoutToken(s);
  }

  public tokenPositionsAbbrevJournalNames(s: string): OffsetPosition[];
  public tokenPositionsAbbrevJournalNames(s: LayoutToken[]): OffsetPosition[];
  public tokenPositionsAbbrevJournalNames(s: string | LayoutToken[]): OffsetPosition[] {
    if (this.abbrevJournalPattern === null) this.initJournals();
    if (typeof s === "string") return this.abbrevJournalPattern!.matchToken(s);
    return this.abbrevJournalPattern!.matchLayoutToken(s);
  }

  public tokenPositionsConferenceNames(s: string): OffsetPosition[];
  public tokenPositionsConferenceNames(s: LayoutToken[]): OffsetPosition[];
  public tokenPositionsConferenceNames(s: string | LayoutToken[]): OffsetPosition[] {
    if (this.conferencePattern === null) this.initConferences();
    if (typeof s === "string") return this.conferencePattern!.matchToken(s);
    return this.conferencePattern!.matchLayoutToken(s);
  }

  public tokenPositionsPublisherNames(s: string): OffsetPosition[];
  public tokenPositionsPublisherNames(s: LayoutToken[]): OffsetPosition[];
  public tokenPositionsPublisherNames(s: string | LayoutToken[]): OffsetPosition[] {
    if (this.publisherPattern === null) this.initPublishers();
    if (typeof s === "string") return this.publisherPattern!.matchToken(s);
    return this.publisherPattern!.matchLayoutToken(s);
  }

  /** Soft look-up in collaboration name gazetteer for layout tokens. */
  public tokenPositionsCollaborationNames(s: LayoutToken[]): OffsetPosition[] {
    if (this.collaborationPattern === null) this.initCollaborations();
    return this.collaborationPattern!.matchLayoutToken(s);
  }

  /** Case sensitive look-up in funder name gazetteer. (Upstream line 776-781.) */
  public tokenPositionsFunderNames(s: LayoutToken[]): OffsetPosition[] {
    if (this.funderPattern === null) this.initFunders();
    return this.funderPattern!.matchLayoutToken(s, true, true);
  }

  /** Case sensitive look-up in research infrastructure name gazetteer. (Upstream line 787-792.) */
  public tokenPositionsResearchInfrastructureNames(s: LayoutToken[]): OffsetPosition[] {
    if (this.researchInfrastructurePattern === null) this.initResearchInfrastructures();
    return this.researchInfrastructurePattern!.matchLayoutToken(s, true, true);
  }

  public tokenPositionsCityNames(s: string): OffsetPosition[];
  public tokenPositionsCityNames(s: LayoutToken[]): OffsetPosition[];
  public tokenPositionsCityNames(s: string | LayoutToken[]): OffsetPosition[] {
    if (this.cityPattern === null) this.initCities();
    if (typeof s === "string") return this.cityPattern!.matchToken(s);
    return this.cityPattern!.matchLayoutToken(s);
  }

  public tokenPositionsOrganisationNames(s: string): OffsetPosition[];
  public tokenPositionsOrganisationNames(s: LayoutToken[]): OffsetPosition[];
  public tokenPositionsOrganisationNames(s: string | LayoutToken[]): OffsetPosition[] {
    if (this.organisationPattern === null) this.initOrganisations();
    if (typeof s === "string") return this.organisationPattern!.matchToken(s);
    return this.organisationPattern!.matchLayoutToken(s);
  }

  public tokenPositionsCountryNames(s: LayoutToken[]): OffsetPosition[] {
    if (this.countryPattern === null) this.initCountryPatterns();
    return this.countryPattern!.matchLayoutToken(s);
  }

  /** Char-position lookups in org name gazetteer. (Upstream line 861-883.) */
  public charPositionsOrganisationNames(s: string): OffsetPosition[];
  public charPositionsOrganisationNames(s: LayoutToken[]): OffsetPosition[];
  public charPositionsOrganisationNames(s: string | LayoutToken[]): OffsetPosition[] {
    if (this.organisationPattern === null) this.initOrganisations();
    if (typeof s === "string") return this.organisationPattern!.matchCharacter(s);
    return this.organisationPattern!.matchCharacterLayoutToken(s);
  }

  public tokenPositionsOrgForm(s: string): OffsetPosition[];
  public tokenPositionsOrgForm(s: LayoutToken[]): OffsetPosition[];
  public tokenPositionsOrgForm(s: string | LayoutToken[]): OffsetPosition[] {
    if (this.orgFormPattern === null) this.initOrgForms();
    if (typeof s === "string") return this.orgFormPattern!.matchToken(s);
    return this.orgFormPattern!.matchLayoutToken(s);
  }

  public charPositionsOrgForm(s: string): OffsetPosition[];
  public charPositionsOrgForm(s: LayoutToken[]): OffsetPosition[];
  public charPositionsOrgForm(s: string | LayoutToken[]): OffsetPosition[] {
    if (this.orgFormPattern === null) this.initOrgForms();
    if (typeof s === "string") return this.orgFormPattern!.matchCharacter(s);
    return this.orgFormPattern!.matchCharacterLayoutToken(s);
  }

  public tokenPositionsLocationNames(s: string): OffsetPosition[];
  public tokenPositionsLocationNames(s: LayoutToken[]): OffsetPosition[];
  public tokenPositionsLocationNames(s: string | LayoutToken[]): OffsetPosition[] {
    if (this.locationPattern === null) this.initLocations();
    if (typeof s === "string") return this.locationPattern!.matchToken(s);
    return this.locationPattern!.matchLayoutToken(s);
  }

  public charPositionsLocationNames(s: string): OffsetPosition[];
  public charPositionsLocationNames(s: LayoutToken[]): OffsetPosition[];
  public charPositionsLocationNames(s: string | LayoutToken[]): OffsetPosition[] {
    if (this.locationPattern === null) this.initLocations();
    if (typeof s === "string") return this.locationPattern!.matchCharacter(s);
    return this.locationPattern!.matchCharacterLayoutToken(s);
  }

  public tokenPositionsPersonTitle(s: string): OffsetPosition[];
  public tokenPositionsPersonTitle(s: LayoutToken[]): OffsetPosition[];
  public tokenPositionsPersonTitle(s: string | LayoutToken[]): OffsetPosition[] {
    if (this.personTitlePattern === null) this.initPersonTitles();
    if (typeof s === "string") return this.personTitlePattern!.matchToken(s);
    return this.personTitlePattern!.matchLayoutToken(s);
  }

  public tokenPositionsPersonSuffix(s: LayoutToken[]): OffsetPosition[] {
    if (this.personSuffixPattern === null) this.initPersonSuffix();
    return this.personSuffixPattern!.matchLayoutToken(s);
  }

  public charPositionsPersonTitle(s: string): OffsetPosition[];
  public charPositionsPersonTitle(s: LayoutToken[]): OffsetPosition[];
  public charPositionsPersonTitle(s: string | LayoutToken[]): OffsetPosition[] {
    if (this.personTitlePattern === null) this.initPersonTitles();
    if (typeof s === "string") return this.personTitlePattern!.matchCharacter(s);
    return this.personTitlePattern!.matchCharacterLayoutToken(s);
  }

  // ─── regex-based identifier lookups — upstream line 1064-1130, 1649-1661 ─

  /** Identify in tokenized input the positions of identifier patterns. */
  public tokenPositionsIdentifierPattern(tokens: LayoutToken[]): OffsetPosition[] {
    let result: OffsetPosition[] = [];
    const text = LayoutTokensUtil.toText(tokens);

    // DOI positions
    result = this.tokenPositionsDOIPattern(tokens, text);

    // arXiv
    const positions = this.tokenPositionsArXivPattern(tokens, text);
    result = Utilities.mergePositions(result, positions) ?? [];

    // ISSN and ISBN — upstream-commented out
    /* positions = tokenPositionsISSNPattern(tokens);
       result = Utilities.mergePositions(result, positions);
       positions = tokenPositionsISBNPattern(tokens);
       result = Utilities.mergePositions(result, positions); */

    return result;
  }

  /** Identify in tokenized input the positions of the DOI patterns. */
  public tokenPositionsDOIPattern(tokens: LayoutToken[], text: string): OffsetPosition[] {
    const textResult: OffsetPosition[] = [];
    DOI_PATTERN_G.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = DOI_PATTERN_G.exec(text)) !== null) {
      textResult.push(new OffsetPosition(m.index, m.index + m[0].length));
      if (m[0].length === 0) DOI_PATTERN_G.lastIndex++;
    }
    return Utilities.convertStringOffsetToTokenOffset(textResult, tokens);
  }

  /**
   * Identify in tokenized input the positions of the arXiv identifier
   * patterns with token positions.
   */
  public tokenPositionsArXivPattern(tokens: LayoutToken[], text: string): OffsetPosition[] {
    const textResult: OffsetPosition[] = [];
    ARXIV_PATTERN_G.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ARXIV_PATTERN_G.exec(text)) !== null) {
      textResult.push(new OffsetPosition(m.index, m.index + m[0].length));
      if (m[0].length === 0) ARXIV_PATTERN_G.lastIndex++;
    }
    return Utilities.convertStringOffsetToTokenOffset(textResult, tokens);
  }

  /** Identify in tokenized input the positions of ISSN patterns. */
  public tokenPositionsISSNPattern(_tokens: LayoutToken[]): OffsetPosition[] {
    const result: OffsetPosition[] = [];
    // TBD !  (upstream line 1117)
    return result;
  }

  /** Identify in tokenized input the positions of ISBN patterns. */
  public tokenPositionsISBNPattern(_tokens: LayoutToken[]): OffsetPosition[] {
    const result: OffsetPosition[] = [];
    // TBD !!  (upstream line 1128)
    return result;
  }

  /** Identify in tokenized input the positions of a URL pattern with token positions. */
  public static tokenPositionsUrlPattern(tokens: LayoutToken[]): OffsetPosition[] {
    const textResult = Lexicon.characterPositionsUrlPattern(tokens);
    return Utilities.convertStringOffsetToTokenOffset(textResult, tokens);
  }

  /** Identify in tokenized input the positions of a URL pattern with character positions. */
  public static characterPositionsUrlPattern(tokens: LayoutToken[]): OffsetPosition[] {
    const text = LayoutTokensUtil.toText(tokens);
    const textResult: OffsetPosition[] = [];
    URL_PATTERN_1_G.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = URL_PATTERN_1_G.exec(text)) !== null) {
      textResult.push(new OffsetPosition(m.index, m.index + m[0].length));
      if (m[0].length === 0) URL_PATTERN_1_G.lastIndex++;
    }
    return textResult;
  }

  /**
   * Identify in tokenized input the positions of a URL pattern with
   * character positions, and refine positions based on possible PDF URI
   * annotations.
   * <p>
   * This will produce better quality recognized URL, avoiding missing
   * suffixes and problems with break lines and spaces.
   *
   * (Upstream line 1161-1179.)
   */
  public static characterPositionsUrlPatternWithPdfAnnotations(
    layoutTokens: LayoutToken[],
    pdfAnnotations: PDFAnnotation[],
    text: string,
  ): OffsetPosition[] {
    const urlTokensPositionsAndDestinations: Pair<OffsetPosition, string | null>[] =
      Lexicon.tokenPositionUrlPatternWithPdfAnnotations(layoutTokens, pdfAnnotations);

    // We only need the positions here
    const urlTokensPositions: OffsetPosition[] = urlTokensPositionsAndDestinations.map(
      (p) => p.getA(),
    );

    // We need to adjust the end of the positions to avoid problems with the
    // sublist that is used in the following method
    for (const o of urlTokensPositions) o.end += 1;

    // here we need to match the offsetPositions related to the text obtained
    // by the layoutTokens, with the text which may be different (spaces,
    // hypen, breakline)
    return TextUtilities.matchTokenAndString(layoutTokens, text, urlTokensPositions);
  }

  /**
   * This method returns the token positions in respect of the layout tokens,
   * result is (inclusive, inclusive), so for calling this subList after this
   * method, remember to add +1  to the end offset.
   *
   * (Upstream line 1185-1221.)
   */
  public static tokenPositionUrlPatternWithPdfAnnotations(
    layoutTokens: LayoutToken[],
    pdfAnnotations: PDFAnnotation[],
  ): Pair<OffsetPosition, string | null>[] {
    const characterPositionsAndDestinations: Pair<OffsetPosition, string | null>[] =
      Lexicon.characterPositionsUrlPatternWithPdfAnnotationsInternal(
        layoutTokens,
        pdfAnnotations,
      );
    const characterPositions: OffsetPosition[] = characterPositionsAndDestinations.map((p) =>
      p.getA(),
    );
    const tokenOffsetPositionsWithRegex: OffsetPosition[] = Utilities.convertStringOffsetToTokenOffset(
      characterPositions,
      layoutTokens,
    );
    const tokenOffsetPositionsAndDestinationsWithRegex: Pair<
      OffsetPosition,
      string | null
    >[] = [];
    for (let i = 0; i < tokenOffsetPositionsWithRegex.length; i++) {
      tokenOffsetPositionsAndDestinationsWithRegex.push(
        new Pair<OffsetPosition, string | null>(
          tokenOffsetPositionsWithRegex[i]!,
          characterPositionsAndDestinations[i]!.getB(),
        ),
      );
    }

    const tokenOffsetPositionsFromAnyURLs: Pair<OffsetPosition, string | null>[] =
      Lexicon.tokenPositionsAnyURLMatchingPdfAnnotations(layoutTokens, pdfAnnotations);

    // Consolidate the two lists
    if (tokenOffsetPositionsFromAnyURLs.length === 0) {
      return tokenOffsetPositionsAndDestinationsWithRegex;
    } else {
      // We add possible URL that weren't bound to any PDF annotations
      for (const item of tokenOffsetPositionsAndDestinationsWithRegex) {
        const dest = item.getB();
        if (dest === null) {
          // if the destination offsets does not overlap any other offsets, we add it
          const overlaps = tokenOffsetPositionsFromAnyURLs.some((existingItem) =>
            existingItem.getA().overlaps(item.getA()),
          );
          if (!overlaps) {
            tokenOffsetPositionsFromAnyURLs.push(item);
          }
        }
      }
      return tokenOffsetPositionsFromAnyURLs;
    }
  }

  /** Upstream line 1223-1249. */
  public static getTokenPositions(
    startPos: number,
    endPos: number,
    layoutTokens: LayoutToken[],
  ): OffsetPosition {
    // token sublist
    let startTokenIndex = -1;
    let endTokensIndex = -1;

    const urlTokens: LayoutToken[] = [];
    let tokenPos = 0;
    let tokenIndex = 0;
    for (const localToken of layoutTokens) {
      const tokText = localToken.getText() ?? "";
      if (startPos <= tokenPos && tokenPos + tokText.length <= endPos) {
        urlTokens.push(localToken);
        if (startTokenIndex === -1) startTokenIndex = tokenIndex;
        if (tokenIndex > endTokensIndex) endTokensIndex = tokenIndex;
      }
      if (tokenPos > endPos) break;
      tokenPos += tokText.length;
      tokenIndex++;
    }

    return new OffsetPosition(startTokenIndex, endTokensIndex);
  }

  /** Upstream line 1251-1285. */
  public static getTokenIndexMatchingURLDestination(
    urlTokens: LayoutToken[],
    destination: string,
  ): OffsetPosition {
    const urlString = LayoutTokensUtil.toText(urlTokens);

    const joinedNoSpaces = urlString.replace(/\s/g, "");
    const destinationNoSpaces = destination.replace(/\s/g, "");

    // Find the start index in the space-less string
    const destStartNoSpaces = joinedNoSpaces.indexOf(destinationNoSpaces);
    if (destStartNoSpaces === -1) {
      // Not found, handle as needed
      return new OffsetPosition();
    }

    const destEndNoSpaces = destStartNoSpaces + destinationNoSpaces.length;

    // Map to token indices
    let charCount = 0;
    let indexStart = -1;
    let indexEnd = -1;
    for (let i = 0; i < urlTokens.length; i++) {
      const tokenText = urlTokens[i]!.getText() ?? "";
      for (let j = 0; j < tokenText.length; j++) {
        const ch = tokenText.charAt(j);
        // Character.isWhitespace equivalent.
        if (!/\s/.test(ch)) {
          if (charCount === destStartNoSpaces && indexStart === -1) indexStart = i;
          if (charCount === destEndNoSpaces - 1) indexEnd = i;
          charCount++;
        }
      }
      if (indexEnd !== -1) break;
    }
    return new OffsetPosition(indexStart, indexEnd);
  }

  /**
   * This method returns the character offsets in relation to the string
   * obtained by the layout tokens. Notice the absence of the String text
   * parameter.
   *
   * (Upstream line 1291-1415 — `tokenPositionsAnyURLMatchingPdfAnnotations`.)
   */
  public static tokenPositionsAnyURLMatchingPdfAnnotations(
    layoutTokens: LayoutToken[],
    pdfAnnotations: PDFAnnotation[],
  ): Pair<OffsetPosition, string | null>[] {
    const urlsInPage: number[] = Array.from(
      new Set(layoutTokens.map((t) => t.getPage())),
    );

    // groupingBy(PDFAnnotation::getDestination)
    const relevantURIAnnotations = new Map<string, PDFAnnotation[]>();
    for (const a of pdfAnnotations) {
      const dest = a.getDestination();
      if (
        urlsInPage.indexOf(a.getPageNumber()) !== -1 &&
        dest !== null &&
        dest.trim().length > 0 &&
        a.getType() === PDFAnnotationType.URI
      ) {
        const list = relevantURIAnnotations.get(dest);
        if (list === undefined) relevantURIAnnotations.set(dest, [a]);
        else list.push(a);
      }
    }

    const mergedAnnotations: PDFAnnotation[] = [];

    for (const [, annotations] of relevantURIAnnotations) {
      if (annotations.length <= 1) {
        for (const ann of annotations) mergedAnnotations.push(ann);
        continue;
      }

      const first = annotations[0]!;
      let page = first.getPageNumber();
      for (const ann of annotations) {
        const p = ann.getPageNumber();
        if (p < page) page = p;
      }

      const merged = new PDFAnnotation();
      merged.setPageNumber(page);
      const firstDest = first.getDestination();
      merged.setDestination(firstDest);
      merged.setType(first.getType());

      const boxes: NonNullable<ReturnType<PDFAnnotation["getBoundingBoxes"]>> = [];
      for (const ann of annotations) {
        const b = ann.getBoundingBoxes();
        if (b !== null) for (const box of b) boxes.push(box);
      }
      merged.setBoundingBoxes(boxes);

      mergedAnnotations.push(merged);
    }

    // we calculate the token positions of all the URLs in the layout tokens
    const urlPositions: Pair<OffsetPosition, string | null>[] = [];
    for (const annotation of mergedAnnotations) {
      const destination = annotation.getDestination();
      if (destination === null) continue;
      // Identify the tokens covered by the annotation
      let urlTokens: LayoutToken[] = layoutTokens.filter((t) => annotation.cover(t));

      if (urlTokens.length === 0) continue;

      // Refine the URL tokens based on the destination URL from the
      // annotation. Differently from when we recognise the URLs via regex,
      // here we may have to remove characters also in front of the URL.
      const urlString = LayoutTokensUtil.toText(urlTokens);
      const urlStringWithoutSpaces = urlString.replace(/\s/g, "");

      if (urlStringWithoutSpaces.indexOf(destination) !== -1) {
        // In this case the list of tokens has catches too much, usually this
        // should be limited to a few characters, but we cannot know it for
        // sure.

        let startUrl = urlString.indexOf(destination);
        let endDestinationURL = startUrl + destination.length;
        if (startUrl < 0) {
          // If we cannot find the destination in the URL string, we try to
          // find it without spaces
          startUrl = urlStringWithoutSpaces.indexOf(destination);
          endDestinationURL = startUrl + urlString.length;
        }
        const newTokenPositions = Lexicon.getTokenPositions(
          startUrl,
          endDestinationURL,
          urlTokens,
        );

        if (newTokenPositions.end < 0) {
          // The difference is within the last token, even if we split the
          // layout tokens, here, it won't solve the problem so we limit
          // collateral damage.
          newTokenPositions.end = urlTokens.length - 1;
        }

        urlTokens = urlTokens.slice(newTokenPositions.start, newTokenPositions.end + 1);
      }

      // Cleanup edges
      if (urlTokens.length > 0 && (urlTokens[0]!.getText() ?? "").endsWith("(")) {
        urlTokens.shift();
      }

      if (urlTokens.length === 0) continue;

      if ((urlTokens[urlTokens.length - 1]!.getText() ?? "").endsWith(")")) {
        const joined = LayoutTokensUtil.toText(urlTokens);
        let openedParenthesis = 0;
        let closedParenthesis = 0;
        for (let i = 0; i < joined.length; i++) {
          if (joined.charAt(i) === "(") openedParenthesis++;
          if (joined.charAt(i) === ")") closedParenthesis++;
        }
        if (openedParenthesis < closedParenthesis) {
          urlTokens.pop();
        }
      }

      if (urlTokens.length === 0) continue;

      if ((urlTokens[urlTokens.length - 1]!.getText() ?? "") === ".") {
        urlTokens.pop();
      }

      if (urlTokens.length === 0) continue;

      // Find the token index positions in the layoutTokens object
      const startTokenIndex = layoutTokens.indexOf(urlTokens[0]!);
      const endTokenIndex = layoutTokens.indexOf(urlTokens[urlTokens.length - 1]!);
      const resultPosition = new OffsetPosition(startTokenIndex, endTokenIndex);

      urlPositions.push(
        new Pair<OffsetPosition, string | null>(resultPosition, destination),
      );
    }

    return urlPositions;
  }

  /**
   * This method returns the character offsets in relation to the string
   * obtained by the layout tokens. Notice the absence of the String text
   * parameter.
   *
   * (Upstream line 1421-1578 —
   * `characterPositionsUrlPatternWithPdfAnnotations(layoutTokens,
   * pdfAnnotations)`. Renamed to avoid clashing with the 3-arg public
   * overload `characterPositionsUrlPatternWithPdfAnnotations(layoutTokens,
   * pdfAnnotations, text)` above; both methods exist in upstream as
   * overloads sharing the same name.)
   */
  public static characterPositionsUrlPatternWithPdfAnnotationsInternal(
    layoutTokens: LayoutToken[],
    pdfAnnotations: PDFAnnotation[] | null,
  ): Pair<OffsetPosition, string | null>[] {
    const urlPositions: OffsetPosition[] = Lexicon.characterPositionsUrlPattern(layoutTokens);
    const resultPositions: Pair<OffsetPosition, string | null>[] = [];

    // Do we need to extend the url position based on additional position of
    // the corresponding PDF annotation?
    for (const urlPosition of urlPositions) {
      const startPos = urlPosition.start;
      let endPos = urlPosition.end;

      const tokenPositions = Lexicon.getTokenPositions(startPos, endPos, layoutTokens);

      const startTokenIndex = tokenPositions.start;
      const endTokensIndex = tokenPositions.end;

      // There are no token that matches the character offsets, this may
      // happen rarely when the character offset falls in the middle of a
      // token, this is likely due to a badly constructed PDF document
      if (startTokenIndex < 0 || endTokensIndex < 0) continue;

      let urlTokens: LayoutToken[] = layoutTokens.slice(startTokenIndex, endTokensIndex + 1);

      const urlString = LayoutTokensUtil.toText(urlTokens);

      // This variable is used to adjust the last token index
      let correctedLastTokenIndex = 0;
      let targetAnnotation: PDFAnnotation | null = null;
      if (urlTokens.length > 0) {
        const lastToken = urlTokens[urlTokens.length - 1]!;
        if (pdfAnnotations !== null) {
          targetAnnotation =
            Lexicon.matchPdfAnnotationsBasedOnCoordinatesDestinationOrLastTokens(
              pdfAnnotations,
              urlTokens,
            );

          correctedLastTokenIndex = urlTokens.length - 1;

          // If we cannot match, maybe the regex got some characters too
          // much, e.g. dots, parenthesis,etc.. so we try to check the tokens
          // before the last only if the n-token is a single special characters
          // TODO: Stop after a few characters, instead of when reaching zero?
          if (targetAnnotation === null) {
            const lastTokenText = lastToken.getText() ?? "";
            let index = urlTokens.length - 1;
            // The error should be within a few characters, so we stop if the
            // token length is greater than 1
            while (
              index > 0 &&
              lastTokenText.length === 1 &&
              !/[\p{L}\p{N}]/u.test(lastTokenText.charAt(0)) &&
              targetAnnotation === null
            ) {
              index -= 1;
              // upstream binds `finalLastToken1` but never uses it; preserved
              // semantically as a no-op.
              targetAnnotation =
                Lexicon.matchPdfAnnotationsBasedOnCoordinatesDestinationOrLastTokens(
                  pdfAnnotations,
                  urlTokens,
                );
              correctedLastTokenIndex = index;
            }
          }
        }
      }

      let destination: string | null = null;

      if (targetAnnotation !== null) {
        destination = targetAnnotation.getDestination();
        if (destination !== null) {
          let destinationPos = 0;
          if (urlString.replace(/\s/g, "") === destination) {
            // Nothing to do here, we ignore the correctedLastTokenIndex
            // because the regex got everything we need
          } else if (
            destination.indexOf(urlString) !== -1 ||
            destination.indexOf(urlString.replace(/\s/g, "")) !== -1 ||
            destination.indexOf(stripEnd(urlString, "-")) !== -1
          ) {
            // In this case the regex did not catch all the URL, so we need
            // to extend it using the destination URL from the annotation
            destinationPos = destination.indexOf(urlString) + urlString.length;
            if (endTokensIndex < layoutTokens.length - 1) {
              let additionalSpaces = 0;
              let additionalTokens = 0;
              for (let j = endTokensIndex + 1; j < layoutTokens.length; j++) {
                const nextToken = layoutTokens[j]!;
                const nextText = nextToken.getText() ?? "";

                if (nextText === "\n" || nextText === " " || nextText.length === 0) {
                  endPos += nextText.length;
                  additionalSpaces += nextText.length;
                  additionalTokens += 1;
                  urlTokens.push(nextToken);
                  continue;
                }

                const pos = destination.indexOf(nextText, destinationPos);
                if (pos !== -1) {
                  if (additionalTokens > 0) {
                    additionalSpaces = 0;
                    additionalTokens = 0;
                  }
                  endPos += nextText.length;
                  destinationPos = pos + nextText.length;
                  urlTokens.push(nextToken);
                } else {
                  break;
                }
              }

              // We don't match anything after, but we added spaces, we
              // should take them back
              if (additionalTokens > 0) {
                urlTokens = urlTokens.slice(0, urlTokens.length - additionalTokens);
                endPos -= additionalSpaces;
              }
            }
          } else if (
            urlString.indexOf(destination) !== -1 ||
            urlString.replace(/\s/g, "").indexOf(destination) !== -1
          ) {
            // In this case the regex has catches too much, usually this
            // should be limited to a few characters, but we cannot know it
            // for sure. Here we first find the difference between the
            // destination and the urlString, and then we identify the
            // tokens in which this "difference" is falling, and we remove
            // them from the urlTokens.

            const startCharDifference = urlString.indexOf(destination) + destination.length;
            // upstream binds `difference = urlString.substring(startCharDifference)` but never uses it; preserved as a no-op.
            const newTokenPositions = Lexicon.getTokenPositions(
              startCharDifference,
              urlString.length,
              urlTokens,
            );

            if (newTokenPositions.end < 0) {
              // The difference is within the last token, even if we split
              // the layout tokens, here, it won't solve the problem so we
              // limit collateral damage. At some point we could return the
              // destination containing the clean URL to fill up the "target"
              // attribute in the TEI
              newTokenPositions.end = urlTokens.length - 1;
            }

            urlTokens = urlTokens.slice(0, newTokenPositions.end);
            endPos = startPos + LayoutTokensUtil.toText(urlTokens).length;
          } else {
            // In this case the regex has catches too much, usually this
            // should be limited to a few characters NOTE: Here it might not
            // contain the URL string just because of space TODO: stop after
            // a few characters instead of reaching zero?

            urlTokens = urlTokens.slice(0, correctedLastTokenIndex + 1);
            endPos = startPos + LayoutTokensUtil.toText(urlTokens).length;
          }
        }
      }

      // finally avoid ending a URL by a dot, because it can harm the
      // sentence segmentation
      const lastText = (urlTokens[urlTokens.length - 1]!.getText() ?? "");
      if (lastText.endsWith(".")) {
        endPos = endPos - 1;
      } else if (lastText.endsWith(")")) {
        const joined = LayoutTokensUtil.toText(urlTokens);
        let openedParenthesis = 0;
        let closedParenthesis = 0;
        for (let i = 0; i < joined.length; i++) {
          if (joined.charAt(i) === "(") openedParenthesis++;
          if (joined.charAt(i) === ")") closedParenthesis++;
        }
        if (openedParenthesis < closedParenthesis) {
          endPos = endPos - 1;
        }
      }

      const position = new OffsetPosition();
      position.start = startPos;
      position.end = endPos;
      // LF: if the destination is null, we will use the URL string int he
      // tei construction
      resultPositions.push(new Pair<OffsetPosition, string | null>(position, destination));
    }
    return resultPositions;
  }

  /**
   * Find and return the PDFAnnotation that best matches the given URL
   * tokens, based on their coordinates, destination, or the last tokens in
   * the sequence. This helps refine the association between detected URLs
   * in the text and their corresponding PDF annotations, improving the
   * accuracy of URL extraction from PDF documents.
   *
   * (Upstream line 1588-1643.)
   */
  private static matchPdfAnnotationsBasedOnCoordinatesDestinationOrLastTokens(
    pdfAnnotations: PDFAnnotation[],
    urlTokens: LayoutToken[],
  ): PDFAnnotation | null {
    const lastToken = urlTokens[urlTokens.length - 1]!;
    const urlString = LayoutTokensUtil.toText(urlTokens);

    let possibleTargetAnnotations: PDFAnnotation[] = pdfAnnotations.filter(
      (pdfAnnotation) =>
        pdfAnnotation.getType() !== null &&
        pdfAnnotation.getType() === PDFAnnotationType.URI &&
        pdfAnnotation.cover(lastToken),
    );

    let targetAnnotation: PDFAnnotation | null;
    if (possibleTargetAnnotations.length > 1) {
      possibleTargetAnnotations = possibleTargetAnnotations.filter((pdfAnnotation) => {
        const dest = pdfAnnotation.getDestination();
        return dest !== null && dest.indexOf(urlString) !== -1;
      });

      if (possibleTargetAnnotations.length > 1) {
        // If the lastToken is any of ./:_ we should add the token before
        let index = urlTokens.length - 1;
        if (urlTokens.length > 1 && /^[.:_\-/]$/.test(lastToken.getText() ?? "")) {
          index -= 1;
        }

        while (index > 0 && possibleTargetAnnotations.length > 1) {
          const lastTokenText2 = LayoutTokensUtil.toText(
            urlTokens.slice(index - 1, urlTokens.length),
          );

          possibleTargetAnnotations = possibleTargetAnnotations.filter((pdfAnnotation) => {
            const dest = pdfAnnotation.getDestination();
            return dest !== null && dest.indexOf(lastTokenText2) !== -1;
          });
          index--;
        }

        targetAnnotation = possibleTargetAnnotations.length > 0 ? possibleTargetAnnotations[0]! : null;
      } else {
        targetAnnotation = possibleTargetAnnotations.length > 0 ? possibleTargetAnnotations[0]! : null;
      }
    } else {
      targetAnnotation = possibleTargetAnnotations.length > 0 ? possibleTargetAnnotations[0]! : null;
    }

    return targetAnnotation;
  }

  /**
   * Identify in tokenized input the positions of an email address pattern
   * with token positions.
   *
   * (Upstream line 1649-1661.)
   */
  public tokenPositionsEmailPattern(tokens: LayoutToken[]): OffsetPosition[] {
    const text = LayoutTokensUtil.toText(tokens);
    if (text.indexOf("@") === -1) return [];
    const textResult: OffsetPosition[] = [];
    EMAIL_PATTERN_G.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = EMAIL_PATTERN_G.exec(text)) !== null) {
      textResult.push(new OffsetPosition(m.index, m.index + m[0].length));
      if (m[0].length === 0) EMAIL_PATTERN_G.lastIndex++;
    }
    return Utilities.convertStringOffsetToTokenOffset(textResult, tokens);
  }
}
