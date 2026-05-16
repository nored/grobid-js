// Port of org.grobid.core.sax.CrossrefUnixrefSaxParser.
// Upstream: grobid-core/src/main/java/org/grobid/core/sax/CrossrefUnixrefSaxParser.java
//
// SAX parser for XML crossref DOI metadata descriptions.
// See http://www.crossref.org/openurl_info.html

import { BiblioItem } from "../data/biblio-item.js";
import { parseSax, type SaxAttributes, type SaxHandler } from "./sax-walker.js";

/**
 * Upstream CrossrefUnixrefSaxParser.java line 16-355.
 */
export class CrossrefUnixrefSaxParser implements SaxHandler {
  // Upstream line 18-25.
  private biblio: BiblioItem | null = null;
  private biblioParent: BiblioItem | null = null;
  private biblios: BiblioItem[] | null = null;
  private authors: string[] | null = null;
  private editors: string[] | null = null;
  private author: string | null = null;
  private accumulator: string[] = [];
  private media: string | null = null;

  // Upstream line 27-28 / 30-32 / 34-36.
  constructor();
  constructor(b: BiblioItem);
  constructor(b: BiblioItem[]);
  constructor(b?: BiblioItem | BiblioItem[]) {
    if (b !== undefined) {
      if (Array.isArray(b)) {
        this.biblios = b;
      } else {
        this.biblio = b;
      }
    }
  }

  /** Drive the parser from an XML string. */
  parse(xml: string): void {
    parseSax(this, xml);
  }

  // Upstream line 38-52.
  journalMetadataBlock: boolean = false;
  journalIssueBlock: boolean = false;
  journalArticleBlock: boolean = false;
  conferencePaperBlock: boolean = false;
  proceedingsMetadataBlock: boolean = false;
  contentItemBlock: boolean = false;
  eventMetadataBlock: boolean = false;
  bookMetadataBlock: boolean = false;
  serieMetadataBlock: boolean = false;
  doiDataBlock: boolean = false;
  online: boolean = false;

  authorBlock: boolean = false;
  editorBlock: boolean = false;
  firstAuthor: boolean = false;

  // Upstream line 54-56.
  characters(ch: string, _start: number, _length: number): void {
    this.accumulator.push(ch);
  }

  // Upstream line 58-60.
  getText(): string {
    return this.accumulator.join("").trim();
  }

