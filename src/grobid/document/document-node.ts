// Port of org.grobid.core.document.DocumentNode.
// Upstream: grobid-core/src/main/java/org/grobid/core/document/DocumentNode.java
//
// Node of the structure of a hierarchically organized document (e.g. table
// of contents).

import type { BoundingBox } from "../layout/bounding-box.js";

/**
 * Class corresponding to a node of the structure of a hierarchically
 * organized document (i.e. for a table of content).
 *
 * Upstream DocumentNode.java line 12-192.
 */
export class DocumentNode {
  // Upstream line 13.
  private id: number | null = null;

  // Upstream line 16 — Gorn address for tree structure.
  private address: string | null = null;

  // Upstream line 19 — real numbering of the section, if any.
  private realNumber: string | null = null;

  // Upstream line 22 — normalized numbering of the section, if any.
  private normalizedNumber: string | null = null;

  // Upstream line 25 — the string attached to this document level, e.g. section title.
  private label: string | null = null;

  // Upstream line 28 — list of child document nodes.
  private children: DocumentNode[] | null = null;

  // Upstream line 31-32 — offset relatively to the document tokenization
  // (so token offset, NOT character offset).
  startToken: number = -1;
  endToken: number = -1;

  // Upstream line 36 — coordinates of the string attached to this document
  // level, typically where an index link action points in the document.
  private boundingBox: BoundingBox | null = null;

  // Upstream line 39 — parent document node, if null it is a root node.
  private father: DocumentNode | null = null;

  // Upstream line 40-41 / 43-46.
  constructor();
  constructor(label: string, address: string);
  constructor(label?: string, address?: string) {
    if (label !== undefined) {
      this.label = label;
    }
    if (address !== undefined) {
      this.address = address;
    }
  }

  // Upstream line 48-50.
  getRealNumber(): string | null {
    return this.realNumber;
  }

  // Upstream line 52-54.
  setRealNumber(num: string | null): void {
    this.realNumber = num;
  }

  // Upstream line 56-58.
  getNormalizedNumber(): string | null {
    return this.normalizedNumber;
  }

  // Upstream line 60-62.
  setNormalizedNumber(num: string | null): void {
    this.normalizedNumber = num;
  }

  // Upstream line 64-66.
  getAddress(): string | null {
    return this.address;
  }

  // Upstream line 68-70.
  setAddress(theAddress: string | null): void {
    this.address = theAddress;
  }

  // Upstream line 72-74.
  getLabel(): string | null {
    return this.label;
  }

  // Upstream line 76-78.
  setLabel(theLabel: string | null): void {
    this.label = theLabel;
  }

  // Upstream line 80-82.
  getChildren(): DocumentNode[] | null {
    return this.children;
  }

  // Upstream line 84-86.
  setChildren(nodes: DocumentNode[] | null): void {
    this.children = nodes;
  }

  // Upstream line 88-90.
  getBoundingBox(): BoundingBox | null {
    return this.boundingBox;
  }

  // Upstream line 92-94.
  setBoundingBox(box: BoundingBox | null): void {
    this.boundingBox = box;
  }

  // Upstream line 96-98.
  getFather(): DocumentNode | null {
    return this.father;
  }

  // Upstream line 100-102.
  setFather(parent: DocumentNode | null): void {
    this.father = parent;
  }

  // Upstream line 104-123.
  addChild(child: DocumentNode): void {
    if (this.children === null) {
      this.children = [];
    }
    let addr: string | null = null;
    if (this.address !== null) {
      if (this.address === "0") {
        addr = "" + (this.children.length + 1);
      } else {
        addr = this.address + (this.children.length + 1);
      }
    }
    child.address = addr;
    child.father = this;
    if (child.endToken > this.endToken) {
      this.endToken = child.endToken;
    }
    this.children.push(child);
  }

  // Upstream line 125-127 / 129-142.
  toString(tab?: number): string {
    const tabValue = tab === undefined ? 0 : tab;
    const sb: string[] = [];
    sb.push(String(this.id));
    sb.push(" ");
    sb.push(String(this.address));
    sb.push(" ");
    sb.push(String(this.label));
    sb.push(" ");
    sb.push(String(this.startToken));
    sb.push(" ");
    sb.push(String(this.endToken));
    sb.push("\n");

    if (this.children !== null) {
      for (const node of this.children) {
        for (let n = 0; n < tabValue + 1; n++) {
          sb.push("\t");
        }
        sb.push(node.toString(tabValue + 1));
      }
    }
    return sb.join("");
  }

  // Upstream line 144-152.
  clone(): DocumentNode {
    const result = new DocumentNode();
    result.address = this.address;
    result.realNumber = this.realNumber;
    result.label = this.label;
    result.startToken = this.startToken;
    result.endToken = this.endToken;
    return result;
  }

  // Upstream line 154-169.
  getSpanningNode(position: number): DocumentNode | null {
    if (this.startToken <= position && this.endToken >= position) {
      if (this.children !== null) {
        for (const node of this.children) {
          if (node.startToken <= position && node.endToken >= position) {
            return node.getSpanningNode(position);
          }
        }
        return this;
      } else {
        return this;
      }
    } else {
      return null;
    }
  }

  // NOTE: upstream lines 172-184 are commented-out `nextSlibing()` method;
  // preserved here for fidelity but not implemented.

  // Upstream line 185-187.
  getId(): number | null {
    return this.id;
  }

  // Upstream line 189-191.
  setId(id: number | null): void {
    this.id = id;
  }
}
