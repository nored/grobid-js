// Port of org.grobid.core.document.xml.XmlBuilderUtils.
// Upstream: grobid-core/src/main/java/org/grobid/core/document/xml/XmlBuilderUtils.java
//
// Upstream uses nu.xom (XOM) for in-memory XML construction. We provide a
// minimal XOM-compatible API in TypeScript with the same class names
// (`Node`, `Text`, `Element`, `Attribute`, `Document`) and the methods the
// rest of the codebase invokes (`appendChild`, `addAttribute`,
// `setLocalName`, `getValue`, `getChildCount`, `getChild`, `toXML`, ...).
//
// The serialisation produced by `toXML()` mirrors XOM's default output:
// elements emit `<tag attr="value">children</tag>` with attributes/text
// escaped, and the root element receives the TEI namespace declaration.
// `toPrettyXml()` adds 4-space indentation between block children, matching
// the upstream `Serializer.setIndent(4)` configuration.

import { XMLParser } from "fast-xml-parser";

// Upstream line 22.
export const TEI_NS = "http://www.tei-c.org/ns/1.0";
// Upstream line 29.
export const XML_NS = "http://www.w3.org/XML/1998/namespace";

/**
 * Base XML node — equivalent of `nu.xom.Node`.
 */
export abstract class Node {
  parent: ParentNode | null = null;

  abstract toXML(): string;

  /** Upstream `Node.getValue()` returns the concatenated text content. */
  getValue(): string {
    return "";
  }

  /** XOM `Node.copy()` — deep clone. */
  abstract copy(): Node;

  /** Detach this node from its parent (XOM `Node.detach()`). */
  detach(): void {
    if (this.parent !== null) {
      const idx = this.parent.children.indexOf(this);
      if (idx >= 0) {
        this.parent.children.splice(idx, 1);
      }
      this.parent = null;
    }
  }
}

/**
 * Common base for nodes that have children (Element and Document).
 */
abstract class ParentNode extends Node {
  children: Node[] = [];
}

/**
 * Equivalent of `nu.xom.Text` — a text node.
 */
export class Text extends Node {
  private value: string;

  constructor(value: string) {
    super();
    this.value = value;
  }

  override getValue(): string {
    return this.value;
  }

  setValue(value: string): void {
    this.value = value;
  }

  override toXML(): string {
    return escapeText(this.value);
  }

  override copy(): Text {
    return new Text(this.value);
  }
}

/**
 * Equivalent of `nu.xom.Attribute`.
 */
export class Attribute {
  private localName: string;
  private namespaceURI: string;
  private namespacePrefix: string;
  private value: string;

  // XOM signatures supported by callers:
  //   new Attribute(localName, value)
  //   new Attribute(qualifiedName, namespaceURI, value)
  constructor(nameOrQualified: string, valueOrNamespace: string, maybeValue?: string) {
    if (maybeValue === undefined) {
      // Simple (localName, value) form.
      this.localName = nameOrQualified;
      this.namespaceURI = "";
      this.namespacePrefix = "";
      this.value = valueOrNamespace;
    } else {
      // (qualifiedName, namespaceURI, value) form.
      const qname = nameOrQualified;
      const ns = valueOrNamespace;
      const val = maybeValue;
      const colonIdx = qname.indexOf(":");
      if (colonIdx >= 0) {
        this.namespacePrefix = qname.substring(0, colonIdx);
        this.localName = qname.substring(colonIdx + 1);
      } else {
        this.namespacePrefix = "";
        this.localName = qname;
      }
      this.namespaceURI = ns;
      this.value = val;
    }
  }

  getLocalName(): string {
    return this.localName;
  }

  getValue(): string {
    return this.value;
  }

  setValue(value: string): void {
    this.value = value;
  }

  getNamespaceURI(): string {
    return this.namespaceURI;
  }

  getNamespacePrefix(): string {
    return this.namespacePrefix;
  }

  getQualifiedName(): string {
    if (this.namespacePrefix.length > 0) {
      return this.namespacePrefix + ":" + this.localName;
    }
    return this.localName;
  }

