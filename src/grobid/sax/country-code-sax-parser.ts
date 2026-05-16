// Port of org.grobid.core.sax.CountryCodeSaxParser.
// Upstream: grobid-core/src/main/java/org/grobid/core/sax/CountryCodeSaxParser.java
//
// SAX parser for the XML description of country codes in ISO 3166.
//
// Upstream extends `org.xml.sax.helpers.DefaultHandler` and walks the XML
// stream as a small state machine. Since the consumers in this repo invoke
// the parser on full XML strings (not streaming files), we use
// `fast-xml-parser` to obtain a parsed tree and then walk it imitating
// upstream's `startElement`/`endElement`/`characters` state machine.
// Behaviour is otherwise 1:1 with upstream.

import { XMLParser } from "fast-xml-parser";

/**
 * SAX parser for the XML description of country codes in ISO 3166.
 *
 * Upstream CountryCodeSaxParser.java line 14-100.
 */
export class CountryCodeSaxParser {
  // Upstream line 16: `private StringBuffer accumulator = new StringBuffer();`
  private accumulator: string[] = [];

  // Upstream line 18-21.
  private code: string | null = null;
  private country: string | null = null;
  private countryCodes: Map<string, string> | null = null;
  private countries: Set<string> | null = null;

  // Upstream line 23-24.
  private isCode: boolean = false;
  private isName: boolean = false;

  /** Upstream line 26-27, default constructor for jackson/factory style. */
  constructor();
  /** Upstream line 29-32, `CountryCodeSaxParser(Map cc, Set co)`. */
  constructor(cc: Map<string, string>, co: Set<string>);
  constructor(cc?: Map<string, string>, co?: Set<string>) {
    if (cc !== undefined && co !== undefined) {
      this.countryCodes = cc;
      this.countries = co;
    }
  }

  /**
   * Drive the state machine from a parsed XML tree. Mirrors the sequence of
   * SAX callbacks (`startElement`, `characters`, `endElement`) that upstream
   * receives from the SAX parser.
   *
   * Not part of the upstream API surface (upstream is invoked via the
   * standard SAX `XMLReader.parse(InputSource)` API). The same effect is
   * achieved by walking the parsed tree below.
   */
  parse(xml: string): void {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      preserveOrder: true,
      trimValues: false,
    });
    const parsed = parser.parse(xml);
    this.walk(parsed);
  }

  // Upstream line 34-36.
  characters(chars: string): void {
    this.accumulator.push(chars);
  }

  // Upstream line 38-40.
  getText(): string {
    return this.accumulator.join("").trim();
  }

  // Upstream line 67-98.
  startElement(qName: string, atts: Map<string, string>): void {
    if (qName === "cell") {
      for (const [name, value] of atts) {
        if (name === "role") {
          if (value === "a2code") {
            this.isCode = true;
            this.isName = false;
          } else if (value === "name" || value === "nameAlt") {
            this.isCode = false;
            this.isName = true;
          } else if (value === "a3code") {
            this.isCode = false;
            this.isName = false;
          }
        }
      }
    }
    // upstream line 97: `accumulator.setLength(0);`
    this.accumulator = [];
  }

  // Upstream line 42-65.
  endElement(qName: string): void {
    if (qName === "row") {
      this.code = null;
      this.country = null;
      this.isCode = false;
      this.isName = false;
    } else if (qName === "cell") {
      if (this.isCode) {
        this.code = this.getText();
      } else if (this.isName) {
        this.country = this.getText();
        if (this.country !== null) {
          this.country = this.country.toLowerCase();
        }
        // Upstream calls Map.put / Set.add unconditionally even when code is
        // null at this point (which happens when a name precedes the a2code).
        // The countryCodes/countries fields are nullable in upstream; in
        // practice they are always set via the (Map, Set) constructor before
        // parse() is invoked.
        if (this.countryCodes !== null) {
          this.countryCodes.set(this.country!, this.code as string);
        }
        if (this.countries !== null && !this.countries.has(this.country!)) {
          this.countries.add(this.country!);
        }
      }
    }
    // upstream line 64: `accumulator.setLength(0);`
    this.accumulator = [];
  }

  /**
   * Walk a `preserveOrder: true` fast-xml-parser tree, firing SAX-style
   * callbacks. Each node in this representation is `{ [tagName]: children[], ":@"?: { "@_attr": value } }`
   * for elements, or `{ "#text": "value" }` for text nodes.
   */
  private walk(nodes: unknown): void {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      if (node === null || node === undefined) continue;
      if (typeof node !== "object") continue;
      const rec = node as Record<string, unknown>;
      // Text node.
      if (typeof rec["#text"] === "string") {
        this.characters(rec["#text"]);
        continue;
      }
      if (typeof rec["#text"] === "number") {
        this.characters(String(rec["#text"]));
        continue;
      }
      // Element node. The single non-":@" key is the tag name; its value is
      // the children array.
      let tag: string | null = null;
      let children: unknown = null;
      for (const key of Object.keys(rec)) {
        if (key === ":@") continue;
        tag = key;
        children = rec[key];
        break;
      }
      if (tag === null) continue;

      // Build attribute map from ":@" block.
      const attrs = new Map<string, string>();
      const attrBlock = rec[":@"];
      if (attrBlock !== null && attrBlock !== undefined && typeof attrBlock === "object") {
        for (const [k, v] of Object.entries(attrBlock as Record<string, unknown>)) {
          if (k.startsWith("@_")) {
            attrs.set(k.substring(2), String(v));
          }
        }
      }

      this.startElement(tag, attrs);
      if (Array.isArray(children)) {
        this.walk(children);
      }
      this.endElement(tag);
    }
  }
}
