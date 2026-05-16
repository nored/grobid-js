// Port of org.grobid.core.data.Affiliation.
// Upstream: grobid-core/src/main/java/org/grobid/core/data/Affiliation.java
//
// Class for representing and exchanging affiliation information.

import type { TaggingLabel } from "../engines/label/tagging-label.js";
import { LayoutToken } from "../layout/layout-token.js";
import { Lexicon } from "../lexicon/lexicon.js";
import { LayoutTokensUtil } from "../utilities/layout-tokens-util.js";
import { TextUtilities } from "../utilities/text-utilities.js";

/**
 * Minimal view of `GrobidAnalysisConfig` used by `Affiliation.toTEI`.
 * The full port lives in `engines/config/grobid-analysis-config.ts` (mid-port
 * sibling); we accept any object exposing `getGenerateTeiCoordinates()`.
 */
interface GrobidAnalysisConfigLike {
  getGenerateTeiCoordinates(): string[] | null | undefined;
}

/**
 * Class for representing and exchanging affiliation information.
 */
export class Affiliation {

  private acronym: string | null = null;
  private name: string | null = null;
  private url: string | null = null;
  private institutions: string[] | null = null; // for additional institutions
  private departments: string[] | null = null; // for additional departments
  private laboratories: string[] | null = null; // for additional laboratories

  private country: string | null = null;
  private postCode: string | null = null;
  private postBox: string | null = null;
  private region: string | null = null;
  private settlement: string | null = null;
  private addrLine: string | null = null;
  private marker: string | null = null;

  private addressString: string | null = null; // unspecified address field
  private affiliationString: string | null = null; // unspecified affiliation field
  private rawAffiliationString: string | null = null; // raw affiliation+address text (excluding marker)

  private failAffiliation: boolean = true; // tag for unresolved affiliation attachment

  private isInfrastructureField: boolean = false; // if true, the affiliation is a research infrastructure

  private layoutTokens: LayoutToken[] | null = null;

  // map of model labels to LayoutToken
  private labeledTokens: Map<string, LayoutToken[]> | null = null;

  // an identifier for the affiliation independent from the marker, present in the TEI result
  private key: string | null = null;

  // default indo-european delimiters, should be moved to language specific analysers
  static delimiters: string = " \n\t" + TextUtilities.fullPunctuations + "。、，・";

  // Upstream has two constructors:
  //   Affiliation()
  //   Affiliation(Affiliation aff)  — copy constructor
  // Collapsed into a single signature.
  constructor(aff?: Affiliation) {
    if (aff === undefined) {
      return;
    }
    this.acronym = aff.getAcronym();
    this.name = aff.getName();
    this.url = aff.getURL();
    this.addressString = aff.getAddressString();
    this.country = aff.getCountry();
    this.marker = aff.getMarker();
    this.departments = aff.getDepartments();
    this.institutions = aff.getInstitutions();
    this.laboratories = aff.getLaboratories();
    this.postCode = aff.getPostCode();
    this.postBox = aff.getPostBox();
    this.region = aff.getRegion();
    this.settlement = aff.getSettlement();
    this.addrLine = aff.getAddrLine();
    this.affiliationString = aff.getAffiliationString();
    this.rawAffiliationString = aff.getRawAffiliationString();
    this.layoutTokens = aff.getLayoutTokens();
    this.isInfrastructureField = aff.isInfrastructure();
  }

  getAcronym(): string | null {
    return this.acronym;
  }

  getName(): string | null {
    return this.name;
  }

  getURL(): string | null {
    return this.url;
  }

  getAddressString(): string | null {
    return this.addressString;
  }

  getCountry(): string | null {
    return this.country;
  }

  getMarker(): string | null {
    return this.marker;
  }

  getPostCode(): string | null {
    return this.postCode;
  }

  getPostBox(): string | null {
    return this.postBox;
  }

  getRegion(): string | null {
    return this.region;
  }

  getSettlement(): string | null {
    return this.settlement;
  }

  getAddrLine(): string | null {
    return this.addrLine;
  }

  getAffiliationString(): string | null {
    return this.affiliationString;
  }

  getRawAffiliationString(): string | null {
    return this.rawAffiliationString;
  }

  getInstitutions(): string[] | null {
    return this.institutions;
  }

  getLaboratories(): string[] | null {
    return this.laboratories;
  }

  getDepartments(): string[] | null {
    return this.departments;
  }

  getKey(): string | null {
    return this.key;
  }

  setAcronym(s: string | null): void {
    this.acronym = s;
  }