  copy(): Attribute {
    const a = new Attribute(this.localName, this.value);
    a.namespaceURI = this.namespaceURI;
    a.namespacePrefix = this.namespacePrefix;
    return a;
  }
}

/**
 * Equivalent of `nu.xom.Element`.
 */
export class Element extends ParentNode {
  private localName: string;
  private namespaceURI: string;
  private attributes: Attribute[] = [];

  constructor(localName: string, namespaceURI: string = "") {
    super();
    this.localName = localName;
    this.namespaceURI = namespaceURI;
  }

  // XOM API.
  getLocalName(): string {
    return this.localName;
  }

  setLocalName(name: string): void {
    this.localName = name;
  }

  getNamespaceURI(): string {
    return this.namespaceURI;
  }

  /** Number of child nodes. */
  getChildCount(): number {
    return this.children.length;
  }

  getChild(index: number): Node {
    return this.children[index] as Node;
  }

  // XOM's appendChild accepts a Node, a string (auto-wraps in Text), or an Element.
  appendChild(child: Node | string): void {
    let node: Node;
    if (typeof child === "string") {
      node = new Text(child);
    } else {
      // Detach from previous parent if any.
      if (child.parent !== null) {
        child.detach();
      }
      node = child;
    }
    node.parent = this;
    this.children.push(node);
  }

  insertChild(child: Node | string, position: number): void {
    let node: Node;
    if (typeof child === "string") {
      node = new Text(child);
    } else {
      if (child.parent !== null) {
        child.detach();
      }
      node = child;
    }
    node.parent = this;
    this.children.splice(position, 0, node);
  }

  removeChild(child: Node): Node;
  removeChild(index: number): Node;
  removeChild(arg: Node | number): Node {
    if (typeof arg === "number") {
      const removed = this.children.splice(arg, 1)[0] as Node;
      if (removed) removed.parent = null;
      return removed;
    } else {
      const idx = this.children.indexOf(arg);
      if (idx < 0) {
        throw new Error("NoSuchChildException");
      }
      this.children.splice(idx, 1);
      arg.parent = null;
      return arg;
    }
  }

  addAttribute(attr: Attribute): void {
    // Replace existing attribute with the same qualified name.
    const qname = attr.getQualifiedName();
    for (let i = 0; i < this.attributes.length; i++) {
      if (this.attributes[i]!.getQualifiedName() === qname) {
        this.attributes[i] = attr;
        return;
      }
    }
    this.attributes.push(attr);
  }

  getAttribute(localName: string): Attribute | null;
  getAttribute(index: number): Attribute;
  getAttribute(arg: string | number): Attribute | null {
    if (typeof arg === "number") {
      return this.attributes[arg] as Attribute;
    }
    for (const a of this.attributes) {
      if (a.getLocalName() === arg) return a;
    }
    return null;
  }

  getAttributeCount(): number {
    return this.attributes.length;
  }

  getAttributeValue(localName: string): string | null {
    const a = this.getAttribute(localName);
    return a === null ? null : a.getValue();
  }

  /** Concatenated text content (XOM `Element.getValue()`). */
  override getValue(): string {
    let s = "";
    for (const c of this.children) {
      s += c.getValue();
    }
    return s;
  }

  override toXML(): string {
    return this.serialize(false, 0, true);
  }

  toPrettyXML(): string {
    return this.serialize(true, 0, true);
  }

  override copy(): Element {
    const e = new Element(this.localName, this.namespaceURI);
    for (const a of this.attributes) {
      e.addAttribute(a.copy());
    }
    for (const c of this.children) {
      e.appendChild(c.copy());
    }
    return e;
  }

