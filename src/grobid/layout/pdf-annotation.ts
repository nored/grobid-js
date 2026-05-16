// Port of org.grobid.core.layout.PDFAnnotation.
// Upstream: grobid-core/src/main/java/org/grobid/core/layout/PDFAnnotation.java

import { BoundingBox } from "./bounding-box.js";
import type { LayoutToken } from "./layout-token.js";

export enum PDFAnnotationType {
  UNKNOWN = "UNKNOWN",
  GOTO = "GOTO",
  URI = "URI",
  GOTOR = "GOTOR",
}

/**
 * Region of a PDF page tied to an action (URI for external links, GOTO for
 * intra-document links). Sourced from pdfalto's annotation sidecar XML.
 */
export class PDFAnnotation {
  // Re-export the enum as a static member to mirror Java's `PDFAnnotation.Type`.
  static readonly Type = PDFAnnotationType;

  private destination: string | null = null;
  private boundingBoxes: BoundingBox[] | null = null;
  private startToken: number = -1;
  private endToken: number = -1;
  private pageNumber: number = -1;
  private type: PDFAnnotationType = PDFAnnotationType.UNKNOWN;

  setType(t: PDFAnnotationType): void { this.type = t; }
  getType(): PDFAnnotationType { return this.type; }

  getBoundingBoxes(): BoundingBox[] | null { return this.boundingBoxes; }
  setBoundingBoxes(boxes: BoundingBox[]): void { this.boundingBoxes = boxes; }

  addBoundingBox(box: BoundingBox): void {
    if (this.boundingBoxes === null) this.boundingBoxes = [];
    this.boundingBoxes.push(box);
  }

  getStartToken(): number { return this.startToken; }
  getEndToken(): number { return this.endToken; }
  setStartToken(s: number): void { this.startToken = s; }
  setEndToken(e: number): void { this.endToken = e; }

  getPageNumber(): number { return this.pageNumber; }
  setPageNumber(n: number): void { this.pageNumber = n; }

  isNull(): boolean {
    return this.boundingBoxes === null && this.startToken === -1 && this.endToken === -1 && this.type === null;
  }

  getDestination(): string | null { return this.destination; }
  setDestination(d: string | null): void { this.destination = d; }

  toString(): string {
    let res = `PDFAnnotation{, pageNumber=${this.pageNumber}, startToken=${this.startToken}, endToken=${this.endToken}, type=${this.type}`;
    if (this.boundingBoxes !== null) res += `, boundingBoxes=${this.boundingBoxes}}`;
    return res;
  }

  /**
   * Whether this annotation covers the given token: the token's bbox is
   * contained in OR has >25% area overlap with one of this annotation's
   * bounding boxes on the same page.
   */
  cover(token: LayoutToken | null): boolean {
    if (token === null) return false;
    const pageToken = token.getPage();
    if (pageToken !== this.pageNumber || this.boundingBoxes === null) return false;
    const tokenBox = BoundingBox.fromLayoutToken(token);
    for (const box of this.boundingBoxes) {
      if (!box.intersect(tokenBox)) continue;
      if (box.contains(tokenBox)) return true;
      const areaToken = tokenBox.area();
      const intersection = box.boundingBoxIntersection(tokenBox);
      if (intersection !== null && intersection.area() > areaToken / 4) return true;
    }
    return false;
  }

  /** Intersection bbox between this annotation's box and a token's box. */
  getIntersectionBox(token: LayoutToken | null): BoundingBox | null {
    if (token === null) return null;
    const pageToken = token.getPage();
    if (pageToken !== this.pageNumber || this.boundingBoxes === null) return null;
    const tokenBox = BoundingBox.fromLayoutToken(token);
    let intersectBox: BoundingBox | null = null;
    for (const box of this.boundingBoxes) {
      if (!box.intersect(tokenBox)) continue;
      if (box.contains(tokenBox)) {
        intersectBox = tokenBox;
        break;
      }
      intersectBox = box.boundingBoxIntersection(tokenBox);
    }
    return intersectBox;
  }
}