  setName(s: string | null): void {
    this.name = s;
  }

  setURL(s: string | null): void {
    this.url = s;
  }

  setAddressString(s: string | null): void {
    this.addressString = s;
  }

  setCountry(s: string | null): void {
    if (s !== null) {
      s = TextUtilities.removeLeadingAndTrailingChars(s, "[({.,])}: \n", "[({.,])}: \n");
    }
    this.country = s;
  }

  setMarker(s: string | null): void {
    this.marker = s;
  }

  setPostCode(s: string | null): void {
    this.postCode = s;
  }

  setPostBox(s: string | null): void {
    this.postBox = s;
  }

  setRegion(s: string | null): void {
    if (s !== null) {
      s = TextUtilities.removeLeadingAndTrailingChars(s, "[({.,])}: \n", "[({.,])}: \n");
    }
    this.region = s;
  }

  setSettlement(s: string | null): void {
    if (s !== null) {
      s = TextUtilities.removeLeadingAndTrailingChars(s, "[({.,])}: \n", "[({.,])}: \n");
    }
    this.settlement = s;
  }

  setAddrLine(s: string | null): void {
    this.addrLine = s;
  }

  setAffiliationString(s: string | null): void {
    this.affiliationString = s;
  }

  setRawAffiliationString(s: string | null): void {
    this.rawAffiliationString = s;
    // upstream calls `rawAffiliationString.replaceAll("( )+", " ")` unconditionally,
    // which would NPE if s was null. We replicate the behaviour: only normalize when set.
    if (this.rawAffiliationString !== null) {
      this.rawAffiliationString = this.rawAffiliationString.replace(/( )+/g, " ");
    }
  }

  setInstitutions(affs: string[] | null): void {
    this.institutions = affs;
  }

  addInstitution(aff: string): void {
    if (this.institutions === null)
      this.institutions = [];
    this.institutions.push(TextUtilities.cleanField(aff, true)!);
  }

  setDepartments(affs: string[] | null): void {
    this.departments = affs;
  }

  addDepartment(aff: string): void {
    if (this.departments === null)
      this.departments = [];
    this.departments.push(TextUtilities.cleanField(aff, true)!);
  }

  setLaboratories(affs: string[] | null): void {
    this.laboratories = affs;
  }

  addLaboratory(aff: string): void {
    if (this.laboratories === null)
      this.laboratories = [];
    this.laboratories.push(TextUtilities.cleanField(aff, true)!);
  }

  isInfrastructure(): boolean {
    return this.isInfrastructureField;
  }

  setInfrastructure(boolValue: boolean): void {
    this.isInfrastructureField = boolValue;
  }

  /**
   * DEPRECATED
   */
  extendFirstInstitution(theExtend: string): void {
    if (this.institutions === null) {
      this.institutions = [];
      this.institutions.push(TextUtilities.cleanField(theExtend, true)!);
    } else {
      let first = this.institutions[0]!;
      first = first + theExtend;
      this.institutions[0] = first;
    }
  }

  /**
   * DEPRECATED
   */
  extendLastInstitution(theExtend: string): void {
    if (this.institutions === null) {
      this.institutions = [];
      this.institutions.push(TextUtilities.cleanField(theExtend, true)!);
    } else {
      let first = this.institutions[this.institutions.length - 1]!;
      first = first + theExtend;
      this.institutions[this.institutions.length - 1] = first;
    }
  }

  /**
   * DEPRECATED
   */
  extendFirstDepartment(theExtend: string): void {
    if (this.departments === null) {
      this.departments = [];
      this.departments.push(TextUtilities.cleanField(theExtend, true)!);
    } else {
      let first = this.departments[0]!;
      first = first + theExtend;
      this.departments[0] = first;
    }
  }

  /**
   * DEPRECATED
   */
  extendLastDepartment(theExtend: string): void {
    if (this.departments === null) {
      this.departments = [];
      this.departments.push(TextUtilities.cleanField(theExtend, true)!);
    } else {
      let first = this.departments[this.departments.length - 1]!;
      first = first + theExtend;
      this.departments[this.departments.length - 1] = first;
    }
  }

  /**
   * DEPRECATED
   */
  extendFirstLaboratory(theExtend: string): void {
    if (this.laboratories === null) {
      this.laboratories = [];
      this.laboratories.push(TextUtilities.cleanField(theExtend, true)!);
    } else {
      let first = this.laboratories[0]!;
      first = first + theExtend;
      this.laboratories[0] = first;
    }
  }

