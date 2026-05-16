// Port of org.grobid.core.features.FeaturesVectorChemicalEntity.
// Upstream: grobid-core/src/main/java/org/grobid/core/features/FeaturesVectorChemicalEntity.java
//
// Class for features used for chemical entity identification in raw texts
// such as scientific articles and patent descriptions.

import { TextUtilities } from "../utilities/text-utilities.js";

import { FeatureFactory } from "./feature-factory.js";

export class FeaturesVectorChemicalEntity {
  // default bins for relative position, set experimentally
  private static readonly nbBins = 12;

  public string: string | null = null; // lexical feature
  public label: string | null = null; // label if known

  public capitalisation: string | null = null; // one of INITCAP, ALLCAPS, NOCAPS
  // Upstream `public String digit;` (Java-null default). Port-side TS init fix.
  public digit: string | null = null; // one of ALLDIGIT, CONTAINDIGIT, NODIGIT
  public singleChar: boolean = false;

  public properName: boolean = false;
  public commonName: boolean = false;
  public firstName: boolean = false;
  public punctType: string | null = null;
  // one of NOPUNCT, OPENBRACKET, ENDBRACKET, DOT, COMMA, HYPHEN, QUOTE, PUNCT (default)
  // OPENQUOTE, ENDQUOTE

  public isKnownChemicalToken: boolean = false;
  public isKnownChemicalNameToken: boolean = false;

  public relativeDocumentPosition: number = -1;

  public constructor() {}

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

    // capitalisation (1)
    if (this.digit === "ALLDIGIT") res.push(" NOCAPS");
    else res.push(" " + this.capitalisation);

    // digit information (1)
    res.push(" " + this.digit);

    // character information (1)
    if (this.singleChar) res.push(" 1");
    else res.push(" 0");

    // lexical information (2)
    if (this.properName) res.push(" 1");
    else res.push(" 0");

    if (this.commonName) res.push(" 1");
    else res.push(" 0");

    // chemistry vocabulary information (2)
    if (this.isKnownChemicalToken) res.push(" 1");
    else res.push(" 0");

    if (this.isKnownChemicalNameToken) res.push(" 1");
    else res.push(" 0");

    // punctuation information (1)
    res.push(" " + this.punctType); // in case the token is a punctuation (NO otherwise)

    // token length
    res.push(" " + this.string.length);

    // relative document position
    res.push(" " + this.relativeDocumentPosition);

    // label - for training data (1)
    if (this.label !== null) res.push(" " + this.label + "\n");
    else res.push(" 0\n");

    return res.join("");
  }

  /**
   * Add the features for the chemical entity extraction model.
   */
  public static addFeaturesChemicalEntities(
    line: string,
    totalLength: number,
    position: number,
    isChemicalToken: boolean,
    isChemicalNameToken: boolean,
  ): FeaturesVectorChemicalEntity {
    const featureFactory = FeatureFactory.getInstance();

    const featuresVector = new FeaturesVectorChemicalEntity();
    // StringTokenizer st = new StringTokenizer(line, "\t");
    const parts = line.split("\t").filter((s) => s.length > 0);
    if (parts.length > 0) {
      const word = parts[0]!;
      let label: string | null = null;
      if (parts.length > 1) label = parts[1]!;

      featuresVector.string = word;
      featuresVector.label = label;

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

      featuresVector.relativeDocumentPosition = featureFactory.linearScaling(
        position,
        totalLength,
        FeaturesVectorChemicalEntity.nbBins,
      );

      if (isChemicalToken) {
        featuresVector.isKnownChemicalToken = true;
      }

      if (isChemicalNameToken) {
        featuresVector.isKnownChemicalNameToken = true;
      }
    }

    return featuresVector;
  }
}
