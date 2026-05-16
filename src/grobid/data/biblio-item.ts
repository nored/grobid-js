// Port of org.grobid.core.data.BiblioItem.
// Upstream: grobid-core/src/main/java/org/grobid/core/data/BiblioItem.java
//
// Class for representing and exchanging a bibliographical item.

import { GrobidException } from "../exceptions/grobid-exception.js";
import { Language } from "../lang/language.js";
import { BoundingBox } from "../layout/bounding-box.js";
import { LayoutToken } from "../layout/layout-token.js";
import { Lexicon } from "../lexicon/lexicon.js";
import { Consolidation } from "../utilities/consolidation.js";
import { KeyGen } from "../utilities/key-gen.js";
import { LanguageUtilities } from "../utilities/language-utilities.js";
import { LayoutTokensUtil } from "../utilities/layout-tokens-util.js";
import { getLogger } from "../utilities/logger.js";
import { TextUtilities } from "../utilities/text-utilities.js";
import { CopyrightsLicense } from "./copyrights-license.js";
import { Affiliation } from "./affiliation.js";
import { GrobidDate } from "./date.js";
import { Keyword } from "./keyword.js";
import { Person } from "./person.js";
import { EmailSanitizer } from "./util/email-sanitizer.js";
import { ClassicAuthorEmailAssigner } from "./util/classic-author-email-assigner.js";
import { GrobidAnalysisConfig, GrobidAnalysisConfigBuilder } from "../engines/config/grobid-analysis-config.js";
import type { TaggingLabel } from "../engines/label/tagging-label.js";
import { TaggingLabels } from "../engines/label/tagging-labels.js";
import { TaggingTokenClusteror } from "../tokenization/tagging-token-clusteror.js";
import { GrobidModels } from "../grobid-models.js";
import { TEIFormatter } from "../document/tei-formatter.js";

const LOGGER = getLogger("BiblioItem");

/** Mirrors `org.apache.commons.lang3.StringUtils.isEmpty`. */
function isEmptyStr(s: string | null | undefined): boolean {
  return s === null || s === undefined || s.length === 0;
}

/** Mirrors `org.apache.commons.lang3.StringUtils.isNotEmpty`. */
function isNotEmptyStr(s: string | null | undefined): boolean {
  return !isEmptyStr(s);
}

/** Mirrors `org.apache.commons.lang3.StringUtils.isBlank`. */
function isBlank(s: string | null | undefined): boolean {
  if (s === null || s === undefined) return true;
  for (let i = 0; i < s.length; i++) {
    if (!/\s/.test(s.charAt(i))) return false;
  }
  return true;
}

/** Mirrors `org.apache.commons.lang3.StringUtils.isNotBlank`. */
function isNotBlank(s: string | null | undefined): boolean {
  return !isBlank(s);
}

/** Mirrors `StringUtils.normalizeSpace`. */
function normalizeSpace(s: string | null): string | null {
  if (s === null) return null;
  return s.replace(/\s+/g, " ").trim();
}

/** Mirrors `StringUtils.containsIgnoreCase(s, sub)`. */
function containsIgnoreCase(s: string | null | undefined, sub: string): boolean {
  if (s === null || s === undefined) return false;
  return s.toLowerCase().indexOf(sub.toLowerCase()) !== -1;
}

/** Mirrors `StringUtils.indexOfIgnoreCase(s, sub)`. */
function indexOfIgnoreCase(s: string, sub: string): number {
  return s.toLowerCase().indexOf(sub.toLowerCase());
}

/** Mirrors `CollectionUtils.isEmpty` for arrays. */
function isCollectionEmpty<T>(c: T[] | null | undefined): boolean {
  return c === null || c === undefined || c.length === 0;
}

/** Mirrors `CollectionUtils.isNotEmpty` for arrays. */
function isCollectionNotEmpty<T>(c: T[] | null | undefined): boolean {
  return !isCollectionEmpty(c);
}

/** Mirrors `java.lang.Character.isDigit(char)` for BMP characters. */
function isDigit(ch: string): boolean {
  if (ch.length === 0) return false;
  return /\p{Nd}/u.test(ch);
}

/** Mirrors `java.lang.Character.isLetter(char)`. */
function isLetter(ch: string): boolean {
  if (ch.length === 0) return false;
  return /\p{L}/u.test(ch);
}

/**
 * Class for representing and exchanging a bibliographical item.
 */
export class BiblioItem {
  protected static readonly LOGGER = LOGGER;

  private languageUtilities: LanguageUtilities = LanguageUtilities.getInstance();
  // Forward-typed: these are stubs in the current port. We initialize them
  // lazily on first use to avoid loading the stub modules at construction.
  private authorEmailAssigner: { assign(folks: Person[] | null, emails: string[] | null): void } | null = null;
  private emailSanitizer: { splitAndClean(emails: string[]): string[] | null } | null = null;
  private teiId: string | null = null;
  //TODO: keep in sync with teiId - now teiId is generated in many different places
  private ordinal: number | null = null;
  private coordinates: BoundingBox[] | null = null;

  // map of labels (e.g. <title> or <abstract>) to LayoutToken
  private labeledTokens: Map<string, LayoutToken[]> | null = null;

  // accumulation of the LayoutTokens for sequences of affiliation/address
  private affiliationAddresslabeledTokens: LayoutToken[][] | null = null;

  /**
   * The following are internal working structures not meant to be used outside.
   * For collecting layout tokens of the various bibliographical component,
   * please refers to @See(getLayoutTokens(TaggingLabels label)
   */
  private authorsTokensWorkingCopy: LayoutToken[] = [];
  private abstractTokensWorkingCopy: LayoutToken[] = [];

  toString(): string {
    return "BiblioItem{" +
      "submission_date='" + this.submission_date + "'" +
      ", download_date='" + this.download_date + "'" +
      ", server_date='" + this.server_date + "'" +
      ", languageUtilities=" + this.languageUtilities +
      ", item=" + this.item +
      ", parentItem=" + this.parentItem +
      ", ISBN13='" + this.ISBN13 + "'" +
      ", ISBN10='" + this.ISBN10 + "'" +
      ", title='" + this.title + "'" +
      ", publisher='" + this.publisher + "'" +
      ", nbPages=" + this.nbPages +
      ", edition='" + this.edition + "'" +
      ", language='" + this.language + "'" +
      ", subtitle='" + this.subtitle + "'" +
      ", publication_date='" + this.publication_date + "'" +
      ", normalized_publication_date=" + this.normalized_publication_date +
      ", editors='" + this.editors + "'" +
      ", publisher_website='" + this.publisher_website + "'" +
      ", serie='" + this.serie + "'" +
      ", ISSN='" + this.ISSN + "'" +
      ", ISSNe='" + this.ISSNe + "'" +
      ", volume='" + this.volume + "'" +
      ", number='" + this.number + "'" +
      ", month='" + this.month + "'" +
      ", support_type='" + this.support_type + "'" +
      ", version='" + this.version + "'" +
      ", smallImageURL='" + this.smallImageURL + "'" +
      ", largeImageURL='" + this.largeImageURL + "'" +
      ", publisherPlace='" + this.publisherPlace + "'" +
      ", review='" + this.review + "'" +
      ", keywords=" + this.keywords +
      ", subjects=" + this.subjects +
      ", categories='" + this.categories + "'" +
      ", type='" + this.type + "'" +
      ", typeDescription='" + this.typeDescription + "'" +
      ", book_type='" + this.book_type + "'" +
      ", DOI='" + this.doi + "'" +
      ", arXivId='" + this.arXivId + "'" +
      ", PMID='" + this.PMID + "'" +
      ", PMCID='" + this.PMCID + "'" +
      ", PII='" + this.PII + "'" +
      ", HALId='" + this.halId + "'" +
      ", ark='" + this.ark + "'" +
      ", istexId='" + this.istexId + "'" +
      ", inDOI='" + this.inDOI + "'" +
      ", abstract_='" + this.abstract_ + "'" +
      ", authors='" + this.authors + "'" +
      ", firstAuthorSurname='" + this.firstAuthorSurname + "'" +
      ", location='" + this.location + "'" +
      ", bookTitle='" + this.bookTitle + "'" +
      ", serieTitle='" + this.serieTitle + "'" +
      ", pageRange='" + this.pageRange + "'" +
      ", journal='" + this.journal + "'" +
      ", volumeBlock='" + this.volumeBlock + "'" +
      ", institution='" + this.institution + "'" +
      ", note='" + this.note + "'" +
      ", affiliation='" + this.affiliation + "'" +
      ", address='" + this.address + "'" +
      ", country='" + this.country + "'" +
      ", town='" + this.town + "'" +
      ", email='" + this.email + "'" +
      ", pubnum='" + this.pubnum + "'" +
      ", keyword='" + this.keyword + "'" +
      ", phone='" + this.phone + "'" +
      ", degree='" + this.degree + "'" +
      ", web='" + this.web + "'" +
      ", issue='" + this.issue + "'" +
      ", journal_abbrev='" + this.journal_abbrev + "'" +
      ", event='" + this.event + "'" +
      ", abstractHeader='" + this.abstractHeader + "'" +
      ", day='" + this.day + "'" +
      ", locationPublisher='" + this.locationPublisher + "'" +
      ", dedication='" + this.dedication + "'" +
      ", submission='" + this.submission + "'" +
      ", english_title='" + this.english_title + "'" +
      ", url='" + this.url + "'" +
      ", oaUrl='" + this.oaUrl + "'" +
      ", uri='" + this.uri + "'" +
      ", confidence='" + this.confidence + "'" +
      ", conf=" + this.conf +
      ", e_year='" + this.e_year + "'" +
      ", e_month='" + this.e_month + "'" +
      ", e_day='" + this.e_day + "'" +
      ", s_year='" + this.s_year + "'" +
      ", s_month='" + this.s_month + "'" +
      ", s_day='" + this.s_day + "'" +
      ", d_year='" + this.d_year + "'" +
      ", d_month='" + this.d_month + "'" +
      ", d_day='" + this.d_day + "'" +
      ", a_year='" + this.a_year + "'" +
      ", a_month='" + this.a_month + "'" +
      ", a_day='" + this.a_day + "'" +
      ", authorList=" + this.authorList +
      ", editorList=" + this.editorList +
      ", affiliationList=" + this.affiliationList +
      ", addressList=" + this.addressList +
      ", emailList=" + this.emailList +
      ", webList=" + this.webList +
      ", phoneList=" + this.phoneList +
      ", markers=" + this.markers +
      ", fullAuthors=" + this.fullAuthors +
      ", fullEditors=" + this.fullEditors +
      ", fullAffiliations=" + this.fullAffiliations +
      ", reference='" + this.reference + "'" +
      ", copyright='" + this.copyright + "'" +
      ", funding='" + this.funding + "'" +
      ", affiliationAddressBlock='" + this.affiliationAddressBlock + "'" +
      ", articleTitle='" + this.articleTitle + "'" +
      ", beginPage=" + this.beginPage +
      ", endPage=" + this.endPage +
      ", year='" + this.year + "'" +
      ", authorString='" + this.authorString + "'" +
      ", path='" + this.path + "'" +
      ", collaboration='" + this.collaboration + "'" +
      ", postProcessEditors=" + this.postProcessEditors +
      ", crossrefError=" + this.crossrefError +
      ", normalized_submission_date=" + this.normalized_submission_date +
      ", normalized_download_date=" + this.normalized_download_date +
      ", originalAffiliation='" + this.originalAffiliation + "'" +
      ", originalAbstract='" + this.originalAbstract + "'" +
      ", originalTitle='" + this.originalTitle + "'" +
      ", originalAuthors='" + this.originalAuthors + "'" +
      ", originalEditors='" + this.originalEditors + "'" +
      ", originalAddress='" + this.originalAddress + "'" +
      ", originalNote='" + this.originalNote + "'" +
      ", originalKeyword='" + this.originalKeyword + "'" +
      ", originalVolumeBlock='" + this.originalVolumeBlock + "'" +
      ", originalJournal='" + this.originalJournal + "'" +
      ", workingGroup='" + this.workingGroup + "'" +
      ", documentType='" + this.documentType + "'" +
      "}";
  }

  public item: number = -1;

  static readonly Book: number = 0; // the whole book
  static readonly Periodical: number = 1; // the journal or magazine item
  static readonly Digital_support: number = 2;
  static readonly Article: number = 3; // of a journal or magazine
  static readonly Unknown: number = 4;
  static readonly InBook: number = 5;
  static readonly InProceedings: number = 6;
  static readonly InCollection: number = 7;
  static readonly Manual: number = 8;
  static readonly TechReport: number = 9;
  static readonly MasterThesis: number = 10;
  static readonly PhdThesis: number = 11;
  static readonly Unpublished: number = 12;
  static readonly Proceedings: number = 13;
  static readonly Serie: number = 14;

  private parentItem: BiblioItem | null = null; // the bibliographic item "container", i.e.
  // the book for a chapter
  // the journal for a journal article, etc.

  private ISBN13: string | null = null;
  private ISBN10: string | null = null;
  private title: string | null = null;
  private publisher: string | null = null;
  private nbPages: number = -1;
  private edition: string | null = null;
  private language: string | null = null;
  private subtitle: string | null = null;
  private publication_date: string | null = null;
  private normalized_publication_date: GrobidDate | null = null;
  private editors: string | null = null;
  private publisher_website: string | null = null;
  private serie: string | null = null;
  private ISSN: string | null = null; // print/default
  private ISSNe: string | null = null; // electronic
  private volume: string | null = null;
  private number: string | null = null;
  private month: string | null = null;
  private support_type: string | null = null;
  private version: string | null = null;
  private smallImageURL: string | null = null;
  private largeImageURL: string | null = null;
  private publisherPlace: string | null = null;
  private review: string | null = null;
  private keywords: Keyword[] | null = null;
  private subjects: string[] | null = null;
  private categories: string[] | null = null;
  private type: string | null = null; // book, journal, proceedings, in book, etc
  private typeDescription: string | null = null;
  private book_type: string | null = null;
  private doi: string | null = null;
  private inDOI: string | null = null;
  private arXivId: string | null = null;
  private PMID: string | null = null;
  private PMCID: string | null = null;
  private PII: string | null = null;
  private halId: string | null = null;
  private ark: string | null = null;
  private istexId: string | null = null;
  private abstract_: string | null = null;
  private collaboration: string | null = null;
  private documentType: string | null = null;

  // for convenience GROBIDesque
  private authors: string | null = null;
  //private List<LayoutToken> authorsTokens = new ArrayList<>();
  private firstAuthorSurname: string | null = null;
  private location: string | null = null;
  private bookTitle: string | null = null;
  private serieTitle: string | null = null;
  private pageRange: string | null = null;
  private journal: string | null = null;
  private volumeBlock: string | null = null;
  private institution: string | null = null;
  private note: string | null = null;
  private affiliation: string | null = null;
  private address: string | null = null;
  private country: string | null = null;
  private town: string | null = null;
  private email: string | null = null;
  private pubnum: string | null = null;
  private keyword: string | null = null;
  private phone: string | null = null;
  private degree: string | null = null;
  private web: string | null = null;
  private issue: string | null = null;
  private journal_abbrev: string | null = null;
  private event: string | null = null;
  private abstractHeader: string | null = null;
  private day: string | null = null;
  private locationPublisher: string | null = null;
  private dedication: string | null = null;
  private submission: string | null = null;
  private english_title: string | null = null;
  private url: string | null = null;
  private oaUrl: string | null = null;
  private uri: string | null = null;
  private confidence: string | null = null;
  private conf: number = 0.0;

  // abstract labeled featured sequence (to produce a structured abstract with, in particular, reference callout)
  private labeledAbstract: string | null = null;

  // date for electronic publishing
  private e_year: string | null = null;
  private e_month: string | null = null;
  private e_day: string | null = null;

  // date of submission
  private s_year: string | null = null;
  private s_month: string | null = null;
  private s_day: string | null = null;

  // date of acceptance
  private a_year: string | null = null;
  private a_month: string | null = null;
  private a_day: string | null = null;

  // date of download
  private d_year: string | null = null;
  private d_month: string | null = null;
  private d_day: string | null = null;

  // advanced grobid recognitions
  private authorList: string[] | null = null;
  private editorList: string[] | null = null;
  private affiliationList: string[] | null = null;
  private addressList: string[] | null = null;
  private emailList: string[] | null = null;
  private webList: string[] | null = null;
  private phoneList: string[] | null = null;
  private markers: string[] | null = null;

  private fullAuthors: Person[] | null = null;
  private fullEditors: Person[] | null = null;
  private fullAffiliations: Affiliation[] | null = null;

  private reference: string | null = null;
  private copyright: string | null = null;
  private funding: string | null = null;

  //public List<String> affiliationAddressBlock = null;
  public affiliationAddressBlock: string | null = null;

  // just for articles
  private articleTitle: string | null = null;
  private beginPage: number = -1;
  private endPage: number = -1;
  private year: string | null = null; // default is publication date on print media
  private authorString: string | null = null;
  private path: string = "";
  private postProcessEditors: boolean = false;
  private crossrefError: boolean = true;
  private submission_date: string | null = null;
  private normalized_submission_date: GrobidDate | null = null;
  private download_date: string | null = null;
  private normalized_download_date: GrobidDate | null = null;
  private server_date: string | null = null;
  private normalized_server_date: GrobidDate | null = null;

  // for OCR post-corrections
  private originalAffiliation: string | null = null;
  private originalAbstract: string | null = null;
  private originalTitle: string | null = null;
  private originalAuthors: string | null = null;
  private originalEditors: string | null = null;
  private originalAddress: string | null = null;
  private originalNote: string | null = null;
  private originalKeyword: string | null = null;
  private originalVolumeBlock: string | null = null;
  private originalJournal: string | null = null;

  private workingGroup: string | null = null;
  private rawMeeting: string | null = null;

  // Availability statement
  private availabilityStmt: string | null = null;

  // Conflict of interests
  private conflictStmt: string | null = null;

  // Credits / Author contributions
  private contributionStmt: string | null = null;

  // Copyrights/license information object
  copyrightsLicense: CopyrightsLicense | null = null;

  // Source (whether the data was consolidated)
  private status: string = Consolidation.CONSOLIDATION_STATUS_EXTRACTED;

  // Which consolidation service was used (e.g. "crossref" or "glutton")
  private consolidationService: string | null = null;

  // All the tokens that are considered noise will be collected here
  private discardedPieces: string[] = [];
  private discardedPiecesTokens: LayoutToken[][] = [];

  static readonly confPrefixes: readonly string[] = ["Proceedings of", "proceedings of",
    "In Proceedings of the", "In: Proceeding of", "In Proceedings, ", "In Proceedings of",
    "In Proceeding of", "in Proceeding of", "in Proceeding", "In Proceeding", "Proceedings",
    "proceedings", "In Proc", "in Proc", "In Proc.", "in Proc.", "In proc.", "in proc", "in proc.",
    "In proc", "Proc", "proc", "Proc.", "proc.", "Acte de la", "Acte de", "Acte", "acte de la",
    "acte de", "acte"];

