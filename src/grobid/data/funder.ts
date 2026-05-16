// Port of org.grobid.core.data.Funder.
// Upstream: grobid-core/src/main/java/org/grobid/core/data/Funder.java

import type { LayoutToken } from "../layout/layout-token.js";
import type { Language } from "../lang/language.js";
import { TextUtilities } from "../utilities/text-utilities.js";
import type { GrobidDate } from "./date.js";

// Upstream type is `org.grobid.core.data.Date`. To avoid the name clash
// with the JS built-in Date, the TS port exposes it as `GrobidDate`.

/**
 * Class for representing a funding organization.
 * Optionally the funder is identified by its DOI at CrossRef funder registry.
 */
export class Funder {
  // prefered full name
  private fullName: string | null = null;
  private fullNameLayoutTokens: LayoutToken[] = [];

  // full names by languages
  private fullNameByLanguage: Map<Language, string[]> = new Map();

  private abbreviatedName: string | null = null;
  private abbreviatedNameLayoutTokens: LayoutToken[] = [];

  // abbreviated names by languages
  private abbreviatedNameByLanguage: Map<Language, string[]> = new Map();

  private doi: string | null = null;

  // country or regional area (e.g. EU)
  private country: string | null = null;
  private countryCode: string | null = null;
  private address: string | null = null;
  private region: string | null = null;

  private startActiveDate: GrobidDate | null = null;
  private endActiveDate: GrobidDate | null = null;
  private preceededBy: Funder | null = null;
  private followedBy: Funder | null = null;

  private url: string | null = null;

  private crossrefFunderType: string | null = null;

  private layoutTokens: LayoutToken[] = [];

  // Java: `static public Funder EMPTY = new Funder("unknown")`.
  // Static class fields can't reference the class while it's being defined
  // in TS; we declare it here and initialize after the class body.
  static EMPTY: Funder;

  static prefixFounders: Map<string, string>;

  static {
    Funder.prefixFounders = new Map<string, string>();
    Funder.prefixFounders.set("ANR", "Agence Nationale de la Recherche");
    Funder.prefixFounders.set("NSF", "National Science Foundation");
    Funder.prefixFounders.set("NIH", "National Institutes of Health");
    Funder.prefixFounders.set("ERC", "European Research Council");
    // Japanese government
    Funder.prefixFounders.set("MEXT", "Ministry of Education, Culture, Sports, Science and Technology");
  }

  constructor(fullName?: string) {
    if (fullName !== undefined) {
      this.fullName = fullName;
    }
  }

  getFullName(): string | null {
    return this.fullName;
  }

  setFullName(fullName: string | null): void {
    this.fullName = fullName;
  }

  setFullNameLayoutTokens(layoutTokens: LayoutToken[] | null): void {
    // upstream allows null assignment via field write; preserve nullability
    this.fullNameLayoutTokens = (layoutTokens ?? []) as LayoutToken[];
  }

  appendFullNameLayoutTokens(layoutTokens: LayoutToken[]): void {
    for (const t of layoutTokens) this.fullNameLayoutTokens.push(t);
  }

  getFullNameLayoutTokens(): LayoutToken[] {
    return this.fullNameLayoutTokens;
  }

  getAbbreviatedName(): string | null {
    return this.abbreviatedName;
  }

  setAbbreviatedName(abbreviatedName: string | null): void {
    this.abbreviatedName = abbreviatedName;
  }

  setAbbreviatedNameLayoutTokens(layoutTokens: LayoutToken[] | null): void {
    this.abbreviatedNameLayoutTokens = (layoutTokens ?? []) as LayoutToken[];
  }

  appendAbbreviatedNameLayoutTokens(layoutTokens: LayoutToken[]): void {
    for (const t of layoutTokens) this.abbreviatedNameLayoutTokens.push(t);
  }

  getAbbreviatedNameLayoutTokens(): LayoutToken[] {
    return this.abbreviatedNameLayoutTokens;
  }

  getDoi(): string | null {
    return this.doi;
  }

  setDoi(doi: string | null): void {
    this.doi = doi;
  }

  getCountry(): string | null {
    return this.country;
  }

  setCountry(country: string | null): void {
    this.country = country;
  }

  getCountryCode(): string | null {
    return this.countryCode;
  }

  setCountryCode(countryCode: string | null): void {
    this.countryCode = countryCode;
  }

  getAddress(): string | null {
    return this.address;
  }

  setAddress(address: string | null): void {
    this.address = address;
  }

  getStartActiveDate(): GrobidDate | null {
    return this.startActiveDate;
  }

  setStartActiveDate(startActiveDate: GrobidDate | null): void {
    this.startActiveDate = startActiveDate;
  }

  getEndActiveDate(): GrobidDate | null {
    return this.endActiveDate;
  }

  setEndActiveDate(endActiveDate: GrobidDate | null): void {
    this.endActiveDate = endActiveDate;
  }

  getPreceededBy(): Funder | null {
    return this.preceededBy;
  }

  setPreceededBy(preceededBy: Funder | null): void {
    this.preceededBy = preceededBy;
  }

  getFollowedBy(): Funder | null {
    return this.followedBy;
  }

  setFollowedBy(followedBy: Funder | null): void {
    this.followedBy = followedBy;
  }

  getUrl(): string | null {
    return this.url;
  }

  setUrl(url: string | null): void {
    this.url = url;
  }

  getLayoutTokens(): LayoutToken[] {
    return this.layoutTokens;
  }

  setLayoutTokens(layoutTokens: LayoutToken[]): void {
    this.layoutTokens = layoutTokens;
  }

  addLayoutTokens(layoutTokens: LayoutToken[]): void {
    for (const t of layoutTokens) this.layoutTokens.push(t);
  }

  toString(): string {
    let builder = "";
    if (this.fullName != null) builder += this.fullName;
    if (this.abbreviatedName != null) builder += this.abbreviatedName;
    return builder;
  }

  toJson(): string {
    let json = "";
    let start = false;
    json += "{\n";
    if (this.fullName != null) {
      json += "\t\"fullName\": \"";
      json += this.fullName + "\"";
      start = true;
    }
    if (this.abbreviatedName != null) {
      if (start) {
        json += ",\n";
      }
      json += "\t\"abbreviatedName\": \"";
      json += this.abbreviatedName + "\"";
    }
    // to be completed...

    json += "\n}";
    return json;
  }

  /** Java overloads: toTEI() / toTEI(int nbIndent). */
  toTEI(nbIndent: number = 0): string {
    let tei = "";

    for (let i = 0; i < nbIndent; i++) tei += "\t";
    tei += "<funder>\n";

    if (this.fullName != null) {
      for (let i = 0; i < nbIndent + 1; i++) tei += "\t";
      tei += "<orgName type=\"full\">" + TextUtilities.HTMLEncode(this.fullName) + "</orgName>\n";
    }
    if (this.abbreviatedName != null) {
      for (let i = 0; i < nbIndent + 1; i++) tei += "\t";
      tei += "<orgName type=\"abbreviated\">" + TextUtilities.HTMLEncode(this.abbreviatedName) + "</orgName>\n";
    }
    if (this.doi != null) {
      for (let i = 0; i < nbIndent + 1; i++) tei += "\t";
      tei += "<idno type=\"DOI\" subtype=\"crossref\">" + TextUtilities.HTMLEncode(this.doi) + "</idno>\n";
    }

    for (let i = 0; i < nbIndent; i++) tei += "\t";
    tei += "</funder>\n";

    return tei;
  }
}

// Initialise static field that references the class.
Funder.EMPTY = new Funder("unknown");
