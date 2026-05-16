// Port of org.grobid.core.sax.TextSaxParser.
// Upstream: grobid-core/src/main/java/org/grobid/core/sax/TextSaxParser.java
//
// Stupid SAX parser which accumulate the textual content for a patent
// document. As an option, it is possible to accumulate only the content
// under a given element name, for instance "description" for getting the
// description of a patent XML document.

import { parseSax, type SaxAttributes, type SaxHandler } from "./sax-walker.js";

/**
 * Upstream TextSaxParser.java line 15-130.
 */
export class TextSaxParser implements SaxHandler {
  // Upstream line 17.
  accumulator: string[] = [];

  // Upstream line 19-22.
  private filters: string[] | null = null;

  // Upstream line 24.
  private accumule: boolean = true;

  // Upstream line 26-27.
  currentPatentNumber: string | null = null;
  country: string | null = null;

  // Upstream line 29.
  private texts: string[];

  // Upstream line 31-33.
  constructor() {
    this.texts = [];
  }

  /** Drive the parser from an XML string. */
  parse(xml: string): void {
    parseSax(this, xml);
  }

  // Upstream line 35-39.
  characters(buffer: string, _start: number, _length: number): void {
    if (this.accumule) {
      this.accumulator.push(buffer);
    }
  }

  // Upstream line 41-44.
  setFilter(filt: string[]): void {
    this.filters = filt;
    this.accumule = false;
  }

  // Upstream line 46-52.
  addFilter(filt: string): void {
    if (this.filters === null) this.filters = [];
    if (!this.filters.includes(filt)) this.filters.push(filt);
    this.accumule = false;
  }

  // Upstream line 54-61.
  getText(): string {
    let text = this.accumulator.join("").trim();
    // NOTE: upstream line 56 — `//text = text.replace("\n", " ");` (commented-out).
    text = text.split("\t").join(" ");
    // NOTE: upstream line 58 — `//text = text.replaceAll("\\p{Space}+", " ");` (commented-out).
    text = text.replace(/( )+/g, " ");
    return text;
  }

  // Upstream line 63-65.
  getTexts(): string[] {
    return this.texts;
  }

  // Upstream line 67-81.
  endElement(_uri: string, _localName: string, qName: string): void {
    // NOTE: upstream dereferences `filters` unconditionally — a null
    // `filters` would throw NullPointerException. Preserved verbatim;
    // callers must call `setFilter` / `addFilter` first.
    if (this.filters!.includes(qName)) {
      const localText = this.getText();
      if (localText.trim().length > 0) this.texts.push(localText);
      this.accumulator = [];
      this.accumule = false;
    }
    if (this.accumule) {
      if (qName === "row" || qName === "p" || qName === "heading") {
        this.accumulator.push(" ");
      }
    }
  }

  // Upstream line 83-128.
  startElement(_namespaceURI: string, _localName: string, qName: string, atts: SaxAttributes): void {
    if (qName === "patent-document") {
      const length = atts.getLength();
      let docID: string | null = null;
      let docNumber: string | null = null;
      let kindCode: string | null = null;
      for (let i = 0; i < length; i++) {
        const name = atts.getQName(i);
        const value = atts.getValue(i);
        if (name !== null) {
          if (name === "country") {
            this.country = value;
          } else if (name === "kind") {
            kindCode = value;
          } else if (name === "doc-number" || name === "docnumber") {
            docNumber = value;
          } else if (name === "id" || name === "ID") {
            docID = value;
          }
        }
      }
      if (this.country !== null && docNumber !== null) {
        if (kindCode !== null) {
          this.currentPatentNumber = this.country + docNumber + kindCode;
        } else {
          this.currentPatentNumber = this.country + docNumber;
        }
      } else if (docID !== null) {
        this.currentPatentNumber = docID;
      }
    }
    // NOTE: upstream line 125 — dereferences `filters` unconditionally.
    if (this.filters!.includes(qName)) {
      this.accumule = true;
    }
  }
}
