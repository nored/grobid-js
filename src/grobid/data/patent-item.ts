// Port of org.grobid.core.data.PatentItem.
// Upstream: grobid-core/src/main/java/org/grobid/core/data/PatentItem.java

import type { BoundingBox } from "../layout/bounding-box.js";
import { TextUtilities } from "../utilities/text-utilities.js";

/**
 * Class for managing patent bibliographical references.
 */
export class PatentItem {
  // attribute
  private authority: string | null = null;
  private number_epodoc: string | null = null;
  private number_wysiwyg: string | null = null;
  private kindCode: string | null = null;

  // patent type when applicable
  private application: boolean = false;
  private provisional: boolean = false;
  private reissued: boolean = false;
  private plant: boolean = false;
  private design: boolean = false;
  private utility: boolean = false;

  // scores
  private conf: number = 1.0;
  // private String confidence = null;

  // position in document
  private offset_begin: number = 0;
  private offset_end: number = 0;

  // position in raw string (in case of factorised numbers)
  private offset_raw: number = 0;

  // context of occurrence of the reference
  private context: string | null = null;

  // coordinates in the orignal layout (for PDF)
  private coordinates: BoundingBox[] | null = null;

  getAuthority(): string | null {
    return this.authority;
  }

  getNumberEpoDoc(): string | null {
    return this.number_epodoc;
  }

  getNumberWysiwyg(): string | null {
    return this.number_wysiwyg;
  }

  getKindCode(): string | null {
    return this.kindCode;
  }

  getApplication(): boolean {
    return this.application;
  }

  getProvisional(): boolean {
    return this.provisional;
  }

  getReissued(): boolean {
    return this.reissued;
  }

  getPlant(): boolean {
    return this.plant;
  }

  getDesign(): boolean {
    return this.design;
  }

  // Fixed from upstream: upstream returns `this.design` here, a clear
  // copy-paste bug from `getDesign()` directly above. Returns `this.utility`
  // as the method name implies.
  getUtility(): boolean {
    return this.utility;
  }

  getConf(): number {
    return this.conf;
  }

  /* getConfidence(): string { return this.confidence; } */

  getOffsetBegin(): number {
    return this.offset_begin;
  }

  getOffsetEnd(): number {
    return this.offset_end;
  }

  getOffsetRaw(): number {
    return this.offset_raw;
  }

  /** Context of occurrence of the reference */
  getContext(): string | null {
    return this.context;
  }

  setContext(cont: string | null): void {
    this.context = cont;
  }

  setOffsetBegin(ofs: number): void {
    this.offset_begin = ofs;
  }

  setOffsetEnd(ofs: number): void {
    this.offset_end = ofs;
  }

  setOffsetRaw(ofs: number): void {
    this.offset_raw = ofs;
  }

  setKindCode(kc: string | null): void {
    this.kindCode = kc;
  }

  setNumberEpoDoc(num: string | null): void {
    this.number_epodoc = num;
  }

  setNumberWysiwyg(num: string | null): void {
    this.number_wysiwyg = num;
  }

  setAuthority(s: string | null): void {
    this.authority = s;
  }

  setApplication(b: boolean): void {
    this.application = b;
  }

  setProvisional(b: boolean): void {
    this.provisional = b;
  }

  setReissued(b: boolean): void {
    this.reissued = b;
  }

  setPlant(b: boolean): void {
    this.plant = b;
  }

  setDesign(b: boolean): void {
    this.design = b;
  }

  setUtility(b: boolean): void {
    this.utility = b;
  }

  setConf(val: number): void {
    this.conf = val;
  }

  /** Java Comparable<PatentItem> — order by number_wysiwyg. */
  compareTo(another: PatentItem): number {
    const a = this.number_wysiwyg ?? "";
    const b = another.getNumberWysiwyg() ?? "";
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  }

  private static readonly espacenet = "http://v3.espacenet.com/publicationDetails/biblio?DB=EPODOC";
  private static readonly espacenet2 = "http://v3.espacenet.com/searchResults?DB=EPODOC";

  private static readonly epoline = "https://register.epoline.org/espacenet/application?number=";

  private static readonly epoline2 = "https://register.epoline.org/espacenet/simpleSearch?index[0]=publication&value[0]=";
  private static readonly epoline3 = "&index[1]=&value[1]=&index[2]=&value[2]=&searchMode=simple&recent=";

  getEspacenetURL(): string {
    let res: string;
    if (this.provisional) {
      res = PatentItem.espacenet2 + "&PR=" + this.authority + this.number_epodoc + "P";
    } else if (this.application) {
      res = PatentItem.espacenet2 + "&AP=" + this.authority + this.number_epodoc;
    } else {
      res = PatentItem.espacenet + "&CC=" + this.authority + "&NR=" + this.number_epodoc;
    }
    return res;
  }

