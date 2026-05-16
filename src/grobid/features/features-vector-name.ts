// Port of org.grobid.core.features.FeaturesVectorName.
// Upstream: grobid-core/src/main/java/org/grobid/core/features/FeaturesVectorName.java
//
// Class for features used for parsing sequence of names.

import { LayoutToken } from "../layout/layout-token.js";
import { OffsetPosition } from "../utilities/offset-position.js";
import { TextUtilities } from "../utilities/text-utilities.js";
import { UnicodeUtil } from "../utilities/unicode-util.js";

import { FeatureFactory } from "./feature-factory.js";

export class FeaturesVectorName {
  public string: string | null = null; // lexical feature
  public label: string | null = null; // label if known
  public lineStatus: string | null = null; // one of LINESTART, LINEIN, LINEEND
  public capitalisation: string | null = null; // one of INITCAP, ALLCAPS, NOCAPS
  // Upstream `public String digit;` (Java-null default). Port-side TS init fix
  // so the engine's `=== null` guard fires and we never emit "undefined".
  public digit: string | null = null; // one of ALLDIGIT, CONTAINDIGIT, NODIGIT
  public singleChar: boolean = false;
  public commonName: boolean = false;
  public firstName: boolean = false;
  public lastName: boolean = false;
  public punctType: string | null = null;
  // one of NOPUNCT, OPENBRACKET, ENDBRACKET, DOT, COMMA, HYPHEN, QUOTE, PUNCT (default)

  public isKnownTitle: boolean = false;
  public isKnownSuffix: boolean = false;

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

    // lexical information (3)
    if (this.commonName) res.push(" 1");
    else res.push(" 0");

    if (this.firstName) res.push(" 1");
    else res.push(" 0");

    if (this.lastName) res.push(" 1");
    else res.push(" 0");

    if (this.isKnownTitle) res.push(" 1");
    else res.push(" 0");

    if (this.isKnownSuffix) res.push(" 1");
    else res.push(" 0");

    // punctuation information (1)
    res.push(" " + this.punctType); // in case the token is a punctuation (NO otherwise)

    // label - for training data (1)
    if (this.label !== null) res.push(" " + this.label + "\n");
    else res.push(" 0\n");

    return res.join("");
  }

  /**
   * Add feature for name parsing.
   */
  public static addFeaturesName(
    tokens: LayoutToken[],
    labels: string[] | null,
    titlePosition: OffsetPosition[] | null,
    suffixPosition: OffsetPosition[] | null,
  ): string {
    const featureFactory = FeatureFactory.getInstance();

    const header: string[] = [];
    let newline = true;
    let previousTag: string | null = null;
    let previousText: string | null = null;
    let features: FeaturesVectorName | null = null;
    let token: LayoutToken | null = null;

    let currentTitlePosition = 0;
    let currentSuffixPosition = 0;

    let isTitleToken: boolean;
    let isSuffixToken: boolean;
    let skipTest: boolean;

    for (let n = 0; n < tokens.length; n++) {
      let outputLineStatus = false;
      isTitleToken = false;
      isSuffixToken = false;
      skipTest = false;

      token = tokens[n]!;

      /*if (line == null) {
                header.append("\n \n");
                newBlock = true;
                newline = true;
                n++;
                continue;
            }
            line = line.trim();
            if (line.length() == 0) {
                header.append("\n \n");
                newBlock = true;
                newline = true;
                n++;
                continue;
            }

            if (line.equals("@newline")) {
                if (newline) {
                    newBlock = true;
                }
                newline = true;
                n++;
                continue;
            }*/

      //int ind = line.indexOf(" ");
      let text: string | null = token.getText();
      if (text === null) {
        continue;
      }
      if (text === " ") {
        continue;
      }

      newline = false;
      if (text === "\n") {
        newline = true;
        continue;
      }

      // parano normalisation
      text = UnicodeUtil.normaliseTextAndRemoveSpaces(text);
      if (text.trim().length === 0) {
        continue;
      }

      // check the position of matches for journals
      if (titlePosition !== null && titlePosition.length > 0) {
        if (currentTitlePosition === titlePosition.length - 1) {
          if (titlePosition[currentTitlePosition]!.end < n) {
            skipTest = true;
          }
        }
        if (!skipTest) {
          for (let i = currentTitlePosition; i < titlePosition.length; i++) {
            if (titlePosition[i]!.start <= n && titlePosition[i]!.end >= n) {
              isTitleToken = true;
              currentTitlePosition = i;
              break;
            } else if (titlePosition[i]!.start > n) {
              isTitleToken = false;
              currentTitlePosition = i;
              break;
            }
          }
        }
      }
      // check the position of matches for abbreviated journals
      skipTest = false;
      if (suffixPosition !== null) {
        if (currentSuffixPosition === suffixPosition.length - 1) {
          if (suffixPosition[currentSuffixPosition]!.end < n) {
            skipTest = true;
          }
        }
        if (!skipTest) {
          for (let i = currentSuffixPosition; i < suffixPosition.length; i++) {
            if (
              suffixPosition[i]!.start <= n &&
              suffixPosition[i]!.end >= n
            ) {
              isSuffixToken = true;
              currentSuffixPosition = i;
              break;
            } else if (suffixPosition[i]!.start > n) {
              isSuffixToken = false;
              currentSuffixPosition = i;
              break;
            }
          }
        }
      }

      let tag: string | null = null;
      if (labels !== null && labels.length > 0 && labels.length > n) {
        tag = labels[n]!;
      }

      if (TextUtilities.filterLine(text)) {
        continue;
      }

      features = new FeaturesVectorName();
      features.string = text;

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
      } else if (tokens.length === n + 1) {
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
          const newLine = tokens[n + i]!.getText();
          if (newLine !== null && newLine !== undefined) {
            if (newLine === "\n") {
              endline = true;
              if (!outputLineStatus) {
                features.lineStatus = "LINEEND";
                outputLineStatus = true;
              }
              endloop = true;
            } else if (newLine !== " ") {
              endloop = true;
            }
          }
          void endline;

          /*if ((endline) & (!outputLineStatus)) {
                        features.lineStatus = "LINEEND";
                        outputLineStatus = true;
                    }*/
          i++;
        }
      }

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

      if (featureFactory.test_common(text)) {
        features.commonName = true;
      }

      if (featureFactory.test_first_names(text)) {
        features.firstName = true;
      }

      if (featureFactory.test_last_names(text)) {
        features.lastName = true;
      }

      if (featureFactory.isDigit.test(text)) {
        features.digit = "ALLDIGIT";
      }

      if (features.digit === null || features.digit === undefined)
        features.digit = "NODIGIT";

      if (features.punctType === null) features.punctType = "NOPUNCT";

      if (isTitleToken) {
        features.isKnownTitle = true;
      }

      if (isSuffixToken) {
        features.isKnownSuffix = true;
      }

      features.label = tag;

      const printed = features.printVector();
      if (printed !== null) header.push(printed);

      previousTag = tag;
      previousText = text;
    }
    void previousTag;
    void previousText;

    return header.join("");
  }
}
