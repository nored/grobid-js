// Port of org.grobid.core.features.FeaturesVectorSegmentation.
// Upstream: grobid-core/src/main/java/org/grobid/core/features/FeaturesVectorSegmentation.java
//
// Class for features used for high level segmentation of document.

import { LayoutToken } from "../layout/layout-token.js";
import { TextUtilities } from "../utilities/text-utilities.js";

export class FeaturesVectorSegmentation {
  public token: LayoutToken | null = null; // not a feature, reference value
  public line: string | null = null; // not a feature, the complete processed line

  public string: string | null = null; // first lexical feature
  public secondString: string | null = null; // second lexical feature
  public label: string | null = null; // label if known
  public blockStatus: string | null = null; // one of BLOCKSTART, BLOCKIN, BLOCKEND
  public lineStatus: string | null = null; // one of LINESTART, LINEIN, LINEEND
  public fontStatus: string | null = null; // one of NEWFONT, SAMEFONT
  public fontSize: string | null = null; // one of HIGHERFONT, SAMEFONTSIZE, LOWERFONT
  public pageStatus: string | null = null; // one of PAGESTART, PAGEIN, PAGEEND
  public alignmentStatus: string | null = null; // one of ALIGNEDLEFT, INDENT, CENTERED
  public bold: boolean = false;
  public italic: boolean = false;
  public capitalisation: string | null = null; // one of INITCAP, ALLCAPS, NOCAPS
  // Upstream declares `public String digit;` (Java default-initialised to `null`).
  // Mirror with `string | null` (default `null`) so the per-parser `=== null`
  // guard sets `NODIGIT` correctly and we never emit the literal string
  // "undefined" into a feature column.
  public digit: string | null = null; // one of ALLDIGIT, CONTAINDIGIT, NODIGIT
  public singleChar: boolean = false;
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
  public relativeDocumentPosition: number = -1;
  public relativePagePosition: number = -1;
  public relativePagePositionChar: number = -1; // not used
  public punctuationProfile: string | null = null; // the punctuations of the current line of the token
  public firstPageBlock: boolean = false;
  public lastPageBlock: boolean = false;
  public lineLength: number = 0;
  public bitmapAround: boolean = false;
  public vectorAround: boolean = false;
  public inMainArea: boolean = true;

  public repetitivePattern: boolean = false; // if true, the textual pattern is repeated at the same position on other pages
  public firstRepetitivePattern: boolean = false; // if true, this is a repetitive textual pattern and this is its first occurrence in the doc

  public spacingWithPreviousBlock: number = 0; // discretized
  public characterDensity: number = 0; // discretized

  public printVector(): string | null {
    if (this.string === null) return null;
    if (this.string.length === 0) return null;
    const res: string[] = [];

    // token string (1)
    res.push(this.string);

    // second token string
    if (this.secondString !== null) res.push(" " + this.secondString);
    else res.push(" " + this.string);

    // lowercase string
    res.push(" " + this.string.toLowerCase());

    // prefix (4)
    res.push(" " + TextUtilities.prefix(this.string, 1));
    res.push(" " + TextUtilities.prefix(this.string, 2));
    res.push(" " + TextUtilities.prefix(this.string, 3));
    res.push(" " + TextUtilities.prefix(this.string, 4));

    // block information (1)
    if (this.blockStatus !== null) res.push(" " + this.blockStatus);
    //res.append(" 0");

    // line information (1)
    if (this.lineStatus !== null) res.push(" " + this.lineStatus);

    // line alignment/identation information (1)
    //res.append(" " + alignmentStatus);

    // page information (1)
    res.push(" " + this.pageStatus);

    // font information (1)
    res.push(" " + this.fontStatus);

    // font size information (1)
    res.push(" " + this.fontSize);

    // string type information (3)
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

    // lexical information (9)
    if (this.properName) res.push(" 1");
    else res.push(" 0");

    if (this.commonName) res.push(" 1");
    else res.push(" 0");

    /* TODO: to review, never set! */
    if (this.firstName) res.push(" 1");
    else res.push(" 0");

    if (this.year) res.push(" 1");
    else res.push(" 0");

    if (this.month) res.push(" 1");
    else res.push(" 0");

    if (this.email) res.push(" 1");
    else res.push(" 0");

    if (this.http) res.push(" 1");
    else res.push(" 0");

    // punctuation information (1)
    if (this.punctType !== null) res.push(" " + this.punctType); // in case the token is a punctuation (NO otherwise)

    // relative document position (1)
    res.push(" " + this.relativeDocumentPosition);

    // relative page position coordinate (1)
    //res.append(" " + relativePagePosition);

    // relative page position characters (1)
    res.push(" " + this.relativePagePositionChar);

    // punctuation profile
    if (this.punctuationProfile === null || this.punctuationProfile.length === 0) {
      // string profile
      res.push(" no");
      // number of punctuation symbols in the line
      res.push(" 0");
    } else {
      // string profile
      res.push(" " + this.punctuationProfile);
      // number of punctuation symbols in the line
      res.push(" " + this.punctuationProfile.length);
    }

    // current line length on a predefined scale and relative to the longest line of the current block
    res.push(" " + this.lineLength);

    if (this.bitmapAround) {
      res.push(" 1");
    } else {
      res.push(" 0");
    }

    if (this.vectorAround) {
      res.push(" 1");
    } else {
      res.push(" 0");
    }

    if (this.repetitivePattern) {
      res.push(" 1");
    } else {
      res.push(" 0");
    }

    if (this.firstRepetitivePattern) {
      res.push(" 1");
    } else {
      res.push(" 0");
    }

    // if the block is in the page main area (1)
    if (this.inMainArea) {
      res.push(" 1");
    } else {
      res.push(" 0");
    }

    // space with previous block, discretised (1)
    //res.append(" " + spacingWithPreviousBlock);
    //res.append(" " + 0);

    // character density of the previous block, discretised (1)
    //res.append(" " + characterDensity);
    //res.append(" " + 0);

    // label - for training data (1)
    /*if (label != null)
              res.append(" " + label + "\n");
          else
              res.append(" 0\n");
          */

    res.push("\n");

    return res.join("");
  }
}
