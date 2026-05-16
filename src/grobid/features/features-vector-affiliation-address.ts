// Port of org.grobid.core.features.FeaturesVectorAffiliationAddress.
// Upstream: grobid-core/src/main/java/org/grobid/core/features/FeaturesVectorAffiliationAddress.java
//
// Class for features used for parsing a block corresponding to affiliation
// and address.

import { GrobidException } from "../exceptions/grobid-exception.js";
import { LayoutToken } from "../layout/layout-token.js";
import { OffsetPosition } from "../utilities/offset-position.js";
import { TextUtilities } from "../utilities/text-utilities.js";

import { FeatureFactory } from "./feature-factory.js";

export class FeaturesVectorAffiliationAddress {
  public string: string | null = null; // lexical feature
  public label: string | null = null; // label if known
  public lineStatus: string | null = null; // one of LINESTART, LINEIN, LINEEND
  public bold: boolean = false;
  public italic: boolean = false;
  public capitalisation: string | null = null; // one of INITCAP, ALLCAPS, NOCAPS
  // Upstream `public String digit;` (Java-null default). Port-side TS init fix.
  public digit: string | null = null; // one of ALLDIGIT, CONTAINDIGIT, NODIGIT
  public singleChar: boolean = false;
  public properName: boolean = false;
  public commonName: boolean = false;
  public firstName: boolean = false;
  public locationName: boolean = false;
  public countryName: boolean = false;
  public punctType: string | null = null;
  public wordShape: string | null = null;
  // one of NOPUNCT, OPENBRACKET, ENDBRACKET, DOT, COMMA, HYPHEN, QUOTE, PUNCT (default)

  public printVector(): string | null {
    if (this.string === null) return null;
    if (this.string.length === 0) return null;
    const res: string[] = [];

    // token string (1)
    res.push(this.string);

    // lowercase string
    res.push(" " + this.string.toLowerCase());

    // prefix (4)
    res.push(" " + TextUtilities.prefix(this.string, 1));
    res.push(" " + TextUtilities.prefix(this.string, 2));
    res.push(" " + TextUtilities.prefix(this.string, 3));
    res.push(" " + TextUtilities.prefix(this.string, 4));

    // suffix (4)
    res.push(" " + TextUtilities.suffix(this.string, 1));
    res.push(" " + TextUtilities.suffix(this.string, 2));
    res.push(" " + TextUtilities.suffix(this.string, 3));
    res.push(" " + TextUtilities.suffix(this.string, 4));

    // line information (1)
    res.push(" " + this.lineStatus);

    // capitalisation (1)
    if (this.digit === "ALLDIGIT") res.push(" NOCAPS");
    else res.push(" " + this.capitalisation);

    // digit information (1)
    res.push(" " + this.digit);

    // character information (1)
    if (this.singleChar) res.push(" 1");
    else res.push(" 0");

    // lexical information (5)
    if (this.properName) res.push(" 1");
    else res.push(" 0");

    if (this.commonName) res.push(" 1");
    else res.push(" 0");

    if (this.firstName) res.push(" 1");
    else res.push(" 0");

    if (this.locationName) res.push(" 1");
    else res.push(" 0");

    if (this.countryName) res.push(" 1");
    else res.push(" 0");

    // punctuation information (1)
    res.push(" " + this.punctType); // in case the token is a punctuation (NO otherwise)

    res.push(" ");
    res.push(this.wordShape ?? "");

    // label - for training data (1)
    if (this.label !== null) res.push(" " + this.label + "\n");
    else res.push(" 0\n");

    return res.join("");
  }