  // Upstream line 62-235.
  endElement(_uri: string, _localName: string, qName: string): void {
    if (qName === "journal_metadata") {
      this.journalMetadataBlock = false;
      this.biblio!.setItem(BiblioItem.Periodical);
    } else if (qName === "journal_issue") {
      this.journalIssueBlock = false;
      this.biblio!.setItem(BiblioItem.Periodical);
    } else if (qName === "journal_article") {
      this.journalArticleBlock = false;
      this.biblio!.setItem(BiblioItem.Article);
      // NOTE: upstream line 72 — `// biblio.setItem(BiblioItem.Periodical);` (commented-out).
    } else if (qName === "proceedings_metadata") {
      this.proceedingsMetadataBlock = false;
      this.biblio!.setItem(BiblioItem.InProceedings);
    } else if (qName === "content_item") {
      this.contentItemBlock = false;
    } else if (qName === "event_metadata") {
      this.eventMetadataBlock = false;
    } else if (qName === "conference_paper") {
      this.conferencePaperBlock = false;
      this.biblio!.setItem(BiblioItem.InProceedings);
    } else if (qName === "doi_data") {
      this.doiDataBlock = false;
    } else if (qName === "title") {
      if (this.journalArticleBlock || this.contentItemBlock || this.conferencePaperBlock) {
        this.biblio!.setArticleTitle(this.getText());
      } else if (this.serieMetadataBlock) {
        this.biblio!.setSerieTitle(this.getText());
      } else {
        this.biblio!.setTitle(this.getText());
      }
    } else if (qName === "full_title") {
      this.biblio!.setJournal(this.getText());
    } else if (qName === "abbrev_title") {
      this.biblio!.setJournalAbbrev(this.getText());
    } else if (qName === "issn") {
      const issn = this.getText();
      if (this.media !== null) {
        if (this.media === "print") this.biblio!.setISSN(issn);
        else this.biblio!.setISSNe(issn);
      } else {
        this.biblio!.setISSN(issn);
      }
    } else if (qName === "isbn") {
      this.biblio!.setISBN13(this.getText());
    } else if (qName === "volume") {
      const volume = this.getText();
      if (volume !== null) {
        if (volume.length > 0) {
          this.biblio!.setVolume(volume);
          this.biblio!.setVolumeBlock(volume, true);
        }
      }
    } else if (qName === "issue") {
      const issue = this.getText();
      // issue can be of the form 4-5
      if (issue !== null) {
        if (issue.length > 0) {
          this.biblio!.setNumber(issue);
          this.biblio!.setIssue(issue);
          // NOTE: upstream line 126 — `//biblio.setNumber(Integer.parseInt(issue));` (commented-out).
        }
      }
    } else if (qName === "year") {
      const year = this.getText();
      this.biblio!.setPublicationDate(year);
      if (this.online) this.biblio!.setE_Year(year);
      else this.biblio!.setYear(year);
    } else if (qName === "month") {
      const month = this.getText();
      if (this.online) this.biblio!.setE_Month(month);
      else this.biblio!.setMonth(month);
    } else if (qName === "day") {
      const day = this.getText();
      if (this.online) this.biblio!.setE_Day(day);
      else this.biblio!.setDay(day);
    } else if (qName === "first_page") {
      let page = this.getText();
      if (page !== null && page.length > 0) {
        // NOTE: upstream lines 150-152 — commented-out `L`/`l` prefix stripping
        // (the same effect is achieved by `cleanPage`).
        page = CrossrefUnixrefSaxParser.cleanPage(page);
        try {
          this.biblio!.setBeginPage(parseInt(page, 10));
          if (Number.isNaN(parseInt(page, 10))) throw new Error("NaN");
        } catch {
          // warning message to be logged here
        }
      }
    } else if (qName === "last_page") {
      let page = this.getText();
      if (page !== null && page.length > 0) {
        page = CrossrefUnixrefSaxParser.cleanPage(page);
        try {
          this.biblio!.setEndPage(parseInt(page, 10));
          if (Number.isNaN(parseInt(page, 10))) throw new Error("NaN");
        } catch {
          // warning message to be logged here
        }
      }
    } else if (qName === "doi") {
      const doi = this.getText();
      if (this.doiDataBlock) this.biblio!.setDOI(doi);
      this.biblio!.setError(false);
    } else if (qName === "given_name") {
      this.author = this.getText();
    } else if (qName === "surname") {
      const sauce = this.getText();
      if (sauce !== "Unknown") {
        if (this.author === null) this.author = sauce;
        else this.author = this.author + " " + sauce;
        this.authors!.push(this.author);
        if (this.authorBlock) this.biblio!.addAuthor(this.author);
        else if (this.editorBlock) this.biblio!.addEditor(this.author);
        this.author = null;
      }
    } else if (qName === "person_name") {
      this.firstAuthor = false;
      this.authorBlock = false;
    } else if (qName === "conference_name") {
      const event = this.getText();
      this.biblio!.setEvent(event);
      this.biblio!.setItem(BiblioItem.InProceedings);
    } else if (qName === "conference_location") {
      const location = this.getText();
      this.biblio!.setLocation(location);
      this.biblio!.setItem(BiblioItem.InProceedings);
    } else if (qName === "conference_acronym") {
      const acro = this.getText();
      if (this.biblio!.getEvent() === null) this.biblio!.setEvent(acro);
      else this.biblio!.setEvent(this.biblio!.getEvent() + ", " + acro);
      this.biblio!.setItem(BiblioItem.InProceedings);
    } else if (qName === "proceedings_title") {
      let proc: string | null = this.getText();
      if (proc !== null) proc = proc.replace(/ - /g, ", ");
      this.biblio!.setBookTitle(proc);
      this.biblio!.setItem(BiblioItem.InProceedings);
    } else if (qName === "doi_record") {
      if (this.biblios !== null) {
        this.biblios.push(this.biblio!);
        this.biblio = null;
      }
    } else if (qName === "publisher_name") {
      const publisher = this.getText();
      this.biblio!.setPublisher(publisher);
    } else if (qName === "publisher_place") {
      const location = this.getText();
      this.biblio!.setLocationPublisher(location);
    } else if (qName === "series_metadata") {
      this.serieMetadataBlock = false;
      this.biblio!.setItem(BiblioItem.InCollection);
    } else if (qName === "book_metadata") {
      this.bookMetadataBlock = false;
      this.biblio!.setItem(BiblioItem.InBook);
    }
    this.accumulator = [];
  }

