// Port of org.grobid.core.features.FeaturesVectorHeader.
// Upstream: grobid-core/src/main/java/org/grobid/core/features/FeaturesVectorHeader.java
//
// Class for features used for header parsing.

import { LayoutToken } from "../layout/layout-token.js";
import { TextUtilities } from "../utilities/text-utilities.js";

export class FeaturesVectorHeader {
  public token: LayoutToken | null = null; // not a feature, reference value
  public string: string | null = null; // lexical feature
  public label: string | null = null; // label if known
  public blockStatus: string | null = null; // one of BLOCKSTART, BLOCKIN, BLOCKEND
  public lineStatus: string | null = null; // one of LINESTART, LINEIN, LINEEND
  public alignmentStatus: string | null = null; // one of ALIGNEDLEFT, INDENTED, CENTERED - applied to the whole line
  public fontStatus: string | null = null; // one of NEWFONT, SAMEFONT

  public bold: boolean = false;
  public italic: boolean = false;
  public rotation: boolean = false;
  public capitalisation: string | null = null; // one of INITCAP, ALLCAPS, NOCAPS
  // Upstream declares `public String digit;` (Java default-initialised to `null`).
  // We mirror with `string | null` (default `null`) so the `=== null` guard in
  // HeaderParser.getSectionHeaderFeatured fires correctly and we never emit the
  // literal string "undefined" into a feature column — which would silently
  // poison Wapiti inference for every token whose `digit` feature is missed.
  public digit: string | null = null; // one of ALLDIGIT, CONTAINDIGIT, NODIGIT
  public singleChar: boolean = false;
  //public boolean containDash = false;
  public properName: boolean = false;
  public commonName: boolean = false;
  public firstName: boolean = false;
  public locationName: boolean = false;
  public year: boolean = false;
  public month: boolean = false;
  public email: boolean = false;
  public http: boolean = false;
  //public boolean acronym = false;
  public punctType: string | null = null; // one of NOPUNCT, OPENBRACKET, ENDBRACKET, DOT, COMMA, HYPHEN, QUOTE, PUNCT (default)
  //public boolean containPunct = false;

  public punctuationProfile: string | null = null; // the punctuations of the current line of the token

  public spacingWithPreviousBlock: number = 0; // discretized
  public characterDensity: number = 0; // discretized

  // font size related
  public fontSize: string | null = null; // one of HIGHERFONT, SAMEFONTSIZE, LOWERFONT
  public largestFont: boolean = false;
  public smallestFont: boolean = false;
  public largerThanAverageFont: boolean = false;
  //public boolean superscript = false;

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

    // 10 first features written at this stage

    // block information (1)
    res.push(" " + this.blockStatus);

    // line information (1)
    res.push(" " + this.lineStatus);

    // line position/indentation (1)
    res.push(" " + this.alignmentStatus);

    // font information (1)
    res.push(" " + this.fontStatus);

    // font size information (1)
    res.push(" " + this.fontSize);

    // string type information (2)
    if (this.bold) res.push(" 1");
    else res.push(" 0");

    if (this.italic) res.push(" 1");
    else res.push(" 0");

    // capitalisation (1)
    if (this.digit === "ALLDIGIT") res.push(" NOCAPS");
    else res.push(" " + this.capitalisation);

    // digit information (1)
    res.push(" " + this.digit);

    // character information (1)
    if (this.singleChar) res.push(" 1");
    else res.push(" 0");

    // 20 first features written at this stage

    // lexical information (7)
    if (this.properName) res.push(" 1");
    else res.push(" 0");

    if (this.commonName) res.push(" 1");
    else res.push(" 0");

    /*if (firstName)
            res.append(" 1");
        else
            res.append(" 0");*/

    if (this.year) res.push(" 1");
    else res.push(" 0");

    if (this.month) res.push(" 1");
    else res.push(" 0");

    if (this.locationName) res.push(" 1");
    else res.push(" 0");

    if (this.email) res.push(" 1");
    else res.push(" 0");

    if (this.http) res.push(" 1");
    else res.push(" 0");

    // punctuation information (1)
    res.push(" " + this.punctType); // in case the token is a punctuation (NO otherwise)

    // 28 features written at this point

    // space with previous block, discretised (1)
    //res.append(" " + spacingWithPreviousBlock);
    //res.append(" " + 0);

    // character density of the previous block, discretised (1)
    //res.append(" " + characterDensity);
    //res.append(" " + 0);

    if (this.largestFont) res.push(" 1");
    else res.push(" 0");

    if (this.smallestFont) res.push(" 1");
    else res.push(" 0");

    if (this.largerThanAverageFont) res.push(" 1");
    else res.push(" 0");

    /*if (superscript)
            res.append(" 1");
        else
            res.append(" 0");*/

    // 30 features written at this point

    // label - for training data (1)
    if (this.label !== null) res.push(" " + this.label + "\n");
    /*else
            res.append("\n");*/ else res.push(" 0\n");

    return res.join("");
  }
}
