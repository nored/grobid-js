// Port of org.grobid.core.sax.PDFMetadataSaxHandler.
// Upstream: grobid-core/src/main/java/org/grobid/core/sax/PDFMetadataSaxHandler.java
//
// SAX parser for the metadata of PDF files obtained via xpdf pdfalto.

import { Metadata } from "../data/metadata.js";
import type { Document } from "../document/document.js";
import { getLogger } from "../utilities/logger.js";
import { parseSax, type SaxAttributes, type SaxHandler } from "./sax-walker.js";

const LOGGER = getLogger("PDFMetadataSaxHandler");

/**
 * Upstream PDFMetadataSaxHandler.java line 15-91.
 */
export class PDFMetadataSaxHandler implements SaxHandler {
  // Upstream line 16.
  static readonly LOGGER = LOGGER;

  // Upstream line 18.
  private accumulator: string[] = [];

  // Upstream line 20.
  private doc: Document | null = null;

  // Upstream line 22.
  private metadata: Metadata;

  // Upstream line 24-26.
  characters(ch: string, _start: number, _length: number): void {
    this.accumulator.push(ch);
  }

  // Upstream line 28-31.
  getText(): string {
    const res = this.accumulator.join("").trim();
    return res.trim();
  }

  // Upstream line 33-36.
  constructor(d: Document) {
    this.doc = d;
    this.metadata = new Metadata();
  }

  /** Drive the parser from an XML string. */
  parse(xml: string): void {
    parseSax(this, xml);
  }

  // Upstream line 37-67.
  endElement(_uri: string, _localName: string, qName: string): void {
    if (qName === "METADATA") {
      // upstream: empty branch (preserved verbatim).
    } else if (qName === "TITLE") {
      this.metadata.setTitle(this.getText());
      this.accumulator = [];
    } else if (qName === "SUBJECT") {
      this.metadata.setSubject(this.getText());
      this.accumulator = [];
    } else if (qName === "KEYWORDS") {
      this.metadata.setKeywords(this.getText());
      this.accumulator = [];
    } else if (qName === "AUTHOR") {
      this.metadata.setAuthor(this.getText());
      this.accumulator = [];
    } else if (qName === "CREATOR") {
      this.metadata.setCreator(this.getText());
      this.accumulator = [];
    } else if (qName === "PRODUCER") {
      this.metadata.setProducer(this.getText());
      this.accumulator = [];
    } else if (qName === "CREATIONDATE") {
      this.metadata.setCreateDate(this.getText());
      this.accumulator = [];
    } else if (qName === "MODIFICATIONDATE") {
      this.metadata.setModificationDate(this.getText());
      this.accumulator = [];
    }
  }

  // Upstream line 69-70.
  endDocument(): void {
    // empty.
  }

  // Upstream line 72-86.
  startElement(_namespaceURI: string, _localName: string, qName: string, _atts: SaxAttributes): void {
    if (qName === "METADATA") {
      // empty
    } else if (qName === "TITLE") {
      // empty
    } else if (qName === "SUBJECT") {
      // empty
    } else if (qName === "KEYWORDS") {
      // empty
    } else if (qName === "AUTHOR") {
      // empty
    } else if (qName === "CREATOR") {
      // empty
    } else if (qName === "PRODUCER") {
      // empty
    } else if (qName === "CREATIONDATE") {
      // empty
    } else if (qName === "MODIFICATIONDATE") {
      // empty
    }
  }

  // Upstream line 88-90.
  getMetadata(): Metadata {
    return this.metadata;
  }
}