  /**
   * Add the features for the affiliation+address model.
   */
  public static addFeaturesAffiliationAddress(
    lines: string[],
    allTokens: LayoutToken[][],
    locationPlaces: OffsetPosition[][] | null,
    countriesPositions: OffsetPosition[][],
  ): string {
    if (locationPlaces === null) {
      throw new GrobidException(
        "At least one list of gazetter matches positions is null.",
      );
    }
    if (locationPlaces.length === 0) {
      throw new GrobidException(
        "At least one list of gazetter matches positions is empty.",
      );
    }
    //System.out.println(lines);
    const result: string[] = [];
    let isPlace = false;
    let isCountry = false;
    let lineStatus = "LINESTART";
    let locPlace = 0;
    let currentLocationPlaces: OffsetPosition[] | null = locationPlaces[locPlace] ?? null;
    let currentCountryPlaces: OffsetPosition[] | null = countriesPositions[locPlace] ?? null;
    let tokens: LayoutToken[] | null = allTokens[locPlace] ?? null;
    let currentPosPlaces = 0;
    let currentPosCountries = 0;
    let mm = 0; // position of the token in the current sentence
    let line: string | null = null;

    for (let i = 0; i < lines.length; i++) {
      line = lines[i]!;
      isPlace = false;
      isCountry = false;
      if (line === "\n") {
        result.push("\n \n");
        continue;
      }

      while (tokens !== null && mm < tokens.length) {
        const token = tokens[mm]!;
        if (token.getText() === " " || token.getText() === "\n") mm++;
        else break;
      }

      // check the position of matches for place names
      let skipTest = false;
      if (currentLocationPlaces !== null && currentLocationPlaces.length > 0) {
        if (currentPosPlaces === currentLocationPlaces.length - 1) {
          if (currentLocationPlaces[currentPosPlaces]!.end < mm) {
            skipTest = true;
          }
        }
        if (!skipTest) {
          for (let j = currentPosPlaces; j < currentLocationPlaces.length; j++) {
            if (
              currentLocationPlaces[j]!.start <= mm &&
              currentLocationPlaces[j]!.end >= mm
            ) {
              isPlace = true;
              currentPosPlaces = j;
              break;
            } else if (currentLocationPlaces[j]!.start > mm) {
              isPlace = false;
              currentPosPlaces = j;
              break;
            }
          }
        }
      }

      // check the position of matches for country names
      skipTest = false;
      if (currentCountryPlaces !== null && currentCountryPlaces.length > 0) {
        if (currentPosCountries === currentCountryPlaces.length - 1) {
          if (currentCountryPlaces[currentPosCountries]!.end < mm) {
            skipTest = true;
          }
        }
        if (!skipTest) {
          for (let j = currentPosCountries; j < currentCountryPlaces.length; j++) {
            if (
              currentCountryPlaces[j]!.start <= mm &&
              currentCountryPlaces[j]!.end >= mm
            ) {
              isCountry = true;
              currentPosCountries = j;
              break;
            } else if (currentCountryPlaces[j]!.start > mm) {
              isCountry = false;
              currentPosCountries = j;
              break;
            }
          }
        }
      }

      if (line.trim().includes("@newline")) {
        lineStatus = "LINESTART";
        continue;
      }

      if (line.trim().length === 0) {
        result.push("\n");
        lineStatus = "LINESTART";
        currentLocationPlaces = locationPlaces[locPlace] ?? null;
        currentCountryPlaces = countriesPositions[locPlace] ?? null;
        tokens = allTokens[locPlace] ?? null;
        currentPosPlaces = 0;
        currentPosCountries = 0;
        locPlace++;
        mm = 0;
      } else {
        // look ahead for line status update
        if (lineStatus !== "LINESTART") {
          if (i + 1 < lines.length) {
            const nextLine = lines[i + 1]!;
            if (
              nextLine.trim().length === 0 ||
              nextLine.trim().includes("@newline")
            ) {
              lineStatus = "LINEEND";
            }
          } else if (i + 1 === lines.length) {
            lineStatus = "LINEEND";
          }
        }

        const vector = FeaturesVectorAffiliationAddress.addFeaturesAffiliationAddressLine(
          line,
          lineStatus,
          isPlace,
          isCountry,
        );
        const printed = vector.printVector();
        if (printed !== null) result.push(printed);

        if (lineStatus === "LINESTART") {
          lineStatus = "LINEIN";
        } else if (lineStatus === "LINEEND") {
          lineStatus = "LINESTART";
        }
      }
      mm++;
    }
    //System.out.println(result.toString());
    return result.join("");
  }

  private static addFeaturesAffiliationAddressLine(
    line: string,
    lineStatus: string,
    isPlace: boolean,
    isCountry: boolean,
  ): FeaturesVectorAffiliationAddress {
    const featureFactory = FeatureFactory.getInstance();
    const featuresVector = new FeaturesVectorAffiliationAddress();

    // StringTokenizer st = new StringTokenizer(line.trim(), "\t ");
    const parts = line.trim().split(/[\t ]+/).filter((s) => s.length > 0);
    if (parts.length > 0) {
      const word = parts[0]!;
      let label: string | null = null;
      if (parts.length > 1) label = parts[1]!;

      featuresVector.string = word;
      featuresVector.label = label;

      featuresVector.lineStatus = lineStatus;

      if (word.length === 1) {
        featuresVector.singleChar = true;
      }

      if (featureFactory.test_all_capital(word))
        featuresVector.capitalisation = "ALLCAPS";
      else if (featureFactory.test_first_capital(word))
        featuresVector.capitalisation = "INITCAP";
      else featuresVector.capitalisation = "NOCAPS";

      if (featureFactory.test_number(word)) featuresVector.digit = "ALLDIGIT";
      else if (featureFactory.test_digit(word))
        featuresVector.digit = "CONTAINDIGIT";
      else featuresVector.digit = "NODIGIT";

      if (featureFactory.test_common(word)) featuresVector.commonName = true;

      if (featureFactory.test_names(word)) featuresVector.properName = true;

      if (featureFactory.isPunct.test(word)) {
        featuresVector.punctType = "PUNCT";
      }
      if (word === "(" || word === "[") {
        featuresVector.punctType = "OPENBRACKET";
      } else if (word === ")" || word === "]") {
        featuresVector.punctType = "ENDBRACKET";
      } else if (word === ".") {
        featuresVector.punctType = "DOT";
      } else if (word === ",") {
        featuresVector.punctType = "COMMA";
      } else if (word === "-") {
        featuresVector.punctType = "HYPHEN";
      } else if (word === '"' || word === "'" || word === "`") {
        featuresVector.punctType = "QUOTE";
      }

      if (featuresVector.capitalisation === null)
        featuresVector.capitalisation = "NOCAPS";

      if (featuresVector.digit === null || featuresVector.digit === undefined)
        featuresVector.digit = "NODIGIT";

      if (featuresVector.punctType === null)
        featuresVector.punctType = "NOPUNCT";

      if (isPlace) featuresVector.locationName = true;

      //if (featureFactory.test_country(word))
      if (isCountry) featuresVector.countryName = true;

      featuresVector.wordShape = TextUtilities.wordShape(word);
    }

    return featuresVector;
  }
}