  constructor() {
    // empty: matches upstream default constructor
  }

  setParentItem(bi: BiblioItem | null): void {
    this.parentItem = bi;
  }

  getParentItem(): BiblioItem | null {
    return this.parentItem;
  }

  getItem(): number {
    return this.item;
  }

  setItem(type: number): void {
    this.item = type;
  }

  getISBN13(): string | null {
    return this.ISBN13;
  }

  getISBN10(): string | null {
    return this.ISBN10;
  }

  getTitle(): string | null {
    return this.title;
  }

  getPublisher(): string | null {
    return this.publisher;
  }

  getEdition(): string | null {
    return this.edition;
  }

  getLanguage(): string | null {
    return this.language;
  }

  getSubtitle(): string | null {
    if (this.subtitle !== null)
      if (this.subtitle.length !== 0)
        if (this.subtitle !== "null")
          return this.subtitle;
    return null;
  }

  getPublicationDate(): string | null {
    return this.publication_date;
  }

  getNormalizedPublicationDate(): GrobidDate | null {
    return this.normalized_publication_date;
  }

  getEditors(): string | null {
    return this.editors;
  }

  getPublisherWebsite(): string | null {
    return this.publisher_website;
  }

  getSerie(): string | null {
    return this.serie;
  }

  getISSN(): string | null {
    return this.ISSN;
  }

  getISSNe(): string | null {
    return this.ISSNe;
  }

  getVolume(): string | null {
    return this.volume;
  }

  getNumber(): string | null {
    return this.number;
  }

  getMonth(): string | null {
    return this.month;
  }

  getSupportType(): string | null {
    return this.support_type;
  }

  getVersion(): string | null {
    return this.version;
  }

  getSmallImageURL(): string | null {
    return this.smallImageURL;
  }

  getLargeImageURL(): string | null {
    return this.largeImageURL;
  }

  getPublisherPlace(): string | null {
    return this.publisherPlace;
  }

  getReview(): string | null {
    return this.review;
  }

  getCategories(): string[] | null {
    return this.categories;
  }

  getNbPages(): number {
    return this.nbPages;
  }

  getType(): string | null {
    return this.type;
  }

  getTypeDescription(): string | null {
    return this.typeDescription;
  }

  getBookType(): string | null {
    return this.book_type;
  }

  getDOI(): string | null {
    return this.doi;
  }

  getHalId(): string | null {
    return this.halId;
  }

  getArk(): string | null {
    return this.ark;
  }

  getIstexId(): string | null {
    return this.istexId;
  }

  getInDOI(): string | null {
    return this.inDOI;
  }

  getArXivId(): string | null {
    return this.arXivId;
  }

  getPMID(): string | null {
    return this.PMID;
  }

  getPMCID(): string | null {
    return this.PMCID;
  }

  getPII(): string | null {
    return this.PII;
  }

  getArticleTitle(): string | null {
    return this.articleTitle;
  }

  getBeginPage(): number {
    return this.beginPage;
  }

  getEndPage(): number {
    return this.endPage;
  }

  getYear(): string | null {
    return this.year;
  }

  getAbstract(): string | null {
    return this.abstract_;
  }

  getLabeledAbstract(): string | null {
    return this.labeledAbstract;
  }

  getEmail(): string | null {
    return this.email;
  }

  getPubnum(): string | null {
    return this.pubnum;
  }

  getCollaboration(): string | null {
    return this.collaboration;
  }

  getSerieTitle(): string | null {
    return this.serieTitle;
  }

  getURL(): string | null {
    return this.url;
  }

  getOAURL(): string | null {
    return this.oaUrl;
  }

  getURI(): string | null {
    return this.uri;
  }

  getConfidence(): string | null {
    return this.confidence;
  }

  // temp
  getAuthors(): string | null {
    return this.authors;
  }

  getLocation(): string | null {
    return this.location;
  }

  getBookTitle(): string | null {
    return this.bookTitle;
  }

  getPageRange(): string | null {
    if (this.pageRange !== null)
      return this.pageRange;
    else if ((this.beginPage !== -1) && (this.endPage !== -1))
      return "" + this.beginPage + "--" + this.endPage;
    else
      return null;
  }

  getJournal(): string | null {
    return this.journal;
  }

  getVolumeBlock(): string | null {
    return this.volumeBlock;
  }

  getInstitution(): string | null {
    return this.institution;
  }

  getNote(): string | null {
    return this.note;
  }

  getAffiliation(): string | null {
    return this.affiliation;
  }

  getAddress(): string | null {
    return this.address;
  }

  getCountry(): string | null {
    return this.country;
  }

  getTown(): string | null {
    return this.town;
  }

  getKeyword(): string | null {
    return this.keyword;
  }

  getKeywords(): Keyword[] | null {
    return this.keywords;
  }

  getSubjects(): string[] | null {
    return this.subjects;
  }

  getPhone(): string | null {
    return this.phone;
  }

  getDegree(): string | null {
    return this.degree;
  }

  getWeb(): string | null {
    return this.web;
  }

  getIssue(): string | null {
    return this.issue;
  }

  getJournalAbbrev(): string | null {
    return this.journal_abbrev;
  }

  getEvent(): string | null {
    return this.event;
  }

  getError(): boolean {
    return this.crossrefError;
  }

  getAbstractHeader(): string | null {
    return this.abstractHeader;
  }

  getDay(): string | null {
    return this.day;
  }

  getLocationPublisher(): string | null {
    return this.locationPublisher;
  }

  getAuthorString(): string | null {
    return this.authorString;
  }

  getE_Year(): string | null {
    return this.e_year;
  }

  getE_Month(): string | null {
    return this.e_month;
  }

  getE_Day(): string | null {
    return this.e_day;
  }

  getS_Year(): string | null {
    return this.s_year;
  }

  getS_Month(): string | null {
    return this.s_month;
  }

  getS_Day(): string | null {
    return this.s_day;
  }

  getA_Year(): string | null {
    return this.a_year;
  }

  getA_Month(): string | null {
    return this.a_month;
  }

  getA_Day(): string | null {
    return this.a_day;
  }

  getD_Year(): string | null {
    return this.d_year;
  }

  getD_Month(): string | null {
    return this.d_month;
  }

  getD_Day(): string | null {
    return this.d_day;
  }

  getDedication(): string | null {
    return this.dedication;
  }

  getSubmission(): string | null {
    return this.submission;
  }

  getEnglishTitle(): string | null {
    return this.english_title;
  }

  getSubmissionDate(): string | null {
    return this.submission_date;
  }

  getNormalizedSubmissionDate(): GrobidDate | null {
    return this.normalized_submission_date;
  }

  getDownloadDate(): string | null {
    return this.download_date;
  }

  getNormalizedDownloadDate(): GrobidDate | null {
    return this.normalized_download_date;
  }

  getServerDate(): string | null {
    return this.server_date;
  }

  getNormalizedServerDate(): GrobidDate | null {
    return this.normalized_server_date;
  }

  getOriginalAffiliation(): string | null {
    return this.originalAffiliation;
  }

  getOriginalAbstract(): string | null {
    return this.originalAbstract;
  }

  getOriginalAuthors(): string | null {
    return this.originalAuthors;
  }

  getOriginalEditors(): string | null {
    return this.originalEditors;
  }

  getOriginalTitle(): string | null {
    return this.originalTitle;
  }

  getOriginalAddress(): string | null {
    return this.originalAddress;
  }

  getOriginalNote(): string | null {
    return this.originalNote;
  }

  getOriginalKeyword(): string | null {
    return this.originalKeyword;
  }

  getOriginalVolumeBlock(): string | null {
    return this.originalVolumeBlock;
  }

  getOriginalJournal(): string | null {
    return this.originalJournal;
  }

  getFullAuthors(): Person[] | null {
    return this.fullAuthors;
  }

  getFullEditors(): Person[] | null {
    return this.fullEditors;
  }

  getFullAffiliations(): Affiliation[] | null {
    return this.fullAffiliations;
  }

  getReference(): string | null {
    return this.reference;
  }

  getCopyright(): string | null {
    return this.copyright;
  }

  getFunding(): string | null {
    return this.funding;
  }

  getWorkingGroup(): string | null {
    return this.workingGroup;
  }

  getDocumentType(): string | null {
    return this.documentType;
  }

  setISBN13(isbn: string | null): void {
    /* some cleaning... */
    this.ISBN13 = normalizeSpace(BiblioItem.cleanISBNString(isbn));
  }

  setISBN10(isbn: string | null): void {
    /* some cleaning... */
    this.ISBN10 = normalizeSpace(isbn);
  }

  setTitle(theTitle: string | null): void {
    this.title = normalizeSpace(theTitle);
  }

  setPublisher(thePublisher: string | null): void {
    this.publisher = normalizeSpace(thePublisher);
  }

  setEdition(theEdition: string | null): void {
    if (theEdition !== null) {
      if (theEdition.length > 10) {
        theEdition = theEdition.substring(0, 9);
      }
    }
    this.edition = normalizeSpace(theEdition);
  }

  setLanguage(theLanguage: string | null): void {
    this.language = normalizeSpace(theLanguage);
  }

  setSubtitle(theSubtitle: string | null): void {
    this.subtitle = normalizeSpace(theSubtitle);
  }

  setPublicationDate(theDate: string | null): void {
    this.publication_date = normalizeSpace(theDate);
  }

  setNormalizedPublicationDate(theDate: GrobidDate | null): void {
    this.normalized_publication_date = theDate;
  }

  mergeNormalizedPublicationDate(theDate: GrobidDate): void {
    this.normalized_publication_date = GrobidDate.merge(this.normalized_publication_date!, theDate);
  }

  setEditors(theEditors: string | null): void {
    this.editors = normalizeSpace(theEditors);
  }

  setPublisherWebsite(theWebsite: string | null): void {
    this.publisher_website = normalizeSpace(theWebsite);
  }

  setSerie(theSerie: string | null): void {
    this.serie = normalizeSpace(theSerie);
  }

  setISSN(theISSN: string | null): void {
    this.ISSN = normalizeSpace(theISSN);
  }

  setISSNe(theISSN: string | null): void {
    this.ISSNe = normalizeSpace(theISSN);
  }

  setVolume(theVolume: string | null): void {
    this.volume = normalizeSpace(theVolume);
  }

  setNumber(theNumber: string | null): void {
    this.number = normalizeSpace(theNumber);
  }

  setMonth(theMonth: string | null): void {
    this.month = normalizeSpace(theMonth);
  }

  setSupportType(theType: string | null): void {
    this.support_type = normalizeSpace(theType);
  }

  setVersion(theVersion: string | null): void {
    this.version = normalizeSpace(theVersion);
  }

  setSmallImageURL(url: string | null): void {
    this.smallImageURL = url;
  }

  setLargeImageURL(url: string | null): void {
    this.largeImageURL = url;
  }

  setPublisherPlace(p: string | null): void {
    this.publisherPlace = normalizeSpace(p);
  }

  setCategories(cat: string[] | null): void {
    this.categories = cat;
  }

  addCategory(cat: string): void {
    if (this.categories === null) {
      this.categories = [];
    }
    this.categories.push(cat);
  }

  setNbPages(nb: number): void {
    this.nbPages = nb;
  }

  setReview(rev: string | null): void {
    this.review = rev;
  }

  setType(t: string | null): void {
    this.type = t;
  }

  setTypeDescription(t: string | null): void {
    this.typeDescription = t;
  }

  setBookType(bt: string | null): void {
    this.book_type = normalizeSpace(bt);
  }

  setDOI(id: string | null): void {
    if (id === null)
      return;
    this.doi = BiblioItem.cleanDOI(id);
  }

  setInDOI(id: string | null): void {
    if (id !== null) {
      this.inDOI = normalizeSpace(id);
      this.inDOI = this.inDOI!.replace(/ /g, "");
      this.inDOI = BiblioItem.cleanDOI(this.inDOI);
    }
  }

