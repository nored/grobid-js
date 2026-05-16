// Port of org.grobid.core.features.FeaturesVectorReference.
// Upstream: grobid-core/src/main/java/org/grobid/core/features/FeaturesVectorReference.java
//
// Class for features used for reference identification in raw texts such as
// patent descriptions. It covers references to scholar works and to patent
// publications.

import { LayoutToken } from "../layout/layout-token.js";
import { TextUtilities } from "../utilities/text-utilities.js";

import { FeatureFactory } from "./feature-factory.js";

export class FeaturesVectorReference {
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
  public locationName: boolean = false;
  public year: boolean = false;
  public month: boolean = false;
  public http: boolean = false;
  public punctType: string | null = null; // one of NOPUNCT, OPENBRACKET, ENDBRACKET, DOT,
  // COMMA, HYPHEN, QUOTE, PUNCT (default)
  // OPENQUOTE, ENDQUOTE
  public isKnownJournalTitle: boolean = false;
  public isKnownAbbrevJournalTitle: boolean = false;
  public isKnownConferenceTitle: boolean = false;
  public isKnownPublisher: boolean = false;

  public isCountryCode: boolean = false;
  public isKindCode: boolean = false;

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

    // lexical information (7)
    if (this.properName) res.push(" 1");
    else res.push(" 0");

    if (this.commonName) res.push(" 1");
    else res.push(" 0");

    if (this.firstName) res.push(" 1");
    else res.push(" 0");

    if (this.locationName) res.push(" 1");
    else res.push(" 0");

    if (this.year) res.push(" 1");
    else res.push(" 0");

    if (this.month) res.push(" 1");
    else res.push(" 0");

    if (this.http) res.push(" 1");
    else res.push(" 0");

    // bibliographical information(4)
    if (this.isKnownJournalTitle || this.isKnownAbbrevJournalTitle)
      res.push(" 1");
    else res.push(" 0");

    if (this.isKnownConferenceTitle) res.push(" 1");
    else res.push(" 0");

    if (this.isKnownPublisher) res.push(" 1");
    else res.push(" 0");

    if (this.isCountryCode) res.push(" 1");
    else res.push(" 0");

    if (this.isKindCode) res.push(" 1");
    else res.push(" 0");

    // punctuation information (1)
    res.push(" " + this.punctType); // in case the token is a punctuation (NO otherwise)

    // token length
    res.push(" " + this.string.length);

    // relative document position
    res.push(" " + this.relativeDocumentPosition);

    // label - for training data (1)
    if (this.label !== null) res.push(" " + this.label + "\n");

    //else
    //    res.append(" 0\n");

    return res.join("");
  }

  /**
   * Add the features for the patent reference extraction model.
   */
  public static addFeaturesPatentReferences(
    token: LayoutToken,
    localLabel: string | null,
    totalLength: number,
    position: number,
    isJournalToken: boolean,
    isAbbrevJournalToken: boolean,
    isConferenceToken: boolean,
    isPublisherToken: boolean,
  ): FeaturesVectorReference {
    const featureFactory = FeatureFactory.getInstance();

    const featuresVector = new FeaturesVectorReference();
    //StringTokenizer st = new StringTokenizer(line, "\t");
    //if (st.hasMoreTokens()) {

    const word: string = token.getText() ?? "";
    const label = localLabel;
    /*if (st.hasMoreTokens())
                label = st.nextToken();*/

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

    if (featureFactory.test_month(word)) featuresVector.month = true;

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

    if (featureFactory.year.test(word)) {
      featuresVector.year = true;
    }

    if (featureFactory.http.test(word)) {
      featuresVector.http = true;
    }

    if (featureFactory.test_city(word)) {
      featuresVector.locationName = true;
    }

    if (featuresVector.capitalisation === null)
      featuresVector.capitalisation = "NOCAPS";

    if (featuresVector.digit === null || featuresVector.digit === undefined)
      featuresVector.digit = "NODIGIT";

    if (featuresVector.punctType === null)
      featuresVector.punctType = "NOPUNCT";

    if (featureFactory.test_country_codes(word))
      featuresVector.isCountryCode = true;

    if (featureFactory.test_kind_codes(word))
      featuresVector.isKindCode = true;

    featuresVector.relativeDocumentPosition = featureFactory.linearScaling(
      position,
      totalLength,
      FeaturesVectorReference.nbBins,
    );

    if (isJournalToken) {
      featuresVector.isKnownJournalTitle = true;
    }

    if (isAbbrevJournalToken) {
      featuresVector.isKnownAbbrevJournalTitle = true;
    }

    if (isConferenceToken) {
      featuresVector.isKnownConferenceTitle = true;
    }

    if (isPublisherToken) {
      featuresVector.isKnownPublisher = true;
    }
    //}

    return featuresVector;
  }
}
