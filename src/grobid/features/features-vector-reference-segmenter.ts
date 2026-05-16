// Port of org.grobid.core.features.FeaturesVectorReferenceSegmenter.
// Upstream: grobid-core/src/main/java/org/grobid/core/features/FeaturesVectorReferenceSegmenter.java
//
// Class for features used for header parsing.

import { LayoutToken } from "../layout/layout-token.js";
import { TextUtilities } from "../utilities/text-utilities.js";

export class FeaturesVectorReferenceSegmenter {
  // default bins for relative position, set experimentally
  public token: LayoutToken | null = null; // not a feature, reference value

  public string: string | null = null; // lexical feature
  public label: string | null = null; // label if known
  public blockStatus: string | null = null; // one of BLOCKSTART, BLOCKIN, BLOCKEND
  public lineStatus: string | null = null; // one of LINESTART, LINEIN, LINEEND
  public alignmentStatus: string | null = null; // one of ALIGNEDLEFT, INDENT, CENTERED, applied to the whole line
  public fontStatus: string | null = null; // one of NEWFONT, SAMEFONT
  public fontSize: string | null = null; // one of HIGHERFONT, SAMEFONTSIZE, LOWERFONT
  public bold: boolean = false;
  public italic: boolean = false;
  public rotation: boolean = false;
  public capitalisation: string | null = null; // one of INITCAP, ALLCAPS, NOCAPS
  // Upstream `public String digit;` (Java-null default). Port-side TS init fix.
  public digit: string | null = null; // one of ALLDIGIT, CONTAINDIGIT, NODIGIT
  public singleChar: boolean = false;
  public containDash: boolean = false;
  public properName: boolean = false;
  public commonName: boolean = false;
  public firstName: boolean = false;

  public locationName: boolean = false;

  public year: boolean = false;
  public month: boolean = false;
  public email: boolean = false;
  public http: boolean = false;
  //public boolean acronym = false;
  public punctType: string | null = null; // one of NOPUNCT, OPENBRACKET, ENDBRACKET, DOT, COMMA, HYPHEN, QUOTE, PUNCT
  //public boolean containPunct = false;
  public relativePosition: number = -1;
  public lineLength: number = 0;
  public punctuationProfile: string | null = null; // the punctuations of the current line of the token

  // true if the token is part of a predefinied name (single or multi-token)
  public printVector(): string | null {
    if (this.string === null) return null;
    if (this.string.length === 0) return null;
    const res: string[] = [];

    // token string (1)
    res.push(this.string);

    // lowercase string (1)
    res.push(" ");
    res.push(this.string.toLowerCase());

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
    res.push(" ");
    res.push(this.lineStatus ?? "");

    // line position/indentation (1)
    res.push(" " + this.alignmentStatus);

    // capitalisation (1)
    if (this.digit === "ALLDIGIT") res.push(" NOCAPS");
    else {
      res.push(" ");
      res.push(this.capitalisation ?? "");
    }

    // digit information (1)
    res.push(" ");
    res.push(this.digit ?? "");

    // character information (1)
    if (this.singleChar) res.push(" 1");
    else res.push(" 0");

    // lexical information (8)
    if (this.properName) res.push(" 1");
    else res.push(" 0");

    if (this.commonName) res.push(" 1");
    else res.push(" 0");

    /* TODO: to review, never set! */
    if (this.firstName) res.push(" 1");
    else res.push(" 0");

    /* TODO: to review, never set! */
    if (this.locationName) res.push(" 1");
    else res.push(" 0");

    if (this.year) res.push(" 1");
    else res.push(" 0");

    if (this.month) res.push(" 1");
    else res.push(" 0");

    /*if (email)
            res.append(" 1");
        else
            res.append(" 0");
		*/
    if (this.http) res.push(" 1");
    else res.push(" 0");

    // punctuation information (1)
    res.push(" ");
    res.push(this.punctType ?? ""); // in case the token is a punctuation (NO otherwise)

    // relative length on the line as compared to the max line length on a predefined scale (1)
    res.push(" ");
    res.push(String(this.relativePosition));

    // relative position in the line on a predefined scale (1)
    res.push(" " + this.lineLength);

    // block information (1)
    //if (blockStatus != null)
    res.push(" " + this.blockStatus);

    // punctuation profile
    if (this.punctuationProfile === null || this.punctuationProfile.length === 0)
      res.push(" no");
    else {
      let theLength = this.punctuationProfile.length;
      if (theLength > 10) theLength = 10;
      res.push(" " + theLength);
    }
    // label - for training data (1)
    if (this.label !== null) {
      res.push(" ");
      res.push(this.label);
      res.push("\n");
    } else res.push(" 0\n");

    return res.join("");
  }
}