  /**
   * DEPRECATED
   */
  extendLastLaboratory(theExtend: string): void {
    if (this.laboratories === null) {
      this.laboratories = [];
      this.laboratories.push(TextUtilities.cleanField(theExtend, true)!);
    } else {
      let first = this.laboratories[this.laboratories.length - 1]!;
      first = first + theExtend;
      this.laboratories[this.laboratories.length - 1] = first;
    }
  }

  isNotNull(): boolean {
    return !((this.departments === null) &&
      (this.institutions === null) &&
      (this.laboratories === null) &&
      (this.country === null) &&
      (this.postCode === null) &&
      (this.postBox === null) &&
      (this.region === null) &&
      (this.settlement === null) &&
      (this.addrLine === null) &&
      (this.affiliationString === null) &&
      (this.rawAffiliationString === null) &&
      (this.addressString === null));
  }

  isNotEmptyAffiliation(): boolean {
    return !((this.departments === null) &&
      (this.institutions === null) &&
      (this.laboratories === null) &&
      (this.affiliationString === null) &&
      (this.rawAffiliationString === null));
  }

  hasAddress(): boolean {
    if (this.country !== null ||
      this.postCode !== null ||
      this.postBox !== null ||
      this.settlement !== null ||
      this.addrLine !== null ||
      this.region !== null ||
      this.addressString !== null) {
      return true;
    } else
      return false;
  }

  setFailAffiliation(b: boolean): void {
    this.failAffiliation = b;
  }

  getFailAffiliation(): boolean {
    return this.failAffiliation;
  }

  setKey(key: string | null): void {
    this.key = key;
  }

  getLayoutTokens(): LayoutToken[] | null {
    return this.layoutTokens;
  }

  setLayoutTokens(tokens: LayoutToken[] | null): void {
    this.layoutTokens = tokens;
  }

  appendLayoutTokens(tokens: LayoutToken[]): void {
    if (this.layoutTokens === null)
      this.layoutTokens = [];
    for (const t of tokens) this.layoutTokens.push(t);
  }

  clean(): void {
    if (this.departments !== null) {
      const newDepartments: string[] = [];
      for (const department of this.departments) {
        const dep = TextUtilities.cleanField(department, true);
        if (dep !== null && dep.length > 2) {
          newDepartments.push(dep);
        }
      }
      this.departments = newDepartments;
    }

    if (this.institutions !== null) {
      const newInstitutions: string[] = [];
      for (const institution of this.institutions) {
        const inst = TextUtilities.cleanField(institution, true);
        if (inst !== null && inst.length > 1) {
          newInstitutions.push(inst);
        }
      }
      this.institutions = newInstitutions;
    }

    if (this.laboratories !== null) {
      const newLaboratories: string[] = [];
      for (const laboratorie of this.laboratories) {
        const inst = TextUtilities.cleanField(laboratorie, true);
        if (inst !== null && inst.length > 2) {
          newLaboratories.push(inst);
        }
      }
      this.laboratories = newLaboratories;
    }

    if (this.country !== null) {
      this.country = TextUtilities.cleanField(this.country, true);
      if (this.country !== null && this.country.endsWith(")")) {
        // for some reason the ) at the end of this field is not removed
        this.country = this.country.substring(0, this.country.length - 1);
      }
      if (this.country !== null && this.country.length < 2)
        this.country = null;
    }
    if (this.postCode !== null) {
      this.postCode = TextUtilities.cleanField(this.postCode, true);
      if (this.postCode !== null && this.postCode.length < 2)
        this.postCode = null;
    }
    if (this.postBox !== null) {
      this.postBox = TextUtilities.cleanField(this.postBox, true);
      if (this.postBox !== null && this.postBox.length < 2)
        this.postBox = null;
    }
    if (this.region !== null) {
      this.region = TextUtilities.cleanField(this.region, true);
      if (this.region !== null && this.region.length < 2)
        this.region = null;
    }
    if (this.settlement !== null) {
      this.settlement = TextUtilities.cleanField(this.settlement, true);
      if (this.settlement !== null && this.settlement.length < 2)
        this.settlement = null;
    }
    if (this.addrLine !== null) {
      this.addrLine = TextUtilities.cleanField(this.addrLine, true);
      if (this.addrLine !== null && this.addrLine.length < 2)
        this.addrLine = null;
    }
    if (this.addressString !== null) {
      this.addressString = TextUtilities.cleanField(this.addressString, true);
      if (this.addressString !== null && this.addressString.length < 2)
        this.addressString = null;
    }
    if (this.affiliationString !== null) {
      this.affiliationString = TextUtilities.cleanField(this.affiliationString, true);
      if (this.affiliationString !== null && this.affiliationString.length < 2)
        this.affiliationString = null;
    }
    if (this.marker !== null) {
      this.marker = TextUtilities.cleanField(this.marker, true);
      if (this.marker !== null)
        this.marker = this.marker.replace(/ /g, "");
    }
  }

