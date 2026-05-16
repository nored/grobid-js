// Port of org.grobid.core.features.FeaturesVectorDate.
// Upstream: grobid-core/src/main/java/org/grobid/core/features/FeaturesVectorDate.java
//
// Class for features used for parsing date chunk.

import { TextUtilities } from "../utilities/text-utilities.js";

import { FeatureFactory } from "./feature-factory.js";

export class FeaturesVectorDate {
  public string: string | null = null; // lexical feature
  public label: string | null = null; // label if known
  public lineStatus: string | null = null; // one of LINESTART, LINEIN, LINEEND
  public capitalisation: string | null = null; // one of INITCAP, ALLCAPS, NOCAPS
  // Upstream `public String digit;` (Java-null default). Port-side TS init fix.
  public digit: string | null = null; // one of ALLDIGIT, CONTAINDIGIT, NODIGIT
  public singleChar: boolean = false;
  public containDash: boolean = false;
  public year: boolean = false;
  public month: boolean = false;
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
    if (this.year) res.push(" 1");
    else res.push(" 0");

    if (this.month) res.push(" 1");
    else res.push(" 0");

    // punctuation information (2)
    res.push(" " + this.punctType); // in case the token is a punctuation (NO otherwise)

    // label - for training data (1)
    if (this.label !== null) res.push(" " + this.label + "\n");
    else res.push(" 0\n");

    return res.join("");
  }

  /**
   * Add feature for date parsing.
   */
  public static addFeaturesDate(lines: (string | null)[]): string {
    const featureFactory = FeatureFactory.getInstance();

    let line: string | null;
    const stringBuilder: string[] = [];
    let newline = true;
    let newBlock = true;
    const currentFont: string | null = null;
    const currentFontSize: number = -1;

    let endblock = false;
    let previousTag: string | null = null;
    let previousText: string | null = null;
    let features: FeaturesVectorDate | null = null;
    for (let n = 0; n < lines.length; n++) {
      let outputLineStatus = false;
      let outputBlockStatus = false;
      void outputBlockStatus;

      line = lines[n] ?? null;

      if (line === null) {
        stringBuilder.push(" \n");
        newBlock = true;
        newline = true;
        continue;
      }
      line = line.trim();
      if (line.length === 0) {
        stringBuilder.push("\n \n");
        newBlock = true;
        newline = true;
        continue;
      }

      if (line === "@newline") {
        if (newline) {
          newBlock = true;
        }
        newline = true;
        continue;
      }

      const ind = line.indexOf(" ");
      let text: string | null = null;
      let tag: string | null = null;
      if (ind !== -1) {
        text = line.substring(0, ind);
        tag = line.substring(ind + 1, line.length);
      }

      let filter = false;
      if (text === null) {
        filter = true;
      } else if (text.length === 0) {
        filter = true;
      } else if (text.startsWith("@IMAGE")) {
        filter = true;
      } else if (text.includes(".pbm")) {
        filter = true;
      } else if (text.includes(".svg")) {
        filter = true;
      } else if (text.includes(".jpg")) {
        filter = true;
      } else if (text.includes(".png")) {
        filter = true;
      }

      if (filter) {
        continue;
      }

      features = new FeaturesVectorDate();
      features.string = text;

      if (newline) {
        features.lineStatus = "LINESTART";
        outputLineStatus = true;
      }

      if (featureFactory.isPunct.test(text!)) {
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
      } else if (lines.length === n + 1) {
        if (!outputLineStatus) {
          features.lineStatus = "LINEEND";
          outputLineStatus = true;
        }
      } else {
        // look ahead...
        let endline = false;
        let i = 1;
        let endloop = false;
        while (lines.length > n + i && !endloop) {
          const newLine = lines[n + i];

          if (newLine !== null && newLine !== undefined) {
            if (newLine.trim().length === 0) {
              endline = true;
              endblock = true;
              if (!outputLineStatus) {
                features.lineStatus = "LINEEND";
                outputLineStatus = true;
              }
            } else if (newLine === "@newline") {
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

      if (text!.length === 1) {
        features.singleChar = true;
      }

      const c0 = text!.charAt(0);
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

      if (featureFactory.test_month(text!)) {
        features.month = true;
      }

      if (featureFactory.isDigit.test(text!)) {
        features.digit = "ALLDIGIT";
      }

      if (features.digit === null || features.digit === undefined)
        features.digit = "NODIGIT";

      if (featureFactory.year.test(text!)) {
        features.year = true;
      }

      if (features.punctType === null) features.punctType = "NOPUNCT";

      features.label = tag;

      const printed = features.printVector();
      if (printed !== null) stringBuilder.push(printed);

      previousTag = tag;
      previousText = text;
    }
    void previousTag;
    void previousText;
    void newBlock;
    void endblock;
    void currentFont;
    void currentFontSize;

    return stringBuilder.join("");
  }
}
