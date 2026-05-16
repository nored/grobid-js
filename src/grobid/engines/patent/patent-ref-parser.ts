// Port of org.grobid.core.engines.patent.PatentRefParser.
// Upstream: grobid-core/src/main/java/org/grobid/core/engines/patent/PatentRefParser.java
//
// Adaptations:
// - Java `Pattern.compile` regexes preserved verbatim. Java's `\\` escapes
//   translate to single `\` in JS regex literals; otherwise patterns are
//   identical.
// - `IOUtils.closeQuietly` is unnecessary in JS; resource cleanup is GC.
// - `TreeMap` → plain JS `Map`; we don't rely on ordered iteration here.
// - Apache `Character.isDigit` → standard JS char-class check.
// - `Matcher.find()` / `Matcher.group(0)` / `Matcher.end()` → run a single
//   exec/regex.exec and read `result[0]` / `result.index + result[0].length`.
// - `Integer.parseInt(s)` throws → `parseInt(s)` returns `NaN` instead; we
//   surface that path explicitly with the same try/catch shape.

import * as fs from "node:fs";
import * as path from "node:path";
import { getLogger } from "../../utilities/logger.js";
import { PatentItem } from "../../data/patent-item.js";
import { GrobidProperties } from "../../utilities/grobid-properties.js";
import { TextUtilities } from "../../utilities/text-utilities.js";
import { GrobidException } from "../../exceptions/grobid-exception.js";
import { GrobidResourceException } from "../../exceptions/grobid-resource-exception.js";

const LOGGER = getLogger("PatentRefParser");

function isDigitChar(ch: string): boolean {
  if (ch == null || ch.length === 0) return false;
  const c = ch.charCodeAt(0);
  return c >= 48 && c <= 57;
}

/**
 * Parser for patent references based on regular language rewriting.
 * Input raw references are WISIWIG references (i.e. reference string as
 * they appear). Expected ouput is the patent reference in the EPO Epoque
 * format.
 */
export class PatentRefParser {
  private rawText: string | null = null;
  private rawTextOffset: number = 0; // starting offset of the current raw text
  private patent_pattern: RegExp;
  private number_pattern: RegExp;

  // this is the complete list of existing authorities that was identified in the nature, always
  // two upper-case letter codes
  static readonly authorities: readonly string[] = [
    "AP", "AL", "DZ", "AR", "AU", "AT", "BE", "BX",
    "BR", "BG", "CA", "CL", "CN", "CO",
    "HR", "CU", "CY", "CZ", "CS", "DK", "EG", "EA", "EP", "DE", "DD", "FI", "FR", "GB", "GR", "HK", "HU",
    "IS", "IN", "ID", "IB", "TP", "IR", "IQ", "IE", "IL", "IT", "JP", "JO", "KE", "KP", "KR", "LV", "LT",
    "LU", "MW", "MY", "MX", "MD", "MC", "MN", "MA", "NL", "NZ", "NG", "NO", "OA", "WO", "PE", "PH",
    "PL", "PT", "RD", "RO", "RU", "SA", "SG", "SK", "SI", "ZA", "SU", "ES", "LK", "SE", "CH", "TW", "TH",
    "TT", "TN", "TR", "UA", "GB", "US", "UY", "VE", "VN", "YU", "ZM", "ZW",
  ];

  // this is the list of supported languages - language codes given ISO 639-1, two-letter codes
  static readonly languages: readonly string[] = ["en", "de", "fr", "es", "it", "ja", "ko", "pt", "zh", "ar"];

  // list of regular expressions for identifying the authority in the raw reference string
  private autority_patterns: RegExp[] = [];

  // map giving for a language and an authority name the list of language specific expressions
  // this uses the language resource files *.local under grobid-home/lexicon/patent/
  private languageResources: Map<string, string[]> | null = null;

  private application_pattern: RegExp | null = null;
  private publication_pattern: RegExp | null = null;
  private pct_application_pattern: RegExp;
  private provisional_pattern: RegExp | null = null;
  private non_provisional_pattern: RegExp;
  // upstream declares `us_serial_pattern` and `translation_pattern` / `utility_pattern` but only some are used
  private us_serial_pattern: RegExp;
  private translation_pattern: RegExp;
  private utility_pattern: RegExp | null = null;
  private kindcode_pattern1: RegExp;
  private kindcode_pattern2: RegExp;
  private kindcode_pattern3: RegExp;
  private jp_kokai_pattern: RegExp;
  private jp_heisei_pattern: RegExp;
  private standardText: RegExp;

  constructor() {
    this.patent_pattern = /([UEWDJFA])[.\s]?([SPOERKU])[.\s]?-?(A|B|C)?\s?-?([\s,0-9/-]+(A|B|C)?[\s,0-9/-]?)/;

    //number_pattern = Pattern.compile("[ABC]?([\\s,0-9/-]*)+[ABC]?([\\s,0-9/-])*[ABC]?");
    this.number_pattern = /((RE|PP)[\s,0-9/\-.\\]*)|(PCT(\/|\\)[A-Z][A-Z]([\s,0-9/\-.\\]*))|([ABC]?([0-9][\s,0-9/\-.\\]*)+[ABCUT]?([\s,0-9/\-.\\])*[ABCUT]?)/g;
    //number_pattern = Pattern.compile("((RE|PP)[\\s,0-9/\\-\\.\\\\]*)|(PCT(/|\\\\)[A-Z][A-Z]([\\s,0-9/\\-\\.\\\\]*))|([ABC]?([0-9][\\s,0-9/\\-\\.\\\\]*)+[ABCUT][0-9])|([ABC]?([0-9][\\s,0-9/\\-\\.\\\\]*)+[ABCUT])|([ABC]?([0-9][\\s,0-9/\\-\\.\\\\]*)+)");
    //number_pattern = Pattern.compile("((RE|PP)[\\s,0-9/\\-\\.\\\\]*)|(PCT(/|\\\\)[A-Z][A-Z]([\\s,0-9/\\-\\.\\\\]*))|([ABC]?([\\s,0-9/\\-\\.\\\\ABC])+[ABCUT]?)");
    this.kindcode_pattern1 = /([ABC][0-9]?)/; // before number
    this.kindcode_pattern2 = /([ABCUT][0-9]?)/; // after number
    this.kindcode_pattern3 = /^([ABC][0-9]?)-/; // as prefix of the number

    this.standardText = /[a-z][A-Z]/;

    //application_pattern = Pattern.compile("((A|a)pplicat)|((a|A)ppln)");
    //publication_pattern = Pattern.compile("((P|p)ublicat)|((p|P)ub)");
    this.pct_application_pattern = /(PCT\/(GB|EP|US|JP|DE|FR|UK|BE|CA|CH|AT|AU|KR|RU|FI|NL|SE|ES|DK|DD)\/?([0-9][0-9]([0-9][0-9])?))/;
    //provisional_pattern = Pattern.compile("((P|p)rovisional)");
    this.non_provisional_pattern = /((n|N)on.(P|p)rovisional)/;
    this.translation_pattern = /((T|t)ranslation)/;
    //utility_pattern = Pattern.compile("((U|u)tility)");

    this.us_serial_pattern = /((S|s)erial(\s|-)+((n|N)o(\.)?)(\s|-)*[0-9]*\/)/;

    this.jp_kokai_pattern = /(k|K)oka(l|i)/;
    this.jp_heisei_pattern = /(H|h)(E|e)(I|i)/;

    this.initLanguageResources();

    // we compile the different authority regular expression patterns based on the language resource files
    for (const authorityName of PatentRefParser.authorities) {
      this.autority_patterns.push(this.compilePattern(authorityName));
    }

    // compiling additional non-authority patterns: application, publication, provisional, utility
    this.application_pattern = this.compilePattern("application");
    this.publication_pattern = this.compilePattern("publication");
    this.provisional_pattern = this.compilePattern("provisional");
    this.utility_pattern = this.compilePattern("utility");

    // note: multilingual lexical patterns are expressed in external resource files under grobid-home/lexicon/patent/
  }

