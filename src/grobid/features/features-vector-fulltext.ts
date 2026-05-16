// Port of org.grobid.core.features.FeaturesVectorFulltext.
// Upstream: grobid-core/src/main/java/org/grobid/core/features/FeaturesVectorFulltext.java
//
// Class for features used for fulltext parsing.

import { LayoutToken } from "../layout/layout-token.js";
import { TextUtilities } from "../utilities/text-utilities.js";

export class FeaturesVectorFulltext {
  public token: LayoutToken | null = null; // not a feature, reference value
  public string: string | null = null; // lexical feature
  public label: string | null = null; // label if known
  public blockStatus: string | null = null; // one of BLOCKSTART, BLOCKIN, BLOCKEND
  public lineStatus: string | null = null; // one of LINESTART, LINEIN, LINEEND
  public fontStatus: string | null = null; // one of NEWFONT, SAMEFONT
  public fontSize: string | null = null; // one of HIGHERFONT, SAMEFONTSIZE, LOWERFONT
  public alignmentStatus: string | null = null; // one of ALIGNEDLEFT, INDENTED, CENTERED - applied to the whole line
  public bold: boolean = false;
  public italic: boolean = false;
  public capitalisation: string | null = null; // one of INITCAP, ALLCAPS, NOCAPS
  // Upstream `public String digit;` (Java-null default). Port-side TS init fix.
  public digit: string | null = null; // one of ALLDIGIT, CONTAINDIGIT, NODIGIT
  public singleChar: boolean = false;

  public punctType: string | null = null;
  // one of NOPUNCT, OPENBRACKET, ENDBRACKET, DOT, COMMA, HYPHEN, QUOTE, PUNCT (default)

  public relativeDocumentPosition: number = -1;
  public relativePagePositionChar: number = -1;
  public relativePagePosition: number = -1;

  // graphic in closed proximity of the current block
  public bitmapAround: boolean = false;
  public vectorAround: boolean = false;

  // if a graphic is in close proximity of the current block, characteristics of this graphic
  public closestGraphicHeight: number = -1;
  public closestGraphicWidth: number = -1;
  public closestGraphicSurface: number = -1;

  public spacingWithPreviousBlock: number = 0; // discretized
  public characterDensity: number = 0; // discretized

  // how the reference callouts are expressed, if known
  public calloutType: string | null = null; // one of UNKNOWN, NUMBER, AUTHOR
  public calloutKnown: boolean = false; // true if the token match a known reference label
  public superscript: boolean = false;

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

    // at this stage, we have written 10 features

    // block information (1)
    res.push(" " + this.blockStatus);

    // line information (1)
    res.push(" " + this.lineStatus);

    // line position/identation (1)
    res.push(" " + this.alignmentStatus);

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

    // at this stage, we have written 20 features

    // punctuation information (1)
    res.push(" " + this.punctType); // in case the token is a punctuation (NO otherwise)

    // relative document position (1)
    res.push(" " + this.relativeDocumentPosition);

    // relative page position (1)
    res.push(" " + this.relativePagePosition);

    // proximity of a graphic to the current block (2)
    if (this.bitmapAround) res.push(" 1");
    else res.push(" 0");

    /*if (vectorAround)
            res.append(" 1");
        else
            res.append(" 0");*/

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

    if (this.calloutType !== null) res.push(" " + this.calloutType);
    else res.push(" UNKNOWN");

    if (this.calloutKnown) res.push(" 1");
    else res.push(" 0");

    if (this.superscript) res.push(" 1");
    else res.push(" 0");

    res.push("\n");

    return res.join("");
  }
}
