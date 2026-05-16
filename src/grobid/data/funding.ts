// Port of org.grobid.core.data.Funding.
// Upstream: grobid-core/src/main/java/org/grobid/core/data/Funding.java

import type { LayoutToken } from "../layout/layout-token.js";
import { KeyGen } from "../utilities/key-gen.js";
import { LayoutTokensUtil } from "../utilities/layout-tokens-util.js";
import { TextUtilities } from "../utilities/text-utilities.js";
import type { GrobidDate } from "./date.js";
import { Funder } from "./funder.js";

/**
 * Class for representing a funding/grant.
 */
export class Funding {
  private funder: Funder | null = null;

  // this is an identifier for identifying and referencing the funding inside the full document
  private identifier: string | null = null;

  // program or call
  private programFullName: string | null = null;
  private programFullNameLayoutTokens: LayoutToken[] = [];

  private programAbbreviatedName: string | null = null;
  private programAbbreviatedNameLayoutTokens: LayoutToken[] = [];

  private grantNumber: string | null = null;
  private grantNumberLayoutTokens: LayoutToken[] = [];

  private grantName: string | null = null;
  private grantNameLayoutTokens: LayoutToken[] = [];

  private projectFullName: string | null = null;
  private projectFullNameLayoutTokens: LayoutToken[] = [];

  // Java has both a field `projectAbbreviatedName` (private) and an accessor
  // method `projectAbbreviatedName()`. TS cannot share the same name, so the
  // backing field is renamed and only the method is exposed publicly.
  private _projectAbbreviatedName: string | null = null;
  private projectAbbreviatedNameLayoutTokens: LayoutToken[] = [];

  private url: string | null = null;
  private urlLayoutTokens: LayoutToken[] = [];

  private layoutTokens: LayoutToken[] = [];

  private start: GrobidDate | null = null;
  private end: GrobidDate | null = null;

  getFunder(): Funder | null {
    return this.funder;
  }

  setFunder(funder: Funder | null): void {
    this.funder = funder;
  }

  getProgramFullName(): string | null {
    return this.programFullName;
  }

  setProgramFullName(programFullName: string | null): void {
    this.programFullName = programFullName;
  }

  appendProgramFullNameLayoutTokens(layoutTokens: LayoutToken[]): void {
    for (const t of layoutTokens) this.programFullNameLayoutTokens.push(t);
  }

  getProgramFullNameLayoutTokens(): LayoutToken[] {
    return this.programFullNameLayoutTokens;
  }

  getProgramAbbreviatedName(): string | null {
    return this.programAbbreviatedName;
  }

  setProgramAbbreviatedName(programAbbreviatedName: string | null): void {
    this.programAbbreviatedName = programAbbreviatedName;
  }

  appendProgramAbbreviatedNameLayoutTokens(layoutTokens: LayoutToken[]): void {
    for (const t of layoutTokens) this.programAbbreviatedNameLayoutTokens.push(t);
  }

  getProgramAbbreviatedNameLayoutTokens(): LayoutToken[] {
    return this.programAbbreviatedNameLayoutTokens;
  }

  getGrantNumber(): string | null {
    return this.grantNumber;
  }

  setGrantNumber(grantNumber: string | null): void {
    if (grantNumber != null && grantNumber.startsWith("n˚")) {
      grantNumber = grantNumber.replace(/n˚/g, "");
    }
    this.grantNumber = grantNumber;
  }

  appendGrantNumberLayoutTokens(layoutTokens: LayoutToken[]): void {
    for (const t of layoutTokens) this.grantNumberLayoutTokens.push(t);
  }

  getGrantNumberLayoutTokens(): LayoutToken[] {
    return this.grantNumberLayoutTokens;
  }

  getGrantName(): string | null {
    return this.grantName;
  }

  setGrantName(grantName: string | null): void {
    this.grantName = grantName;
  }

  appendGrantNameLayoutTokens(layoutTokens: LayoutToken[]): void {
    for (const t of layoutTokens) this.grantNameLayoutTokens.push(t);
  }

  getGrantNameLayoutTokens(): LayoutToken[] {
    return this.grantNameLayoutTokens;
  }

  getProjectFullName(): string | null {
    return this.projectFullName;
  }

  setProjectFullName(project: string | null): void {
    this.projectFullName = project;
  }

  appendProjectFullNameLayoutTokens(layoutTokens: LayoutToken[]): void {
    for (const t of layoutTokens) this.projectFullNameLayoutTokens.push(t);
  }

  getProjectFullNameLayoutTokens(): LayoutToken[] {
    return this.projectFullNameLayoutTokens;
  }

  // Upstream method name uses `projectAbbreviatedName()` — preserved verbatim.
  projectAbbreviatedName(): string | null {
    return this._projectAbbreviatedName;
  }

  setProjectAbbreviatedName(project: string | null): void {
    this._projectAbbreviatedName = project;
  }

