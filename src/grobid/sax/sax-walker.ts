// Internal helper for the SAX-ported parsers in this directory.
//
// The upstream parsers extend `org.xml.sax.helpers.DefaultHandler` and drive
// a state machine via `startElement`/`characters`/`endElement` callbacks. In
// TypeScript we use `fast-xml-parser` to obtain a `preserveOrder: true`
// tree and walk it, firing the same callbacks on the handler. The handler
// itself implements the upstream methods 1:1 so the state machine matches.

import { XMLParser } from "fast-xml-parser";

/**
 * Callback surface roughly matching `org.xml.sax.helpers.DefaultHandler`.
 *
 * `qName` upstream is the "qualified name" (prefix:local). Most upstream
 * parsers only inspect `qName` and ignore `namespaceURI` / `localName`,
 * so we pass the tag name from the parsed tree as `qName` and forward an
 * empty string as `namespaceURI` / `localName`. Where a parser actually
 * uses the local name, the tag in the tree IS the local name (fast-xml-parser
 * strips namespace prefixes when no `removeNSPrefix` option is set, but the
 * actual XOM-style separator is unchanged), so callers receive a string
 * that matches upstream behaviour for the documents GROBID processes.
 */
export interface SaxHandler {
  startDocument?(): void;
  endDocument?(): void;
  startElement?(namespaceURI: string, localName: string, qName: string, atts: SaxAttributes): void;
  endElement?(uri: string, localName: string, qName: string): void;
  characters?(buffer: string, start: number, length: number): void;
}

/**
 * Mimics `org.xml.sax.Attributes` — only the methods used by ported parsers
 * are exposed (`getLength`, `getQName`, `getValue` by index and by name).
 */
export class SaxAttributes {
  private names: string[] = [];
  private values: string[] = [];

  constructor(attrs?: Map<string, string>) {
    if (attrs !== undefined) {
      for (const [k, v] of attrs) {
        this.names.push(k);
        this.values.push(v);
      }
    }
  }

  getLength(): number {
    return this.names.length;
  }

  getQName(i: number): string {
    return this.names[i] ?? "";
  }

  getLocalName(i: number): string {
    return this.names[i] ?? "";
  }

  /** Value by attribute index or by qualified name. */
  getValue(arg: number | string): string | null {
    if (typeof arg === "number") return this.values[arg] ?? null;
    for (let i = 0; i < this.names.length; i++) {
      if (this.names[i] === arg) return this.values[i] ?? null;
    }
    return null;
  }
}

/**
 * Walk a fast-xml-parser `preserveOrder: true` tree and dispatch SAX
 * callbacks to the provided handler.
 */
export function walkSax(handler: SaxHandler, nodes: unknown): void {
  walk(handler, nodes);
}

function walk(handler: SaxHandler, nodes: unknown): void {
  if (!Array.isArray(nodes)) return;
  for (const node of nodes) {
    if (node === null || node === undefined) continue;
    if (typeof node !== "object") continue;
    const rec = node as Record<string, unknown>;
    // Text node.
    if (typeof rec["#text"] === "string") {
      const text = rec["#text"];
      handler.characters?.(text, 0, text.length);
      continue;
    }
    if (typeof rec["#text"] === "number") {
      const text = String(rec["#text"]);
      handler.characters?.(text, 0, text.length);
      continue;
    }
    // Element node: single non-":@" key is the tag name; its value is the children.
    let tag: string | null = null;
    let children: unknown = null;
    for (const key of Object.keys(rec)) {
      if (key === ":@") continue;
      tag = key;
      children = rec[key];
      break;
    }
    if (tag === null) continue;

    const attrMap = new Map<string, string>();
    const attrBlock = rec[":@"];
    if (attrBlock !== null && attrBlock !== undefined && typeof attrBlock === "object") {
      for (const [k, v] of Object.entries(attrBlock as Record<string, unknown>)) {
        if (k.startsWith("@_")) {
          attrMap.set(k.substring(2), String(v));
        }
      }
    }
    const atts = new SaxAttributes(attrMap);
    handler.startElement?.("", tag, tag, atts);
    if (Array.isArray(children)) {
      walk(handler, children);
    }
    handler.endElement?.("", tag, tag);
  }
}

/** Parse an XML string and drive the handler. */
export function parseSax(handler: SaxHandler, xml: string): void {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    preserveOrder: true,
    trimValues: false,
  });
  const parsed = parser.parse(xml);
  handler.startDocument?.();
  walk(handler, parsed);
  handler.endDocument?.();
}