  // Internal serialiser — emits `xmlns="..."` on the root element only.
  private serialize(pretty: boolean, depth: number, declareNamespace: boolean): string {
    const parts: string[] = [];
    parts.push("<");
    parts.push(this.localName);
    if (declareNamespace && this.namespaceURI.length > 0) {
      parts.push(' xmlns="');
      parts.push(escapeAttr(this.namespaceURI));
      parts.push('"');
    }
    for (const a of this.attributes) {
      parts.push(" ");
      parts.push(a.getQualifiedName());
      parts.push('="');
      parts.push(escapeAttr(a.getValue()));
      parts.push('"');
      // Emit namespace declaration for namespaced attributes.
      if (a.getNamespacePrefix().length > 0 && a.getNamespaceURI().length > 0) {
        // XOM declares the prefix on the element. We emit it as a separate
        // attribute (e.g. xmlns:xml="..."). Skip the xml prefix which is
        // implicit, matching XOM behaviour.
        if (a.getNamespacePrefix() !== "xml") {
          parts.push(" xmlns:");
          parts.push(a.getNamespacePrefix());
          parts.push('="');
          parts.push(escapeAttr(a.getNamespaceURI()));
          parts.push('"');
        }
      }
    }
    if (this.children.length === 0) {
      parts.push(" />");
      return parts.join("");
    }
    parts.push(">");
    // Decide whether to insert line breaks/indentation.
    const allText = this.children.every((c) => c instanceof Text);
    for (const c of this.children) {
      if (pretty && !allText) {
        parts.push("\n");
        parts.push(indent(depth + 1));
      }
      if (c instanceof Element) {
        parts.push(c.serialize(pretty, depth + 1, false));
      } else {
        parts.push(c.toXML());
      }
    }
    if (pretty && !allText) {
      parts.push("\n");
      parts.push(indent(depth));
    }
    parts.push("</");
    parts.push(this.localName);
    parts.push(">");
    return parts.join("");
  }
}

/**
 * Equivalent of `nu.xom.Document` — wraps a root element.
 */
export class XomDocument extends ParentNode {
  private rootElement: Element;

  constructor(rootElement: Element) {
    super();
    this.rootElement = rootElement;
    rootElement.parent = this;
    this.children.push(rootElement);
  }

  getRootElement(): Element {
    return this.rootElement;
  }

  override toXML(): string {
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + this.rootElement.toXML();
  }

  override copy(): XomDocument {
    return new XomDocument(this.rootElement.copy());
  }
}

// Indentation helper used by `toPrettyXml()`.
function indent(depth: number): string {
  // Upstream serializer.setIndent(4) — four spaces per level.
  let s = "";
  for (let i = 0; i < depth; i++) s += "    ";
  return s;
}

function escapeAttr(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\t/g, "&#x9;")
    .replace(/\n/g, "&#xA;")
    .replace(/\r/g, "&#xD;");
}

function escapeText(v: string): string {
  // XOM's default text escaping: `&`, `<`, `>` and carriage returns.
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r/g, "&#xD;");
}

/**
 * Upstream XmlBuilderUtils — collected as a class with static methods to
 * mirror upstream's namespace.
 */
export class XmlBuilderUtils {
  // Upstream line 22.
  static readonly TEI_NS = TEI_NS;
  // Upstream line 29.
  static readonly XML_NS = XML_NS;

  /**
   * Upstream line 23-28: TO_XML_FUNCTION — a `Function<Element, String>`.
   */
  static readonly TO_XML_FUNCTION = (element: Element): string => {
    return XmlBuilderUtils.toXml(element);
  };