  appendProjectAbbreviatedNameLayoutTokens(layoutTokens: LayoutToken[]): void {
    for (const t of layoutTokens) this.projectAbbreviatedNameLayoutTokens.push(t);
  }

  getProjectAbbreviatedNameLayoutTokens(): LayoutToken[] {
    return this.projectAbbreviatedNameLayoutTokens;
  }

  getUrl(): string | null {
    return this.url;
  }

  setUrl(url: string | null): void {
    this.url = url;
  }

  getIdentifier(): string {
    if (this.identifier == null) {
      const localId = KeyGen.getKey().substring(0, 7);
      this.identifier = "_" + localId;
    }
    return this.identifier;
  }

  setIdentifier(identifier: string | null): void {
    this.identifier = identifier;
  }

  appendUrlLayoutTokens(layoutTokens: LayoutToken[]): void {
    for (const t of layoutTokens) this.urlLayoutTokens.push(t);
  }

  getUrlLayoutTokens(): LayoutToken[] {
    return this.urlLayoutTokens;
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

  isValid(): boolean {
    if (
      this.funder != null ||
      this.grantNumber != null ||
      this.grantName != null ||
      this.projectFullName != null ||
      this._projectAbbreviatedName != null ||
      this.programFullName != null ||
      this.programAbbreviatedName != null ||
      this.url != null
    ) {
      return true;
    } else {
      return false;
    }
  }

  isNonEmptyFunding(): boolean {
    if (
      this.grantNumber != null ||
      this.grantName != null ||
      this.projectFullName != null ||
      this._projectAbbreviatedName != null ||
      this.programFullName != null ||
      this.programAbbreviatedName != null ||
      this.url != null
    ) {
      return true;
    } else {
      return false;
    }
  }

  /**
   * For the given funder instance, try to define the acronym, either as part of the current
   * full name, or as prefix in the grant number for some well-known funders.
   **/
  inferAcronyms(): void {
    if (this.funder == null || this.funder.getFullNameLayoutTokens() == null) {
      return;
    }
    // System.out.println(LayoutTokensUtil.toText(funder.getFullNameLayoutTokens()));

    // check if full name contains acronym
    // Java returns Pair<OffsetPosition, OffsetPosition>; our Pair uses a/b
    // (mirroring `getLeft`/`getRight` from Apache commons-lang).
    const acronymCandidate = TextUtilities.fieldAcronymCandidate(this.funder.getFullNameLayoutTokens());
    if (acronymCandidate != null) {
      const acronymPosition = acronymCandidate.a;
      const basePosition = acronymCandidate.b;

      // System.out.println(LayoutTokensUtil.toText(funder.getFullNameLayoutTokens().subList(acronymPosition.start, acronymPosition.end)));
      // System.out.println(LayoutTokensUtil.toText(funder.getFullNameLayoutTokens().subList(basePosition.start, basePosition.end)));

      // post validate acronym candidate: we need matching with base component
      // get first letter profile for the tokens
      let profileBase = "";
      for (const token of this.funder.getFullNameLayoutTokens()) {
        const txt = token.getText();
        if (txt == null || txt.length === 0) continue;
        profileBase += txt.charAt(0);
      }
      const acronymString = LayoutTokensUtil.toText(
        this.funder.getFullNameLayoutTokens().slice(acronymPosition.start, acronymPosition.end),
      );
      const profileBaseString = profileBase;
      let validAcronym = true;
      let profilePosIndex = 0;
      for (let i = 0; i < acronymString.length; i++) {
        const theChar = acronymString.charAt(i);
        const posMatch = profileBaseString.indexOf(theChar, profilePosIndex);
        if (posMatch === -1) {
          validAcronym = false;
          break;
        } else {
          profilePosIndex = posMatch;
        }
      }

      if (validAcronym) {
        this.funder.setAbbreviatedName(acronymString);
        this.funder.setAbbreviatedNameLayoutTokens(
          this.funder.getFullNameLayoutTokens().slice(acronymPosition.start, acronymPosition.end),
        );

        this.funder.setFullName(
          LayoutTokensUtil.toText(
            this.funder.getFullNameLayoutTokens().slice(basePosition.start, basePosition.end),
          ),
        );
        this.funder.setFullNameLayoutTokens(
          this.funder.getFullNameLayoutTokens().slice(basePosition.start, basePosition.end),
        );
      }
    }

    // check the grant number prefix
    if (this.funder.getAbbreviatedName() == null && this.grantNumber != null) {
      for (const [key, value] of Funder.prefixFounders) {
        if (this.grantNumber.startsWith(key + "-")) {
          this.funder.setAbbreviatedName(key);
          this.funder.setAbbreviatedNameLayoutTokens(null);
          this.funder.setFullName(value);
          this.funder.setFullNameLayoutTokens(null);
          break;
        }
      }
    }

    // check if full name is an acronym
    if (this.funder.getAbbreviatedName() == null && this.funder.getFullName() != null) {
      for (const [key, value] of Funder.prefixFounders) {
        if (this.funder.getFullName() === key) {
          this.funder.setAbbreviatedName(key);
          this.funder.setAbbreviatedNameLayoutTokens(this.funder.getFullNameLayoutTokens());
          this.funder.setFullName(value);
          this.funder.setFullNameLayoutTokens(null);
          break;
        }
      }
    }
  }

  toString(): string {
    let builder = "";
    if (this.funder != null) builder += "funder: " + this.funder.toString() + "\n";
    if (this.grantName != null) builder += "grant name: " + this.grantName + "\n";
    if (this.grantNumber != null) builder += "grant number: " + this.grantNumber + "\n";
    if (this.projectFullName != null) builder += "project name: " + this.projectFullName + "\n";
    if (this._projectAbbreviatedName != null) builder += "project abbreviated name: " + this._projectAbbreviatedName + "\n";
    if (this.programFullName != null) builder += "program name: " + this.programFullName + "\n";
    if (this.programAbbreviatedName != null) builder += "program abbreviated name: " + this.programAbbreviatedName + "\n";
    if (this.url != null) builder += "url: " + this.url + "\n";
    return builder;
  }

  toJson(): string {
    let json = "";
    let start = false;
    json += "{\n";
    if (this.funder != null) {
      json += this.funder.toJson();
      start = true;
    }
    if (this.grantNumber != null) {
      if (start) {
        json += ",\n";
      }
      json += "\"grantNumber\": \"";
      json += this.grantNumber + "\"";
      start = true;
    }
    // to be completed...

    json += "\n}";
    return json;
  }

  /** Java overloads: toTEI() / toTEI(int nbIndent). */
  toTEI(nbIndent: number = 0): string {
    let tei = "";

    let localType = "funding";
    if (this.projectFullName != null || this._projectAbbreviatedName != null) {
      localType = "funded-project";
    }

    if (this.identifier == null) {
      const localId = KeyGen.getKey().substring(0, 7);
      this.identifier = "_" + localId;
    }

    for (let i = 0; i < nbIndent; i++) tei += "\t";
    tei += "<org type=\"" + localType + "\" xml:id=\"" + this.identifier + "\">\n";

    if (this.grantNumber != null) {
      for (let i = 0; i < nbIndent + 1; i++) tei += "\t";
      tei += "<idno type=\"grant-number\">" + TextUtilities.HTMLEncode(this.grantNumber) + "</idno>\n";
    }

    if (this.grantName != null) {
      for (let i = 0; i < nbIndent + 1; i++) tei += "\t";
      tei += "<orgName type=\"grant-name\">" + TextUtilities.HTMLEncode(this.grantName) + "</orgName>\n";
    }

    if (this.projectFullName != null) {
      for (let i = 0; i < nbIndent + 1; i++) tei += "\t";
      tei += "<orgName type=\"project\" subtype=\"full\">" + TextUtilities.HTMLEncode(this.projectFullName) + "</orgName>\n";
    }
    if (this._projectAbbreviatedName != null) {
      for (let i = 0; i < nbIndent + 1; i++) tei += "\t";
      tei += "<orgName type=\"project\" subtype=\"abbreviated\">" + TextUtilities.HTMLEncode(this._projectAbbreviatedName) + "</orgName>\n";
    }
    if (this.programFullName != null) {
      for (let i = 0; i < nbIndent + 1; i++) tei += "\t";
      tei += "<orgName type=\"program\" subtype=\"full\">" + TextUtilities.HTMLEncode(this.programFullName) + "</orgName>\n";
    }
    if (this.programAbbreviatedName != null) {
      for (let i = 0; i < nbIndent + 1; i++) tei += "\t";
      tei += "<orgName type=\"program\" subtype=\"abbreviated\">" + TextUtilities.HTMLEncode(this.programAbbreviatedName) + "</orgName>\n";
    }
    if (this.url != null) {
      for (let i = 0; i < nbIndent + 1; i++) tei += "\t";
      tei += "<ptr target=\"" + TextUtilities.HTMLEncode(this.url) + "\" />\n";
    }
    if (this.start != null) {
      let dateString = this.start.toTEI();
      dateString = dateString.replace("<date ", "<date type=\"start\" ");
      for (let i = 0; i < nbIndent + 1; i++) tei += "\t";
      tei += dateString;
    }
    if (this.end != null) {
      let dateString = this.end.toTEI();
      dateString = dateString.replace("<date ", "<date type=\"end\" ");
      for (let i = 0; i < nbIndent + 1; i++) tei += "\t";
      tei += dateString;
    }

    for (let i = 0; i < nbIndent; i++) tei += "\t";
    tei += "</org>\n";

    return tei;
  }
}