  getEpolineURL(): string {
    let res: string;
    if (this.application) {
      res = PatentItem.epoline + this.authority + this.number_epodoc;
    } else {
      // we need the application number corresponding to the publication
      res = PatentItem.epoline2 + this.authority + this.number_epodoc + PatentItem.epoline3;
    }
    return res;
  }

  getType(): string {
    if (this.application) return "application";
    if (this.provisional) return "provisional";
    if (this.reissued) return "reissued";
    if (this.plant) return "plant";
    if (this.design) return "design";
    // default
    return "publication";
  }

  setType(type: string): void {
    if (type === "publication") return;
    if (type === "application") {
      this.application = true;
    } else if (type === "provisional") {
      this.provisional = true;
    } else if (type === "reissued") {
      this.reissued = true;
    } else if (type === "plant") {
      this.plant = true;
    } else if (type === "design") {
      this.design = true;
    }
  }

  toString(): string {
    return (
      "PatentItem [authority=" + this.authority +
      ", number_wysiwyg=" + this.number_wysiwyg +
      ", number_epodoc=" + this.number_epodoc +
      ", kindCode=" + this.kindCode +
      ", application=" + this.application +
      ", provisional=" + this.provisional +
      ", reissued=" + this.reissued +
      ", plant=" + this.plant +
      ", design=" + this.design +
      ", conf=" + this.conf +
      ", offset_begin=" + this.offset_begin +
      ", offset_end=" + this.offset_end +
      ", offset_raw=" + this.offset_raw +
      ", context=" + this.context +
      "]"
    );
  }

  /**
   * Java overloads:
   *   toTEI()                                      -> toTEI(null, false, null)
   *   toTEI(boolean withPtr, String ptrVal)        -> toTEI(null, withPtr, ptrVal)
   *   toTEI(String date)                           -> toTEI(date, false, null)
   *   toTEI(String date, boolean withPtr, String ptrVal)
   */
  toTEI(): string;
  toTEI(withPtr: boolean, ptrVal: string | null): string;
  toTEI(date: string | null): string;
  toTEI(date: string | null, withPtr: boolean, ptrVal: string | null): string;
  toTEI(
    dateOrWithPtr?: string | boolean | null,
    withPtrOrPtrVal?: boolean | string | null,
    ptrVal?: string | null,
  ): string {
    let date: string | null = null;
    let withPtr = false;
    let _ptrVal: string | null = null;

    if (typeof dateOrWithPtr === "boolean") {
      withPtr = dateOrWithPtr;
      _ptrVal = (withPtrOrPtrVal ?? null) as string | null;
    } else {
      date = (dateOrWithPtr ?? null) as string | null;
      if (typeof withPtrOrPtrVal === "boolean") {
        withPtr = withPtrOrPtrVal;
      }
      _ptrVal = ptrVal ?? null;
    }

    /* TEI for patent bilbiographical data is as follow (After the TEI guideline update of October 2012):
    <biblStruct type="patent¦utilityModel¦designPatent¦plant" status="application¦publication">
    <monogr>
    <authority>
    <orgName type="national¦regional">[name of patent office]<orgName> (mandatory)
    </authority>
    <idno type="docNumber">[patent document number]</idno> (mandatory)
    <imprint> (optional)
    <classCode scheme="kindCode">[kind code]</classCode> (optional)
    <date>[date]</date> (optional)
    </imprint>
    </monogr>
    </biblStruct>
    */
    let biblStruct = "";

    // type of patent
    biblStruct += "<biblStruct type=\"";
    if (this.design) {
      biblStruct += "designPatent";
    } else if (this.plant) {
      biblStruct += "plant";
    } else if (this.utility) {
      biblStruct += "utilityModel";
    } else {
      biblStruct += "patent";
    }

    // status
    biblStruct += "\" status=\"";
    if (this.application) {
      biblStruct += "application";
    } else if (this.provisional) {
      biblStruct += "provisional";
    } else if (this.reissued) {
      biblStruct += "reissued";
    } else {
      biblStruct += "publication";
    }
    biblStruct += "\">";

    biblStruct += "<monogr><authority><orgName type=\"";
    if (
      // NOTE: dead-code parity with upstream — upstream listed "XN" twice
      // in the OR chain. Deduplicated.
      this.authority === "EP" || this.authority === "WO" || this.authority === "XN" ||
      this.authority === "GC" || this.authority === "EA"
    ) {
      // XN is the Nordic Patent Institute
      // OA is the African Intellectual Property Organization (OAPI)
      // GC is the Gulf Cooperation Council
      // EA Eurasian Patent Organization
      biblStruct += "regional";
    } else {
      biblStruct += "national";
    }
    biblStruct += "\">" + TextUtilities.HTMLEncode(this.authority) + "</orgName></authority>";
    biblStruct += "<idno type=\"docNumber\" subtype=\"epodoc\">" + TextUtilities.HTMLEncode(this.number_epodoc) + "</idno>";
    biblStruct += "<idno type=\"docNumber\" subtype=\"original\">" + TextUtilities.HTMLEncode(this.number_wysiwyg) + "</idno>";

    if (this.kindCode != null || date != null) {
      biblStruct += "<imprint>";
      if (this.kindCode != null) {
        biblStruct += "<classCode scheme=\"kindCode\">" + TextUtilities.HTMLEncode(this.kindCode) + "</classCode>";
      }
      if (date != null) {
        biblStruct += "<date>" + TextUtilities.HTMLEncode(date) + "</date>";
      }
      biblStruct += "</imprint>";
    }

    if (withPtr) {
      biblStruct +=
        "<ptr target=\"#string-range('" + _ptrVal + "'," +
        this.offset_begin + "," +
        (this.offset_end - this.offset_begin + 1) + ")\"></ptr>";
    }

    if (this.conf !== 0.0) {
      biblStruct += "<certainty degree=\"" + this.conf + "\" />";
    }
    biblStruct += "</monogr>";

    biblStruct += "</biblStruct>";

    return biblStruct;
  }