  /**
   * Return the number of overall structure members (address included)
   */
  nbStructures(): number {
    let nbStruct = 0;
    if (this.departments !== null) {
      nbStruct += this.departments.length;
    }
    if (this.institutions !== null) {
      nbStruct += this.institutions.length;
    }
    if (this.laboratories !== null) {
      nbStruct += this.laboratories.length;
    }
    if (this.country !== null) {
      nbStruct++;
    }
    if (this.postCode !== null) {
      nbStruct++;
    }
    if (this.postBox !== null) {
      nbStruct++;
    }
    if (this.region !== null) {
      nbStruct++;
    }
    if (this.settlement !== null) {
      nbStruct++;
    }
    if (this.addrLine !== null) {
      nbStruct++;
    }
    if (this.marker !== null) {
      nbStruct++;
    }
    return nbStruct;
  }

  static toTEI(aff: Affiliation, nbTag: number, config?: GrobidAnalysisConfigLike | null): string {
    const tei: string[] = [];
    TextUtilities.appendN(tei, "\t", nbTag + 1);

    const teiCoords: string[] | null | undefined = (config !== null && config !== undefined) ? config.getGenerateTeiCoordinates() : null;
    const withAffCoords: boolean = (config !== null && config !== undefined) &&
      (teiCoords !== null && teiCoords !== undefined) &&
      (teiCoords as string[]).includes("affiliation");
    // upstream declares `orgNameCoords` but never reads it — preserved as dead local
    // for byte-for-byte parity with the Java source.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const orgNameCoords: boolean = (config !== null && config !== undefined) &&
      (teiCoords !== null && teiCoords !== undefined) &&
      (teiCoords as string[]).includes("orgName");

    tei.push("<affiliation");
    if (aff.getKey() !== null)
      tei.push(" key=\"", aff.getKey()!, "\"");
    if (withAffCoords) {
      const layoutToks = aff.getLayoutTokens();
      const coords = layoutToks !== null ? LayoutTokensUtil.getCoordsString(layoutToks) : null;
      if (coords !== null && coords.length > 0) {
        tei.push(" coords=\"" + coords + "\"");
      }
    }
    tei.push(">\n");

    if (aff.getDepartments() !== null) {
      if (aff.getDepartments()!.length === 1) {
        TextUtilities.appendN(tei, "\t", nbTag + 2);
        tei.push("<orgName type=\"department\">" +
          TextUtilities.HTMLEncode(aff.getDepartments()![0]!) + "</orgName>\n");
      } else {
        let q = 1;
        for (const depa of aff.getDepartments()!) {
          TextUtilities.appendN(tei, "\t", nbTag + 2);
          tei.push("<orgName type=\"department\" key=\"dep" + q + "\">" +
            TextUtilities.HTMLEncode(depa) + "</orgName>\n");
          q++;
        }
      }
    }

    if (aff.getLaboratories() !== null) {
      if (aff.getLaboratories()!.length === 1) {
        TextUtilities.appendN(tei, "\t", nbTag + 2);
        tei.push("<orgName type=\"laboratory\">" +
          TextUtilities.HTMLEncode(aff.getLaboratories()![0]!) + "</orgName>\n");
      } else {
        let q = 1;
        for (const labo of aff.getLaboratories()!) {
          TextUtilities.appendN(tei, "\t", nbTag + 2);
          tei.push("<orgName type=\"laboratory\" key=\"lab" + q + "\">" +
            TextUtilities.HTMLEncode(labo) + "</orgName>\n");
          q++;
        }
      }
    }

    if (aff.getInstitutions() !== null) {
      if (aff.getInstitutions()!.length === 1) {
        TextUtilities.appendN(tei, "\t", nbTag + 2);
        tei.push("<orgName type=\"institution\">" +
          TextUtilities.HTMLEncode(aff.getInstitutions()![0]!) + "</orgName>\n");
      } else {
        let q = 1;
        for (const inst of aff.getInstitutions()!) {
          TextUtilities.appendN(tei, "\t", nbTag + 2);
          tei.push("<orgName type=\"institution\" key=\"instit" + q + "\">" +
            TextUtilities.HTMLEncode(inst) + "</orgName>\n");
          q++;
        }
      }
    }

    if (
      aff.getAddrLine() !== null ||
      aff.getPostBox() !== null ||
      aff.getPostCode() !== null ||
      aff.getSettlement() !== null ||
      aff.getRegion() !== null ||
      aff.getCountry() !== null
    ) {
      TextUtilities.appendN(tei, "\t", nbTag + 2);

      tei.push("<address>\n");
      /*if (aff.getAddressString() != null) {
          TextUtilities.appendN(tei, '\t', nbTag + 3);
          tei.append("<addrLine>" + TextUtilities.HTMLEncode(aff.getAddressString()) +
                  "</addrLine>\n");
      }*/
      if (aff.getAddrLine() !== null) {
        TextUtilities.appendN(tei, "\t", nbTag + 3);
        tei.push("<addrLine>" + TextUtilities.HTMLEncode(aff.getAddrLine()) +
          "</addrLine>\n");
      }
      if (aff.getPostBox() !== null) {
        TextUtilities.appendN(tei, "\t", nbTag + 3);
        tei.push("<postBox>" + TextUtilities.HTMLEncode(aff.getPostBox()) +
          "</postBox>\n");
      }
      if (aff.getPostCode() !== null) {
        TextUtilities.appendN(tei, "\t", nbTag + 3);
        tei.push("<postCode>" + TextUtilities.HTMLEncode(aff.getPostCode()) +
          "</postCode>\n");
      }
      if (aff.getSettlement() !== null) {
        TextUtilities.appendN(tei, "\t", nbTag + 3);
        tei.push("<settlement>" + TextUtilities.HTMLEncode(aff.getSettlement()) +
          "</settlement>\n");
      }
      if (aff.getRegion() !== null) {
        TextUtilities.appendN(tei, "\t", nbTag + 3);
        tei.push("<region>" + TextUtilities.HTMLEncode(aff.getRegion()) +
          "</region>\n");
      }
      if (aff.getCountry() !== null) {
        const code = Lexicon.getInstance().getCountryCode(aff.getCountry()!);
        TextUtilities.appendN(tei, "\t", nbTag + 3);
        tei.push("<country");
        if (code !== null && code !== undefined)
          tei.push(" key=\"" + code + "\"");
        tei.push(">" + TextUtilities.HTMLEncode(aff.getCountry()) +
          "</country>\n");
      }

      TextUtilities.appendN(tei, "\t", nbTag + 2);
      tei.push("</address>\n");
    }

    TextUtilities.appendN(tei, "\t", nbTag + 1);
    tei.push("</affiliation>\n");

    return tei.join("");
  }