  private initLanguageResources(): void {
    this.languageResources = new Map<string, string[]>();
    for (const language of PatentRefParser.languages) {
      // opening the corresponding language resource file
      const filePath = (GrobidProperties.getGrobidHomePath() as string) + "/lexicon/patent/" + language + ".local";
      if (!fs.existsSync(filePath)) {
        throw new GrobidResourceException(
          "Cannot add language resources for patent processing (language '" +
            language +
            "'), because file '" +
            path.resolve(filePath) +
            "' does not exists.",
        );
      }
      try {
        fs.accessSync(filePath, fs.constants.R_OK);
      } catch {
        throw new GrobidResourceException(
          "Cannot add language resources for patent processing (language '" +
            language +
            "'), because cannot read file '" +
            path.resolve(filePath) +
            "'.",
        );
      }

      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const lines = content.split(/\r?\n/);
        for (const l of lines) {
          if (l.length === 0) continue;
          // the first token, separated by a '=', gives the authority name
          const parts = l.split("=");
          const authority = parts[0]!.trim();
          // this will cover authority as well as some other patterns such as publication, application, ...
          const expressions = (parts[1] as string).trim();
          if (expressions.trim().length > 0) {
            const subparts = expressions.split(",");
            const listExpressions: string[] = [];
            for (let i = 0; i < subparts.length; i++) {
              listExpressions.push((subparts[i] as string).trim());
            }
            this.languageResources.set(language + authority, listExpressions);
          }
        }
      } catch (e) {
        throw new GrobidException("An exception occured while running Grobid.", e);
      }
    }
  }

  private compilePattern(authorityName: string): RegExp {
    // default authority two character name
    let er = "((\\s|,|\\.|^|\\-)";
    er += authorityName + ")";

    if (authorityName.length === 2) {
      // authority name with dots
      er += "|(" + authorityName.charAt(0) + "\\.(\\s)?" + authorityName.charAt(1) + ")";
    }

    // using language ressources for authority patterns
    for (const language of PatentRefParser.languages) {
      const expressions = this.languageResources?.get(language + authorityName);
      if (expressions != null) {
        for (let expressionRaw of expressions) {
          let expression: string | null = expressionRaw;
          if (expression !== null && expression.trim().length > 1) {
            expression = expression.trim();

            if (expression.indexOf("-") === -1 && expression.indexOf(".") === -1) {
              if (TextUtilities.isAllLowerCase(expression)) {
                expression =
                  "(" +
                  expression.charAt(0) +
                  "|" +
                  expression.charAt(0).toUpperCase() +
                  ")" +
                  expression.substring(1, expression.length);
              }
            } else {
              if (expression.indexOf("-") !== -1) {
                const parts = expression.split("-");
                expression = "";
                for (let j = 0; j < parts.length; j++) {
                  const part = parts[j] as string;
                  if (j > 0) {
                    expression += "(\\s|-)*";
                  }
                  if (TextUtilities.isAllLowerCase(part)) {
                    expression +=
                      "(" +
                      part.charAt(0) +
                      "|" +
                      part.charAt(0).toUpperCase() +
                      ")" +
                      part.substring(1, part.length);
                  }
                }
              }

              if (expression !== null && expression.indexOf(".") !== -1) {
                // Note: Java's `"abc".split(".")` interprets "." as a regex
                // wildcard and matches any character — so it returns an empty
                // array. We preserve the upstream behavior verbatim by
                // mirroring `String.split(regex)` semantics here.
                const parts = expression.split(/./);
                expression = "";
                for (let j = 0; j < parts.length; j++) {
                  const part = parts[j] as string;
                  if (j > 0) {
                    expression += "(\\s)?\\.(\\s)?";
                  }
                  if (TextUtilities.isAllLowerCase(part)) {
                    expression +=
                      "(" +
                      part.charAt(0) +
                      "|" +
                      part.charAt(0).toUpperCase() +
                      ")" +
                      part.substring(1, part.length);
                  }
                }
              }
            }
            er += "|(" + expression + ")";
          }
        }
      }
    }

    return new RegExp(er);
  }

  setRawRefText(s: string): void {
    this.rawText = s;
  }

  setRawRefTextOffset(s: number): void {
    this.rawTextOffset = s;
  }

  processRawRefText(): PatentItem[] {
    const res: PatentItem[] = [];
    //System.out.println("processRawRefText: " + rawText);
    let country: string | null = null;
    let country_position: number = -1;
    // Java's outer `while(true) { ...; break; }` is a single-iteration loop
    // used to scope variables — preserved verbatim.
    while (true) {
      let i = 0;
      for (const authority of PatentRefParser.authorities) {
        const thePattern = this.autority_patterns[i] as RegExp;

        const m = thePattern.exec(this.rawText as string);
        if (m !== null) {
          country = authority;
          country_position = m.index + m[0].length;
          break;
        }
        i++;
      }
      break;
    }

    if (country !== null) {
      let numbers: string[] = [];
      const offsets_begin: number[] = [];
      const offsets_end: number[] = [];
      // Global RegExp for find-all semantics
      const numberRe = new RegExp(this.number_pattern.source, "g");
      let mNum: RegExpExecArray | null;
      while ((mNum = numberRe.exec(this.rawText as string)) !== null) {
        let toto = mNum[0];

        const inde_begin = (this.rawText as string).indexOf(toto) + this.rawTextOffset;
        const inde_end = inde_begin + toto.length - 1;
        //toto = toto.replaceAll("(A|B|C|\\s|-|/)", "");
        //toto = toto.replaceAll("(-)", "");
        toto = toto.replace(/()/g, "");
        if (toto.length > 0) {
          let notPieces = true;
          // additional tests are necessary for , and .
          if (toto.length > 14) {
            // we have mostlikely two patents separated by a ,
            // count the number of ,
            let countComma = 0;
            let pieces: string[] = toto.split(",");
            countComma = pieces.length - 1;

            if (countComma > 0) {
              // we split depending on number of comma
              const ratio = toto.length / countComma;
              if (ratio < 10) pieces = toto.split(", ");
              if (pieces.length === 2) {
                const p0 = pieces[0] as string;
                const p1 = pieces[1] as string;
                if (
                  (p0.length > p1.length && p0.length - p1.length < 4) ||
                  (p0.length <= p1.length && p1.length - p0.length < 4)
                ) {
                  for (let ii = 0; ii < 2; ii++) {
                    const piece = pieces[ii] as string;
                    this.addNumber(numbers, offsets_begin, offsets_end, piece, inde_begin, inde_end, toto);
                  }
                  notPieces = false;
                }
              } else if (toto.length > 6 * pieces.length) {
                for (let ii = 0; ii < pieces.length; ii++) {
                  const piece = pieces[ii] as string;
                  this.addNumber(numbers, offsets_begin, offsets_end, piece, inde_begin, inde_end, toto);
                }
                notPieces = false;
              }
            }
          }

          if (notPieces) {
            this.addNumber(numbers, offsets_begin, offsets_end, toto, inde_begin, inde_end, null);
          }
        }
      }

      const applications: boolean[] = [];
      const provisionals: boolean[] = [];
      const pctapps: boolean[] = [];
      const designs: boolean[] = [];
      const reissueds: boolean[] = [];
      const plants: boolean[] = [];
      const kindcodes: (string | null)[] = [];

      for (let _idx = 0; _idx < numbers.length; _idx++) {
        applications.push(false);
        provisionals.push(false);
        pctapps.push(false);
        designs.push(false);
        reissueds.push(false);
        plants.push(false);
        kindcodes.push(null);
      }

      const newNumbers: (string | null)[] = [];
      const originalNumbers: string[] = [];
      let i = 0;
      let lastPositionVisited = country_position;
      for (const numberRaw of numbers) {
        let number: string = numberRaw;
        let originalNumber: string | null = number;

        // try to get the kind code
        let kindCodeFound = false;
        // do we have the kind code directly in the number prefix?
        let fitKindCode = this.kindcode_pattern3.exec(number);
        if (fitKindCode !== null) {
          let tata = fitKindCode[0];
          // const posKind = fitKindCode.index + fitKindCode[0].length;
          // if we have standard text between the kind code and the number, the kind code is not valid
          tata = tata.replace(/[\- ]/g, "");
          kindcodes[i] = tata;

          lastPositionVisited = (offsets_end[i] as number) - this.rawTextOffset;
          kindCodeFound = true;
          const ind = number.indexOf("-");
          number = number.substring(ind, number.length);
        }

        if (!kindCodeFound && (offsets_begin[i] as number) - this.rawTextOffset >= lastPositionVisited) {
          // is there a kind code between the last position and position of this number?
          const interChunk = (this.rawText as string).substring(
            lastPositionVisited,
            (offsets_begin[i] as number) - this.rawTextOffset,
          );
          fitKindCode = this.kindcode_pattern1.exec(interChunk);
          if (fitKindCode !== null) {
            const tata = fitKindCode[0];
            const posKind = fitKindCode.index + fitKindCode[0].length;

            // if we have standard text between the kind code and the number, the kind code is not valid
            const subChunk = interChunk.substring(posKind, interChunk.length);
            const m = this.standardText.exec(subChunk);
            // just try to find a match
            if (m === null) {
              // if the distance between the kind code and the number is too large,
              // the kind code is not valid

              if (interChunk.length - posKind <= 4) {
                // otherwise, we validated the kind code for this patent reference
                kindcodes[i] = tata;
                if ((offsets_end[i] as number) < this.rawTextOffset) {
                  offsets_end[i] = (offsets_end[i] as number) + this.rawTextOffset;
                }
                lastPositionVisited = (offsets_end[i] as number) - this.rawTextOffset;
                kindCodeFound = true;
              }
            }
          }
        }

        if (!kindCodeFound) {
          // is there a kind code immediatly after the number?
          let postLength = 0;
          if ((this.rawText as string).length - ((offsets_end[i] as number) - this.rawTextOffset) >= 3)
            postLength = 3;
          else postLength = (this.rawText as string).length - ((offsets_end[i] as number) - this.rawTextOffset);
          if (postLength > 0) {
            const postChunk = (this.rawText as string).substring(
              (offsets_end[i] as number) - this.rawTextOffset - 1,
              (offsets_end[i] as number) - this.rawTextOffset + postLength,
            );
            fitKindCode = this.kindcode_pattern2.exec(postChunk);
            if (fitKindCode !== null) {
              const tata = fitKindCode[0];
              kindcodes[i] = tata;
              kindCodeFound = true;
              lastPositionVisited = (offsets_end[i] as number) + postLength - this.rawTextOffset;
            }
          }
        }

        number = number.replace(/-/g, "");
        // do we have an application or a patent publication?
        if (country === "WO" || country === "W0") {
          number = number.replace(/[.\s]/g, "");
          // in case of usual typo W0 for WO
          let numm = number.replace(/[/,.]/g, "").trim();
          originalNumber = numm;
          if (numm.startsWith("0") && numm.length === 11) {
            // a useless zero has been inserted
            number = number.substring(1, number.length);
          } else if ((numm.startsWith("09") && numm.length === 8) || (numm.startsWith("00") && numm.length === 8)) {
            // a useless zero has been inserted (WO format before July 2002!)
            number = number.substring(1, number.length);
          }
          // PCT application checking
          const fitApplication = this.pct_application_pattern.exec(number);
          if (fitApplication !== null) {
            let titi = fitApplication[0];
            let move = titi.length;
            titi = titi.replace("PCT/", "");
            if (titi.length > 2) {
              const countr = titi.substring(0, 2);
              let year: string | null = null;
              if (titi.charAt(2) !== "/") year = titi.substring(2, titi.length);
              else year = titi.substring(3, titi.length);
              if (year.length === 2) {
                if (year.charAt(0) === "7" || year.charAt(0) === "8" || year.charAt(0) === "9") {
                  year = "19" + year;
                } else {
                  year = "20" + year;
                }
              } else if (year.length !== 4 && year.length > 1) {
                year = year.substring(0, 2);
                if (year.charAt(0) === "7" || year.charAt(0) === "8" || year.charAt(0) === "9") {
                  year = "19" + year;
                } else {
                  year = "20" + year;
                }
              } else if (titi.charAt(2) === "/" && year.length === 4 && year.length > 1) {
                year = year.substring(0, 2);
                move = move - 1;
                if (year.charAt(0) === "7" || year.charAt(0) === "8" || year.charAt(0) === "9") {
                  year = "19" + year;
                } else {
                  year = "20" + year;
                }
              }
              number = year + countr + number.substring(move, number.length);
              number = number.replace(/[/,.]/g, "").trim();
              if (number.length === 12) {
                if (number.charAt(6) === "0") number = number.substring(0, 6) + number.substring(7, 12);
              }
            }
            applications[i] = true;
            pctapps[i] = true;
          }
        } else {
          const appli = this.application_pattern!.exec(this.rawText as string) !== null;
          const publi = this.publication_pattern!.exec(this.rawText as string) !== null;

          if (appli && !publi) {
            applications[i] = true;
          }
          if (publi) {
            applications[i] = false;
          }

          if (country === "EP") {
            const numm = number.replace(/[ABCU,.\s/]/g, "").trim();
            originalNumber = numm;
            if (numm.length === 8) {
              applications[i] = true;
              // epodoc format with the full year as prefix
              if (numm.startsWith("0") || numm.startsWith("1")) {
                number = "20" + numm.substring(0, 2) + "0" + numm.substring(2, numm.length);
              } else {
                // we will have a problem in 2078 guys...
                number = "19" + numm.substring(0, 2) + "0" + numm.substring(2, numm.length);
              }
            } else if (numm.length <= 7) {
              applications[i] = false;
            }
          }
          if (country === "US") {
            // do we have a provisional?
            const fitProvisional = this.provisional_pattern!.exec(this.rawText as string) !== null;
            const fitNonProvisional = this.non_provisional_pattern.exec(this.rawText as string) !== null;

            if (fitProvisional && !fitNonProvisional) {
              provisionals[i] = true;
            }

            // interpretation of prefix "serial code" is given here:
            // https://www.uspto.gov/web/offices/ac/ido/oeip/taf/filingyr.htm
            // we need to identify the year based on the serial number range

            // provisional starts with 60 or 61 or 62 or 63 (time flies!)
            if (number.startsWith("60") && (appli || number.startsWith("60/"))) {
              applications[i] = true;
              provisionals[i] = true;
              originalNumber = number;
              number = number.substring(3, number.length);
              number = number.replace(/[.\s/,]/g, "");
              // we check the range of the number for deciding about a year
              let numb = -1;
              try {
                numb = parseInt(number, 10);
                if (isNaN(numb)) throw new Error("NumberFormatException");
              } catch (_e) {
                LOGGER.warn("Cannot parse extracted patent number: " + number);
              }
              if (numb === -1 || isNaN(numb)) {
                i++;
                continue;
              }
              let year: string | null = null;
              if (numb < 9474) year = "1995";
              else if (numb < 34487) year = "1996";
              else if (numb < 70310) year = "1997";
              else if (numb < 113787) year = "1998";
              else if (numb < 173038) year = "1999";
              else if (numb < 256730) year = "2000";
              else if (numb < 343564) year = "2001";
              else if (numb < 437173) year = "2002";
              else if (numb < 532638) year = "2003";
              else if (numb < 639450) year = "2004";
              else if (numb < 754464) year = "2005";
              else if (numb < 877460) year = "2006";
              else if (numb < 999999) year = "2007";
              number = year + "0" + number;
            } else if (number.startsWith("61") && (appli || number.startsWith("61/"))) {
              // same as for 60 but the ranges are different
              applications[i] = true;
              provisionals[i] = true;
              originalNumber = number;
              number = number.substring(3, number.length);
              number = number.replace(/[.\s/,]/g, "");
              // we check the range of the number for deciding about a year
              let numb = -1;
              try {
                numb = parseInt(number, 10);
                if (isNaN(numb)) throw new Error("NumberFormatException");
              } catch (_e) {
                LOGGER.warn("Cannot parse extracted patent number: " + number);
              }
              if (numb === -1 || isNaN(numb)) {
                i++;
                continue;
              }
              let year: string | null = null;
              if (numb < 9389) year = "2007";
              else if (numb < 203947) year = "2008";
              else if (numb < 335046) year = "2009";
              else if (numb < 460301) year = "2010";
              else if (numb < 631245) year = "2011";
              else if (numb < 848274) year = "2012";
              else if (numb < 964276) year = "2013";
              else if (numb < 999999) year = "2014";
              number = year + "0" + number;
            } else if (number.startsWith("62") && (appli || number.startsWith("62/"))) {
              // same as for 60 but the ranges are different
              applications[i] = true;
              provisionals[i] = true;
              originalNumber = number;
              number = number.substring(3, number.length);
              number = number.replace(/[.\s/,]/g, "");
              // we check the range of the number for deciding about a year
              let numb = -1;
              try {
                numb = parseInt(number, 10);
                if (isNaN(numb)) throw new Error("NumberFormatException");
              } catch (_e) {
                LOGGER.warn("Cannot parse extracted patent number: " + number);
              }
              if (numb === -1 || isNaN(numb)) {
                i++;
                continue;
              }
              let year: string | null = null;
              if (numb < 124715) year = "2014";
              else if (numb < 387330) year = "2015";
              else if (numb < 498538) year = "2016";
              else if (numb < 708919) year = "2017";
              else if (numb < 917758) year = "2018";
              else if (numb < 974841) year = "2019";
              else if (numb < 999999) year = "2020";
              number = year + "0" + number;
            } else if (number.startsWith("63") && (appli || number.startsWith("63/"))) {
              // same as for 60 but the ranges are different
              applications[i] = true;
              provisionals[i] = true;
              originalNumber = number;
              number = number.substring(3, number.length);
              number = number.replace(/[.\s/,]/g, "");
              // we check the range of the number for deciding about a year
              let numb = -1;
              try {
                numb = parseInt(number, 10);
                if (isNaN(numb)) throw new Error("NumberFormatException");
              } catch (_e) {
                LOGGER.warn("Cannot parse extracted patent number: " + number);
              }
              if (numb === -1 || isNaN(numb)) {
                i++;
                continue;
              }
              let year: string | null = null;
              if (numb < 205597) year = "2020";
              else year = "2021";
              number = year + "0" + number;
            } else if (number.startsWith("29") && (appli || number.startsWith("29/"))) {
              // design patent application starts with 29
              applications[i] = true;
              provisionals[i] = false;
              designs[i] = true;
              originalNumber = number;
              number = number.substring(3, number.length);
              number = number.replace(/[.\s/,]/g, "");
              // we check the range of the number for deciding about a year
              let numb = -1;
              try {
                numb = parseInt(number, 10);
                if (isNaN(numb)) throw new Error("NumberFormatException");
              } catch (_e) {
                LOGGER.warn("Cannot parse extracted patent number: " + number);
              }
              if (numb === -1 || isNaN(numb)) {
                i++;
                continue;
              }
              let year: string | null = null;
              if (numb < 3180) year = "1992";
              else if (numb < 16976) year = "1993";
              else if (numb < 32919) year = "1994";
              else if (numb < 48507) year = "1995";
              else if (numb < 64454) year = "1996";
              else if (numb < 81426) year = "1997";
              else if (numb < 98302) year = "1998";
              else if (numb < 116135) year = "1999";
              else if (numb < 134406) year = "2000";
              else if (numb < 152739) year = "2001";
              else if (numb < 173499) year = "2002";
              else if (numb < 196307) year = "2003";
              else if (numb < 220177) year = "2004";
              else if (numb < 245663) year = "2005";
              else if (numb < 270581) year = "2006";
              else if (numb < 294213) year = "2007";
              else if (numb < 313375) year = "2008";
              else if (numb < 348400) year = "2009";
              else if (numb < 372670) year = "2010";
              else if (numb < 395318) year = "2011";
              else if (numb < 442191) year = "2012";
              else if (numb < 463549) year = "2013";
              else if (numb < 474693) year = "2014";
              else if (numb < 505607) year = "2015";
              else if (numb < 620459) year = "2016";
              else if (numb < 651149) year = "2017";
              else if (numb < 651684) year = "2018";
              else if (numb < 742106) year = "2019";
              else if (numb < 742402) year = "2020";
              else year = "2021";
              number = year + "0" + number;
            } else if (number.startsWith("17") && (appli || number.startsWith("17/"))) {
              // standard patent application, not yet in the table
              applications[i] = true;
              provisionals[i] = false;
              originalNumber = number;
              number = number.substring(3, number.length);
              number = number.replace(/[.\s/,]/g, "");
              // we check the range of the number for deciding about a year
              let numb = -1;
              try {
                numb = parseInt(number, 10);
                if (isNaN(numb)) throw new Error("NumberFormatException");
              } catch (_e) {
                LOGGER.warn("Cannot parse extracted patent number: " + number);
              }
              if (numb === -1 || isNaN(numb)) {
                i++;
                continue;
              }
              const year = "2021";
              number = year + "0" + number;
            } else if (number.startsWith("16") && (appli || number.startsWith("16/"))) {
              // standard patent application, most recent serial code
              applications[i] = true;
              provisionals[i] = false;
              originalNumber = number;
              number = number.substring(3, number.length);
              number = number.replace(/[.\s/,]/g, "");
              // we check the range of the number for deciding about a year
              let numb = -1;
              try {
                numb = parseInt(number, 10);
                if (isNaN(numb)) throw new Error("NumberFormatException");
              } catch (_e) {
                LOGGER.warn("Cannot parse extracted patent number: " + number);
              }
              if (numb === -1 || isNaN(numb)) {
                i++;
                continue;
              }
              let year: string | null = null;
              if (numb < 350739) year = "2018";
              else if (numb < 602938) year = "2019";
              else if (numb < 974313) year = "2020";
              else year = "2021";
              number = year + "0" + number;
            } else if (number.startsWith("15") && (appli || number.startsWith("15/"))) {
              // standard patent application
              applications[i] = true;
              provisionals[i] = false;
              originalNumber = number;
              number = number.substring(3, number.length);
              number = number.replace(/[.\s/,]/g, "");
              // we check the range of the number for deciding about a year
              let numb = -1;
              try {
                numb = parseInt(number, 10);
                if (isNaN(numb)) throw new Error("NumberFormatException");
              } catch (_e) {
                LOGGER.warn("Cannot parse extracted patent number: " + number);
              }
              if (numb === -1 || isNaN(numb)) {
                i++;
                continue;
              }
              let year: string | null = null;
              if (numb < 530347) year = "2016";
              else if (numb < 732787) year = "2017";
              else year = "2018";
              number = year + "0" + number;
            } else if (number.startsWith("14") && (appli || number.startsWith("14/"))) {
              // standard patent application
              applications[i] = true;
              provisionals[i] = false;
              originalNumber = number;
              number = number.substring(3, number.length);
              number = number.replace(/[.\s/,]/g, "");
              // we check the range of the number for deciding about a year
              let numb = -1;
              try {
                numb = parseInt(number, 10);
                if (isNaN(numb)) throw new Error("NumberFormatException");
              } catch (_e) {
                LOGGER.warn("Cannot parse extracted patent number: " + number);
              }
              if (numb === -1 || isNaN(numb)) {
                i++;
                continue;
              }
              let year: string | null = null;
              if (numb < 544379) year = "2014";
              else if (numb < 757791) year = "2015";
              else year = "2016";
              number = year + "0" + number;
            } else if (number.startsWith("13") && (appli || number.startsWith("13/"))) {
              // standard patent application
              applications[i] = true;
              provisionals[i] = false;
              originalNumber = number;
              number = number.substring(3, number.length);
              number = number.replace(/[.\s/,]/g, "");
              // we check the range of the number for deciding about a year
              let numb = -1;
              try {
                numb = parseInt(number, 10);
                if (isNaN(numb)) throw new Error("NumberFormatException");
              } catch (_e) {
                LOGGER.warn("Cannot parse extracted patent number: " + number);
              }
              if (numb === -1 || isNaN(numb)) {
                i++;
                continue;
              }
              let year: string | null = null;
              if (numb < 374487) year = "2011";
              else if (numb < 694748) year = "2012";
              else if (numb < 998975) year = "2013";
              else year = "2014";
              number = year + "0" + number;
            } else if (number.startsWith("12") && (appli || number.startsWith("12/"))) {
              // standard patent application
              applications[i] = true;
              provisionals[i] = false;
              originalNumber = number;
              number = number.substring(3, number.length);
              number = number.replace(/[.\s/,]/g, "");
              // we check the range of the number for deciding about a year
              let numb = -1;
              try {
                numb = parseInt(number, 10);
                if (isNaN(numb)) throw new Error("NumberFormatException");
              } catch (_e) {
                LOGGER.warn("Cannot parse extracted patent number: " + number);
              }
              if (numb === -1 || isNaN(numb)) {
                i++;
                continue;
              }
              let year: string | null = null;
              if (numb < 5841) year = "2007";
              else if (numb < 317884) year = "2008";
              else if (numb < 655475) year = "2009";
              else if (numb < 930166) year = "2010";
              else year = "2011";
              number = year + "0" + number;
            } else if (number.startsWith("11") && (appli || number.startsWith("11/"))) {
              // standard patent application
              applications[i] = true;
              provisionals[i] = false;
              originalNumber = number;
              number = number.substring(3, number.length);
              number = number.replace(/[.\s/,]/g, "");
              // we check the range of the number for deciding about a year
              let numb = -1;
              try {
                numb = parseInt(number, 10);
                if (isNaN(numb)) throw new Error("NumberFormatException");
              } catch (_e) {
                LOGGER.warn("Cannot parse extracted patent number: " + number);
              }
              if (numb === -1 || isNaN(numb)) {
                i++;
                continue;
              }
              let year: string | null = null;
              // upstream uses octal literal 023305 (= 9925); preserved verbatim
              if (numb < 0o23305) year = "2004";
              else if (numb < 320178) year = "2005";
              else if (numb < 646743) year = "2006";
              else year = "2007";
              number = year + "0" + number;
            } else if (number.startsWith("10") && (appli || number.startsWith("10/"))) {
              // standard patent application
              applications[i] = true;
              provisionals[i] = false;
              originalNumber = number;
              number = number.substring(3, number.length);
              number = number.replace(/[.\s/,]/g, "");
              // we check the range of the number for deciding about a year
              let numb = -1;
              try {
                numb = parseInt(number, 10);
                if (isNaN(numb)) throw new Error("NumberFormatException");
              } catch (_e) {
                LOGGER.warn("Cannot parse extracted patent number: " + number);
              }
              if (numb === -1 || isNaN(numb)) {
                i++;
                continue;
              }
              let year: string | null = null;
              if (numb < 32443) year = "2001";
              else if (numb < 334164) year = "2002";
              else if (numb < 746297) year = "2003";
              else year = "2004";
              number = year + "0" + number;
            } else if (number.startsWith("9/") || number.startsWith("09/")) {
              // standard patent application
              applications[i] = true;
              provisionals[i] = false;
              originalNumber = number;
              if (number.startsWith("9/")) number = number.substring(2, number.length);
              else number = number.substring(3, number.length);
              number = number.replace(/[.\s/,]/g, "");
              // we check the range of the number for deciding about a year
              let numb = -1;
              try {
                numb = parseInt(number, 10);
                if (isNaN(numb)) throw new Error("NumberFormatException");
              } catch (_e) {
                LOGGER.warn("Cannot parse extracted patent number: " + number);
              }
              if (numb === -1 || isNaN(numb)) {
                i++;
                continue;
              }
              let year: string | null = null;
              if (numb < 219723) year = "1998";
              else if (numb < 471932) year = "1999";
              else if (numb < 740756) year = "2000";
              else year = "2001";
              number = year + "0" + number;
            } else if (number.startsWith("8/") || number.startsWith("08/")) {
              // standard patent application
              applications[i] = true;
              provisionals[i] = false;
              originalNumber = number;
              if (number.startsWith("8/")) number = number.substring(2, number.length);
              else number = number.substring(3, number.length);
              number = number.replace(/[.\s/,]/g, "");
              // we check the range of the number for deciding about a year
              let numb = -1;
              try {
                numb = parseInt(number, 10);
                if (isNaN(numb)) throw new Error("NumberFormatException");
              } catch (_e) {
                LOGGER.warn("Cannot parse extracted patent number: " + number);
              }
              if (numb === -1 || isNaN(numb)) {
                i++;
                continue;
              }
              let year: string | null = null;
              if (numb < 176047) year = "1993";
              else if (numb < 367542) year = "1994";
              else if (numb < 581739) year = "1995";
              else if (numb < 777991) year = "1996";
              else year = "1997";
              number = year + "0" + number;
            } else if (number.startsWith("7/") || number.startsWith("07/")) {
              // standard patent application
              applications[i] = true;
              provisionals[i] = false;
              originalNumber = number;
              if (number.startsWith("7/")) number = number.substring(2, number.length);
              else number = number.substring(3, number.length);
              number = number.replace(/[.\s/,]/g, "");
              // we check the range of the number for deciding about a year
              let numb = -1;
              try {
                numb = parseInt(number, 10);
                if (isNaN(numb)) throw new Error("NumberFormatException");
              } catch (_e) {
                LOGGER.warn("Cannot parse extracted patent number: " + number);
              }
              if (numb === -1 || isNaN(numb)) {
                i++;
                continue;
              }
              let year: string | null = null;
              if (numb < 140321) year = "1987";
              else if (numb < 292671) year = "1988";
              else if (numb < 459413) year = "1989";
              else if (numb < 636609) year = "1990";
              else if (numb < 815501) year = "1991";
              else year = "1992";
              number = year + "0" + number;
            } else if (number.startsWith("6/") || number.startsWith("06/")) {
              // standard patent application
              applications[i] = true;
              provisionals[i] = false;
              originalNumber = number;
              if (number.startsWith("6/")) number = number.substring(2, number.length);
              else number = number.substring(3, number.length);
              number = number.replace(/[.\s/,]/g, "");
              // we check the range of the number for deciding about a year
              let numb = -1;
              try {
                numb = parseInt(number, 10);
                if (isNaN(numb)) throw new Error("NumberFormatException");
              } catch (_e) {
                LOGGER.warn("Cannot parse extracted patent number: " + number);
              }
              if (numb === -1 || isNaN(numb)) {
                i++;
                continue;
              }
              let year: string | null = null;
              if (numb < 108971) year = "1979";
              else if (numb < 221957) year = "1980";
              else if (numb < 336510) year = "1981";
              else if (numb < 454954) year = "1982";
              else if (numb < 567457) year = "1983";
              else if (numb < 688174) year = "1984";
              else if (numb < 815454) year = "1985";
              else year = "1986";
              number = year + "0" + number;
            } else if (number.startsWith("5/") || number.startsWith("05/")) {
              // standard patent application
              applications[i] = true;
              provisionals[i] = false;
              originalNumber = number;
              if (number.startsWith("5/")) number = number.substring(2, number.length);
              else number = number.substring(3, number.length);
              number = number.replace(/[.\s/,]/g, "");
              // we check the range of the number for deciding about a year
              let numb = -1;
              try {
                numb = parseInt(number, 10);
                if (isNaN(numb)) throw new Error("NumberFormatException");
              } catch (_e) {
                LOGGER.warn("Cannot parse extracted patent number: " + number);
              }
              if (numb === -1 || isNaN(numb)) {
                i++;
                continue;
              }
              let year: string | null = null;
              if (numb < 103000) year = "1970";
              else if (numb < 214538) year = "1971";
              else if (numb < 319971) year = "1972";
              else if (numb < 429701) year = "1973";
              else if (numb < 537821) year = "1974";
              else if (numb < 645931) year = "1975";
              else if (numb < 756051) year = "1976";
              else if (numb < 866211) year = "1977";
              else year = "1978";
              number = year + "0" + number;
            } else if (number.startsWith("4/") || number.startsWith("04/")) {
              // standard patent application
              applications[i] = true;
              provisionals[i] = false;
              originalNumber = number;
              if (number.startsWith("4/")) number = number.substring(2, number.length);
              else number = number.substring(3, number.length);
              number = number.replace(/[.\s/,]/g, "");
              // we check the range of the number for deciding about a year
              let numb = -1;
              try {
                numb = parseInt(number, 10);
                if (isNaN(numb)) throw new Error("NumberFormatException");
              } catch (_e) {
                LOGGER.warn("Cannot parse extracted patent number: " + number);
              }
              if (numb === -1 || isNaN(numb)) {
                i++;
                continue;
              }
              let year: string | null = null;
              if (numb < 80000) year = "1960";
              else if (numb < 163000) year = "1961";
              else if (numb < 248000) year = "1962";
              else if (numb < 335000) year = "1963";
              else if (numb < 423000) year = "1964";
              else if (numb < 518000) year = "1965";
              else if (numb < 606000) year = "1966";
              else if (numb < 695000) year = "1967";
              else if (numb < 788000) year = "1968";
              else year = "1969";
              number = year + "0" + number;
            } else if (number.startsWith("3/") || number.startsWith("03/")) {
              applications[i] = true;
              provisionals[i] = false;
              originalNumber = number;
              if (number.startsWith("3/")) number = number.substring(2, number.length);
              else number = number.substring(3, number.length);
              number = number.replace(/[.\s/,]/g, "");
              // we check the range of the number for deciding about a year
              let numb = -1;
              try {
                numb = parseInt(number, 10);
                if (isNaN(numb)) throw new Error("NumberFormatException");
              } catch (_e) {
                LOGGER.warn("Cannot parse extracted patent number: " + number);
              }
              if (numb === -1 || isNaN(numb)) {
                i++;
                continue;
              }
              let year: string | null = null;
              if (numb < 68000) year = "1948";
              else if (numb < 136000) year = "1949";
              else if (numb < 204000) year = "1950";
              else if (numb < 264000) year = "1951";
              else if (numb < 329000) year = "1952";
              else if (numb < 401000) year = "1953";
              else if (numb < 479000) year = "1954";
              else if (numb < 557000) year = "1955";
              else if (numb < 632000) year = "1956";
              else if (numb < 706000) year = "1957";
              else if (numb < 784000) year = "1958";
              else year = "1959";
              number = year + "0" + number;
            } else if (number.startsWith("2/") || number.startsWith("02/")) {
              applications[i] = true;
              provisionals[i] = false;
              originalNumber = number;
              if (number.startsWith("2/")) number = number.substring(2, number.length);
              else number = number.substring(3, number.length);
              number = number.replace(/[.\s/,]/g, "");
              // we check the range of the number for deciding about a year
              let numb = -1;
              try {
                numb = parseInt(number, 10);
                if (isNaN(numb)) throw new Error("NumberFormatException");
              } catch (_e) {
                LOGGER.warn("Cannot parse extracted patent number: " + number);
              }
              if (numb === -1 || isNaN(numb)) {
                i++;
                continue;
              }
              let year: string | null = null;
              if (numb < 57000) year = "1935";
              else if (numb < 119000) year = "1936";
              else if (numb < 183000) year = "1937";
              else if (numb < 249000) year = "1938";
              else if (numb < 312000) year = "1939";
              else if (numb < 372000) year = "1940";
              else if (numb < 425000) year = "1941";
              else if (numb < 471000) year = "1942";
              else if (numb < 516000) year = "1943";
              else if (numb < 570000) year = "1944";
              else if (numb < 638000) year = "1945";
              else if (numb < 719000) year = "1946";
              else year = "1947";
              number = year + "0" + number;
            } else if (number.startsWith("1/") || number.startsWith("01/")) {
              applications[i] = true;
              provisionals[i] = false;
              originalNumber = number;
              if (number.startsWith("1/")) number = number.substring(2, number.length);
              else number = number.substring(3, number.length);
              number = number.replace(/[.\s/,]/g, "");
              // we check the range of the number for deciding about a year
              let numb = -1;
              try {
                numb = parseInt(number, 10);
                if (isNaN(numb)) throw new Error("NumberFormatException");
              } catch (_e) {
                LOGGER.warn("Cannot parse extracted patent number: " + number);
              }
              if (numb === -1 || isNaN(numb)) {
                i++;
                continue;
              }
              let year: string | null = null;
              // years 1915-1924 are redundant with 1925-1934 because apparently they forgot
              // incrementing the prefix...
              /*if (numb < 70000) year = "1915";
              else if (numb < 140000) year = "1916";
              else if (numb < 210000) year = "1917";
              else if (numb < 270000) year = "1918";
              else if (numb < 349000) year = "1919";
              else if (numb < 435000) year = "1920";
              else if (numb < 526000) year = "1921";
              else if (numb < 610000) year = "1922";
              else if (numb < 684000) year = "1923";
              else if (numb < ) year = "1924";
              else */
              if (numb < 78000) year = "1925";
              else if (numb < 158000) year = "1926";
              else if (numb < 244000) year = "1927";
              else if (numb < 330000) year = "1928";
              else if (numb < 418000) year = "1929";
              else if (numb < 506000) year = "1930";
              else if (numb < 584000) year = "1931";
              else if (numb < 650000) year = "1932";
              else if (numb < 705000) year = "1933";
              else year = "1934";
              number = year + "0" + number;
            } else if (number.startsWith("RE")) {
              // we have a reissued patent USRE with 5 digits number normally
              reissueds[i] = true;
              applications[i] = false;
              provisionals[i] = false;
            } else if (number.startsWith("PP")) {
              // we have a plant patent USPP
              plants[i] = true;
              applications[i] = false;
              provisionals[i] = false;
            } else {
              // even if it is indicated as an application, the serial coding indicates
              // that it is maybe not !
              // access to OPS would be necessary to decide but heuristitics can help !
              const numm = number.replace(/[ABCU,.\s/\\]/g, "").trim();
              originalNumber = numm;
              if (numm.length === 10 || numm.length === 11) {
                applications[i] = false;
                provisionals[i] = false;

                //if (publi && (numm.length() == 11)) {
                if (!(applications[i] as boolean) && numm.length === 11) {
                  if (numm.charAt(4) === "0") {
                    number = numm.substring(0, 4) + numm.substring(5, numm.length);
                  }
                }
              } else if (number.indexOf("/") !== -1 && !publi) {
                applications[i] = true;
              }
            }
          } else if (country === "JP") {
            const numm = number.replace(/[ABCU,.\s/]/g, "").trim();
            originalNumber = numm;
            if (numm.length === 10) {
              applications[i] = false;
              provisionals[i] = false;
            }
            // first do we have a modern numbering
            if (numm.length === 9 && (numm.startsWith("20") || numm.startsWith("19"))) {
              // publication, we need to add a 0 after the 4 digit year
              number = numm.substring(0, 4) + "0" + numm.substring(4, numm.length);
            }
            //else if ((numm.length() == 7)) {
            //}
            else if ((applications[i] as boolean) && (numm.length === 7 || numm.length === 8)) {
              // for application !
              // emperor reign post processing
              // we need to get the prefix in the original number
              let prefix: string | null = "" + number.charAt(0);
              let move = 0;
              if (prefix === "A" || prefix === "B" || prefix === "C") {
                // kind code
                kindcodes[i] = prefix;
                prefix = null;
                move = 1;
                applications[i] = false;
                // it was not an application number but a publication !
              } else if (isDigitChar(prefix.charAt(0))) {
                if (originalNumber.charAt(1) === "-" || originalNumber.charAt(1) === "/") {
                  move = 1;
                } else if (isDigitChar(number.charAt(1))) {
                  prefix += number.charAt(1);
                  move = 2;
                } else move = 1;
              } else {
                if (isDigitChar(number.charAt(1))) {
                  prefix = "" + number.charAt(1);
                  move = 2;
                } else prefix = null;
              }
              if (prefix !== null) {
                let year: string | null = null;
                // this is an heuristics: for small numbers (<25) we have Heisei reign
                // for higher, we have Showa reign... this works from 1950
                const emperorYear = parseInt(prefix, 10);
                if (emperorYear <= 25) {
                  year = "" + (emperorYear + 1988);
                } else if (emperorYear <= 63) {
                  year = "" + (emperorYear + 1925);
                }
                number = year + number.substring(move, number.length);
              }
            }
          } else if (country === "DE") {
            // Application numbering format up to 2003. The first digit indicates the type of
            // application (1 for patent). The next 2 digits are the filing year. the remaining
            // digits are the serial number
            // ex: 195 00 002.1 -> DE19951000002

            // Numbering format (as of 1st January 2004). First two digits indicates application
            // type (10 for patent). The 4-digit year of filing is next, followed by a 6-digit
            // serial number, and an optional check digit.
            // ex: 102004005106.7 -> DE200410005106

            // otherwise a publication
          } else if (country === "GB") {
            if (applications[i] as boolean) {
              const numm = number.replace(/[ABCU,.\s/]/g, "").trim();
              originalNumber = numm;
              if (numm.length === 7) {
                let year = numm.substring(0, 2);
                if (year.charAt(0) === "7" || year.charAt(0) === "8" || year.charAt(0) === "9") {
                  year = "19" + year;
                } else {
                  year = "20" + year;
                }
                number = year + "00" + numm.substring(2, numm.length);
              }
            }
          } else if (country === "FR") {
            // A 2 digit year followed by a 5-digit serial number in sequential order according to
            // year
            // ex: 96 03098 -> FR19960003098
          }
        }
        newNumbers.push(number);
        if (originalNumber === null) originalNumber = number;
        originalNumbers.push(originalNumber);
        i++;
      }

      numbers = newNumbers as string[];
      i = 0;
      for (const number of numbers) {
        if (number !== null) {
          const res0 = new PatentItem();
          res0.setAuthority(country);
          res0.setApplication(applications[i] as boolean);
          res0.setProvisional(provisionals[i] as boolean);
          res0.setReissued(reissueds[i] as boolean);
          res0.setPlant(plants[i] as boolean);
          if (pctapps[i] as boolean) res0.setNumberEpoDoc(number.replace(/[.\s/\\]/g, ""));
          else res0.setNumberEpoDoc(number.replace(/[ABCU,.\s/\\]/g, ""));
          if (i < originalNumbers.length) {
            res0.setNumberWysiwyg((originalNumbers[i] as string).replace(/[ABCU,.\s/\\]/g, ""));
          }

          // number completion
          if (country === "EP") {
            if (!res0.getApplication()) {
              while ((res0.getNumberEpoDoc() as string).length < 7) {
                res0.setNumberEpoDoc("0" + res0.getNumberEpoDoc());
              }
            }
          }

          res0.setKindCode(kindcodes[i] ?? null);

          res0.setOffsetBegin(offsets_begin[i] as number);
          res0.setOffsetEnd(offsets_end[i] as number);
          res.push(res0);
        }
        i++;
      }
    }

    return res;
  }

  private addNumber(
    numbers: string[],
    offsets_begin: number[],
    offsets_end: number[],
    toto: string,
    offset_begin: number,
    offset_end: number,
    sequence: string | null,
  ): void {
    // we have to check if we have a check code at the end of the number
    toto = toto.trim();
    if (toto.length > 2) {
      if (toto.charAt(toto.length - 2) === "." && isDigitChar(toto.charAt(toto.length - 1))) {
        toto = toto.substring(0, toto.length - 2);
      }
      if (
        toto.length > 2 &&
        (toto.charAt(toto.length - 2) === "A" ||
          toto.charAt(toto.length - 2) === "B" ||
          toto.charAt(toto.length - 2) === "C") &&
        isDigitChar(toto.charAt(toto.length - 1))
      ) {
        toto = toto.substring(0, toto.length - 2);
      }
    }

    if (toto.length > 4 && toto.length < 20) {
      if (sequence === null) {
        numbers.push(toto.trim());
        offsets_begin.push(offset_begin);
        offsets_end.push(offset_end);
      } else {
        // we might have an enumeration and we need to match the target number in it
        const localStart = sequence.indexOf(toto);
        const localEnd = localStart + toto.length;
        numbers.push(toto.trim());
        if (localStart !== -1) {
          offsets_begin.push(localStart + offset_begin);
          offsets_end.push(localEnd + offset_begin);
        } else {
          offsets_begin.push(offset_begin);
          offsets_end.push(offset_end);
        }
      }
    }
  }
}