  toJson(date: string | null, withCoordinates: boolean): string {
    let json = "";
    json += "{";
    json += "\"type\": ";
    if (this.design) {
      json += "\"designPatent\"";
    } else if (this.plant) {
      json += "\"plant\"";
    } else if (this.utility) {
      json += "\"utilityModel\"";
    } else {
      json += "\"patent\"";
    }

    json += ", \"status\": ";
    if (this.application) {
      json += "\"application\"";
    } else if (this.provisional) {
      json += "\"provisional\"";
    } else if (this.reissued) {
      json += "\"reissued\"";
    } else {
      json += "\"publication\"";
    }

    json += ", \"authority\": { \"name\": \"" + this.authority + "\", \"type\": \"";
    if (
      // NOTE: dead-code parity with upstream — upstream listed "XN" twice;
      // deduplicated here.
      this.authority === "EP" || this.authority === "WO" || this.authority === "XN" ||
      this.authority === "GC" || this.authority === "EA"
    ) {
      // XN is the Nordic Patent Institute
      // OA is the African Intellectual Property Organization (OAPI)
      // GC is the Gulf Cooperation Council
      // EA Eurasian Patent Organization
      json += "regional";
    } else {
      json += "national";
    }
    json += "\"}";

    json += ", \"number\": {";
    if (this.number_wysiwyg != null) {
      json += "\"original\" : \"" + this.number_wysiwyg + "\"";
      if (this.number_epodoc != null) json += ", ";
    }
    if (this.number_epodoc != null) {
      json += "\"epodoc\" : \"" + this.number_epodoc + "\"";
    }
    json += "}";

    if (this.kindCode != null) {
      json += ", \"kindCode\" : \"" + this.kindCode + "\"";
    }

    if (date != null) {
      json += ", \"date\" : \"" + date + "\"";
    }

    if (withCoordinates && this.coordinates != null && this.coordinates.length > 0) {
      json += ", \"pos\": [";
      let first = true;
      for (const b of this.coordinates) {
        if (first) {
          first = false;
        } else {
          json += ",";
        }
        json += "{" + (b as unknown as { toJson(): string }).toJson() + "}";
      }
      json += "]";
    }

    if (this.offset_begin !== -1 && this.offset_end !== -1) {
      json += ", \"offset\": {";
      json += "\"begin\" : " + this.offset_begin + ", ";
      json += "\"end\" : " + this.offset_end;
      json += "}";
    }

    const url1 = this.getEspacenetURL();
    let url2: string | null = null;

    if (this.authority === "EP") {
      url2 = this.getEpolineURL();
    }

    if (url1 != null || url2 != null) {
      json += ", \"url\": {";
      if (url1 != null) {
        json += "\"espacenet\" : \"" + url1 + "\"";
        if (url2 != null) json += ", ";
      }
      if (url2 != null) {
        json += "\"epoline\" : \"" + url2 + "\"";
      }
      json += "}";
    }

    json += "}";
    return json;
  }

  setCoordinates(coordinates: BoundingBox[] | null): void {
    this.coordinates = coordinates;
  }

  getCoordinates(): BoundingBox[] | null {
    return this.coordinates;
  }
}