  toString(): string {
    return "Affiliation{" +
      "name='" + this.name + "'" +
      ", url='" + this.url + "'" +
      ", key='" + this.key + "'" +
      ", institutions=" + this.institutions +
      ", departments=" + this.departments +
      ", laboratories=" + this.laboratories +
      ", country='" + this.country + "'" +
      ", postCode='" + this.postCode + "'" +
      ", postBox='" + this.postBox + "'" +
      ", region='" + this.region + "'" +
      ", settlement='" + this.settlement + "'" +
      ", addrLine='" + this.addrLine + "'" +
      ", marker='" + this.marker + "'" +
      ", addressString='" + this.addressString + "'" +
      ", affiliationString='" + this.affiliationString + "'" +
      ", rawAffiliationString='" + this.rawAffiliationString + "'" +
      ", failAffiliation=" + this.failAffiliation + "'" +
      ", isInfrastructure=" + this.isInfrastructureField +
      "}";
  }

  addLabeledResult(label: TaggingLabel, tokenizations: LayoutToken[] | null): void {
    if (this.labeledTokens === null)
      this.labeledTokens = new Map<string, LayoutToken[]>();

    let theTokenList: LayoutToken[];
    if (tokenizations === null)
      theTokenList = [];
    else
      theTokenList = tokenizations;

    const theExistingTokenList = this.labeledTokens.get(label.getLabel());
    if (theExistingTokenList !== undefined) {
      for (const t of theTokenList) theExistingTokenList.push(t);
      theTokenList = theExistingTokenList;
    }

    this.labeledTokens.set(label.getLabel(), theTokenList);
  }

  getLabeledResult(label: TaggingLabel): LayoutToken[] | undefined {
    return this.labeledTokens === null ? undefined : this.labeledTokens.get(label.getLabel());
  }
}
