// Port of org.grobid.core.features.FeatureFactory.
// Upstream: grobid-core/src/main/java/org/grobid/core/features/FeatureFactory.java
//
// Class providing a toolkit for managing and creating features or string
// sequence tagging problems.

import { Lexicon } from "../lexicon/lexicon.js";
import { OffsetPosition } from "../utilities/offset-position.js";

export class FeatureFactory {
  private static instance: FeatureFactory | null = null;

  public newline: boolean = true;
  public lexicon: Lexicon = Lexicon.getInstance();

  public year: RegExp = /[1,2][0-9][0-9][0-9]/;
  public http: RegExp = /http(s)?/;
  public isDigit: RegExp = /^\d+$/;
  public email2: RegExp = /\w+([.-]\w+)*@\w+([.-]\w+)+/;
  public email: RegExp = /^(?:[a-zA-Z0-9_'^&amp;/+-])+(?:\.(?:[a-zA-Z0-9_'^&amp;/+-])+)*@(?:(?:\[?(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?))\.){3}(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\]?)|(?:[a-zA-Z0-9-]+\.)+(?:[a-zA-Z]){2,}\.?)$/;
  public acronym: RegExp = /[A-Z]\.([A-Z]\.)*/;
  public isPunct: RegExp = /^[\,\:;\?\.]+$/;

  public static readonly KEYWORDSPUB: string[] = [
    "Journal",
    "journal",
    "Proceedings",
    "proceedings",
    "Conference",
    "conference",
    "Workshop",
    "workshop",
    "Symposium",
    "symposium",
  ];

  public static readonly MONTHS: string[] = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
    "jan",
    "feb",
    "mar",
    "apr",
    "may",
    "jun",
    "jul",
    "aug",
    "sep",
    "oct",
    "nov",
    "dec",
  ];

  public static readonly COUNTRY_CODES: string[] = [
    "US",
    "EP",
    "WO",
    "DE",
    "AU",
    "GB",
    "DK",
    "BE",
    "AT",
    "CN",
    "KR",
    "EA",
    "CH",
    "JP",
    "FR",
    "UK",
    "RU",
    "CA",
    "NL",
    "DD",
    "SE",
    "FI",
    "MX",
    "OA",
    "AP",
    "AR",
    "BR",
    "BG",
    "CL",
    "GR",
    "HU",
    "IS",
    "IN",
    "IE",
    "IL",
    "IT",
    "LU",
    "NO",
    "NZ",
    "PL",
    "RU",
    "ES",
    "TW",
    "TR",
  ];

  public static readonly KIND_CODES: string[] = ["A", "B", "C", "U", "P"];

  // hidden constructor
  private constructor() {}

  public static getInstance(): FeatureFactory {
    if (FeatureFactory.instance === null) {
      FeatureFactory.instance = new FeatureFactory();
    }
    return FeatureFactory.instance;
  }

  /**
   * Test if the first letter of the string is a capital letter
   */
  public test_first_capital(tok: string | null | undefined): boolean {
    if (tok === null || tok === undefined) return false;
    if (tok.length === 0) return false;
    const a = tok.charAt(0);
    if (a >= "A" && a <= "Z") return true;
    // Cover Unicode upper case beyond ASCII (Java Character.isUpperCase)
    if (a !== a.toLowerCase() && a === a.toUpperCase()) return true;
    return false;
  }

  /**
   * Test if all the letters of the string are capital letters
   * (characters can be also digits which are then ignored)
   */
  public test_all_capital(tok: string | null | undefined): boolean {
    if (tok === null || tok === undefined) return false;
    if (tok.length === 0) return false;
    for (let i = 0; i < tok.length; i++) {
      const a = tok.charAt(i);
      // Java Character.isLowerCase
      if (a !== a.toUpperCase() && a === a.toLowerCase()) return false;
    }
    return true;
  }

  /**
   * Test for a given character occurrence in the string
   */
  public test_char(tok: string | null | undefined, c: string): boolean {
    if (tok === null || tok === undefined) return false;
    if (tok.length === 0) return false;
    const i = tok.indexOf(c);
    if (i === -1) return false;
    return true;
  }

  /**
   * Test for the current string contains at least one digit
   */
  public test_digit(tok: string | null | undefined): boolean {
    if (tok === null || tok === undefined) return false;
    if (tok.length === 0) return false;
    for (let i = 0; i < tok.length; i++) {
      const a = tok.charAt(i);
      if (a >= "0" && a <= "9") return true;
    }
    return false;
  }

  /**
   * Test for the current string contains only digit
   */
  public test_number(tok: string | null | undefined): boolean {
    if (tok === null || tok === undefined) return false;
    if (tok.length === 0) return false;
    for (let i = 0; i < tok.length; i++) {
      const a = tok.charAt(i);
      if (!(a >= "0" && a <= "9")) return false;
    }
    return true;
  }

  /**
   * Test for the current string is a number or a decimal number, i.e. containing only digits or ",", "."
   */
  public test_complex_number(tok: string | null | undefined): boolean {
    if (tok === null || tok === undefined) return false;
    if (tok.length === 0) return false;
    for (let i = 0; i < tok.length; i++) {
      const a = tok.charAt(i);
      if (!(a >= "0" && a <= "9") && a !== "," && a !== ".") return false;
    }
    return true;
  }

  /**
   * Test if the current string is a common name
   */
  public test_common(tok: string | null | undefined): boolean {
    if (tok === null || tok === undefined) return false;
    else if (tok.length === 0) return false;
    else return this.lexicon.inDictionary(tok.trim().toLowerCase());
  }

  /**
   * Test if the current string is a first name or family name
   */
  public test_names(tok: string): boolean {
    return (
      this.lexicon.inFirstNames(tok.toLowerCase()) ||
      this.lexicon.inLastNames(tok.toLowerCase())
    );
  }

  /**
   * Test if the current string is a family name
   */
  public test_first_names(tok: string): boolean {
    return this.lexicon.inFirstNames(tok.toLowerCase());
  }

  /**
   * Test if the current string is a family name
   */
  public test_last_names(tok: string): boolean {
    return this.lexicon.inLastNames(tok.toLowerCase());
  }

  /**
   * Test if the current string refers to a month
   */
  public test_month(tok: string): boolean {
    return FeatureFactory.MONTHS.includes(tok.toLowerCase());
  }

  /**
   * Test if the current string refers to country code
   */
  public test_country_codes(tok: string): boolean {
    return FeatureFactory.COUNTRY_CODES.includes(tok);
  }

  /**
   * Test if the current string refers to a kind code
   */
  public test_kind_codes(tok: string): boolean {
    return FeatureFactory.KIND_CODES.includes(tok);
  }

  /**
   * Test if the current string refers to a country
   */
  public test_country(tok: string): boolean {
    return this.lexicon.isCountry(tok.toLowerCase());
  }

  /**
   * Test if the current string refers to a known city
   */
  public test_city(tok: string): boolean {
    const pos: OffsetPosition[] = this.lexicon.tokenPositionsCityNames(
      tok.toLowerCase(),
    );
    if (pos !== null && pos !== undefined && pos.length > 0) return true;
    return false;
  }

  /**
   * Given an integer value between 0 and total, discretized into nbBins following a linear scale
   * (handles both int and double overload from upstream uniformly).
   */
  public linearScaling(pos: number, total: number, nbBins: number): number {
    if (pos >= total) return nbBins;
    if (pos <= 0) return 0;
    const rel: number = pos / total;
    const rel2: number = rel * nbBins; // + 1;
    return Math.trunc(rel2);
  }

  /**
   * Given an double value between 0.0 and total, discretized into nbBins following a log scale
   */
  public logScaling(pos: number, total: number, nbBins: number): number {
    //System.out.println("total: " + total + " / pos: " + pos);
    if (pos >= total) return nbBins;
    if (pos <= 0) return 0;
    const max: number = Math.log(total + 1);
    const val: number = Math.log(pos + 1);
    //System.out.println("max: " + max + " / val: " + val);
    const rel: number = val / max;
    const rel2: number = rel * nbBins;
    return Math.trunc(rel2);
  }

  /**
   * Transform a text in a text pattern where punctuations are ignored and
   * remaining text in lowercase
   */
  public getPattern(text: string): string {
    const pattern = text.replace(/[^a-zA-Z]/g, "").toLowerCase();
    //pattern = pattern.replaceAll("[0-9]", "X");
    return pattern;
  }
}