  /**
   * Upstream line 31-42: parse an XML string and return the (copied) root
   * element.
   */
  static fromString(xml: string): Element {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      preserveOrder: true,
      trimValues: false,
    });
    let parsed: unknown;
    try {
      parsed = parser.parse(xml);
    } catch (e) {
      throw new Error("XmlBuilderUtils.fromString: " + String(e));
    }
    const root = XmlBuilderUtils.buildFromTree(parsed);
    if (root === null) {
      throw new Error("XmlBuilderUtils.fromString: empty document");
    }
    // Upstream returns `(Element) rootElement.copy()`.
    return root.copy();
  }

  // Upstream line 44-55: returns `element.toXML()`.
  static toXml(element: Element): string;
  // Upstream line 69-71: `toXml(List<Element>)` — joins with `\n`.
  static toXml(elements: Element[]): string;
  static toXml(arg: Element | Element[]): string {
    if (Array.isArray(arg)) {
      return arg.map((e) => XmlBuilderUtils.toXml(e)).join("\n");
    }
    return arg.toXML();
  }

  // Upstream line 57-67.
  static toPrettyXml(element: Element): string {
    // Upstream wraps in Document + serializer.setIndent(4).
    const doc = new XomDocument(element.copy());
    return doc.getRootElement().toPrettyXML();
  }

  // Upstream line 73-75 / 91-95.
  static teiElement(name: string): Element;
  static teiElement(name: string, content: string): Element;
  static teiElement(name: string, content?: string): Element {
    const el = new Element(name, TEI_NS);
    if (content !== undefined) {
      el.appendChild(content);
    }
    return el;
  }

  // Upstream line 77-81.
  static addCoords(el: Element, coords: string | null): void {
    if (coords !== null && coords !== undefined) {
      el.addAttribute(new Attribute("coords", coords));
    }
  }

  // Upstream line 83-85.
  static addXmlId(el: Element, id: string): void {
    el.addAttribute(new Attribute("xml:id", XML_NS, id));
  }

  // Upstream line 87-89.
  static textNode(text: string): Node {
    return new Text(text);
  }

  /**
   * Upstream line 98-102 — `main()` method, kept as a no-op static for
   * fidelity. Not invoked by the codebase.
   */
  static main(_args: string[]): void {
    const e = XmlBuilderUtils.fromString("<div><a>Test</a></div>");
    // eslint-disable-next-line no-console
    console.log(XmlBuilderUtils.toXml(e));
  }

  // Upstream line 104-121.
  static stripNonValidXMLCharacters(input: string | null): string {
    const out: string[] = [];
    let current: number;
    if (input === null || input === "") {
      return "";
    }
    for (let i = 0; i < input.length; i++) {
      current = input.charCodeAt(i);
      if (
        current === 0x9 ||
        current === 0xa ||
        current === 0xd ||
        (current >= 0x20 && current <= 0xd7ff) ||
        (current >= 0xe000 && current <= 0xfffd) ||
        (current >= 0x10000 && current <= 0x10ffff)
      ) {
        out.push(input.charAt(i));
      }
    }
    return out.join("");
  }

  // Build a parsed fast-xml-parser tree into a XOM-style Element tree.
  private static buildFromTree(parsed: unknown): Element | null {
    if (!Array.isArray(parsed)) return null;
    for (const node of parsed) {
      if (node === null || node === undefined) continue;
      if (typeof node !== "object") continue;
      const rec = node as Record<string, unknown>;
      if (typeof rec["#text"] !== "undefined") continue;
      // Find the element tag key.
      for (const key of Object.keys(rec)) {
        if (key === ":@") continue;
        const el = XmlBuilderUtils.makeElement(key, rec);
        return el;
      }
    }
    return null;
  }

  private static makeElement(tag: string, rec: Record<string, unknown>): Element {
    const el = new Element(tag);
    const attrBlock = rec[":@"];
    if (attrBlock !== null && attrBlock !== undefined && typeof attrBlock === "object") {
      for (const [k, v] of Object.entries(attrBlock as Record<string, unknown>)) {
        if (k.startsWith("@_")) {
          el.addAttribute(new Attribute(k.substring(2), String(v)));
        }
      }
    }
    const children = rec[tag];
    if (Array.isArray(children)) {
      for (const c of children) {
        if (c === null || c === undefined) continue;
        if (typeof c !== "object") continue;
        const r = c as Record<string, unknown>;
        if (typeof r["#text"] === "string") {
          el.appendChild(new Text(r["#text"]));
          continue;
        }
        if (typeof r["#text"] === "number") {
          el.appendChild(new Text(String(r["#text"])));
          continue;
        }
        for (const k of Object.keys(r)) {
          if (k === ":@") continue;
          el.appendChild(XmlBuilderUtils.makeElement(k, r));
          break;
        }
      }
    }
    return el;
  }
}

// Re-export the function form for callers using `XBUNs.textNode(...)`.
export function textNode(text: string): Node {
  return XmlBuilderUtils.textNode(text);
}
