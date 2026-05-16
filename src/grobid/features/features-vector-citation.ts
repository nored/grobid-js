// Port of org.grobid.core.features.FeaturesVectorCitation.
// Upstream: grobid-core/src/main/java/org/grobid/core/features/FeaturesVectorCitation.java
//
// Class for features used for header parsing.

import { GrobidException } from "../exceptions/grobid-exception.js";
import { LayoutToken } from "../layout/layout-token.js";
import { OffsetPosition } from "../utilities/offset-position.js";
import { TextUtilities } from "../utilities/text-utilities.js";
import { UnicodeUtil } from "../utilities/unicode-util.js";

import { FeatureFactory } from "./feature-factory.js";

export class FeaturesVectorCitation {
  // default bins for relative position, set experimentally
  private static readonly nbBins = 12;

  public string: string | null = null; // lexical feature
  public label: string | null = null; // label if known
  public blockStatus: string | null = null; // one of BLOCKSTART, BLOCKIN, BLOCKEND
  public lineStatus: string | null = null; // one of LINESTART, LINEIN, LINEEND
  public fontStatus: string | null = null; // one of NEWFONT, SAMEFONT
  public fontSize: string | null = null; // one of HIGHERFONT, SAMEFONTSIZE, LOWERFONT
  public bold: boolean = false;
  public italic: boolean = false;
  public capitalisation: string | null = null; // one of INITCAP, ALLCAPS, NOCAPS
  // Upstream `public String digit;` (Java-null default). Port-side TS init fix.
  public digit: string | null = null; // one of ALLDIGIT, CONTAINDIGIT, NODIGIT
  public singleChar: boolean = false;
  public properName: boolean = false;
  public commonName: boolean = false;
  public firstName: boolean = false;
  public lastName: boolean = false;

  public year: boolean = false;
  public month: boolean = false;
  public http: boolean = false;
  public punctType: string | null = null; // one of NOPUNCT, OPENBRACKET, ENDBRACKET, DOT, COMMA, HYPHEN, QUOTE, PUNCT (default)
  public containPunct: boolean = false;
  public relativePosition: number = -1;

  // true if the token is part of a predefinied name (single or multi-token)
  public isKnownJournalTitle: boolean = false;
  public isKnownAbbrevJournalTitle: boolean = false;
  public isKnownConferenceTitle: boolean = false;
  public isKnownPublisher: boolean = false;
  public isKnownLocation: boolean = false;
  public isKnownCollaboration: boolean = false;
  public isKnownIdentifier: boolean = false;

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

    // lexical information (9)
    if (this.properName) res.push(" 1");
    else res.push(" 0");

    if (this.commonName) res.push(" 1");
    else res.push(" 0");

    if (this.firstName) res.push(" 1");
    else res.push(" 0");

    if (this.lastName) res.push(" 1");
    else res.push(" 0");

    if (this.isKnownLocation) res.push(" 1");
    else res.push(" 0");

    if (this.year) res.push(" 1");
    else res.push(" 0");

    if (this.month) res.push(" 1");
    else res.push(" 0");

    if (this.http) res.push(" 1");
    else res.push(" 0");

    if (this.isKnownCollaboration) res.push(" 1");
    else res.push(" 0");

    // bibliographical information(3)
    if (this.isKnownJournalTitle || this.isKnownAbbrevJournalTitle)
      res.push(" 1");
    else res.push(" 0");

    if (this.isKnownConferenceTitle) res.push(" 1");
    else res.push(" 0");

    if (this.isKnownPublisher) res.push(" 1");
    else res.push(" 0");

    if (this.isKnownIdentifier) res.push(" 1");
    else res.push(" 0");

    // punctuation information (1)
    res.push(" ");
    res.push(this.punctType ?? ""); // in case the token is a punctuation (NO otherwise)

    // relative position in the sequence (1)
    res.push(" ");
    res.push(String(this.relativePosition));

    // label - for training data (1)
    if (this.label !== null) {
      res.push(" ");
      res.push(this.label);
      res.push("\n");
    } else res.push(" 0\n");

