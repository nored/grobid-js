// Port of org.grobid.core.features.FeaturesVectorFunding.
// Upstream: grobid-core/src/main/java/org/grobid/core/features/FeaturesVectorFunding.java
//
// Class for features used for recognizing funding.

import { LayoutToken } from "../layout/layout-token.js";
import { Lexicon } from "../lexicon/lexicon.js";
import { OffsetPosition } from "../utilities/offset-position.js";
import { TextUtilities } from "../utilities/text-utilities.js";
import { UnicodeUtil } from "../utilities/unicode-util.js";

import { FeatureFactory } from "./feature-factory.js";

export class FeaturesVectorFunding {
  public string: string | null = null; // lexical feature
  public label: string | null = null; // label if known
  public lineStatus: string | null = null; // one of LINESTART, LINEIN, LINEEND
  public capitalisation: string | null = null; // one of INITCAP, ALLCAPS, NOCAPS
  // Upstream `public String digit;` (Java-null default). Port-side TS init fix.
  public digit: string | null = null; // one of ALLDIGIT, CONTAINDIGIT, NODIGIT
  public singleChar: boolean = false;
  public containDash: boolean = false;
  public knownFunder: boolean = false;
  public knownInfrastructure: boolean = false;
  public punctType: string | null = null;
  // one of NOPUNCT, OPENBRACKET, ENDBRACKET, DOT, COMMA, HYPHEN, QUOTE, PUNCT (default)
  public containPunct: boolean = false;

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

    // lexical information (2)
    if (this.knownFunder) res.push(" 1");
    else res.push(" 0");

    // lexical information (2)
    if (this.knownInfrastructure) res.push(" 1");
    else res.push(" 0");

    // punctuation information (2)
    res.push(" " + this.punctType); // in case the token is a punctuation (NO otherwise)

    // label - for training data (1)
    if (this.label !== null) res.push(" " + this.label + "\n");
    else res.push(" 0\n");