  // Upstream line 237-348.
  startElement(_namespaceURI: string, _localName: string, qName: string, atts: SaxAttributes): void {
    if (qName === "journal_metadata") {
      this.journalMetadataBlock = true;
      this.biblio!.setItem(BiblioItem.Periodical);
    } else if (qName === "proceedings_metadata") {
      this.proceedingsMetadataBlock = true;
      this.biblio!.setItem(BiblioItem.InProceedings);
    } else if (qName === "book_metadata") {
      this.bookMetadataBlock = true;
      this.biblio!.setItem(BiblioItem.InBook);
    } else if (qName === "series_metadata") {
      this.serieMetadataBlock = true;
      if (this.bookMetadataBlock) this.biblio!.setItem(BiblioItem.InCollection);
    } else if (qName === "content_item") {
      const biblio2 = new BiblioItem();
      biblio2.setParentItem(this.biblio);
      this.biblio = biblio2;
      this.contentItemBlock = true;
    } else if (qName === "event_metadata") {
      this.eventMetadataBlock = true;
    } else if (qName === "conference_paper") {
      this.conferencePaperBlock = true;
      this.biblio!.setItem(BiblioItem.InProceedings);
    } else if (qName === "journal_issue") {
      this.journalIssueBlock = true;
      this.biblio!.setItem(BiblioItem.Periodical);
    } else if (qName === "journal_article") {
      this.journalArticleBlock = true;
      this.biblio!.setItem(BiblioItem.Periodical);
    } else if (qName === "doi_data") {
      this.doiDataBlock = true;
    } else if (qName === "contributors") {
      this.authors = [];
      this.editors = [];
    } else if (qName === "error") {
      this.biblio!.setError(true);
    } else if (qName === "person_name") {
      const length = atts.getLength();
      for (let i = 0; i < length; i++) {
        const name = atts.getQName(i);
        const value = atts.getValue(i);
        // NOTE: upstream line 287 — `(name != null) & (value != null)` uses
        // bitwise `&` instead of logical `&&`. Preserved verbatim.
        if ((name !== null) && (value !== null)) {
          if (name === "sequence") {
            if (value === "firstAuthor") this.firstAuthor = true;
            else this.firstAuthor = false;
          }
          if (name === "contributor_role") {
            if (value === "author") {
              this.authorBlock = true;
              this.editorBlock = true;
            } else if (value === "editor") {
              this.authorBlock = false;
              this.editorBlock = true;
            } else {
              this.authorBlock = false;
              this.editorBlock = false;
            }
          }
        }
      }
    } else if (qName === "doi_record") {
      if (this.biblios !== null) {
        this.biblio = new BiblioItem();
      }
    } else if (qName === "publication_date") {
      const length = atts.getLength();
      for (let i = 0; i < length; i++) {
        const name = atts.getQName(i);
        const value = atts.getValue(i);
        if ((name !== null) && (value !== null)) {
          if (name === "media_type") {
            if (value === "online") this.online = true;
            else this.online = false;
          }
        }
      }
    } else if (qName === "issn") {
      const length = atts.getLength();
      for (let i = 0; i < length; i++) {
        const name = atts.getQName(i);
        const value = atts.getValue(i);
        if ((name !== null) && (value !== null)) {
          if (name === "media_type") {
            this.media = value;
          }
        }
      }
    }
    this.accumulator = [];
  }

  // Upstream line 350-352 — strip leading "L"/"l" characters (StringUtils.stripStart).
  protected static cleanPage(page: string): string {
    let i = 0;
    while (i < page.length && (page.charAt(i) === "L" || page.charAt(i) === "l")) {
      i++;
    }
    return page.substring(i);
  }
}