    return res.join("");
  }

  /**
   * Add feature for citation parsing.
   */
  public static addFeaturesCitation(
    tokens: LayoutToken[],
    labels: string[] | null,
    journalPositions: OffsetPosition[] | null,
    abbrevJournalPositions: OffsetPosition[] | null,
    conferencePositions: OffsetPosition[] | null,
    publisherPositions: OffsetPosition[] | null,
    locationPositions: OffsetPosition[] | null,
    collaborationPositions: OffsetPosition[] | null,
    identifierPositions: OffsetPosition[] | null,
    urlPositions: OffsetPosition[] | null,
  ): string {
    if (
      journalPositions === null ||
      abbrevJournalPositions === null ||
      conferencePositions === null ||
      publisherPositions === null ||
      locationPositions === null ||
      collaborationPositions === null ||
      identifierPositions === null ||
      urlPositions === null
    ) {
      throw new GrobidException(
        "At least one list of gazetter matches positions is null.",
      );
    }

    const featureFactory = FeatureFactory.getInstance();

    const citation: string[] = [];

    let currentJournalPositions = 0;
    let currentAbbrevJournalPositions = 0;
    let currentConferencePositions = 0;
    let currentPublisherPositions = 0;
    let currentLocationPositions = 0;
    let currentCollaborationPositions = 0;
    let currentIdentifierPositions = 0;
    let currentUrlPositions = 0;

    let isJournalToken: boolean;
    let isAbbrevJournalToken: boolean;
    let isConferenceToken: boolean;
    let isPublisherToken: boolean;
    let isLocationToken: boolean;
    let isCollaborationToken: boolean;
    let isIdentifierToken: boolean;
    let isUrlToken: boolean;
    let skipTest: boolean;

    let previousTag: string | null = null;
    let previousText: string | null = null;
    let features: FeaturesVectorCitation | null = null;
    const sentenceLenth = tokens.length; // length of the current sentence
    for (let n = 0; n < tokens.length; n++) {
      const token = tokens[n]!;
      let tag: string | null = null;
      if (labels !== null && labels.length > 0 && n < labels.length)
        tag = labels[n]!;

      let outputLineStatus = false;
      isJournalToken = false;
      isAbbrevJournalToken = false;
      isConferenceToken = false;
      isPublisherToken = false;
      isLocationToken = false;
      isCollaborationToken = false;
      isIdentifierToken = false;
      isUrlToken = false;
      skipTest = false;

      let text: string | null = token.getText();
      if (text === null) {
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

      // check the position of matches for journals
      if (journalPositions !== null && journalPositions.length > 0) {
        if (currentJournalPositions === journalPositions.length - 1) {
          if (journalPositions[currentJournalPositions]!.end < n) {
            skipTest = true;
          }
        }
        if (!skipTest) {
          for (let i = currentJournalPositions; i < journalPositions.length; i++) {
            if (
              journalPositions[i]!.start <= n &&
              journalPositions[i]!.end >= n
            ) {
              isJournalToken = true;
              currentJournalPositions = i;
              break;
            } else if (journalPositions[i]!.start > n) {
              isJournalToken = false;
              currentJournalPositions = i;
              break;
            }
          }
        }
      }
      // check the position of matches for abbreviated journals
      skipTest = false;
      if (abbrevJournalPositions !== null) {
        if (currentAbbrevJournalPositions === abbrevJournalPositions.length - 1) {
          if (abbrevJournalPositions[currentAbbrevJournalPositions]!.end < n) {
            skipTest = true;
          }
        }
        if (!skipTest) {
          for (let i = currentAbbrevJournalPositions; i < abbrevJournalPositions.length; i++) {
            if (
              abbrevJournalPositions[i]!.start <= n &&
              abbrevJournalPositions[i]!.end >= n
            ) {
              isAbbrevJournalToken = true;
              currentAbbrevJournalPositions = i;
              break;
            } else if (abbrevJournalPositions[i]!.start > n) {
              isAbbrevJournalToken = false;
              currentAbbrevJournalPositions = i;
              break;
            }
          }
        }
      }
      // check the position of matches for conferences
      skipTest = false;
      if (conferencePositions !== null) {
        if (currentConferencePositions === conferencePositions.length - 1) {
          if (conferencePositions[currentConferencePositions]!.end < n) {
            skipTest = true;
          }
        }
        if (!skipTest) {
          for (let i = currentConferencePositions; i < conferencePositions.length; i++) {
            if (
              conferencePositions[i]!.start <= n &&
              conferencePositions[i]!.end >= n
            ) {
              isConferenceToken = true;
              currentConferencePositions = i;
              break;
            } else if (conferencePositions[i]!.start > n) {
              isConferenceToken = false;
              currentConferencePositions = i;
              break;
            }
          }
        }
      }
      // check the position of matches for publishers
      skipTest = false;
      if (publisherPositions !== null) {
        if (currentPublisherPositions === publisherPositions.length - 1) {
          if (publisherPositions[currentPublisherPositions]!.end < n) {
            skipTest = true;
          }
        }
        if (!skipTest) {
          for (let i = currentPublisherPositions; i < publisherPositions.length; i++) {
            if (
              publisherPositions[i]!.start <= n &&
              publisherPositions[i]!.end >= n
            ) {
              isPublisherToken = true;
              currentPublisherPositions = i;
              break;
            } else if (publisherPositions[i]!.start > n) {
              isPublisherToken = false;
              currentPublisherPositions = i;
              break;
            }
          }
        }
      }
      // check the position of matches for locations
      skipTest = false;
      if (locationPositions !== null) {
        if (currentLocationPositions === locationPositions.length - 1) {
          if (locationPositions[currentLocationPositions]!.end < n) {
            skipTest = true;
          }
        }
        if (!skipTest) {
          for (let i = currentLocationPositions; i < locationPositions.length; i++) {
            if (
              locationPositions[i]!.start <= n &&
              locationPositions[i]!.end >= n
            ) {
              isLocationToken = true;
              currentLocationPositions = i;
              break;
            } else if (locationPositions[i]!.start > n) {
              isLocationToken = false;
              currentLocationPositions = i;
              break;
            }
          }
        }
      }
      // check the position of matches for collaboration
      skipTest = false;
      if (collaborationPositions !== null) {
        if (currentCollaborationPositions === collaborationPositions.length - 1) {
          if (collaborationPositions[currentCollaborationPositions]!.end < n) {
            skipTest = true;
          }
        }
        if (!skipTest) {
          for (let i = currentCollaborationPositions; i < collaborationPositions.length; i++) {
            if (
              collaborationPositions[i]!.start <= n &&
              collaborationPositions[i]!.end >= n
            ) {
              isCollaborationToken = true;
              currentCollaborationPositions = i;
              break;
            } else if (collaborationPositions[i]!.start > n) {
              isCollaborationToken = false;
              currentCollaborationPositions = i;
              break;
            }
          }
        }
      }
      // check the position of matches for identifier
      skipTest = false;
      if (identifierPositions !== null) {
        if (currentIdentifierPositions === identifierPositions.length - 1) {
          if (identifierPositions[currentIdentifierPositions]!.end < n) {
            skipTest = true;
          }
        }
        if (!skipTest) {
          for (let i = currentIdentifierPositions; i < identifierPositions.length; i++) {
            if (
              identifierPositions[i]!.start <= n &&
              identifierPositions[i]!.end >= n
            ) {
              isIdentifierToken = true;
              currentIdentifierPositions = i;
              break;
            } else if (identifierPositions[i]!.start > n) {
              isIdentifierToken = false;
              currentIdentifierPositions = i;
              break;
            }
          }
        }
      }
      // check the position of matches for url
      skipTest = false;
      if (urlPositions !== null) {
        if (currentUrlPositions === urlPositions.length - 1) {
          if (urlPositions[currentUrlPositions]!.end < n) {
            skipTest = true;
          }
        }
        if (!skipTest) {
          for (let i = currentUrlPositions; i < urlPositions.length; i++) {
            if (urlPositions[i]!.start <= n && urlPositions[i]!.end >= n) {
              isUrlToken = true;
              currentUrlPositions = i;
              break;
            } else if (urlPositions[i]!.start > n) {
              isUrlToken = false;
              currentUrlPositions = i;
              break;
            }
          }
        }
      }

      if (TextUtilities.filterLine(text)) {
        continue;
      }

      features = new FeaturesVectorCitation();
      features.string = text;
      features.relativePosition = featureFactory.linearScaling(
        n,
        sentenceLenth,
        FeaturesVectorCitation.nbBins,
      );

      if (n === 0) {
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
      }

      if (!outputLineStatus) {
        features.lineStatus = "LINEIN";
        outputLineStatus = true;
      }

      if (text.length === 1) {
        features.singleChar = true;
      }

      // Character.isUpperCase(text.charAt(0))
      const c0 = text.charAt(0);
      if (c0 !== c0.toLowerCase() && c0 === c0.toUpperCase()) {
        features.capitalisation = "INITCAP";
      }

      if (featureFactory.test_all_capital(text)) {
        features.capitalisation = "ALLCAP";
      }

      if (featureFactory.test_digit(text)) {
        features.digit = "CONTAINSDIGITS";
      }

      if (featureFactory.test_common(text)) {
        features.commonName = true;
      }

      if (featureFactory.test_names(text)) {
        features.properName = true;
      }

      if (featureFactory.test_month(text)) {
        features.month = true;
      }

      if (featureFactory.test_last_names(text)) {
        features.lastName = true;
      }

      if (featureFactory.test_first_names(text)) {
        features.firstName = true;
      }

      if (featureFactory.isDigit.test(text)) {
        features.digit = "ALLDIGIT";
      }

      if (featureFactory.year.test(text)) {
        features.year = true;
      }

      if (isCollaborationToken) features.isKnownCollaboration = true;

      /*Matcher m5 = featureFactory.ACRONYM.matcher(text);
         if (m5.find()) {
             features.acronym = true;
         }*/

      if (features.capitalisation === null) features.capitalisation = "NOCAPS";

      if (features.digit === null || features.digit === undefined)
        features.digit = "NODIGIT";

      if (features.punctType === null) features.punctType = "NOPUNCT";

      if (isJournalToken) {
        features.isKnownJournalTitle = true;
      }

      if (isAbbrevJournalToken) {
        features.isKnownAbbrevJournalTitle = true;
      }

      if (isConferenceToken) {
        features.isKnownConferenceTitle = true;
      }

      if (isPublisherToken) {
        features.isKnownPublisher = true;
      }

      if (isLocationToken) {
        features.isKnownLocation = true;
      }

      if (isIdentifierToken) {
        features.isKnownIdentifier = true;
      }

      if (isUrlToken) {
        features.http = true;
      }

      features.label = tag;

      const printed = features.printVector();
      if (printed !== null) citation.push(printed);

      previousTag = tag;
      previousText = text;
    }
    void previousTag;
    void previousText;

    return citation.join("");
  }
}