    return res.join("");
  }

  /**
   * Add features for funding recognition.
   */
  public static addFeatures(
    tokens: LayoutToken[],
    tags: string[] | null,
  ): string {
    const featureFactory = FeatureFactory.getInstance();

    const funderPositions: OffsetPosition[] =
      Lexicon.getInstance().tokenPositionsFunderNames(tokens);
    const infrastructurePositions: OffsetPosition[] =
      Lexicon.getInstance().tokenPositionsResearchInfrastructureNames(tokens);

    const stringBuilder: string[] = [];
    let features: FeaturesVectorFunding | null = null;
    let newline = true;

    let currentFunderPositions = 0;
    let isKnownFunderToken = false;
    let currentInfrastructurePositions = 0;
    let isKnownInfrastructureToken = false;
    let skipTest: boolean;

    for (let n = 0; n < tokens.length; n++) {
      let outputLineStatus = false;
      isKnownFunderToken = false;
      skipTest = false;

      const token = tokens[n]!;
      let text: string | null = token.getText();
      let tag: string | null = null;
      if (tags !== null && tags.length === tokens.length) tag = tags[n]!;

      if (text === null || text.length === 0) {
        continue;
      }

      if (text === " ") {
        continue;
      }

      if (text === "\n") {
        // should not be the case for citation model
        continue;
      }

      // parano normalisation
      text = UnicodeUtil.normaliseTextAndRemoveSpaces(text);
      if (text.trim().length === 0) {
        continue;
      }

      /*boolean filter = false;
            if (text == null) {
                filter = true;
            } else if (text.length() == 0) {
                filter = true;
            } else if (text.startsWith("@IMAGE")) {
                filter = true;
            } else if (text.contains(".pbm")) {
                filter = true;
            } else if (text.contains(".svg")) {
                filter = true;
            } else if (text.contains(".jpg")) {
                filter = true;
            } else if (text.contains(".png")) {
                filter = true;
            }

            if (filter)
                continue;*/

      features = new FeaturesVectorFunding();
      features.string = text;

      // check the position of matches for known funders
      if (funderPositions !== null && funderPositions.length > 0) {
        if (currentFunderPositions === funderPositions.length - 1) {
          if (funderPositions[currentFunderPositions]!.end < n) {
            skipTest = true;
          }
        }
        if (!skipTest) {
          for (let i = currentFunderPositions; i < funderPositions.length; i++) {
            if (funderPositions[i]!.start <= n && funderPositions[i]!.end >= n) {
              isKnownFunderToken = true;
              currentFunderPositions = i;
              break;
            } else if (funderPositions[i]!.start > n) {
              isKnownFunderToken = false;
              currentFunderPositions = i;
              break;
            }
          }
        }
      }

      // check the position of matches for known infrastructures
      if (infrastructurePositions !== null && infrastructurePositions.length > 0) {
        if (
          currentInfrastructurePositions ===
          infrastructurePositions.length - 1
        ) {
          if (
            infrastructurePositions[currentInfrastructurePositions]!.end < n
          ) {
            skipTest = true;
          }
        }
        if (!skipTest) {
          for (
            let i = currentInfrastructurePositions;
            i < infrastructurePositions.length;
            i++
          ) {
            if (
              infrastructurePositions[i]!.start <= n &&
              infrastructurePositions[i]!.end >= n
            ) {
              isKnownInfrastructureToken = true;
              currentInfrastructurePositions = i;
              break;
            } else if (infrastructurePositions[i]!.start > n) {
              isKnownInfrastructureToken = false;
              currentInfrastructurePositions = i;
              break;
            }
          }
        }
      }

      if (newline) {
        features.lineStatus = "LINESTART";
        outputLineStatus = true;
      }

      if (featureFactory.isPunct.test(text)) {
        features.punctType = "PUNCT";
      }

      if (text === "(" || text === "[") {
        features.punctType = "OPENBRACKET";
      } else if (text === ")" || text === "]") {
        features.punctType = "ENDBRACKET";
      } else if (text === ".") {
        features.punctType = "DOT";
      } else if (text === ",") {
        features.punctType = "COMMA";
      } else if (text === "-") {
        features.punctType = "HYPHEN";
      } else if (text === '"' || text === "'" || text === "`") {
        features.punctType = "QUOTE";
      }

      if (n === 0) {
        if (!outputLineStatus) {
          features.lineStatus = "LINESTART";
          outputLineStatus = true;
        }
      } else if (n === tokens.length - 1) {
        if (!outputLineStatus) {
          features.lineStatus = "LINEEND";
          outputLineStatus = true;
        }
      } else {
        // look ahead...
        let endline = false;
        let i = 1;
        let endloop = false;
        while (tokens.length > n + i && !endloop) {
          const newToken = tokens[n + i]!;
          const newText = newToken.getText();

          if (newText !== null && newText !== undefined) {
            if (newText === "\n") {
              endline = true;
              if (!outputLineStatus) {
                features.lineStatus = "LINEEND";
                outputLineStatus = true;
              }
            } else if (newText === "@newline") {
              endline = true;
              if (!outputLineStatus) {
                features.lineStatus = "LINEEND";
                outputLineStatus = true;
              }
            } else {
              endloop = true;
            }
          }

          if (endline && !outputLineStatus) {
            features.lineStatus = "LINEEND";
            outputLineStatus = true;
          }
          i++;
        }
      }

      newline = false;
      if (!outputLineStatus) {
        features.lineStatus = "LINEIN";
        outputLineStatus = true;
      }

      if (text.length === 1) {
        features.singleChar = true;
      }

      const c0 = text.charAt(0);
      if (c0 !== c0.toLowerCase() && c0 === c0.toUpperCase()) {
        features.capitalisation = "INITCAP";
      }

      if (featureFactory.test_all_capital(text)) {
        features.capitalisation = "ALLCAP";
      }

      if (features.capitalisation === null) features.capitalisation = "NOCAPS";

      if (featureFactory.test_digit(text)) {
        features.digit = "CONTAINSDIGITS";
      }

      if (featureFactory.isDigit.test(text)) {
        features.digit = "ALLDIGIT";
      }

      if (features.digit === null || features.digit === undefined)
        features.digit = "NODIGIT";

      if (features.punctType === null) features.punctType = "NOPUNCT";

      if (isKnownFunderToken) features.knownFunder = true;

      if (isKnownInfrastructureToken) features.knownInfrastructure = true;

      if (tag !== null) features.label = tag;

      const printed = features.printVector();
      if (printed !== null) stringBuilder.push(printed);
    }

    return stringBuilder.join("");
  }
}
