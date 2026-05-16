// Port of org.grobid.core.sax.PDFALTOOutlineSaxHandler.
// Upstream: grobid-core/src/main/java/org/grobid/core/sax/PDFALTOOutlineSaxHandler.java
//
// SAX parser for ALTO XML representation of the outline/bookmark present in
// PDF files obtained via pdfalto.

import type { Document } from "../document/document.js";
import { DocumentNode } from "../document/document-node.js";
import { BoundingBox } from "../layout/bounding-box.js";
import { getLogger } from "../utilities/logger.js";
import { parseSax, type SaxAttributes, type SaxHandler } from "./sax-walker.js";

const LOGGER = getLogger("PDFALTOOutlineSaxHandler");

/**
 * Upstream PDFALTOOutlineSaxHandler.java line 18-228.
 */
export class PDFALTOOutlineSaxHandler implements SaxHandler {
  // Upstream line 19.
  static readonly LOGGER = LOGGER;

  // Upstream line 21.
  private accumulator: string[] = [];
  // Upstream line 22.
  private doc: Document | null = null;
  // Upstream line 23.
  private root: DocumentNode | null = null;
  // Upstream line 24.
  private currentNode: DocumentNode | null = null;

  // Upstream line 26.
  private label: string | null = null;
  // Upstream line 27.
  private box: BoundingBox | null = null;

  // Upstream line 29-31.
  private currentLevel: number = -1;
  private currentId: number = -1;
  private currentParentId: number = -1;

  // Upstream line 33.
  private nodes: Map<number, DocumentNode> | null = null;

  // Upstream line 35-37.
  constructor(doc: Document) {
    this.doc = doc;
  }

  /** Drive the parser from an XML string. */
  parse(xml: string): void {
    parseSax(this, xml);
  }

  // Upstream line 39-41.
  characters(ch: string, _start: number, _length: number): void {
    this.accumulator.push(ch);
  }

  // Upstream line 43-45.
  getText(): string {
    return this.accumulator.join("").trim();
  }

  // Upstream line 47-49.
  getRootNode(): DocumentNode | null {
    return this.root;
  }

  // Upstream line 51-73.
  endElement(_uri: string, _localName: string, qName: string): void {
    if (qName === "STRING") {
      this.currentNode!.setLabel(this.getText());
    } else if (qName === "ITEM") {
      // The box could come from a nested element.
      if (this.box !== null) {
        this.currentNode!.setBoundingBox(this.box);
      }
      this.box = null;
      this.label = null;
    } else if (qName === "TOCITEMLIST") {
      this.currentParentId = -1;
    } else if (qName === "LINK") {
      // in case of nested item, we need to assign the box right away or we will lose it.
      if (this.box !== null) {
        this.currentNode!.setBoundingBox(this.box);
      }
      this.box = null;
    }
  }

  // Upstream line 75-226.
  startElement(_namespaceURI: string, _localName: string, qName: string, atts: SaxAttributes): void {
    if (qName === "TOCITEMS") {
      // this is the document root
      this.root = new DocumentNode();
      this.nodes = new Map<number, DocumentNode>();
    } else if (qName === "ITEM") {
      this.currentNode = new DocumentNode();
      const length = atts.getLength();
      for (let i = 0; i < length; i++) {
        const name = atts.getQName(i);
        const value = atts.getValue(i);
        if (name !== null && value !== null) {
          if (name.toLowerCase() === "id") {
            try {
              this.currentId = parseInt(value, 10);
              if (Number.isNaN(this.currentId)) throw new Error("NaN");
            } catch {
              LOGGER.warn("Invalid id string (should be an integer): " + value);
              this.currentId = -1;
            }
          }
        }
      }
      this.currentNode.setId(this.currentId);
      this.nodes!.set(this.currentId, this.currentNode);
      if (this.currentParentId !== -1) {
        const father = this.nodes!.get(this.currentParentId);
        if (father === undefined) {
          LOGGER.warn("Father not yet encountered! id is " + this.currentParentId);
        } else {
          this.currentNode.setFather(father);
          father.addChild(this.currentNode);
        }
      } else {
        // parent is the root node
        this.currentNode.setFather(this.root);
        this.root!.addChild(this.currentNode);
      }
    } else if (qName === "TOCITEMLIST") {
      // we only consider annotation with attribute @subtype of value "Link"
      const length = atts.getLength();
      for (let i = 0; i < length; i++) {
        const name = atts.getQName(i);
        const value = atts.getValue(i);
        if (name !== null && value !== null) {
          if (name === "level") {
            try {
              this.currentLevel = parseInt(value, 10);
              if (Number.isNaN(this.currentLevel)) throw new Error("NaN");
            } catch {
              LOGGER.warn("Invalid level string (should be an integer): " + value);
              this.currentLevel = -1;
            }
          } else if (name === "idItemParent") {
            try {
              this.currentParentId = parseInt(value, 10);
              if (Number.isNaN(this.currentParentId)) throw new Error("NaN");
            } catch {
              LOGGER.warn("Invalid parent id string (should be an integer): " + value);
              this.currentParentId = -1;
            }
          }
        }
      }
    } else if (qName === "LINK") {
      const length = atts.getLength();
      let page = -1;
      let top = -1.0;
      let bottom = -1.0;
      let left = -1.0;
      let right = -1.0;
      for (let i = 0; i < length; i++) {
        const name = atts.getQName(i);
        const value = atts.getValue(i);
        if (name !== null && value !== null) {
          if (name === "page") {
            const parsed = parseInt(value, 10);
            if (Number.isNaN(parsed)) {
              LOGGER.error("The value for page coordinate attribute is not a valid int: " + value);
            } else {
              page = parsed;
            }
          } else if (name === "top") {
            let val = -1.0;
            const parsed = parseFloat(value);
            if (Number.isNaN(parsed)) {
              LOGGER.error("The value for top coordinate attribute is not a valid double: " + value);
            } else {
              val = parsed;
            }
            if (val !== -1.0) {
              top = val;
            }
          } else if (name === "bottom") {
            let val = -1.0;
            const parsed = parseFloat(value);
            if (Number.isNaN(parsed)) {
              LOGGER.error("The value for bottom coordinate attribute is not a valid double: " + value);
            } else {
              val = parsed;
            }
            if (val !== -1.0) {
              bottom = val;
            }
          } else if (name === "left") {
            let val = -1.0;
            const parsed = parseFloat(value);
            if (Number.isNaN(parsed)) {
              LOGGER.error("The value for left coordinate attribute is not a valid double: " + value);
            } else {
              val = parsed;
            }
            if (val !== -1.0) {
              left = val;
            }
          } else if (name === "right") {
            let val = -1.0;
            const parsed = parseFloat(value);
            if (Number.isNaN(parsed)) {
              LOGGER.error("The value for right coordinate attribute is not a valid double: " + value);
            } else {
              val = parsed;
            }
            if (val !== -1.0) {
              right = val;
            }
          }
        }
      }

      // create the bounding box
      const x = left;
      // NOTE: upstream line 215 — `double y = right;` (assigns `right` to `y`,
      // almost certainly a bug — should be `top`). Preserved verbatim.
      const y = right;
      let width = -1.0;
      let height = -1.0;
      if (right >= left) width = right - left;
      if (bottom >= top) height = bottom - top;
      this.box = BoundingBox.fromPointAndDimensions(page, x, y, width, height);
    }
    this.accumulator = [];
  }
}