  static cleanDOI(doi: string | null): string | null {
    if (doi === null) {
      return doi;
    }

    doi = normalizeSpace(doi)!;
    doi = doi.replace(/ /g, "");
    doi = doi.replace(/https?:\/\/(dx\.)?doi\.org\//g, "");

    //bibl = bibl.replace("//", "/");
    if (doi.toLowerCase().startsWith("doi:") || doi.toLowerCase().startsWith("doi/")) {
      doi = doi.substring(4);
    }
    if (doi.toLowerCase().startsWith("doi")) {
      doi = doi.substring(3);
    }
    // pretty common wrong extraction pattern:
    // 43-61.DOI:10.1093/jpepsy/14.1.436/7
    // 367-74.DOI:10.1080/14034940210165064
    // (pages concatenated to the DOI) - easy/safe to fix
    if (containsIgnoreCase(doi, "doi:10.")) {
      doi = doi.substring(indexOfIgnoreCase(doi, "doi:10.") + 4);
    }

    // for DOI coming from PDF links, we have some prefix cleaning to make
    if (doi.startsWith("file://") || doi.startsWith("https://") || doi.startsWith("http://")) {
      const ind = doi.indexOf("/10.");
      if (ind !== -1)
        doi = doi.substring(ind + 1);
    }

    doi = doi.trim();
    const ind = doi.indexOf("http://");
    if (ind > 10) {
      doi = doi.substring(0, ind);
    }

    doi = doi.replace(/[\p{M}]/gu, "");
    doi = doi.replace(/\p{Mn}+/gu, "");

    // remove possible starting/trailing parenthesis
    if (doi.startsWith("(") || doi.startsWith("[") || doi.startsWith("⟨"))
      doi = doi.substring(1);

    if (doi.endsWith(")") || doi.endsWith("]") || doi.endsWith("⟩"))
      doi = doi.substring(0, doi.length - 1);

    return doi;
  }

  setHalId(halId: string | null): void {
    this.halId = halId;
  }

  setArXivId(id: string | null): void {
    if (id !== null) {
      this.arXivId = normalizeSpace(id);
      this.arXivId = this.arXivId!.replace(/ /g, "");
    }
  }

  setPMID(id: string | null): void {
    if (id !== null) {
      this.PMID = normalizeSpace(id);
      this.PMID = this.PMID!.replace(/ /g, "");
    }
  }

  setPMCID(id: string | null): void {
    if (id !== null) {
      this.PMCID = normalizeSpace(id);
      this.PMCID = this.PMCID!.replace(/ /g, "");
    }
  }

  setPII(id: string | null): void {
    if (id !== null) {
      this.PII = normalizeSpace(id);
      this.PII = this.PII!.replace(/ /g, "");
    }
  }

  setIstexId(id: string | null): void {
    this.istexId = id;
  }

  setArk(id: string | null): void {
    this.ark = id;
  }

  setArticleTitle(ti: string | null): void {
    this.articleTitle = normalizeSpace(ti);
  }

  setBeginPage(p: number): void {
    this.beginPage = p;
  }

  setEndPage(p: number): void {
    this.endPage = p;
  }

  setYear(y: string | null): void {
    this.year = normalizeSpace(y);
  }

  setAbstract(a: string | null): void {
    this.abstract_ = this.cleanAbstract(a);
  }

  setLabeledAbstract(labeledAbstract: string | null): void {
    this.labeledAbstract = labeledAbstract;
  }

  setLocationPublisher(s: string | null): void {
    this.locationPublisher = normalizeSpace(s);
  }

  setSerieTitle(s: string | null): void {
    this.serieTitle = normalizeSpace(s);
  }

  setAuthorString(s: string | null): void {
    this.authorString = s;
  }

  setURL(s: string | null): void {
    this.url = normalizeSpace(s);
  }

  setOAURL(s: string | null): void {
    this.oaUrl = s;
  }

  setURI(s: string | null): void {
    this.uri = normalizeSpace(s);
  }

  setConfidence(s: string | null): void {
    this.confidence = s;
  }

  setConf(b: number): void {
    this.conf = b;
  }

  setFullAuthors(full: Person[] | null): void {
    this.fullAuthors = full;
  }

  setFullEditors(full: Person[] | null): void {
    this.fullEditors = full;
  }

  setFullAffiliations(full: Affiliation[] | null): void {
    this.fullAffiliations = full;
    // if no id is present in the affiliation objects, we add one
    let num = 0;
    if (this.fullAffiliations !== null) {
      for (const affiliation of this.fullAffiliations) {
        if (affiliation.getKey() === null) {
          affiliation.setKey("aff" + num);
        }
        num++;
      }
    }
  }

  setWorkingGroup(wg: string | null): void {
    this.workingGroup = wg;
  }

  setDocumentType(doctype: string | null): void {
    this.documentType = doctype;
  }

  // temp
  setAuthors(aut: string | null): void {
    this.authors = aut;
  }

  collectAuthorsToken(lt: LayoutToken): BiblioItem {
    this.authorsTokensWorkingCopy.push(lt);
    return this;
  }

  collectAuthorsTokens(layoutTokens: LayoutToken[]): void {
    for (const t of layoutTokens) this.authorsTokensWorkingCopy.push(t);
  }

  collectAbstractTokens(layoutTokens: LayoutToken[]): void {
    for (const t of layoutTokens) this.abstractTokensWorkingCopy.push(t);
  }

  addAuthor(aut: string): void {
    if (this.authors === null)
      this.authors = aut;
    else
      this.authors += " ; " + aut;

    if (this.authorList === null)
      this.authorList = [];
    if (!this.authorList.includes(aut))
      this.authorList.push(aut);
  }

  addFullAuthor(aut: Person): void {
    if (this.fullAuthors === null)
      this.fullAuthors = [];
    if (!this.fullAuthors.includes(aut))
      this.fullAuthors.push(aut);
  }

  addFullEditor(aut: Person): void {
    if (this.fullEditors === null)
      this.fullEditors = [];
    if (!this.fullEditors.includes(aut))
      this.fullEditors.push(aut);
  }

  addEditor(aut: string): void {
    if (this.editors === null)
      this.editors = aut;
    else
      this.editors += " ; " + aut;

    if (this.editorList === null)
      this.editorList = [];
    if (!this.editorList.includes(aut))
      this.editorList.push(aut);
  }

  setLocation(loc: string | null): void {
    this.location = normalizeSpace(loc);
  }

  setBookTitle(book: string | null): void {
    this.bookTitle = normalizeSpace(book);
  }

  setPageRange(pages: string | null): void {
    this.pageRange = normalizeSpace(pages);
  }

  setJournal(jour: string | null): void {
    this.journal = normalizeSpace(jour);
  }

  setVolumeBlock(vol: string | null, postProcess: boolean): void {
    this.volumeBlock = normalizeSpace(vol);
    if (postProcess)
      this.volumeBlock = this.postProcessVolumeBlock();
  }

  setInstitution(inst: string | null): void {
    this.institution = normalizeSpace(inst);
  }

  setNoteOrConcatenateIfNotEmpty(note: string | null): void {
    if (isBlank(this.note)) {
      this.note = normalizeSpace(note);
    } else {
      this.note += " " + normalizeSpace(note);
    }
  }

  setNote(not: string | null): void {
    this.note = normalizeSpace(not);
  }

  setAffiliation(a: string | null): void {
    this.affiliation = a;
  }

  setAddress(a: string | null): void {
    this.address = a;
  }

  setCountry(a: string | null): void {
    this.country = a;
  }

  setTown(a: string | null): void {
    this.town = a;
  }

  setEmail(e: string | null): void {
    this.email = e;
  }

  setPubnum(p: string | null): void {
    this.pubnum = normalizeSpace(p);
  }

  setKeyword(k: string | null): void {
    this.keyword = BiblioItem.cleanKeywords(k);
  }

  addKeyword(k: string): void {
    if (this.keywords === null)
      this.keywords = [];
    let theKey: string | null = BiblioItem.cleanKeywords(k);
    if (theKey !== null && theKey.toLowerCase().includes("introduction")) {
      // if the keyword contains introduction, this is normally a segmentation error
      theKey = null;
    }
    if (theKey !== null) {
      this.keywords.push(new Keyword(theKey));
    }
  }

  setKeywords(k: Keyword[] | null): void {
    this.keywords = k;
  }

  addSubject(k: string): void {
    if (this.subjects === null)
      this.subjects = [];
    this.subjects.push(k);
  }

  setSubjects(k: string[] | null): void {
    this.subjects = k;
  }

  setPhone(p: string | null): void {
    this.phone = p;
  }

  setDegree(d: string | null): void {
    this.degree = normalizeSpace(d);
  }

  setWeb(w: string | null): void {
    this.web = normalizeSpace(w);
    this.web = this.web!.replace(/ /g, "");

    if (isEmptyStr(this.doi)) {
      const doiMatch = this.web.match(TextUtilities.DOIPattern);
      if (doiMatch !== null) {
        this.setDOI(doiMatch[0]);
      }
    }
  }

  setCollaboration(collab: string | null): void {
    this.collaboration = normalizeSpace(collab);
  }

  setIssue(i: string | null): void {
    this.issue = normalizeSpace(i);
  }

  setJournalAbbrev(j: string | null): void {
    this.journal_abbrev = normalizeSpace(j);
  }

  setEvent(e: string | null): void {
    this.event = normalizeSpace(e);
  }

  setError(e: boolean): void {
    this.crossrefError = e;
  }

  setAbstractHeader(a: string | null): void {
    this.abstractHeader = normalizeSpace(a);
  }

  setPath(p: string): void {
    this.path = p;
  }

  setDay(d: string | null): void {
    this.day = d;
  }

  setE_Year(d: string | null): void {
    this.e_year = d;
  }

  setE_Month(d: string | null): void {
    this.e_month = d;
  }

  setE_Day(d: string | null): void {
    this.e_day = d;
  }

  setA_Year(d: string | null): void {
    this.a_year = d;
  }

  setA_Month(d: string | null): void {
    this.a_month = d;
  }

  setA_Day(d: string | null): void {
    this.a_day = d;
  }

  setS_Year(d: string | null): void {
    this.s_year = d;
  }

  setS_Month(d: string | null): void {
    this.s_month = d;
  }

  setS_Day(d: string | null): void {
    this.s_day = d;
  }

  setD_Year(d: string | null): void {
    this.d_year = d;
  }

  setD_Month(d: string | null): void {
    this.d_month = d;
  }

  setD_Day(d: string | null): void {
    this.d_day = d;
  }

  setDedication(d: string | null): void {
    this.dedication = normalizeSpace(d);
  }

  setSubmission(s: string | null): void {
    this.submission = normalizeSpace(s);
  }

  setEnglishTitle(d: string | null): void {
    this.english_title = normalizeSpace(d);
  }

  setSubmissionDate(d: string | null): void {
    this.submission_date = normalizeSpace(d);
  }

  setNormalizedSubmissionDate(d: GrobidDate | null): void {
    this.normalized_submission_date = d;
  }

  setDownloadDate(d: string | null): void {
    this.download_date = normalizeSpace(d);
  }

  setNormalizedDownloadDate(d: GrobidDate | null): void {
    this.normalized_download_date = d;
  }

  setServerDate(d: string | null): void {
    this.server_date = normalizeSpace(d);
  }

  setNormalizedServerDate(d: GrobidDate | null): void {
    this.normalized_server_date = d;
  }

  setOriginalAffiliation(original: string | null): void {
    this.originalAffiliation = original;
  }

  setOriginalAbstract(original: string | null): void {
    this.originalAbstract = original;
  }

  setOriginalAuthors(original: string | null): void {
    this.originalAuthors = original;
  }

  setOriginalEditors(original: string | null): void {
    this.originalEditors = original;
  }

  setOriginalTitle(original: string | null): void {
    this.originalTitle = original;
  }

  setOriginalAddress(original: string | null): void {
    this.originalAddress = original;
  }

  setOriginalNote(original: string | null): void {
    this.originalNote = original;
  }

  setOriginalKeyword(original: string | null): void {
    this.originalKeyword = original;
  }

  setOriginalVolumeBlock(original: string | null): void {
    this.originalVolumeBlock = original;
  }

  setOriginalJournal(original: string | null): void {
    this.originalJournal = original;
  }

  setReference(ref: string | null): void {
    this.reference = ref;
  }

  setCopyright(cop: string | null): void {
    this.copyright = normalizeSpace(cop);
  }

  setFunding(gra: string | null): void {
    this.funding = normalizeSpace(gra);
  }

  getMeeting(): string | null {
    return this.rawMeeting;
  }

  setMeeting(meet: string | null): void {
    this.rawMeeting = meet;
  }

  /**
   * General string cleaning for SQL strings. This method might depend on the chosen
   * relational database.
   */
  static cleanSQLString(str: string | null): string | null {
    if (str === null)
      return null;
    if (str.length === 0)
      return null;
    let cleanedString = "";
    // upstream declares `special` but never reads it — preserved as dead local.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    let special = false;
    for (let index = 0; (index < str.length); index++) {
      const currentCharacter = str.charAt(index);
      if ((currentCharacter === "'") || (currentCharacter === "%") || (currentCharacter === "_")) {
        special = true;
        cleanedString += "\\";
      }
      cleanedString += currentCharacter;
    }

    return cleanedString;
  }

  /**
   * Special string cleaning of ISBN and ISSN numbers.
   */
  static cleanISBNString(str: string | null): string {
    let cleanedString = "";
    if (str === null) return normalizeSpace(cleanedString)!;
    for (let index = 0; (index < str.length); index++) {
      const currentCharacter = str.charAt(index);
      if ((currentCharacter !== "-") && (currentCharacter !== " ") && (currentCharacter !== "'"))
        cleanedString += currentCharacter;
    }

    return normalizeSpace(cleanedString)!;
  }

  /**
   * Reinit all the values of the current bibliographical item
   */
  reset(): void {
    this.ISBN13 = null;
    this.ISBN10 = null;
    this.title = null;
    this.publisher = null;
    this.edition = null;
    this.language = null;
    this.subtitle = null;
    this.publication_date = null;
    this.normalized_publication_date = null;
    this.editors = null;
    this.publisher_website = null;
    this.serie = null;
    this.ISSN = null;
    this.ISSNe = null;
    this.volume = null;
    this.number = null;
    this.month = null;
    this.support_type = null;
    this.version = null;
    this.smallImageURL = null;
    this.largeImageURL = null;
    this.publisherPlace = null;
    this.review = null;
    this.categories = null;
    this.nbPages = -1;
    this.type = null;
    this.book_type = null;
    this.doi = null;
    this.halId = null;
    this.istexId = null;
    this.ark = null;
    this.inDOI = null;
    this.arXivId = null;
    this.PMID = null;
    this.PMCID = null;
    this.PII = null;
    this.abstract_ = null;
    this.url = null;
    this.oaUrl = null;
    this.uri = null;

    this.authors = null;
    this.location = null;
    this.bookTitle = null;
    this.pageRange = null;
    this.journal = null;
    this.volumeBlock = null;
    this.institution = null;
    this.note = null;
    this.affiliation = null;
    this.address = null;
    this.email = null;
    this.pubnum = null;
    this.keyword = null;
    this.phone = null;
    this.degree = null;
    this.web = null;
    this.issue = null;
    this.journal_abbrev = null;
    this.event = null;
    this.day = null;
    this.submission_date = null;
    this.normalized_submission_date = null;
    this.download_date = null;
    this.normalized_download_date = null;
    this.server_date = null;
    this.normalized_server_date = null;

    this.beginPage = -1;
    this.endPage = -1;
    this.articleTitle = null;
    this.dedication = null;
    this.submission = null;
    this.english_title = null;

    this.fullAuthors = null;
    this.fullAffiliations = null;
    this.reference = null;
    this.copyright = null;
    this.funding = null;

    this.workingGroup = null;
    this.documentType = null;
  }

  /**
   * Post process the volume block in order to distinguish when
   * possible and when appropriate volume and issue
   */
  postProcessVolumeBlock(): string | null {
    if (this.volumeBlock === null) {
      return null;
    }
    if (this.volumeBlock.length === 0) {
      return this.volumeBlock;
    }
    this.volumeBlock = normalizeSpace(this.volumeBlock)!;

    // the volume is always the first full number sequence of the block
    // first we remove the possible non digit character prefix
    let stop = false;
    let p = 0;
    while (!stop && (p < this.volumeBlock.length)) {
      if (isDigit(this.volumeBlock.charAt(p)))
        stop = true;
      else
        p++;
    }

    if (!stop)
      return this.volumeBlock; // we just have letters... we can't do anything

    let i = p;
    stop = false;
    while (!stop && (i < this.volumeBlock.length)) {
      if (!isDigit(this.volumeBlock.charAt(i)))
        stop = true;
      else
        i++;
    }

    let resVolume: string | null = null;
    if (stop)
      resVolume = this.volumeBlock.substring(p, i);
    else
      return this.volumeBlock.substring(p);

    // we then have at least one non numerical character
    stop = false;
    while (!stop && (i < this.volumeBlock.length)) {
      if (isDigit(this.volumeBlock.charAt(i)))
        stop = true;
      else
        i++;
    }

    if (!stop)
      return resVolume;

    // if present, the second number sequence is the issue
    stop = false;
    let j = i + 1;
    while (!stop && (j < this.volumeBlock.length)) {
      if (!isDigit(this.volumeBlock.charAt(j)))
        stop = true;
      else
        j++;
    }

    if (!stop)
      j = this.volumeBlock.length;

    this.issue = this.volumeBlock.substring(i, j);
    return resVolume;
  }

  /**
   * Some little cleaning of the abstract field.
   *
   * To be done: use a short text model to structure abstract
   */
  static readonly ABSTRACT_PREFIXES: readonly string[] = ["abstract", "summary", "résumé", "abrégé", "a b s t r a c t"];

  cleanAbstract(string: string | null): string | null {

    if (string === null)
      return null;
    if (string.length === 0)
      return string;
    let res = normalizeSpace(string)!;
    const res0 = res.toLowerCase();

    for (const abstractPrefix of BiblioItem.ABSTRACT_PREFIXES) {
      if (res0.startsWith(abstractPrefix)) {
        if (abstractPrefix.length < res.length) {
          res = res.substring(abstractPrefix.length, res.length);
          // upstream calls `res.trim()` without assigning — preserved as no-op.
          res.trim();
        } else {
          res = "";
        }
        this.abstractHeader = abstractPrefix;
        break;
      }
    }

    if ((res.startsWith(".")) || (res.startsWith(":")) || (res.startsWith(")"))) {
      res = res.substring(1, res.length);
      res = res.trim();
    }

    //res = res.replace("@BULLET", " • ");

    res = res.replace(/\( /g, "(");
    res = res.replace(/ \)/g, ")");
    res = res.replace(/ {2}/g, " ");

    return res;
  }

  static cleanAbstractLayoutTokens(tokens: LayoutToken[] | null): LayoutToken[] | null {
    if (tokens === null)
      return null;
    if (tokens.length === 0)
      return tokens;

    let n = 0;
    while (n < tokens.length) {
      const tokenString = normalizeSpace(tokens[n]!.getText()!.toLowerCase())!;
      if (tokenString.length === 0 || TextUtilities.delimiters.indexOf(tokenString) !== -1) {
        n++;
        continue;
      }
      let matchPrefix = false;
      for (const abstractPrefix of BiblioItem.ABSTRACT_PREFIXES) {
        if (tokenString === abstractPrefix) {
          matchPrefix = true;
          break;
        }
      }
      if (matchPrefix) {
        n++;
        continue;
      }
      break;
    }

    return tokens.slice(n);
  }

  static cleanTitles(bibl: BiblioItem): void {
    if (bibl.getTitle() !== null) {
      let localTitle = TextUtilities.cleanField(bibl.getTitle(), false);
      if (localTitle !== null && localTitle.endsWith(" y")) {
        // some markers at the end of the title are extracted from the pdf as " y" at the end of the title
        // e.g. <title level="a" type="main">Computations in finite-dimensional Lie algebras y</title>
        localTitle = localTitle.substring(0, localTitle.length - 2);
      }
      bibl.setTitle(localTitle);
    }
    if (bibl.getBookTitle() !== null) {
      bibl.setBookTitle(TextUtilities.cleanField(bibl.getBookTitle(), false));
    }
  }

  /**
   * Some little cleaning of the keyword field (likely unnecessary with latest header model).
   */
  static cleanKeywords(string: string | null): string | null {
    if (string === null)
      return null;
    if (string.length === 0)
      return string;
    let res = normalizeSpace(string)!;
    const resLow = res.toLowerCase();
    if (resLow.startsWith("keywords")) {
      res = res.substring(8);
    } else if (resLow.startsWith("key words") || resLow.startsWith("mots clés") || resLow.startsWith("mots cles")) {
      res = res.substring(9);
    } else if (resLow.startsWith("mots clefs")) {
      res = res.substring(10);
    }

    res = res.trim();
    if (res.startsWith(":") || res.startsWith("—") || res.startsWith("-")) {
      res = res.substring(1);
    }
    if (res.endsWith(".")) {
      res = res.substring(0, res.length - 1);
    }

    return res.trim();
  }

  /**
   * Keyword field segmentation.
   *
   * TBD: create a dedicated model to analyse the keyword field, segmenting them properly and
   * identifying the possible schemes
   */
  static segmentKeywords(string: string | null): Keyword[] | null {
    if (string === null)
      return null;
    if (string.length === 0)
      return null;
    let type: string | null = null;
    if (string.startsWith("Categories and Subject Descriptors")) {
      type = "subject-headers";
      string = string.replace("Categories and Subject Descriptors", "").trim();
    }
    else if (string.startsWith("PACS Numbers") || string.startsWith("PACS")) {
      type = "pacs";
      string = string.replace("PACS Numbers", "").replace("PACS", "").trim();
      if (string.startsWith(":")) {
        string = string.substring(1);
      }
    }
    else {
      type = "author";
    }

    const result: Keyword[] = [];
    // the list of possible keyword separators
    const separators: string[] = [";", "■", "•", "ㆍ", "Á", "\n", ",", ".", ":", "/", "|"];
    const separatorsSecondary: string[] = ["•", "■"];
    for (const separator of separators) {
      // StringTokenizer(string, separator): single-char delimiter, skips empty tokens
      const tokens = string.split(separator).filter((t) => t.length > 0);
      if (tokens.length > 2) {
        for (const tok of tokens) {
          let res = tok.trim();
          if (res.startsWith(":")) {
            res = res.substring(1);
          }
          let noSecondary = true;
          res = res.replace(/\n/g, " ").replace(/( )+/g, " ");
          for (const separatorSecondary of separatorsSecondary) {
            const tokens2 = res.split(separatorSecondary).filter((t) => t.length > 0);
            if (tokens2.length > 1) {
              for (const tok2 of tokens2) {
                let res2 = tok2.trim();
                res2 = res2.replace(/\n/g, " ").replace(/( )+/g, " ");
                const keyw = new Keyword(res2, type);
                result.push(keyw);
              }
              noSecondary = false;
            }
          }
          if (noSecondary) {
            const keyw = new Keyword(res, type);
            result.push(keyw);
          }
        }
        break;
      }
    }

    return result;
  }

  /**
   * Format initials by appending a dot to single-letter tokens.
   * Splits on whitespace and hyphens (preserving hyphens).
   * e.g. "W S" -> "W. S.", "J-L" -> "J.-L.", "Nicholas" -> "Nicholas", "W" -> "W."
   */
  private static formatInitials(name: string | null): string | null {
    if (isBlank(name)) {
      return name;
    }
    const spaceParts = name!.trim().split(/\s+/);
    const result: string[] = [];
    for (let i = 0; i < spaceParts.length; i++) {
      if (i > 0) {
        result.push(" ");
      }
      // Handle hyphenated parts. Java regex: `(?<=-)(?=[^-])|(?<=[^-])(?=-)`
      const hyphenParts = spaceParts[i]!.split(/(?<=-)(?=[^-])|(?<=[^-])(?=-)/);
      for (const hp of hyphenParts) {
        if (hp === "-") {
          result.push("-");
        } else if (hp.length === 1 && isLetter(hp.charAt(0))) {
          result.push(hp + ".");
        } else {
          result.push(hp);
        }
      }
    }
    return result.join("");
  }

  /**
   * Format a Person's name for BibTeX output.
   * Returns the formatted name string, or empty string if no name parts are present.
   */
  private static formatPersonNameBibTeX(person: Person): string {
    const sb: string[] = [];
    if (isNotBlank(person.getLastName())) {
      sb.push(person.getLastName()!.trim());
    }
    if (isNotBlank(person.getFirstName())) {
      if (sb.length > 0) {
        sb.push(", ");
      }
      sb.push(BiblioItem.formatInitials(person.getFirstName()!.trim())!);
    }
    if (isNotBlank(person.getMiddleName())) {
      if (sb.length > 0) {
        sb.push(isBlank(person.getFirstName()) ? ", " : " ");
      }
      sb.push(BiblioItem.formatInitials(person.getMiddleName()!.trim())!);
    }
    return sb.join("");
  }

  /**
   * Generate a BibTeX key from the first author's surname, the publication year,
   * and the first significant word of the title (all lowercased).
   * If the first word of the title is 2 characters or fewer, it is merged with the second word.
   */
  generateBibTeXKey(): string {
    const key: string[] = [];

    // Author component
    const surname = this.getFirstAuthorSurname();
    if (isNotBlank(surname)) {
      key.push(surname!.replace(/[^\p{L}]/gu, "").toLowerCase());
    }

    // Year component
    if (this.normalized_publication_date !== null && this.normalized_publication_date.getYear() >= 0) {
      key.push("" + this.normalized_publication_date.getYear());
    } else if (isNotBlank(this.publication_date)) {
      const yearStr = this.publication_date!.replace(/[^0-9]/g, "");
      if (yearStr.length >= 4) {
        key.push(yearStr.substring(0, 4));
      } else if (yearStr.length !== 0) {
        key.push(yearStr);
      }
    }

    // Title component (fall back to bookTitle if title is missing)
    const titleForKey = isNotBlank(this.title) ? this.title : this.bookTitle;
    if (isNotBlank(titleForKey)) {
      const words = titleForKey!.trim().split(/\s+/);
      if (words.length > 0) {
        let firstWord = words[0]!.replace(/[^\p{L}]/gu, "").toLowerCase();
        if (firstWord.length <= 2 && words.length > 1) {
          firstWord += words[1]!.replace(/[^\p{L}]/gu, "").toLowerCase();
        }
        key.push(firstWord);
      }
    }

    if (key.length === 0) {
      return "unknown";
    }
    return key.join("");
  }

  /**
   * Export to BibTeX format using an auto-generated key.
   */
  toBibTeX(): string;
  /**
   * Export to BibTeX format
   *
   * @param id the BibTeX key to use.
   */
  toBibTeX(id: string): string;
  /**
   * Export to BibTeX format
   *
   * @param id the BibTeX key to use
   */
  toBibTeX(id: string, config: GrobidAnalysisConfig): string;
  toBibTeX(id?: string, config?: GrobidAnalysisConfig): string {
    if (id === undefined) {
      return this.toBibTeX(this.generateBibTeXKey());
    }
    if (config === undefined) {
      return this.toBibTeX(id, new GrobidAnalysisConfigBuilder().includeRawCitations(false).build());
    }
    let type: string;
    if (this.journal !== null) {
      type = "article";
    } else if (this.book_type !== null) {
      type = "techreport";
    } else if (this.bookTitle !== null) {
      if (containsIgnoreCase(this.bookTitle, "proceedings") ||
        (this.bookTitle.startsWith("proc")) || (this.bookTitle.startsWith("Proc")) ||
        (this.bookTitle.startsWith("In Proc")) || (this.bookTitle.startsWith("In proc"))) {
        type = "inproceedings";
      } else {
        LOGGER.debug("No journal given, but a booktitle. However, the booktitle does not start with \"proc\" or similar strings. Returning inbook");
        type = "inbook";
      }
    } else {
      // using "misc" as fallback type
      type = "misc";
    }

    // StringJoiner(",\n", "@" + type + "{" + id + ",\n", "\n}\n")
    const bibtexEntries: string[] = [];
    const finalPrefix = "@" + type + "{" + id + ",\n";
    const finalSuffix = "\n}\n";

    try {

      // author
      // fullAuthors has to be used instead
      if (this.collaboration !== null) {
        bibtexEntries.push("  author = {" + this.collaboration + "}");
      } else {
        const authorParts: string[] = [];
        if (isCollectionNotEmpty(this.fullAuthors)) {
          for (const person of this.fullAuthors!) {
            if (person === null) continue;
            const author = BiblioItem.formatPersonNameBibTeX(person);
            if (isNotBlank(author)) {
              authorParts.push(author);
            }
          }
        } else if (this.authors !== null) {
          // StringTokenizer(authors, ";"): single-char delimiter, skips empty tokens
          const parts = this.authors.split(";").filter((t) => t.length > 0);
          for (const author of parts) {
            if (author !== null) {
              authorParts.push(author.trim());
            }
          }
        }
        bibtexEntries.push("  author = {" + authorParts.join(" and ") + "}");
      }

      // title
      if (this.title !== null) {
        bibtexEntries.push("  title = {" + this.title + "}");
      }

      // journal
      if (this.journal !== null) {
        bibtexEntries.push("  journal = {" + this.journal + "}");
      }

      // booktitle
      if ((this.journal === null) && (this.book_type === null) && (this.bookTitle !== null)) {
        bibtexEntries.push("  booktitle = {" + this.bookTitle + "}");
      }

      // booktitle
      if ((this.journal === null) && (this.serieTitle !== null)) {
        bibtexEntries.push("  series = {" + this.serieTitle + "}");
      }

      // publisher
      if (this.publisher !== null) {
        bibtexEntries.push("  publisher = {" + this.publisher + "}");
      }

      // editors
      let editorsAdded = false;
      if (isCollectionNotEmpty(this.fullEditors)) {
        const editorParts: string[] = [];
        for (const e of this.fullEditors!) {
          if (e === null) continue;
          const formatted = BiblioItem.formatPersonNameBibTeX(e);
          if (isNotBlank(formatted)) editorParts.push(formatted);
        }
        const editorStr = editorParts.join(" and ");
        if (isNotBlank(editorStr)) {
          bibtexEntries.push("  editor = {" + editorStr + "}");
          editorsAdded = true;
        }
      }
      if (!editorsAdded && this.editors !== null) {
        const locEditors = this.editors.replace(/ ; /g, " and ");
        bibtexEntries.push("  editor = {" + locEditors + "}");
      }

      // dates
      if (this.normalized_publication_date !== null) {
        const isoDate = GrobidDate.toISOString(this.normalized_publication_date);
        if (isoDate !== null) {
          bibtexEntries.push("  date = {" + isoDate + "}");
        }
        if (this.normalized_publication_date.getYear() >= 0) {
          bibtexEntries.push("  year = {" + this.normalized_publication_date.getYear() + "}");

          if (this.normalized_publication_date.getMonth() >= 0) {
            bibtexEntries.push("  month = {" + this.normalized_publication_date.getMonth() + "}");

            if (this.normalized_publication_date.getDay() >= 0) {
              bibtexEntries.push("  day = {" + this.normalized_publication_date.getDay() + "}");
            }
          }
        }
      } else if (this.publication_date !== null) {
        bibtexEntries.push("  year = {" + this.publication_date + "}");
      }

      // address
      if (this.location !== null) {
        bibtexEntries.push("  address = {" + this.location + "}");
      }

      // pages
      if (this.pageRange !== null) {
        bibtexEntries.push("  pages = {" + this.pageRange + "}");
      }

      // volume
      if (this.volumeBlock !== null) {
        bibtexEntries.push("  volume = {" + this.volumeBlock + "}");
      }

      // issue (named number in BibTeX)
      if (this.issue !== null) {
        bibtexEntries.push("  number = {" + this.issue + "}");
      }

      // DOI
      if (!isEmptyStr(this.doi)) {
        bibtexEntries.push("  doi = {" + this.doi + "}");
      }

      // arXiv identifier
      if (!isEmptyStr(this.arXivId)) {
        bibtexEntries.push("  eprint = {" + this.arXivId + "}");
      }
      /* note that the following is now recommended for arXiv citations:
              archivePrefix = "arXiv",
              eprint        = "0707.3168",
              primaryClass  = "hep-th",
          (here old identifier :( ))
          see https://arxiv.org/hypertex/bibstyles/
      */

      // abstract
      if (!isEmptyStr(this.abstract_)) {
        bibtexEntries.push("  abstract = {" + this.abstract_ + "}");
      }

      // keywords
      if (this.keywords !== null) {
        const kwParts: string[] = [];
        for (const kw of this.keywords) {
          const kwStr = kw.getKeyword();
          if (!isBlank(kwStr)) kwParts.push(kwStr!);
        }
        const value = "keywords = {" + kwParts.join(", ") + "}";
        bibtexEntries.push(value);
      }

      if (config.getIncludeRawCitations() && !isEmptyStr(this.reference)) {
        // escape all " signs
        bibtexEntries.push("  raw = {" + this.reference + "}");
      }
    } catch (e) {
      LOGGER.error("Cannot export BibTex format, because of nested exception.", e);
      throw new GrobidException("Cannot export BibTex format, because of nested exception.", e as Error);
    }
    return finalPrefix + bibtexEntries.join(",\n") + finalSuffix;
  }

  /**
   * Check if the identifier pubnum is a DOI or an arXiv identifier. If yes, instanciate
   * the corresponding field and reset the generic pubnum field.
   */
  checkIdentifier(): void {
    // DOI
    if (!isEmptyStr(this.pubnum) && isEmptyStr(this.doi)) {
      let doiMatch = this.pubnum!.match(TextUtilities.DOIPattern);
      if (doiMatch !== null) {
        this.setDOI(this.pubnum);
        this.setPubnum(null);
      } else {
        doiMatch = this.pubnum!.replace(/ /g, "").match(TextUtilities.DOIPattern);
        if (doiMatch !== null) {
          this.setDOI(this.pubnum);
          this.setPubnum(null);
        }
      }
    }
    // arXiv id (this covers old and new versions)
    if (!isEmptyStr(this.pubnum) && isEmptyStr(this.arXivId)) {
      const arxivMatch = this.pubnum!.match(TextUtilities.arXivPattern);
      if (arxivMatch !== null) {
        this.setArXivId(this.pubnum);
        this.setPubnum(null);
      }
    }
    // PMID
    if (!isEmptyStr(this.pubnum) && isEmptyStr(this.PMID)) {
      const pmidMatch = this.pubnum!.match(TextUtilities.pmidPattern);
      if (pmidMatch !== null) {
        // last group gives the PMID digits
        const digits = pmidMatch[pmidMatch.length - 1]!;
        this.setPMID(digits);
        this.setPubnum(null);
      }
    }
    // PMC ID
    if (!isEmptyStr(this.pubnum) && isEmptyStr(this.PMCID)) {
      const pmcidMatch = this.pubnum!.match(TextUtilities.pmcidPattern);
      if (pmcidMatch !== null) {
        // last group gives the PMC ID digits, but the prefix PMC must be added to follow the NIH guidelines
        const digits = pmcidMatch[pmcidMatch.length - 1]!;
        this.setPMCID("PMC" + digits);
        this.setPubnum(null);
      }
    }
    // ISSN
    if (!isEmptyStr(this.pubnum) && isEmptyStr(this.ISSN)) {
      if (this.pubnum!.toLowerCase().indexOf("issn") !== -1) {
        this.pubnum = this.pubnum!.replace(/issn/g, "");
        this.pubnum = this.pubnum.replace(/ISSN/g, "");
        this.pubnum = TextUtilities.cleanField(this.pubnum, true);
        if (this.pubnum !== null)
          this.setISSN(this.pubnum);
        this.setPubnum(null);
      }
    }

    // ISBN
    if (!isEmptyStr(this.pubnum) && isEmptyStr(this.ISBN13)) {
      if (this.pubnum!.toLowerCase().indexOf("isbn") !== -1) {
        this.pubnum = this.pubnum!.replace(/isbn/g, "");
        this.pubnum = this.pubnum.replace(/ISBN/g, "");
        this.pubnum = TextUtilities.cleanField(this.pubnum, true);
        if (this.pubnum !== null && this.pubnum.length === 10)
          this.setISBN10(this.pubnum);
        else if (this.pubnum !== null && this.pubnum.length === 13)
          this.setISBN13(this.pubnum);
        this.setPubnum(null);
      }
    }

    // TODO: PII and HALId

  }

  /**
   * Export the bibliographical item into a TEI BiblStruct string.
   * Overloaded for `toTEI(n)`, `toTEI(n, indent)`, `toTEI(n, indent, config)`, `toTEI(n, config)`.
   */
  toTEI(n: number): string;
  toTEI(n: number, config: GrobidAnalysisConfig): string;
  toTEI(n: number, indent: number): string;
  toTEI(n: number, indent: number, config: GrobidAnalysisConfig): string;
  toTEI(n: number, secondArg?: number | GrobidAnalysisConfig, thirdArg?: GrobidAnalysisConfig): string {
    let indent: number;
    let config: GrobidAnalysisConfig;
    if (secondArg === undefined) {
      indent = 0;
      config = GrobidAnalysisConfig.defaultInstance();
    } else if (typeof secondArg === "number") {
      indent = secondArg;
      config = thirdArg === undefined ? GrobidAnalysisConfig.defaultInstance() : thirdArg;
    } else {
      // secondArg is config
      indent = 0;
      config = secondArg;
    }
    const tei: string[] = [];
    const generateIDs: boolean = config.isGenerateTeiIds();
    try {
      // we just produce here xml strings
      for (let i = 0; i < indent; i++) {
        tei.push("\t");
      }
      tei.push("<biblStruct");
      const coordsList = config.getGenerateTeiCoordinates();
      const withCoords: boolean = (coordsList !== null && coordsList !== undefined) && coordsList.includes("biblStruct");
      tei.push(" ");
      if (withCoords)
        tei.push(TEIFormatter.getCoordsAttribute(this.coordinates, withCoords) + " ");

      tei.push("status=\"" + this.getStatus() + "\"");
      if (this.getConsolidationService() !== null)
        tei.push(" source=\"" + this.getConsolidationService() + "\"");
      tei.push(" ");

      if (!isEmptyStr(this.language)) {
        if (n === -1) {
          tei.push("xml:lang=\"" + this.language + ">\n");
        } else {
          this.teiId = "b" + n;
          tei.push("xml:lang=\"" + this.language + "\" xml:id=\"" + this.teiId + "\">\n");
        }
        // TBD: we need to ensure that the language is normalized following xml lang attributes !
      } else {
        if (n === -1) {
          tei.push(">\n");
        } else {
          this.teiId = "b" + n;
          tei.push("xml:id=\"" + this.teiId + "\">\n");
        }
      }

      let openAnalytic = false;
      if (((this.bookTitle === null) && (this.journal === null) && (this.serieTitle === null)) ||
        ((this.bookTitle !== null) && (this.title === null) && (this.articleTitle === null) && (this.journal === null) && (this.serieTitle === null))) {
        for (let i = 0; i < indent + 1; i++) {
          tei.push("\t");
        }
        tei.push("<monogr>\n");
      } else {
        for (let i = 0; i < indent + 1; i++) {
          tei.push("\t");
        }
        tei.push("<analytic>\n");
        openAnalytic = true;
      }

      // title
      if (this.title !== null) {
        for (let i = 0; i < indent + 2; i++) {
          tei.push("\t");
        }
        tei.push("<title");
        if ((this.bookTitle === null) && (this.journal === null) && (this.serieTitle === null)) {
          tei.push(" level=\"m\" type=\"main\"");
          if (config.isGenerateTeiCoordinates("title")) {
            // title for articles or chapters
            let titleTokens = this.getLayoutTokensForLabel(TaggingLabels.CITATION_BOOKTITLE);
            if (titleTokens === null || titleTokens.length === 0) {
              titleTokens = this.getLayoutTokensForLabel(TaggingLabels.CITATION_TITLE);
            }

            if (titleTokens !== null && titleTokens.length > 0) {
              const coords = LayoutTokensUtil.getCoordsString(titleTokens);
              if (coords !== null && coords.length > 0) {
                tei.push(" coords=\"" + coords + "\"");
              }
            }
          }
        } else {
          tei.push(" level=\"a\" type=\"main\"");

          if (config.isGenerateTeiCoordinates("title")) {
            // title for articles or chapters
            const titleTokens = this.getLayoutTokensForLabel(TaggingLabels.CITATION_TITLE);
            if (titleTokens !== null && titleTokens.length > 0) {
              const coords = LayoutTokensUtil.getCoordsString(titleTokens);
              if (coords !== null && coords.length > 0) {
                tei.push(" coords=\"" + coords + "\"");
              }
            }
          }
        }
        if (generateIDs) {
          const divID = KeyGen.getKey().substring(0, 7);
          tei.push(" xml:id=\"_" + divID + "\"");
        }

        // here check the language ?
        if (isEmptyStr(this.english_title)) {
          tei.push(">" + TextUtilities.HTMLEncode(this.title) + "</title>\n");
        } else {
          tei.push(" xml:lang=\"" + this.language + "\">" + TextUtilities.HTMLEncode(this.title) + "</title>\n");
        }
      }
      else if (this.bookTitle === null) {
        for (let i = 0; i < indent + 2; i++) {
          tei.push("\t");
        }
        tei.push("<title/>\n");
      }
      let hasEnglishTitle = false;
      if (this.english_title !== null) {
        // here do check the language !
        const resLang = this.languageUtilities.runLanguageId(this.english_title);
        if (resLang !== null) {
          const resL = resLang.getLang();
          if (resL === Language.EN) {
            hasEnglishTitle = true;
            for (let i = 0; i < indent + 2; i++) {
              tei.push("\t");
            }
            tei.push("<title");
            if ((this.bookTitle === null) && (this.journal === null)) {
              tei.push(" level=\"m\"");
            } else {
              tei.push(" level=\"a\"");
            }
            if (generateIDs) {
              const divID = KeyGen.getKey().substring(0, 7);
              tei.push(" xml:id=\"_" + divID + "\"");
            }

            tei.push(" xml:lang=\"en\">" + TextUtilities.HTMLEncode(this.english_title) + "</title>\n");
          }
        }
        // if it's not something in English, we will write it anyway as note without type at the end
      }

      tei.push(this.toTEIAuthorBlock(2, config));

      if (!isEmptyStr(this.doi)) {
        for (let i = 0; i < indent + 2; i++) {
          tei.push("\t");
        }
        tei.push("<idno type=\"DOI\">" + TextUtilities.HTMLEncode(this.doi) + "</idno>\n");
      }

      if (!isEmptyStr(this.halId)) {
        for (let i = 0; i < indent + 2; i++) {
          tei.push("\t");
        }
        tei.push("<idno type=\"HALid\">" + TextUtilities.HTMLEncode(this.halId) + "</idno>\n");
      }

      if (!isEmptyStr(this.arXivId)) {
        for (let i = 0; i < indent + 2; i++) {
          tei.push("\t");
        }
        tei.push("<idno type=\"arXiv\">" + TextUtilities.HTMLEncode(this.arXivId) + "</idno>\n");
      }

      if (!isEmptyStr(this.PMID)) {
        for (let i = 0; i < indent + 2; i++) {
          tei.push("\t");
        }
        tei.push("<idno type=\"PMID\">" + TextUtilities.HTMLEncode(this.PMID) + "</idno>\n");
      }

      if (!isEmptyStr(this.PMCID)) {
        for (let i = 0; i < indent + 2; i++) {
          tei.push("\t");
        }
        tei.push("<idno type=\"PMCID\">" + TextUtilities.HTMLEncode(this.PMCID) + "</idno>\n");
      }

      if (!isEmptyStr(this.PII)) {
        for (let i = 0; i < indent + 2; i++) {
          tei.push("\t");
        }
        tei.push("<idno type=\"PII\">" + TextUtilities.HTMLEncode(this.PII) + "</idno>\n");
      }

      if (!isEmptyStr(this.ark)) {
        for (let i = 0; i < indent + 2; i++) {
          tei.push("\t");
        }
        tei.push("<idno type=\"ark\">" + TextUtilities.HTMLEncode(this.ark) + "</idno>\n");
      }

      if (!isEmptyStr(this.istexId)) {
        for (let i = 0; i < indent + 2; i++) {
          tei.push("\t");
        }
        tei.push("<idno type=\"istexId\">" + TextUtilities.HTMLEncode(this.istexId) + "</idno>\n");
      }

      if (!isEmptyStr(this.pubnum)) {
        for (let i = 0; i < indent + 2; i++) {
          tei.push("\t");
        }
        tei.push("<idno>" + TextUtilities.HTMLEncode(this.pubnum) + "</idno>\n");
      }

      if (!isEmptyStr(this.oaUrl)) {
        for (let i = 0; i < indent + 2; i++) {
          tei.push("\t");
        }
        tei.push("<ptr type=\"open-access\" target=\"" + TextUtilities.HTMLEncode(this.oaUrl) + "\" />\n");
      }

      if (!isEmptyStr(this.web)) {
        for (let i = 0; i < indent + 2; i++) {
          tei.push("\t");
        }
        tei.push("<ptr target=\"" + TextUtilities.HTMLEncode(this.web) + "\" />\n");
      }

      if (openAnalytic) {
        for (let i = 0; i < indent + 1; i++) {
          tei.push("\t");
        }
        tei.push("</analytic>\n");
        for (let i = 0; i < indent + 1; i++) {
          tei.push("\t");
        }
        tei.push("<monogr>\n");
      }

      this._appendBookOrJournalBlock(tei, indent, config, generateIDs);

      if (!isEmptyStr(this.institution)) {
        for (let i = 0; i < indent + 2; i++) {
          tei.push("\t");
        }
        tei.push("<respStmt>\n");
        for (let i = 0; i < indent + 3; i++) {
          tei.push("\t");
        }
        tei.push("<orgName>" + TextUtilities.HTMLEncode(this.institution) + "</orgName>\n");
        for (let i = 0; i < indent + 2; i++) {
          tei.push("\t");
        }
        tei.push("</respStmt>\n");
      }

      for (let i = 0; i < indent + 1; i++) {
        tei.push("\t");
      }
      tei.push("</monogr>\n");

      if (this.submission !== null) {
        for (let i = 0; i < indent + 1; i++) {
          tei.push("\t");
        }
        tei.push("<note type=\"submission\">" + TextUtilities.HTMLEncode(this.submission) + "</note>\n");
      }
      if (this.getSubmissionDate() !== null) {
        for (let i = 0; i < indent + 1; i++) {
          tei.push("\t");
        }
        tei.push("<date type=\"submission\">" + TextUtilities.HTMLEncode(this.getSubmissionDate()) + "</date>\n");
      }
      if (this.getDownloadDate() !== null) {
        for (let i = 0; i < indent + 1; i++) {
          tei.push("\t");
        }
        tei.push("<date type=\"download\">" + TextUtilities.HTMLEncode(this.getDownloadDate()) + "</date>\n");
      }

      if (this.dedication !== null) {
        for (let i = 0; i < indent + 1; i++) {
          tei.push("\t");
        }
        tei.push("<note type=\"dedication\">" + TextUtilities.HTMLEncode(this.dedication) + "</note>\n");
      }

      if (this.book_type !== null) {
        for (let i = 0; i < indent + 1; i++) {
          tei.push("\t");
        }
        tei.push("<note type=\"report_type\">" + TextUtilities.HTMLEncode(this.book_type) + "</note>\n");
      }

      if (this.note !== null) {
        for (let i = 0; i < indent + 1; i++) {
          tei.push("\t");
        }
        tei.push("<note>" + TextUtilities.HTMLEncode(this.note) + "</note>\n");
      }

      if ((this.english_title !== null) && (!hasEnglishTitle)) {
        for (let i = 0; i < indent + 1; i++) {
          tei.push("\t");
        }
        tei.push("<note>" + TextUtilities.HTMLEncode(this.english_title) + "</note>\n");
      }

      if (this.subjects !== null) {
        if (this.subjects.length > 0) {
          for (let i = 0; i < indent + 1; i++) {
            tei.push("\t");
          }
          tei.push("<keywords scheme=\"hal\"><list>\n");
          for (const subject of this.subjects) {
            for (let i = 0; i < indent + 2; i++) {
              tei.push("\t");
            }
            tei.push("<item>" + TextUtilities.HTMLEncode(subject) + "</item>\n");
          }
          tei.push("</list></keywords>\n");
        }
      }

      // keywords here !!
      if (!isEmptyStr(this.getKeyword())) {
        const keywords = this.getKeyword()!;
        if (keywords.startsWith("Categories and Subject Descriptors")) {
          const start = keywords.indexOf("Keywords");
          if (start !== -1) {
            const keywords1 = keywords.substring(0, start - 1);
            const keywords2 = keywords.substring(start + 9, keywords.length);
            for (let i = 0; i < indent + 1; i++) {
              tei.push("\t");
            }
            tei.push("<keywords type=\"subject-headers\">" + TextUtilities.HTMLEncode(keywords1) + "</keywords>\n");
            for (let i = 0; i < indent + 1; i++) {
              tei.push("\t");
            }
            tei.push("<keywords>" + TextUtilities.HTMLEncode(keywords2) + "</keywords>\n");
          } else {
            for (let i = 0; i < indent + 1; i++) {
              tei.push("\t");
            }
            tei.push("<keywords>" + TextUtilities.HTMLEncode(this.getKeyword()) + "</keywords>\n");
          }
        } else {
          // Fixed from upstream: upstream Java's outer `else` lacked braces,
          // so the indent loop was the entire `else` body and the trailing
          // `<keywords>...</keywords>` emission ran unconditionally on ALL
          // branches — producing a second, duplicate `<keywords>` block for
          // "Categories and Subject Descriptors" papers. Now correctly
          // scoped to the `else` (non-Categories) branch.
          for (let i = 0; i < indent + 1; i++) {
            tei.push("\t");
          }
          tei.push("<keywords>" + TextUtilities.HTMLEncode(this.getKeyword()) + "</keywords>\n");
        }
      }

      if (this.uri !== null) {
        /*if (uri.startsWith("http://hal.") || ) {
            for (int i = 0; i < indent + 1; i++) {
                tei.append("\t");
            }
            tei.append("<idno type=\"HALid\">" + TextUtilities.HTMLEncode(uri) + "</idno>\n");
        } else */
        {
          for (let i = 0; i < indent + 1; i++) {
            tei.push("\t");
          }
          tei.push("<idno>" + TextUtilities.HTMLEncode(this.uri) + "</idno>\n");
        }
      }

      if (this.url !== null) {
        if (this.url.startsWith("http://hal.") || this.url.startsWith("https://hal.")) {
          for (let i = 0; i < indent + 1; i++) {
            tei.push("\t");
          }
          tei.push("<idno type=\"HALFile\">" + TextUtilities.HTMLEncode(this.url) + "</idno>\n");
        }
      }

      if (this.abstract_ !== null) {
        if (this.abstract_.length > 0) {
          for (let i = 0; i < indent + 1; i++) {
            tei.push("\t");
          }
          tei.push("<div type=\"abstract\">" + TextUtilities.HTMLEncode(this.abstract_) + "</div>\n");
        }
      }

      if (config.getIncludeRawCitations() && !isEmptyStr(this.reference)) {
        for (let i = 0; i < indent + 1; i++) {
          tei.push("\t");
        }
        let localReference = TextUtilities.HTMLEncode(this.reference)!;
        localReference = localReference.replace(/\n/g, " ");
        localReference = localReference.replace(/( )+/g, " ");
        tei.push("<note type=\"raw_reference\">" + localReference + "</note>\n");
      }

      for (let i = 0; i < indent; i++) {
        tei.push("\t");
      }
      tei.push("</biblStruct>\n");
    } catch (e) {
      throw new GrobidException("Cannot convert  bibliographical item into a TEI, " +
        "because of nested exception.", e as Error);
    }

    return tei.join("");
  }

  /**
   * Emits the `<imprint>`-containing block that depends on whether the entry
   * is a chapter (`bookTitle != null`), a journal article, or a misc entry.
   * Extracted from `toTEI` to keep that method's size manageable but otherwise
   * preserves the upstream control flow verbatim.
   */
  private _appendBookOrJournalBlock(tei: string[], indent: number, config: GrobidAnalysisConfig, generateIDs: boolean): void {
    if (this.bookTitle !== null) {
      for (let i = 0; i < indent + 2; i++) {
        tei.push("\t");
      }
      tei.push("<title level=\"m\"");
      if (generateIDs) {
        const divID = KeyGen.getKey().substring(0, 7);
        tei.push(" xml:id=\"_" + divID + "\"");
      }
      if (config.isGenerateTeiCoordinates("title")) {
        const titleTokens = this.getLayoutTokensForLabel(TaggingLabels.CITATION_BOOKTITLE);
        if (titleTokens !== null && titleTokens.length > 0) {
          const coords = LayoutTokensUtil.getCoordsString(titleTokens);
          if (coords !== null && coords.length > 0) {
            tei.push(" coords=\"" + coords + "\"");
          }
        }
      }

      tei.push(">" + TextUtilities.HTMLEncode(this.bookTitle) + "</title>\n");

      if (!isEmptyStr(this.serieTitle)) {
        // in case the book is part of an indicated series
        for (let i = 0; i < indent + 2; i++) {
          tei.push("\t");
        }
        tei.push("<title level=\"s\"");
        if (generateIDs) {
          const divID = KeyGen.getKey().substring(0, 7);
          tei.push(" xml:id=\"_" + divID + "\"");
        }

        if (config.isGenerateTeiCoordinates("title")) {
          // title for articles or chapters
          const titleTokens = this.getLayoutTokensForLabel(TaggingLabels.CITATION_SERIES);
          if (titleTokens !== null && titleTokens.length > 0) {
            const coords = LayoutTokensUtil.getCoordsString(titleTokens);
            if (coords !== null && coords.length > 0) {
              tei.push(" coords=\"" + coords + "\"");
            }
          }
        }

        tei.push(">" + TextUtilities.HTMLEncode(this.serieTitle) + "</title>\n");
      }

      if (this.fullEditors !== null && this.fullEditors.length > 0) {
        for (const editor of this.fullEditors) {
          let localString = editor.toTEI(false);
          if (localString === null || localString.length === 0)
            continue;

          for (let i = 0; i < indent + 2; i++) {
            tei.push("\t");
          }
          tei.push("<editor>\n");
          for (let i = 0; i < indent + 3; i++) {
            tei.push("\t");
          }

          localString = localString.replace(" xmlns=\"http://www.tei-c.org/ns/1.0\"", "");
          tei.push(localString + "\n");
          for (let i = 0; i < indent + 2; i++) {
            tei.push("\t");
          }
          tei.push("</editor>\n");
        }
      } else if (!isEmptyStr(this.editors)) {
        //postProcessingEditors();

        const editorTokens = this.editors!.split(";").filter((t) => t.length > 0);
        if (editorTokens.length > 0) {
          for (const editor of editorTokens) {
            const trimmedEditor = editor !== null ? editor.trim() : editor;
            for (let i = 0; i < indent + 2; i++) {
              tei.push("\t");
            }
            tei.push("<editor>" + TextUtilities.HTMLEncode(trimmedEditor) + "</editor>\n");
          }
        } else {
          if (this.editors !== null)
            for (let i = 0; i < indent + 2; i++) {
              tei.push("\t");
            }
          tei.push("<editor>" + TextUtilities.HTMLEncode(this.editors) + "</editor>\n");
        }
      }

      // in case the booktitle corresponds to a proceedings, we can try to indidate the meeting title
      let meeting: string | null = this.bookTitle;
      let meetLoc = false;
      if (this.event !== null)
        meeting = this.event;
      else {
        meeting = meeting!.trim();
        for (const prefix of BiblioItem.confPrefixes) {
          if (meeting!.startsWith(prefix)) {
            meeting = meeting!.replace(prefix, "");
            meeting = meeting.trim();
            meeting = TextUtilities.cleanField(meeting, false);
            for (let i = 0; i < indent + 2; i++) {
              tei.push("\t");
            }
            tei.push("<meeting>" + TextUtilities.HTMLEncode(meeting));
            if ((this.location !== null) || (this.town !== null) || (this.country !== null)) {
              tei.push("<address>");
              if (this.town !== null) {
                tei.push("<settlement>" + TextUtilities.HTMLEncode(this.town) + "</settlement>");
              }
              if (this.country !== null) {
                tei.push("<country>" + TextUtilities.HTMLEncode(this.country) + "</country>");
              }
              if ((this.location !== null) && (this.town === null) && (this.country === null)) {
                tei.push("<addrLine>" + TextUtilities.HTMLEncode(this.location) + "</addrLine>");
              }
              tei.push("</address>");
              meetLoc = true;
            }
            tei.push("</meeting>\n");
            break;
          }
          //break;
        }
      }

      if (((this.location !== null) || (this.town !== null) || (this.country !== null)) && (!meetLoc)) {
        for (let i = 0; i < indent + 2; i++) {
          tei.push("\t");
        }
        tei.push("<meeting>");
        tei.push("<address>");
        if (this.town !== null) {
          tei.push("<settlement>" + this.town + "</settlement>");
        }
        if (this.country !== null) {
          tei.push("<country>" + this.country + "</country>");
        }
        if ((this.location !== null) && (this.town === null) && (this.country === null)) {
          tei.push("<addrLine>" + TextUtilities.HTMLEncode(this.location) + "</addrLine>");
        }
        tei.push("</address>");
        tei.push("</meeting>\n");
      }

      for (let i = 0; i < indent + 2; i++) {
        tei.push("\t");
      }
      if ((this.publication_date !== null) || (this.pageRange !== null) || (this.publisher !== null) || (this.volumeBlock !== null)) {
        tei.push("<imprint>\n");
      }
      else
        tei.push("<imprint/>\n");

      if (this.publisher !== null) {
        for (let i = 0; i < indent + 3; i++) {
          tei.push("\t");
        }
        tei.push("<publisher>" + TextUtilities.HTMLEncode(this.publisher) + "</publisher>\n");
      }

      this._appendDateBlock(tei, indent);

      if (this.volumeBlock !== null) {
        for (let i = 0; i < indent + 3; i++) {
          tei.push("\t");
        }
        tei.push("<biblScope unit=\"volume\">" + TextUtilities.HTMLEncode(this.volumeBlock) + "</biblScope>\n");
      }

      if (!isEmptyStr(this.pageRange)) {
        const pageTokens = this.pageRange!.split("--").filter((t) => t.length > 0);
        if (pageTokens.length === 2) {
          for (let i = 0; i < indent + 3; i++) {
            tei.push("\t");
          }
          tei.push("<biblScope unit=\"page\" from=\"" + TextUtilities.HTMLEncode(pageTokens[0]!) + "\" to=\""
            + TextUtilities.HTMLEncode(pageTokens[1]!) + "\" />\n");
        } else {
          for (let i = 0; i < indent + 3; i++) {
            tei.push("\t");
          }
          tei.push("<biblScope unit=\"page\">" + TextUtilities.HTMLEncode(this.pageRange) + "</biblScope>\n");
        }
      }
      if ((this.publication_date !== null) || (this.pageRange !== null) || (this.publisher !== null) || (this.volumeBlock !== null)) {
        for (let i = 0; i < indent + 2; i++) {
          tei.push("\t");
        }
        tei.push("</imprint>\n");
      }
    } else if (!isEmptyStr(this.journal) || !isEmptyStr(this.serieTitle)) {
      for (let i = 0; i < indent + 2; i++) {
        tei.push("\t");
      }
      if (!isEmptyStr(this.journal)) {
        tei.push("<title level=\"j\"");
        if (generateIDs) {
          const divID = KeyGen.getKey().substring(0, 7);
          tei.push(" xml:id=\"_" + divID + "\"");
        }

        if (config.isGenerateTeiCoordinates("title")) {
          // title for articles or chapters
          const titleTokens = this.getLayoutTokensForLabel(TaggingLabels.CITATION_JOURNAL);
          if (titleTokens !== null && titleTokens.length > 0) {
            const coords = LayoutTokensUtil.getCoordsString(titleTokens);
            if (coords !== null && coords.length > 0) {
              tei.push(" coords=\"" + coords + "\"");
            }
          }
        }

        tei.push(">" + TextUtilities.HTMLEncode(this.journal) + "</title>\n");

        if (!isEmptyStr(this.getJournalAbbrev())) {
          for (let i = 0; i < indent + 2; i++) {
            tei.push("\t");
          }
          tei.push("<title level=\"j\" type=\"abbrev\">"
            + TextUtilities.HTMLEncode(this.getJournalAbbrev()) + "</title>\n");
        }
      } else if (!isEmptyStr(this.serieTitle)) {
        tei.push("<title level=\"s\"");
        if (generateIDs) {
          const divID = KeyGen.getKey().substring(0, 7);
          tei.push(" xml:id=\"_" + divID + "\"");
        }

        if (config.isGenerateTeiCoordinates("title")) {
          // title for articles or chapters
          const titleTokens = this.getLayoutTokensForLabel(TaggingLabels.CITATION_SERIES);
          if (titleTokens !== null && titleTokens.length > 0) {
            const coords = LayoutTokensUtil.getCoordsString(titleTokens);
            if (coords !== null && coords.length > 0) {
              tei.push(" coords=\"" + coords + "\"");
            }
          }
        }

        tei.push(">" + TextUtilities.HTMLEncode(this.serieTitle) + "</title>\n");
      }

      if (this.fullEditors !== null && this.fullEditors.length > 0) {
        for (const editor of this.fullEditors) {
          for (let i = 0; i < indent + 2; i++) {
            tei.push("\t");
          }
          tei.push("<editor>\n");
          for (let i = 0; i < indent + 3; i++) {
            tei.push("\t");
          }
          let localString = editor.toTEI(false)!;
          localString = localString.replace(" xmlns=\"http://www.tei-c.org/ns/1.0\"", "");
          tei.push(localString + "\n");
          for (let i = 0; i < indent + 2; i++) {
            tei.push("\t");
          }
          tei.push("</editor>\n");
        }
      } else if (!isEmptyStr(this.editors)) {
        //postProcessingEditors();

        const editorTokens = this.editors!.split(";").filter((t) => t.length > 0);
        if (editorTokens.length > 0) {
          for (const editor of editorTokens) {
            if (editor !== null) {
              for (let i = 0; i < indent + 2; i++) {
                tei.push("\t");
              }
              const trimmedEditor = editor.trim();
              tei.push("<editor>" + TextUtilities.HTMLEncode(trimmedEditor) + "</editor>\n");
            }
          }
        } else {
          if (!isEmptyStr(this.editors)) {
            for (let i = 0; i < indent + 2; i++) {
              tei.push("\t");
            }
            tei.push("<editor>" + TextUtilities.HTMLEncode(this.editors) + "</editor>\n");
          }
        }
      }

      if (!isEmptyStr(this.getISSN())) {
        for (let i = 0; i < indent + 2; i++) {
          tei.push("\t");
        }
        tei.push("<idno type=\"ISSN\">" + TextUtilities.HTMLEncode(this.getISSN()) + "</idno>\n");
      }

      if (!isEmptyStr(this.getISSNe())) {
        if (this.getISSNe() !== this.getISSN()) {
          for (let i = 0; i < indent + 2; i++) {
            tei.push("\t");
          }
          tei.push("<idno type=\"ISSNe\">" + TextUtilities.HTMLEncode(this.getISSNe()) + "</idno>\n");
        }
      }

      // NOTE: upstream uses `|` (bitwise) on the first comparison — preserved verbatim.
      // The mistake is harmless since the operands are already booleans coerced to 0/1.
      if ((this.volumeBlock !== null) || (this.issue !== null) || (this.pageRange !== null) || (this.publication_date !== null)
        || (this.publisher !== null)) {
        for (let i = 0; i < indent + 2; i++) {
          tei.push("\t");
        }
        tei.push("<imprint>\n");
        if (this.volumeBlock !== null) {
          for (let i = 0; i < indent + 3; i++) {
            tei.push("\t");
          }
          tei.push("<biblScope unit=\"volume\">" + TextUtilities.HTMLEncode(this.volumeBlock) + "</biblScope>\n");
        }
        if (this.issue !== null) {
          for (let i = 0; i < indent + 3; i++) {
            tei.push("\t");
          }
          tei.push("<biblScope unit=\"issue\">" + TextUtilities.HTMLEncode(this.issue) + "</biblScope>\n");
        }
        if (this.pageRange !== null) {
          const pageTokens = this.pageRange.split("--").filter((t) => t.length > 0);
          if (pageTokens.length === 2) {
            for (let i = 0; i < indent + 3; i++) {
              tei.push("\t");
            }
            tei.push("<biblScope unit=\"page\" from=\"" +
              TextUtilities.HTMLEncode(pageTokens[0]!) + "\" to=\"" +
              TextUtilities.HTMLEncode(pageTokens[1]!) + "\" />\n");
          } else {
            for (let i = 0; i < indent + 3; i++) {
              tei.push("\t");
            }
            tei.push("<biblScope unit=\"page\">" + TextUtilities.HTMLEncode(this.pageRange) + "</biblScope>\n");
          }
        }

        this._appendDateBlock(tei, indent);

        if (this.getPublisher() !== null) {
          for (let i = 0; i < indent + 3; i++) {
            tei.push("\t");
          }
          tei.push("<publisher>" + TextUtilities.HTMLEncode(this.getPublisher()) + "</publisher>\n");
        }

        if (this.location !== null && this.location.length > 0) {
          for (let i = 0; i < indent + 3; i++) {
            tei.push("\t");
          }
          tei.push("<pubPlace>" + TextUtilities.HTMLEncode(this.location) + "</pubPlace>\n");
        }

        for (let i = 0; i < indent + 2; i++) {
          tei.push("\t");
        }
        tei.push("</imprint>\n");
      }
      else {
        for (let i = 0; i < indent + 2; i++) {
          tei.push("\t");
        }
        tei.push("<imprint/>\n");
      }
    } else {
      // not a journal and not something in a book...
      if (this.editors !== null) {
        //postProcessingEditors();

        const editorTokens = this.editors.split(";").filter((t) => t.length > 0);
        if (editorTokens.length > 0) {
          for (const editor of editorTokens) {
            if (editor !== null) {
              const trimmedEditor = editor.trim();
              for (let i = 0; i < indent + 2; i++) {
                tei.push("\t");
              }
              tei.push("<editor>" + TextUtilities.HTMLEncode(trimmedEditor) + "</editor>\n");
            }
          }
        } else {
          if (this.editors !== null) {
            for (let i = 0; i < indent + 2; i++) {
              tei.push("\t");
            }
            tei.push("<editor>" + TextUtilities.HTMLEncode(this.editors) + "</editor>\n");
          }
        }
      }

      for (let i = 0; i < indent + 2; i++) {
        tei.push("\t");
      }
      if (this.normalized_publication_date !== null ||
        this.publication_date !== null ||
        this.pageRange !== null ||
        this.location !== null ||
        this.publisher !== null ||
        this.volumeBlock !== null) {
        tei.push("<imprint>\n");
      }
      else {
        tei.push("<imprint/>\n");
      }
      this._appendDateBlock(tei, indent);

      if (this.publisher !== null) {
        for (let i = 0; i < indent + 3; i++) {
          tei.push("\t");
        }
        tei.push("<publisher>" + TextUtilities.HTMLEncode(this.publisher) + "</publisher>\n");
      }
      if (this.volumeBlock !== null) {
        for (let i = 0; i < indent + 3; i++) {
          tei.push("\t");
        }
        tei.push("<biblScope unit=\"volume\">" + TextUtilities.HTMLEncode(this.volumeBlock) + "</biblScope>\n");
      }
      if (this.pageRange !== null) {
        const pageTokens = this.pageRange.split("--").filter((t) => t.length > 0);
        if (pageTokens.length === 2) {
          for (let i = 0; i < indent + 3; i++) {
            tei.push("\t");
          }
          tei.push("<biblScope unit=\"page\" from=\"" +
            TextUtilities.HTMLEncode(pageTokens[0]!) +
            "\" to=\"" + TextUtilities.HTMLEncode(pageTokens[1]!) + "\" />\n");
        } else {
          for (let i = 0; i < indent + 3; i++) {
            tei.push("\t");
          }
          tei.push("<biblScope unit=\"page\">" + TextUtilities.HTMLEncode(this.pageRange) + "</biblScope>\n");
        }
      }
      if (this.location !== null) {
        for (let i = 0; i < indent + 3; i++) {
          tei.push("\t");
        }
        tei.push("<pubPlace>" + TextUtilities.HTMLEncode(this.location) + "</pubPlace>\n");
      }

      if ((this.publication_date !== null) || (this.pageRange !== null) || (this.location !== null) || (this.publisher !== null) || (this.volumeBlock !== null)) {
        for (let i = 0; i < indent + 2; i++) {
          tei.push("\t");
        }
        tei.push("</imprint>\n");
      }
    }
  }

  private _appendDateBlock(tei: string[], indent: number): void {
    if (this.normalized_publication_date !== null) {
      if (this.normalized_publication_date.getYear() !== -1) {
        const when = GrobidDate.toISOString(this.normalized_publication_date);
        if (when !== null) {
          for (let i = 0; i < indent + 3; i++) {
            tei.push("\t");
          }
          tei.push("<date type=\"published\" when=\"");
          tei.push(when + "\"");

          if (this.publication_date !== null && this.publication_date.length > 0) {
            tei.push(">");
            tei.push(TextUtilities.HTMLEncode(this.publication_date)!);
            tei.push("</date>\n");
          } else {
            tei.push(" />\n");
          }
        }
      } else if (this.getYear() !== null) {
        let when = "";
        if (this.getYear()!.length === 1)
          when += "000" + this.getYear();
        else if (this.getYear()!.length === 2)
          when += "00" + this.getYear();
        else if (this.getYear()!.length === 3)
          when += "0" + this.getYear();
        else if (this.getYear()!.length === 4)
          when += this.getYear();

        if (this.getMonth() !== null) {
          if (this.getMonth()!.length === 1)
            when += "-0" + this.getMonth();
          else
            when += "-" + this.getMonth();
          if (this.getDay() !== null) {
            if (this.getDay()!.length === 1)
              when += "-0" + this.getDay();
            else
              when += "-" + this.getDay();
          }
        }
        for (let i = 0; i < indent + 3; i++) {
          tei.push("\t");
        }
        tei.push("<date type=\"published\" when=\"");
        tei.push(when + "\"");

        if (this.publication_date !== null && this.publication_date.length > 0) {
          tei.push(">");
          tei.push(TextUtilities.HTMLEncode(this.publication_date)!);
          tei.push("</date>\n");
        } else {
          tei.push(" />\n");
        }
      } else {
        for (let i = 0; i < indent + 3; i++) {
          tei.push("\t");
        }
        tei.push("<date>" + TextUtilities.HTMLEncode(this.publication_date) + "</date>\n");
      }
    } else if (this.publication_date !== null) {
      for (let i = 0; i < indent + 3; i++) {
        tei.push("\t");
      }
      tei.push("<date>" + TextUtilities.HTMLEncode(this.publication_date) + "</date>\n");
    }
  }

  /**
   * Export the bibliographical item into OpenURL 1.0.
   */
  toOpenURL(authors: string | null): string {
    let openurl = "";

    try {
      // general - independent from the type of bibliographical object
      //openurl += "url_ver=Z39.88-2004";
      openurl += "ctx_ver=Z39.88-2004";

      if (this.doi !== null) {
        //openurl += "&rft.doi=" + HTMLEncode(DOI);
        openurl += "&rft_id=info:doi/" + encodeURIComponent(this.doi);
        //openurl += "&rft.doi=" + URLEncoder.encode(DOI,"UTF-8");
        // we can finish here
        openurl += "&url_ctx_fmt=info:ofi/fmt:kev:mtx:ctx&rft.genre=article ";
        return openurl;
      }

      // journal
      if ((this.bookTitle !== null) || (this.journal !== null)) {
        if (this.journal !== null)
          openurl += "&rft_val_fmt=info:ofi/fmt:kev:mtx:journal";
        openurl += "&rft.genre=article"; // ? always to be written ?
        if (this.ISSN !== null)
          openurl += "&rft.issn=" + encodeURIComponent(this.ISSN);
        if (this.title !== null)
          openurl += "&rft.atitle=" + encodeURIComponent(this.title);
        if (this.journal !== null)
          openurl += "&rft.jtitle=" + encodeURIComponent(this.journal);
        else if (this.bookTitle !== null)
          openurl += "&rft.btitle=" + encodeURIComponent(this.bookTitle);
        if (this.volumeBlock !== null)
          openurl += "&rft.volume=" + encodeURIComponent(this.volumeBlock);
        if (this.issue !== null)
          openurl += "&rft.issue=" + encodeURIComponent(this.issue);

        if (this.pageRange !== null) {
          const parts = this.pageRange.split("--").filter((t) => t.length > 0);
          if (parts.length > 0) {
            const spage = parts[0]!;
            openurl += "&rft.spage=" + encodeURIComponent(spage);
            if (parts.length > 1) {
              const epage = parts[1]!;
              openurl += "&rft.epage=" + encodeURIComponent(epage);
            }
          }
        }
      } else {
        // book
        openurl += "&rft_val_fmt=info:ofi/fmt:kev:mtx:book";
        if (this.ISBN13 !== null)
          openurl += "&rft.isbn=" + encodeURIComponent(this.ISBN13);
        if (this.title !== null)
          openurl += "&rft.genre=book&rft.btitle=" + encodeURIComponent(this.title);
      }

      if (this.publication_date !== null)
        openurl += "&rft.date=" + encodeURIComponent(this.publication_date); // year is enough!

      // authors
      if (authors !== null) {
        const localAuthor = this.getFirstAuthorSurname();
        if (localAuthor !== null) {
          openurl += "&rft.aulast=" + encodeURIComponent(localAuthor);
        }
      }

      openurl += "&url_ctx_fmt=info:ofi/fmt:kev:mtx:ctx";
    } catch (e) {
      throw new GrobidException("Cannot open url to DOI, because of nested exception.", e as Error);
    }
    return openurl;
  }


  /**
   * Export the bibliographical item into a COinS (OpenURL ContextObject in SPAN).
   */
  toCOinS(): string {
    const res = "<span class=\"Z3988\" title=\"" + this.toOpenURL(this.authors) + "\"></span>";
    return res;
  }


  /**
   * Export the bibliographical item into an OpenURL with given link resolver address.
   */
  toFullOpenURL(linkResolver: string, imageLinkResolver: string): string {
    const res = "<a href=\"" + linkResolver + this.toOpenURL(this.authors)
      + "\"  target=\"_blank\"><img src=\"" + imageLinkResolver + "\"/></a>";
    return res;
  }

  setFirstAuthorSurname(firstAuthorSurname: string | null): void {
    this.firstAuthorSurname = firstAuthorSurname;
  }

  /**
   * Return the surname of the first author.
   */
  getFirstAuthorSurname(): string | null {
    if (this.firstAuthorSurname !== null) {
      return this.firstAuthorSurname;
      //return TextUtilities.HTMLEncode(this.firstAuthorSurname);
    }

    if (this.fullAuthors !== null) {
      if (this.fullAuthors.length > 0) {
        const aut = this.fullAuthors[0]!;
        const sur = aut.getLastName();
        if (sur !== null) {
          if (sur.length > 0) {
            this.firstAuthorSurname = sur;
            //return TextUtilities.HTMLEncode(sur);
            return sur;
          }
        }
      }
    }

    if (this.authors !== null) {
      const parts = this.authors.split(";").filter((t) => t.length > 0);
      if (parts.length > 0) {
        // we take just the first author
        let author: string | null = parts[0]!;
        if (author !== null)
          author = author.trim();
        const ind = author!.lastIndexOf(" ");
        if (ind !== -1) {
          this.firstAuthorSurname = author!.substring(ind + 1);
          //return TextUtilities.HTMLEncode(author.substring(ind + 1));
          return author!.substring(ind + 1);
        } else {
          this.firstAuthorSurname = author;
          //return TextUtilities.HTMLEncode(author);
          return author;
        }
      }
    }
    return null;
  }

  /**
   * Attach existing recognized emails to authors (default) or editors
   */
  attachEmails(folks?: Person[] | null): void {
    if (folks === undefined) {
      this.attachEmails(this.fullAuthors);
      return;
    }
    // do we have an email field recognized?
    if (this.email === null)
      return;
    // we check if we have several emails in the field
    this.email = this.email.trim();
    this.email = this.email.replace(/ and /g, "\t");
    const emailles: string[] = [];
    const parts = this.email.split("\t").filter((t) => t.length > 0);
    for (const p of parts) {
      emailles.push(p.trim());
    }

    if (this.emailSanitizer === null) {
      this.emailSanitizer = new EmailSanitizer();
    }
    const sanitizedEmails = this.emailSanitizer.splitAndClean(emailles);

    if (sanitizedEmails !== null) {
      if (this.authorEmailAssigner === null) {
        this.authorEmailAssigner = new ClassicAuthorEmailAssigner();
      }
      this.authorEmailAssigner.assign(folks, sanitizedEmails);
    }
  }

  /**
   * Attach existing recognized emails to authors
   */
  attachAuthorEmails(): void {
    this.attachEmails(this.fullAuthors);
  }

  /**
   * Attach existing recognized emails to editors
   */
  attachEditorEmails(): void {
    this.attachEmails(this.fullEditors);
  }

  /**
   * Attach existing recognized affiliations to authors
   */
  attachAffiliations(): void {
    if (this.fullAffiliations === null) {
      return;
    }

    if (this.fullAuthors === null) {
      return;
    }
    const nbAffiliations = this.fullAffiliations.length;
    const nbAuthors = this.fullAuthors.length;

    let hasMarker = false;

    // do we have markers in the affiliations?
    for (const aff of this.fullAffiliations) {
      if (aff.getMarker() !== null) {
        hasMarker = true;
        break;
      }
    }

    if (nbAffiliations === 1) {
      // we distribute this affiliation to each author
      const aff = this.fullAffiliations[0]!;
      for (const aut of this.fullAuthors) {
        aut.addAffiliation(aff);
      }
      aff.setFailAffiliation(false);
    } else if ((nbAuthors === 1) && (nbAffiliations > 1)) {
      // we put all the affiliations to the single author
      const auth = this.fullAuthors[0]!;
      for (const aff of this.fullAffiliations) {
        auth.addAffiliation(aff);
        aff.setFailAffiliation(false);
      }
    } else if (hasMarker) {
      // we get the marker for each affiliation and try to find the related author in the
      // original author field
      let indexAffiliation = 0;
      for (const aff of this.fullAffiliations) {

        // circuit breaker
        if (indexAffiliation > 60)
          break;

        if (aff.getMarker() !== null && aff.getMarker()!.length > 0) {
          const marker = aff.getMarker()!;
          let from = 0;
          let ind = 0;
          const winners: number[] = [];
          while (ind !== -1) {
            ind = this.originalAuthors!.indexOf(marker, from);

            let bad = false;
            if (ind !== -1) {
              // we check if we have a digit/letter (1) matching incorrectly
              //  a double digit/letter (11), or a special non-digit (*) matching incorrectly
              //  a double special non-digit (**)
              if (marker.length === 1) {
                if (isDigit(marker.charAt(0))) {
                  if (ind - 1 > 0) {
                    if (isDigit(this.originalAuthors!.charAt(ind - 1))) {
                      bad = true;
                    }
                  }
                  if (ind + 1 < this.originalAuthors!.length) {
                    if (isDigit(this.originalAuthors!.charAt(ind + 1))) {
                      bad = true;
                    }
                  }
                } else if (isLetter(marker.charAt(0))) {
                  if (ind - 1 > 0) {
                    if (isLetter(this.originalAuthors!.charAt(ind - 1))) {
                      bad = true;
                    }
                  }
                  if (ind + 1 < this.originalAuthors!.length) {
                    if (isLetter(this.originalAuthors!.charAt(ind + 1))) {
                      bad = true;
                    }
                  }
                } else if (marker.charAt(0) === "*") {
                  if (ind - 1 > 0) {
                    if (this.originalAuthors!.charAt(ind - 1) === "*") {
                      bad = true;
                    }
                  }
                  if (ind + 1 < this.originalAuthors!.length) {
                    if (this.originalAuthors!.charAt(ind + 1) === "*") {
                      bad = true;
                    }
                  }
                }
              }
              if (marker.length === 2) {
                // case with ** as marker
                if ((marker.charAt(0) === "*") && (marker.charAt(1) === "*")) {
                  if (ind - 2 > 0) {
                    if ((this.originalAuthors!.charAt(ind - 1) === "*") &&
                      (this.originalAuthors!.charAt(ind - 2) === "*")) {
                      bad = true;
                    }
                  }
                  if (ind + 2 < this.originalAuthors!.length) {
                    if ((this.originalAuthors!.charAt(ind + 1) === "*") &&
                      (this.originalAuthors!.charAt(ind + 2) === "*")) {
                      bad = true;
                    }
                  }
                  if ((ind - 1 > 0) && (ind + 1 < this.originalAuthors!.length)) {
                    if ((this.originalAuthors!.charAt(ind - 1) === "*") &&
                      (this.originalAuthors!.charAt(ind + 1) === "*")) {
                      bad = true;
                    }
                  }
                }
              }
            }

            if ((ind !== -1) && !bad) {
              // we find the associated author name
              const original = this.originalAuthors!.toLowerCase();
              let p = 0;
              let best = -1;
              let ind2 = -1;
              let bestDistance = 1000;
              for (const aut of this.fullAuthors) {
                if (!winners.includes(p)) {
                  let lastname = aut.getLastName();

                  if (lastname !== null) {
                    lastname = lastname.toLowerCase();
                    ind2 = original.indexOf(lastname, ind2 + 1);
                    const dist = Math.abs(ind - (ind2 + lastname.length));
                    if (dist < bestDistance) {
                      best = p;
                      bestDistance = dist;
                    }
                  }
                }
                p++;
              }

              // and we associate this affiliation to this author
              if (best !== -1) {
                this.fullAuthors[best]!.addAffiliation(aff);
                aff.setFailAffiliation(false);
                winners.push(best);
              }

              from = ind + 1;
            }
            if ((ind !== -1) && bad) {
              from = ind + 1;
              bad = false;
            }

            // circuit breaker
            if (ind > this.originalAuthors!.length || ind > 1000)
              break;
          }
        }
        indexAffiliation++;
      }
    } /*else if (nbAuthors == nbAffiliations) {
        // risky heuristics, we distribute in this case one affiliation per author
        // preserving author
        // sometimes 2 affiliations belong both to 2 authors, for these case, the layout
        // positioning should be studied
        for (int p = 0; p < nbAuthors; p++) {
            fullAuthors.get(p).addAffiliation(fullAffiliations.get(p));
            System.out.println("attachment: " + p);
            System.out.println(fullAuthors.get(p));
            fullAffiliations.get(p).setFailAffiliation(false);
        }
    }*/
  }

  /**
   * Create the TEI encoding for the author+affiliation block for the current biblio object.
   */
  toTEIAuthorBlock(nbTag: number): string;
  toTEIAuthorBlock(nbTag: number, config: GrobidAnalysisConfig | null): string;
  toTEIAuthorBlock(nbTag: number, config?: GrobidAnalysisConfig | null): string {
    if (config === undefined) {
      return this.toTEIAuthorBlock(nbTag, GrobidAnalysisConfig.defaultInstance());
    }
    const tei: string[] = [];
    let nbAuthors = 0;
    let nbAffiliations = 0;
    const nbAddresses = 0;

    let withCoordinates = false;
    if (config !== null && config.getGenerateTeiCoordinates() !== null && config.getGenerateTeiCoordinates() !== undefined) {
      withCoordinates = (config.getGenerateTeiCoordinates() as string[]).includes("persName");
    }

    if ((this.collaboration !== null) &&
      ((this.fullAuthors === null) || (this.fullAuthors.length === 0))) {
      // collaboration plays at the same time the role of author and affiliation
      TextUtilities.appendN(tei, "\t", nbTag);
      tei.push("<author>" + "\n");
      TextUtilities.appendN(tei, "\t", nbTag + 1);
      tei.push("<orgName type=\"collaboration\"");
      if (withCoordinates && (this.labeledTokens !== null)) {
        const collabTokens = this.labeledTokens.get("<collaboration>");
        if (withCoordinates && (collabTokens !== undefined) && (collabTokens.length !== 0)) {
          tei.push(" coords=\"" + LayoutTokensUtil.getCoordsString(collabTokens) + "\"");
        }
      }
      tei.push(">" + TextUtilities.HTMLEncode(this.collaboration) + "</orgName>" + "\n");
      TextUtilities.appendN(tei, "\t", nbTag);
      tei.push("</author>" + "\n");
      return tei.join("");
    }

    const auts = this.fullAuthors;

    const lexicon = Lexicon.getInstance();

    const affs = this.fullAffiliations;
    if (affs === null)
      nbAffiliations = 0;
    else
      nbAffiliations = affs.length;

    if (auts === null)
      nbAuthors = 0;
    else
      nbAuthors = auts.length;
    let failAffiliation = true;

    // upstream declares `nbAuthors` and `nbAffiliations` but only one branch
    // reads them — preserved verbatim.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _suppressUnused = nbAuthors + nbAffiliations;

    //if (getAuthors() != null) {
    if (auts !== null) {
      failAffiliation = false;
      if (nbAuthors > 0) {
        let autRank = 0;
        let contactAut = -1;
        //check if we have a single author of contact
        for (const author of auts) {
          if (author.getEmail() !== null) {
            if (contactAut === -1)
              contactAut = autRank;
            else {
              contactAut = -1;
              break;
            }
          }
          autRank++;
        }
        autRank = 0;
        for (const author of auts) {
          if (author.getLastName() !== null) {
            if (author.getLastName()!.length < 2)
              continue;
          }

          if ((author.getFirstName() === null) && (author.getMiddleName() === null) &&
            (author.getLastName() === null)) {
            continue;
          }

          TextUtilities.appendN(tei, "\t", nbTag);
          tei.push("<author");

          if (autRank === contactAut) {
            tei.push(" role=\"corresp\">\n");
          } else
            tei.push(">\n");

          TextUtilities.appendN(tei, "\t", nbTag + 1);

          let localString = author.toTEI(withCoordinates)!;
          localString = localString.replace(" xmlns=\"http://www.tei-c.org/ns/1.0\"", "");
          tei.push(localString + "\n");
          if (author.getEmail() !== null) {
            TextUtilities.appendN(tei, "\t", nbTag + 1);
            tei.push("<email>" + TextUtilities.HTMLEncode(author.getEmail()) + "</email>\n");
          }
          if (author.getORCID() !== null) {
            TextUtilities.appendN(tei, "\t", nbTag + 1);
            tei.push("<idno type=\"ORCID\">" + TextUtilities.HTMLEncode(author.getORCID()) + "</idno>\n");
          }

          if (author.getAffiliations() !== null) {
            for (const aff of author.getAffiliations()!) {
              this._appendAffiliation(tei, nbTag + 1, aff, config, lexicon);
            }
          } else if (this.collaboration !== null) {
            TextUtilities.appendN(tei, "\t", nbTag + 1);
            tei.push("<affiliation>\n");

            TextUtilities.appendN(tei, "\t", nbTag + 2);
            tei.push("<orgName type=\"collaboration\">" +
              TextUtilities.HTMLEncode(this.collaboration) + "</orgName>\n");
            TextUtilities.appendN(tei, "\t", nbTag + 1);
            tei.push("</affiliation>\n");
          }

          TextUtilities.appendN(tei, "\t", nbTag);
          tei.push("</author>\n");
          autRank++;
        }
      }
    }

    // upstream declares `failAffiliation` but never reads it after the writes — preserved.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _suppressFailAff = failAffiliation;

    // if the affiliations were not outputted with the authors, we add them here
    // (better than nothing!)
    if (affs !== null) {
      for (const aff of affs) {
        if (aff.getFailAffiliation()) {
          // dummy <author> for TEI conformance
          TextUtilities.appendN(tei, "\t", nbTag);
          tei.push("<author>\n");
          this._appendAffiliation(tei, nbTag + 1, aff, config, lexicon);
          TextUtilities.appendN(tei, "\t", nbTag);
          tei.push("</author>\n");
        }
      }
    } else if (this.affiliation !== null) {
      const affParts = this.affiliation.split(";").filter((t) => t.length > 0);
      let affiliationRank = 0;
      for (const aff of affParts) {
        TextUtilities.appendN(tei, "\t", nbTag);
        tei.push("<author>\n");
        TextUtilities.appendN(tei, "\t", nbTag + 1);
        tei.push("<affiliation>\n");
        TextUtilities.appendN(tei, "\t", nbTag + 2);
        tei.push("<orgName>" + TextUtilities.HTMLEncode(aff) + "</orgName>\n");
        if (nbAddresses === nbAffiliations) {
          let addressRank = 0;
          if (this.address !== null) {
            const addrParts = this.address.split(";").filter((t) => t.length > 0);
            for (const add of addrParts) {
              if (addressRank === affiliationRank) {
                TextUtilities.appendN(tei, "\t", nbTag + 2);
                tei.push("<address><addrLine>" + TextUtilities.HTMLEncode(add)
                  + "</addrLine></address>\n");
                break;
              }
              addressRank++;
            }
          }
        }
        TextUtilities.appendN(tei, "\t", nbTag + 1);
        tei.push("</affiliation>\n");

        TextUtilities.appendN(tei, "\t", nbTag);
        tei.push("</author>\n");

        affiliationRank++;
      }
    }
    return tei.join("");
  }

  private _appendAffiliation(
    tei: string[],
    nbTag: number,
    aff: Affiliation,
    config: GrobidAnalysisConfig | null,
    lexicon: Lexicon,
  ): void {
    const coordsList = config !== null ? config.getGenerateTeiCoordinates() : null;
    const affiliationWithCoords: boolean = (config !== null) &&
      (coordsList !== null && coordsList !== undefined) &&
      coordsList.includes("affiliation");
    // upstream declares `orgnameWithCoords` but never reads it — preserved.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const orgnameWithCoords: boolean = (config !== null) &&
      (coordsList !== null && coordsList !== undefined) &&
      coordsList.includes("orgName");

    TextUtilities.appendN(tei, "\t", nbTag);
    tei.push("<affiliation");
    if (aff.getKey() !== null)
      tei.push(" key=\"" + aff.getKey() + "\"");
    if (affiliationWithCoords) {
      // we serialize the coordinates for the whole affiliation block
      const layoutToks = aff.getLayoutTokens();
      const coords = layoutToks !== null ? LayoutTokensUtil.getCoordsString(layoutToks) : null;
      if (coords !== null && coords.length > 0) {
        tei.push(" coords=\"" + coords + "\"");
      }
    }
    tei.push(">\n");

    if (
      config !== null &&
      config.getIncludeRawAffiliations() &&
      !isEmptyStr(aff.getRawAffiliationString())
    ) {
      TextUtilities.appendN(tei, "\t", nbTag + 1);
      const encodedRawAffiliationString = TextUtilities.HTMLEncode(
        aff.getRawAffiliationString()
      )!;
      tei.push("<note type=\"raw_affiliation\">");
      LOGGER.debug("marker: {}", aff.getMarker());
      if (isNotEmptyStr(aff.getMarker())) {
        tei.push("<label>");
        tei.push(TextUtilities.HTMLEncode(aff.getMarker())!);
        tei.push("</label> ");
      }
      tei.push(encodedRawAffiliationString);
      tei.push("</note>\n");
    }

    if (aff.getDepartments() !== null) {
      if (aff.getDepartments()!.length === 1) {
        TextUtilities.appendN(tei, "\t", nbTag + 1);
        tei.push("<orgName type=\"department\">" +
          TextUtilities.HTMLEncode(aff.getDepartments()![0]!) + "</orgName>\n");
      } else {
        let q = 1;
        for (const depa of aff.getDepartments()!) {
          TextUtilities.appendN(tei, "\t", nbTag + 1);
          tei.push("<orgName type=\"department\" key=\"dep" + q + "\"");
          tei.push(">" + TextUtilities.HTMLEncode(depa) + "</orgName>\n");
          q++;
        }
      }
    }

    if (aff.getLaboratories() !== null) {
      if (aff.getLaboratories()!.length === 1) {
        TextUtilities.appendN(tei, "\t", nbTag + 1);
        tei.push("<orgName type=\"laboratory\">" +
          TextUtilities.HTMLEncode(aff.getLaboratories()![0]!) + "</orgName>\n");
      } else {
        let q = 1;
        for (const labo of aff.getLaboratories()!) {
          TextUtilities.appendN(tei, "\t", nbTag + 1);
          tei.push("<orgName type=\"laboratory\" key=\"lab" + q + "\">" +
            TextUtilities.HTMLEncode(labo) + "</orgName>\n");
          q++;
        }
      }
    }

    if (aff.getInstitutions() !== null) {
      if (aff.getInstitutions()!.length === 1) {
        TextUtilities.appendN(tei, "\t", nbTag + 1);
        tei.push("<orgName type=\"institution\">" +
          TextUtilities.HTMLEncode(aff.getInstitutions()![0]!) + "</orgName>\n");
      } else {
        let q = 1;
        for (const inst of aff.getInstitutions()!) {
          TextUtilities.appendN(tei, "\t", nbTag + 1);
          tei.push("<orgName type=\"institution\" key=\"instit" + q + "\">" +
            TextUtilities.HTMLEncode(inst) + "</orgName>\n");
          q++;
        }
      }
    }

    if (
      aff.getAddrLine() !== null ||
      aff.getPostBox() !== null ||
      aff.getPostCode() !== null ||
      aff.getSettlement() !== null ||
      aff.getRegion() !== null ||
      aff.getCountry() !== null
    ) {
      TextUtilities.appendN(tei, "\t", nbTag + 1);

      tei.push("<address>\n");
      /*if (aff.getAddressString() != null) {
          TextUtilities.appendN(tei, '\t', nbTag + 2);
          tei.append("<addrLine>" + TextUtilities.HTMLEncode(aff.getAddressString()) +
                  "</addrLine>\n");
      }*/
      if (aff.getAddrLine() !== null) {
        TextUtilities.appendN(tei, "\t", nbTag + 2);
        tei.push("<addrLine>" + TextUtilities.HTMLEncode(aff.getAddrLine()) +
          "</addrLine>\n");
      }
      if (aff.getPostBox() !== null) {
        TextUtilities.appendN(tei, "\t", nbTag + 2);
        tei.push("<postBox>" + TextUtilities.HTMLEncode(aff.getPostBox()) +
          "</postBox>\n");
      }
      if (aff.getPostCode() !== null) {
        TextUtilities.appendN(tei, "\t", nbTag + 2);
        tei.push("<postCode>" + TextUtilities.HTMLEncode(aff.getPostCode()) +
          "</postCode>\n");
      }
      if (aff.getSettlement() !== null) {
        TextUtilities.appendN(tei, "\t", nbTag + 2);
        tei.push("<settlement>" + TextUtilities.HTMLEncode(aff.getSettlement()) +
          "</settlement>\n");
      }
      if (aff.getRegion() !== null) {
        TextUtilities.appendN(tei, "\t", nbTag + 2);
        tei.push("<region>" + TextUtilities.HTMLEncode(aff.getRegion()) +
          "</region>\n");
      }
      if (aff.getCountry() !== null) {
        const code = lexicon.getCountryCode(aff.getCountry()!);
        TextUtilities.appendN(tei, "\t", nbTag + 2);
        tei.push("<country");
        if (code !== null && code !== undefined)
          tei.push(" key=\"" + code + "\"");
        tei.push(">" + TextUtilities.HTMLEncode(aff.getCountry()) +
          "</country>\n");
      }

      TextUtilities.appendN(tei, "\t", nbTag + 1);
      tei.push("</address>\n");
    }

    TextUtilities.appendN(tei, "\t", nbTag);
    tei.push("</affiliation>\n");
  }

  // Page-normalization regex constants, preserved verbatim from upstream.
  // The `volatile` Java fields become plain `static readonly` in TS.
  private static readonly possiblePreFixPageNumber: string = "[A-Ze]?";
  private static readonly possiblePostFixPageNumber: string = "[A-Z]?";
  private static readonly page: RegExp = new RegExp("(" + BiblioItem.possiblePreFixPageNumber + "\\d+" + BiblioItem.possiblePostFixPageNumber + ")", "g");
  private static readonly pageDigits: RegExp = /\d+/g;

  /**
   * Try to normalize the page range, which can be expressed in abbreviated forms and with letter prefix.
   */
  postProcessPages(): void {
    if (this.pageRange !== null) {
      // Java `matcher.find()` walks position-by-position; we use exec on a stateful regex.
      const pageRe = new RegExp(BiblioItem.page.source, "g");
      let m: RegExpExecArray | null = pageRe.exec(this.pageRange);
      if (m !== null) {

        // below for the string form of the page numbers
        let firstPage: string | null = null;
        let lastPage: string | null = null;

        // alphaPrefix or alphaPostfix are for storing possible alphabetical prefix or postfix to page number,
        // e.g. "L" in Smith, G. P., Mazzotta, P., Okabe, N., et al. 2016, MNRAS, 456, L74
        // or "D" in  "Am J Cardiol. 1999, 83:143D-150D. 10.1016/S0002-9149(98)01016-9"
        let alphaPrefixStart: string | null = null;
        let alphaPrefixEnd: string | null = null;
        // upstream declares `alphaPostfixStart` and reads it inside branches — kept.
        let alphaPostfixStart: string | null = null;
        let alphaPostfixEnd: string | null = null;

        // below for the integer form of the page numbers (part in case alphaPrefix is not null)
        let beginPage = -1;
        let endPage = -1;

        if (m.length - 1 > 0) {
          firstPage = m[0]!;
        }

        if (firstPage !== null) {
          try {
            beginPage = Number.parseInt(firstPage, 10);
            if (Number.isNaN(beginPage)) beginPage = -1;
          } catch {
            beginPage = -1;
          }
          if (beginPage !== -1) {
            this.pageRange = "" + beginPage;
          } else {
            this.pageRange = firstPage;

            // try to get the numerical part of the page number, useful for later
            const matcher2 = firstPage.match(BiblioItem.pageDigits);
            if (matcher2 !== null) {
              try {
                beginPage = Number.parseInt(matcher2[0]!, 10);
                if (Number.isNaN(beginPage)) beginPage = -1;
                if (firstPage.length > 0) {
                  alphaPrefixStart = firstPage.substring(0, 1);
                  // is it really alphabetical character?
                  if (!new RegExp("^" + BiblioItem.possiblePreFixPageNumber + "$").test(alphaPrefixStart)) {
                    alphaPrefixStart = null;
                    // look at postfix
                    alphaPostfixStart = firstPage.substring(firstPage.length - 1, firstPage.length);
                    if (!new RegExp("^" + BiblioItem.possiblePostFixPageNumber + "$").test(alphaPostfixStart)) {
                      alphaPostfixStart = null;
                    }
                  }
                }
              } catch {
                beginPage = -1;
              }
            }
          }

          // upstream declares but never re-reads `alphaPrefixStart` / `alphaPostfixStart`
          // outside the branches above — preserved as dead writes.
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const _suppressAlpha1 = alphaPrefixStart;
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const _suppressAlpha2 = alphaPostfixStart;

          m = pageRe.exec(this.pageRange);
          if (m !== null) {
            if (m.length - 1 > 0) {
              lastPage = m[0]!;
            }

            if (lastPage !== null) {
              try {
                endPage = Number.parseInt(lastPage, 10);
                if (Number.isNaN(endPage)) endPage = -1;
              } catch {
                endPage = -1;
              }

              if (endPage === -1) {
                // try to get the numerical part of the page number, to be used for later
                const matcher2 = lastPage.match(BiblioItem.pageDigits);
                if (matcher2 !== null) {
                  try {
                    endPage = Number.parseInt(matcher2[0]!, 10);
                    if (Number.isNaN(endPage)) endPage = -1;
                    if (lastPage.length > 0) {
                      alphaPrefixEnd = lastPage.substring(0, 1);
                      // is it really alphabetical character?
                      if (!new RegExp("^" + BiblioItem.possiblePreFixPageNumber + "$").test(alphaPrefixEnd)) {
                        alphaPrefixEnd = null;
                        // look at postfix
                        alphaPostfixEnd = lastPage.substring(lastPage.length - 1, lastPage.length);
                        if (!new RegExp("^" + BiblioItem.possiblePostFixPageNumber + "$").test(alphaPostfixEnd)) {
                          alphaPostfixEnd = null;
                        }
                      }
                    }
                  } catch {
                    endPage = -1;
                  }
                }
              }

              if ((endPage !== -1) && (endPage < beginPage)) {
                // there are two possibilities:
                // - the substitution, e.g. 433–8 -> 433--438, for example American Medical Association citation style
                // - the addition, e.g. 433–8 -> 433--441
                // unfortunately, it depends on the citation style

                // we try to guess/refine the re-composition of pages

                if (endPage >= 50) {
                  // we assume no journal articles have more than 49 pages and is expressed as addition,
                  // so it's a substitution
                  const upperBound = firstPage.length - lastPage.length;
                  if (upperBound < firstPage.length && upperBound > 0)
                    lastPage = firstPage.substring(0, upperBound) + lastPage;
                  this.pageRange += "--" + lastPage;
                } else {
                  if (endPage < 10) {
                    // case 1 digit for endPage

                    // last digit of begin page
                    const lastDigitBeginPage = beginPage % 10;

                    // if digit of lastPage lower than last digit of beginPage, it's an addition for sure
                    if (endPage < lastDigitBeginPage)
                      endPage = beginPage + endPage;
                    else {
                      // otherwise defaulting to substitution
                      endPage = beginPage - lastDigitBeginPage + endPage;
                    }
                  } else if (endPage < 50) {
                    // case 2 digit for endPage, we apply a similar heuristics
                    const lastDigitBeginPage = beginPage % 100;
                    if (endPage < lastDigitBeginPage)
                      endPage = beginPage + endPage;
                    else {
                      // otherwise defaulting to substitution
                      endPage = beginPage - lastDigitBeginPage + endPage;
                    }
                  }

                  // we assume there is no article of more than 99 pages expressed in this abbreviated way
                  // (which are for journal articles only, so short animals)

                  if (alphaPrefixEnd !== null)
                    this.pageRange += "--" + alphaPrefixEnd + endPage;
                  else if (alphaPostfixEnd !== null)
                    this.pageRange += "--" + endPage + alphaPostfixEnd;
                  else
                    this.pageRange += "--" + endPage;
                }
              } else if ((endPage !== -1)) {
                if (alphaPrefixEnd !== null)
                  this.pageRange += "--" + alphaPrefixEnd + endPage;
                else if (alphaPostfixEnd !== null)
                  this.pageRange += "--" + endPage + alphaPostfixEnd;
                else
                  this.pageRange += "--" + lastPage;
              } else {
                this.pageRange += "--" + lastPage;
              }
            }
          }
        }
      }
    }
  }

  /**
   * Correct/add identifiers of the first biblio item based on the second one
   */
  static injectIdentifiers(destination: BiblioItem, source: BiblioItem): void {
    destination.setDOI(source.getDOI());
    // optionally associated strong identifiers are also injected
    destination.setPMID(source.getPMID());
    destination.setPMCID(source.getPMCID());
    destination.setPII(source.getPII());
    destination.setIstexId(source.getIstexId());
    destination.setArk(source.getArk());
    destination.setHalId(source.getHalId());
  }

  /**
   * Correct fields of the first biblio item based on the second one and the reference string
   *
   * @param bib extracted from document
   * @param bibo fetched from metadata provider (biblioglutton, crossref..)
   */
  static correct(bib: BiblioItem, bibo: BiblioItem): void {
    //System.out.println("correct: \n" + bib.toTEI(0));
    //System.out.println("with: \n" + bibo.toTEI(0));
    if (bibo.getDOI() !== null)
      bib.setDOI(bibo.getDOI());
    if (bibo.getPMID() !== null)
      bib.setPMID(bibo.getPMID());
    if (bibo.getPMCID() !== null)
      bib.setPMCID(bibo.getPMCID());
    if (bibo.getPII() !== null)
      bib.setPII(bibo.getPII());
    if (bibo.getIstexId() !== null)
      bib.setIstexId(bibo.getIstexId());
    if (bibo.getArk() !== null)
      bib.setArk(bibo.getArk());
    if (bibo.getHalId() !== null)
      bib.setHalId(bibo.getHalId());

    if (bibo.getOAURL() !== null)
      bib.setOAURL(bibo.getOAURL());

    if (bibo.getJournal() !== null) {
      bib.setJournal(bibo.getJournal());
      // document type consistency (correction might change overall item type, and some
      // fields become unconsistent)
      if (bibo.getBookTitle() === null) {
        bib.setBookTitle(null);
      }
    }
    if (bibo.getAuthors() !== null)
      bib.setAuthors(bibo.getAuthors());
    if (bibo.getEditors() !== null)
      bib.setEditors(bibo.getEditors());
    if (bibo.getBookTitle() !== null) {
      bib.setBookTitle(bibo.getBookTitle());
      // document type consistency
      if (bibo.getJournal() === null) {
        bib.setJournal(null);
      }
    }
    if (bibo.getVolume() !== null)
      bib.setVolume(bibo.getVolume());
    if (bibo.getVolumeBlock() !== null)
      bib.setVolumeBlock(bibo.getVolumeBlock(), false);
    if (bibo.getIssue() !== null)
      bib.setIssue(bibo.getIssue());
    if (bibo.getBeginPage() !== -1)
      bib.setBeginPage(bibo.getBeginPage());
    if (bibo.getEndPage() !== -1)
      bib.setEndPage(bibo.getEndPage());
    if (bibo.getPageRange() !== null)
      bib.setPageRange(bibo.getPageRange());
    if (bibo.getPublicationDate() !== null)
      bib.setPublicationDate(bibo.getPublicationDate());
    if (bibo.getSubmissionDate() !== null)
      bib.setSubmissionDate(bibo.getSubmissionDate());
    if (bibo.getDownloadDate() !== null)
      bib.setDownloadDate(bibo.getDownloadDate());

    if (bibo.getNormalizedPublicationDate() !== null) {
      if (bib.getNormalizedPublicationDate() !== null) {
        bib.mergeNormalizedPublicationDate(bibo.getNormalizedPublicationDate()!);
      }
      else {
        bib.setNormalizedPublicationDate(bibo.getNormalizedPublicationDate());
      }
    }
    if (bibo.getYear() !== null)
      bib.setYear(bibo.getYear());
    if (bibo.getMonth() !== null)
      bib.setMonth(bibo.getMonth());
    if (bibo.getDay() !== null)
      bib.setDay(bibo.getDay());
    if (bibo.getE_Year() !== null)
      bib.setE_Year(bibo.getE_Year());
    if (bibo.getE_Month() !== null)
      bib.setE_Month(bibo.getE_Month());
    if (bibo.getE_Day() !== null)
      bib.setE_Day(bibo.getE_Day());
    if (bibo.getA_Year() !== null)
      bib.setA_Year(bibo.getA_Year());
    if (bibo.getA_Month() !== null)
      bib.setA_Month(bibo.getA_Month());
    if (bibo.getA_Day() !== null)
      bib.setA_Day(bibo.getA_Day());
    if (bibo.getS_Year() !== null)
      bib.setS_Year(bibo.getS_Year());
    if (bibo.getS_Month() !== null)
      bib.setS_Month(bibo.getS_Month());
    if (bibo.getS_Day() !== null)
      bib.setS_Day(bibo.getS_Day());

    if (bibo.getD_Year() !== null)
      bib.setD_Year(bibo.getD_Year());
    if (bibo.getD_Month() !== null)
      bib.setD_Month(bibo.getD_Month());
    if (bibo.getD_Day() !== null)
      bib.setD_Day(bibo.getD_Day());

    if (bibo.getLocation() !== null)
      bib.setLocation(bibo.getLocation());
    if (bibo.getPublisher() !== null)
      bib.setPublisher(bibo.getPublisher());
    if (bibo.getTitle() !== null) {
      bib.setTitle(bibo.getTitle());
    }
    if (bibo.getArticleTitle() !== null) {
      bib.setArticleTitle(bibo.getArticleTitle());
    }
    if (bibo.getJournalAbbrev() !== null) {
      bib.setJournalAbbrev(bibo.getJournalAbbrev());
    }
    if (bibo.getISSN() !== null)
      bib.setISSN(bibo.getISSN());
    if (bibo.getISSNe() !== null)
      bib.setISSNe(bibo.getISSNe());
    if (bibo.getISBN10() !== null)
      bib.setISBN10(bibo.getISBN10());
    if (bibo.getISBN13() !== null)
      bib.setISBN13(bibo.getISBN13());
    if (bibo.getHalId() !== null)
      bib.setHalId(bibo.getHalId());

    if (bibo.getItem() !== -1) {
      bib.setItem(bibo.getItem());
    }
    if (bibo.getCollaboration() !== null) {
      bib.setCollaboration(bibo.getCollaboration());
    }

    // authors present in fullAuthors list should be in the existing resources
    // at least the corresponding author
    if (!isCollectionEmpty(bibo.getFullAuthors())) {
      if (isCollectionEmpty(bib.getFullAuthors()))
        bib.setFullAuthors(bibo.getFullAuthors());
      else if (bibo.getFullAuthors()!.length === 1) {
        // we have the corresponding author
        // check if the author exists in the obtained list
        const auto = bibo.getFullAuthors()![0]!;
        const auts = bib.getFullAuthors();
        if (auts !== null) {
          for (const aut of auts) {
            if (isNotBlank(aut.getLastName()) && isNotBlank(auto.getLastName())) {
              if (aut.getLastName()!.toLowerCase() === auto.getLastName()!.toLowerCase()) {
                if (isBlank(aut.getFirstName()) ||
                  (auto.getFirstName() !== null &&
                    aut.getFirstName()!.length <= auto.getFirstName()!.length &&
                    auto.getFirstName()!.toLowerCase().startsWith(aut.getFirstName()!.toLowerCase()))) {
                  aut.setFirstName(auto.getFirstName());
                  aut.setCorresp(true);
                  if (isNotBlank(auto.getEmail()))
                    aut.setEmail(auto.getEmail());
                  // should we also check the country ? affiliation?
                  if (isNotBlank(auto.getMiddleName()) && (isBlank(aut.getMiddleName())))
                    aut.setMiddleName(auto.getMiddleName());
                  // crossref is considered more reliable than PDF annotations
                  aut.setORCID(auto.getORCID());
                }
              }
            }
          }
        }
      } else if (bibo.getFullAuthors()!.length > 1) {
        // we have the complete list of authors so we can take them from the second
        // biblio item and merge some possible extra from the first when a match is
        // reliable
        for (const aut of bibo.getFullAuthors()!) {
          // try to find the author in the first item (we know it's not empty)
          for (const aut2 of bib.getFullAuthors()!) {


            if (isNotBlank(aut2.getLastName())) {
              const aut2_lastname = aut2.getLastName()!.toLowerCase();

              if (isNotBlank(aut.getLastName())) {
                const aut_lastname = aut.getLastName()!.toLowerCase();

                if (aut_lastname === aut2_lastname) {
                  // check also first name if present - at least for the initial
                  if (isBlank(aut2.getFirstName()) ||
                    (isNotBlank(aut2.getFirstName()) && isNotBlank(aut.getFirstName()))) {
                    // we have no first name or a match (full first name)

                    if (isBlank(aut2.getFirstName())
                      ||
                      aut.getFirstName() === aut2.getFirstName()
                      ||
                      (aut.getFirstName()!.length === 1 &&
                        aut.getFirstName() === aut2.getFirstName()!.substring(0, 1))
                    ) {
                      // we have a match (full or initial)
                      if (isNotBlank(aut2.getFirstName()) &&
                        aut2.getFirstName()!.length > aut.getFirstName()!.length)
                        aut.setFirstName(aut2.getFirstName());
                      if (isBlank(aut.getMiddleName()))
                        aut.setMiddleName(aut2.getMiddleName());
                      if (isBlank(aut.getTitle()))
                        aut.setTitle(aut2.getTitle());
                      if (isBlank(aut.getSuffix()))
                        aut.setSuffix(aut2.getSuffix());
                      if (isBlank(aut.getEmail()))
                        aut.setEmail(aut2.getEmail());
                      if (!isCollectionEmpty(aut2.getAffiliations()))
                        aut.setAffiliations(aut2.getAffiliations());
                      if (!isCollectionEmpty(aut2.getAffiliationBlocks()))
                        aut.setAffiliationBlocks(aut2.getAffiliationBlocks());
                      if (!isCollectionEmpty(aut2.getAffiliationMarkers()))
                        aut.setAffiliationMarkers(aut2.getAffiliationMarkers());
                      if (!isCollectionEmpty(aut2.getMarkers()))
                        aut.setMarkers(aut2.getMarkers());
                      if (!isCollectionEmpty(aut2.getLayoutTokens()))
                        aut.setLayoutTokens(aut2.getLayoutTokens());
                      // preserve PDF-extracted ORCID when crossref doesn't have one
                      if (isBlank(aut.getORCID()) && isNotBlank(aut2.getORCID()))
                        aut.setORCID(aut2.getORCID());
                      break;
                    }
                  }
                }
              }
            }
          }
        }
        bib.setFullAuthors(bibo.getFullAuthors());
      }
    }
    bib.setStatus(bibo.getStatus());
    bib.setConsolidationService(bibo.getConsolidationService());
  }

  /**
   *  Check is the biblio item can be considered as a minimally valid bibliographical reference.
   *  A certain minimal number of core metadata have to be instanciated. Otherwise, the biblio
   *  item can be considered as "garbage" extracted incorrectly.
   */
  rejectAsReference(): boolean {
    let titleSet = true;
    if ((this.title === null) && (this.bookTitle === null) && (this.journal === null) &&
      (this.ISSN === null) && (this.ISBN13 === null) && (this.ISBN10 === null))
      titleSet = false;
    let authorSet = true;
    if (this.fullAuthors === null && this.collaboration === null)
      authorSet = false;
    // normally properties authors and authorList are null in the current Grobid version
    if (!titleSet && !authorSet && this.url === null && this.doi === null && this.halId === null)
      return true;
    else
      return false;
  }

  getTeiId(): string | null {
    return this.teiId;
  }

  getOrdinal(): number | null {
    return this.ordinal;
  }

  setOrdinal(ordinal: number): void {
    this.ordinal = ordinal;
  }

  setCoordinates(coordinates: BoundingBox[] | null): void {
    this.coordinates = coordinates;
  }

  getCoordinates(): BoundingBox[] | null {
    return this.coordinates;
  }

  getLabeledTokens(): Map<string, LayoutToken[]> | null {
    return this.labeledTokens;
  }

  setLabeledTokens(labeledTokens: Map<string, LayoutToken[]> | null): void {
    this.labeledTokens = labeledTokens;
  }

  /**
   * Returns the layout tokens stored for a given biblio label. Renamed from
   * the overloaded `getLayoutTokens` to avoid the structural clash with the
   * field-typed `LayoutToken[]` accessor used by the working-copy buffers.
   * Java overloads `getLayoutTokens(TaggingLabel)` separately; in TS we keep
   * both signatures but use a distinct internal helper name and dispatch.
   */
  getLayoutTokensForLabel(biblioLabel: TaggingLabel): LayoutToken[] | null {
    if (this.labeledTokens === null) {
      LOGGER.debug("labeledTokens is null");
      return null;
    }
    if (biblioLabel.getLabel() === null) {
      LOGGER.debug("biblioLabel.getLabel() is null");
      return null;
    }
    return this.labeledTokens.get(biblioLabel.getLabel()) ?? null;
  }

  setLayoutTokensForLabel(tokens: LayoutToken[], biblioLabel: TaggingLabel): void {
    if (this.labeledTokens === null)
      this.labeledTokens = new Map<string, LayoutToken[]>();
    this.labeledTokens.set(biblioLabel.getLabel(), tokens);
  }

  generalResultMappingHeader(labeledResult: string, tokenizations: LayoutToken[]): void {
    if (this.labeledTokens === null)
      this.labeledTokens = new Map<string, LayoutToken[]>();

    const clusteror = new TaggingTokenClusteror(GrobidModels.HEADER, labeledResult, tokenizations);
    const clusters = clusteror.cluster();
    for (const cluster of clusters) {
      if (cluster === null) {
        continue;
      }

      const clusterLabel = cluster.getTaggingLabel();
      const clusterTokens = cluster.concatTokens();
      let theList = this.labeledTokens.get(clusterLabel.getLabel());

      theList = theList === undefined ? [] : theList;
      for (const t of clusterTokens) theList.push(t);
      this.labeledTokens.set(clusterLabel.getLabel(), theList);

      if (clusterLabel === TaggingLabels.HEADER_AFFILIATION || clusterLabel === TaggingLabels.HEADER_ADDRESS) {
        if (this.affiliationAddresslabeledTokens === null)
          this.affiliationAddresslabeledTokens = [];
        if (!this.affiliationAddresslabeledTokens.includes(clusterTokens))
          this.affiliationAddresslabeledTokens.push(clusterTokens);
      }
    }
  }

  generalResultMappingReference(labeledResult: string, tokenizations: LayoutToken[]): void {
    if (this.labeledTokens === null)
      this.labeledTokens = new Map<string, LayoutToken[]>();

    const clusteror = new TaggingTokenClusteror(GrobidModels.CITATION, labeledResult, tokenizations);
    const clusters = clusteror.cluster();
    for (const cluster of clusters) {
      if (cluster === null) {
        continue;
      }

      const clusterLabel = cluster.getTaggingLabel();
      const clusterTokens = cluster.concatTokens();
      let theList = this.labeledTokens.get(clusterLabel.getLabel());

      theList = theList === undefined ? [] : theList;
      for (const t of clusterTokens) theList.push(t);
      this.labeledTokens.set(clusterLabel.getLabel(), theList);
    }
  }

  getAuthorsTokensWorkingCopy(): LayoutToken[] {
    return this.authorsTokensWorkingCopy;
  }

  getAbstractTokensWorkingCopy(): LayoutToken[] {
    return this.abstractTokensWorkingCopy;
  }

  getAvailabilityStmt(): string | null {
    return this.availabilityStmt;
  }

  setAvailabilityStmt(availabilityStmt: string | null): void {
    this.availabilityStmt = availabilityStmt;
  }

  getAffiliationAddresslabeledTokens(): LayoutToken[][] | null {
    return this.affiliationAddresslabeledTokens;
  }

  setCopyrightsLicense(copyrightsLicense: CopyrightsLicense | null): void {
    this.copyrightsLicense = copyrightsLicense;
  }

  getCopyrightsLicense(): CopyrightsLicense | null {
    return this.copyrightsLicense;
  }

  getDiscardedPieces(): string[] {
    return this.discardedPieces;
  }

  setDiscardedPieces(discardedPieces: string[]): void {
    this.discardedPieces = discardedPieces;
  }

  addDiscardedPiece(piece: string): void {
    this.discardedPieces.push(piece);
  }

  getDiscardedPiecesTokens(): LayoutToken[][] {
    return this.discardedPiecesTokens;
  }

  setDiscardedPiecesTokens(discardedPiecesTokens: LayoutToken[][]): void {
    this.discardedPiecesTokens = discardedPiecesTokens;
  }

  addDiscardedPieceTokens(pieceToken: LayoutToken[]): void {
    this.discardedPiecesTokens.push(pieceToken);
  }

  getStatus(): string {
    return this.status;
  }

  setStatus(status: string): void {
    this.status = status;
  }

  getConsolidationService(): string | null {
    return this.consolidationService;
  }

  setConsolidationService(consolidationService: string | null): void {
    this.consolidationService = consolidationService;
  }

  getConflictStmt(): string | null {
    return this.conflictStmt;
  }

  setConflictStmt(conflictStmt: string | null): void {
    this.conflictStmt = conflictStmt;
  }

  getContributionStmt(): string | null {
    return this.contributionStmt;
  }

  setContributionStmt(contributionStmt: string | null): void {
    this.contributionStmt = contributionStmt;
  }
}
