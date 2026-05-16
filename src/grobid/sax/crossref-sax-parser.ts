// Port of org.grobid.core.sax.CrossrefSaxParser.
// Upstream: grobid-core/src/main/java/org/grobid/core/sax/CrossrefSaxParser.java
//
// SAX parser for XML crossref DOI metadata descriptions.
// See http://www.crossref.org/openurl_info.html
//
// NOTE: upstream comment lines 14-15 — "This is not used anymore, we use the
// JSON REST API from CrossRef or from biblio-glutton, und das ist auch gut so."

import { BiblioItem } from "../data/biblio-item.js";
import { parseSax, type SaxAttributes, type SaxHandler } from "./sax-walker.js";

/**
 * Upstream CrossrefSaxParser.java line 18-107.
 */
export class CrossrefSaxParser implements SaxHandler {
  // Upstream line 20-22.
  private biblio: BiblioItem | null = null;
  private author: string | null = null;
  private text: string[] = [];

  // Upstream line 24-25 / 27-29.
  constructor();
  constructor(b: BiblioItem);
  constructor(b?: BiblioItem) {
    if (b !== undefined) {
      this.biblio = b;
    }
  }

  /** Drive the parser from an XML string. */
  parse(xml: string): void {
    parseSax(this, xml);
  }

  // Upstream line 31-34.
  characters(ch: string, _start: number, _length: number): void {
    // Upstream: `text.reset(); text.write(ch, start, length);` — note the
    // reset on every chunk, so only the last text run survives. Preserved
    // verbatim (likely a bug but kept for fidelity).
    this.text = [];
    this.text.push(ch);
  }

  // Upstream line 36-39.
  getText(): string {
    // eslint-disable-next-line no-console
    console.log(this.text.join(""));
    return this.text.join("").trim();
  }

  // Upstream line 41-95.
  endElement(_uri: string, _localName: string, qName: string): void {
    // eslint-disable-next-line no-console
    console.log(qName);
    if (qName === "article_title") {
      this.biblio!.setArticleTitle(this.getText());
    }
    if (qName === "journal_title") {
      this.biblio!.setTitle(this.getText());
    }
    if (qName === "ISSN") {
      this.biblio!.setISSN(this.getText());
    }
    if (qName === "volume") {
      const volume = this.getText();
      if (volume !== null) {
        if (volume.length > 0) {
          this.biblio!.setVolume(volume);
        }
      }
    }
    if (qName === "issue") {
      const issue = this.getText();
      if (issue !== null) {
        if (issue.length > 0) {
          this.biblio!.setNumber(issue);
        }
      }
    }
    if (qName === "year") {
      const year = this.getText();
      this.biblio!.setPublicationDate(year);
      this.biblio!.setYear(year);
    }
    if (qName === "first_page") {
      const page = this.getText();
      if (page !== null) {
        if (page.length > 0) {
          this.biblio!.setBeginPage(parseInt(page, 10));
        }
      }
    }
    if (qName === "contributor") {
      this.biblio!.addAuthor(this.author!);
      this.author = null;
    }
    if (qName === "given_name") {
      this.author = this.getText();
    }
    if (qName === "surname") {
      this.author = this.author + " " + this.getText();
    }
    // NOTE: upstream line 94 — `//biblio.setDOIRetrieval(true);` (commented-out).
  }

  // Upstream line 97-105.
  startElement(_namespaceURI: string, _localName: string, qName: string, atts: SaxAttributes): void {
    if (qName === "query") {
      // Upstream stores the read value into a local `n1` and never uses it.
      // NOTE: upstream dead write preserved verbatim.
      const n1 = atts.getValue("status");
      void n1;
    }
  }
}
