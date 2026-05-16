// Port of org.grobid.core.sax.PDFALTOAnnotationSaxHandler.
// Upstream: grobid-core/src/main/java/org/grobid/core/sax/PDFALTOAnnotationSaxHandler.java
//
// SAX parser for ALTO XML representation of the annotations present on PDF
// files obtained via pdfalto. We only consider here link annotations, other
// types of annotations (e.g. highlight) are ignored.

import type { Document } from "../document/document.js";
import { BoundingBox } from "../layout/bounding-box.js";
import { PDFAnnotation, PDFAnnotationType } from "../layout/pdf-annotation.js";
import { getLogger } from "../utilities/logger.js";
import { parseSax, type SaxAttributes, type SaxHandler } from "./sax-walker.js";

const LOGGER = getLogger("PDFALTOAnnotationSaxHandler");

/**
 * Upstream PDFALTOAnnotationSaxHandler.java line 21-182.
 */
export class PDFALTOAnnotationSaxHandler implements SaxHandler {
  // Upstream line 22.
  static readonly LOGGER = LOGGER;

  // Upstream line 24.
  private accumulator: string[] = [];
  // Upstream line 25.
  private doc: Document | null = null;
  // Upstream line 26.
  private annotations: PDFAnnotation[];
  // Upstream line 27.
  private currentAnnotation: PDFAnnotation | null = null;

  // Upstream line 29-30.
  private x_points: number[] | null = null;
  private y_points: number[] | null = null;

  // Upstream line 32-35.
  constructor(doc: Document, annotations: PDFAnnotation[]) {
    this.doc = doc;
    this.annotations = annotations;
  }

  /** Drive the parser from an XML string. */
  parse(xml: string): void {
    parseSax(this, xml);
  }

  // Upstream line 37-39.
  characters(ch: string, _start: number, _length: number): void {
    this.accumulator.push(ch);
  }

  // Upstream line 41-43.
  getText(): string {
    return this.accumulator.join("").trim();
  }

  // Upstream line 45-47.
  getPDFAnnotations(): PDFAnnotation[] {
    return this.annotations;
  }

  // Upstream line 49-90.
  endElement(_uri: string, _localName: string, qName: string): void {
    if (qName === "ANNOTATION") {
      if (this.currentAnnotation !== null) {
        this.annotations.push(this.currentAnnotation);
      }
      this.currentAnnotation = null;
    } else if (qName === "DEST" && this.currentAnnotation !== null) {
      this.currentAnnotation.setDestination(this.getText());
    } else if (qName === "QUADRILATERAL" && this.currentAnnotation !== null) {
      // create the bounding box
      let x = -1.0;
      let y = -1.0;
      let width = -1.0;
      let height = -1.0;

      let max = -1.0;
      let min = 1000.0;
      for (const val of this.x_points!) {
        if (val < min) min = val;
        if (val > max) max = val;
      }
      x = min;
      width = max - min;
      max = -1.0;
      min = 1000.0;
      for (const val of this.y_points!) {
        if (val < min) min = val;
        if (val > max) max = val;
      }
      y = min;
      height = max - min;
      const box = BoundingBox.fromPointAndDimensions(
        this.currentAnnotation.getPageNumber(),
        x,
        y,
        width,
        height,
      );
      this.currentAnnotation.addBoundingBox(box);
    }
  }

  // Upstream line 92-181.
  startElement(_namespaceURI: string, _localName: string, qName: string, atts: SaxAttributes): void {
    if (qName === "ANNOTATION") {
      // we only consider annotation with attribute @subtype of value "Link"
      const length = atts.getLength();
      for (let i = 0; i < length; i++) {
        const name = atts.getQName(i);
        const value = atts.getValue(i);
        if (name !== null && value !== null) {
          if (name === "subtype") {
            if (value === "Link") {
              this.currentAnnotation = new PDFAnnotation();
            }
          } else if (name === "pagenum") {
            let page = -1;
            const parsed = parseInt(value, 10);
            if (Number.isNaN(parsed)) {
              LOGGER.error("The page number attribute for PDF annotation is not a valid integer: " + value);
            } else {
              page = parsed;
            }
            if (page !== -1) this.currentAnnotation!.setPageNumber(page);
          }
        }
      }
    } else if (qName === "ACTION" && this.currentAnnotation !== null) {
      const length = atts.getLength();
      for (let i = 0; i < length; i++) {
        const name = atts.getQName(i);
        const value = atts.getValue(i);
        if (name !== null && value !== null) {
          if (name === "type") {
            if (value === "uri") {
              this.currentAnnotation.setType(PDFAnnotationType.URI);
            } else if (value === "goto") {
              this.currentAnnotation.setType(PDFAnnotationType.GOTO);
            } else if (value === "gotor") {
              this.currentAnnotation.setType(PDFAnnotationType.GOTOR);
            } else {
              LOGGER.info("the link annotation type is not recognized: " + value);
              this.currentAnnotation.setType(PDFAnnotationType.UNKNOWN);
            }
          }
        }
      }
    } else if (qName === "POINT" && this.currentAnnotation !== null) {
      const length = atts.getLength();
      for (let i = 0; i < length; i++) {
        const name = atts.getQName(i);
        const value = atts.getValue(i);
        if (name !== null && value !== null) {
          if (name === "HPOS") {
            let val = -1.0;
            const parsed = parseFloat(value);
            if (Number.isNaN(parsed)) {
              LOGGER.error("The value for x coordinate attribute is not a valid double: " + value);
            } else {
              val = parsed;
            }
            if (val !== -1.0) this.x_points!.push(val);
          } else if (name === "VPOS") {
            let val = -1.0;
            const parsed = parseFloat(value);
            if (Number.isNaN(parsed)) {
              LOGGER.error("The value for y coordinate attribute is not a valid double: " + value);
            } else {
              val = parsed;
            }
            if (val !== -1.0) this.y_points!.push(val);
          }
        }
      }
    } else if (qName === "QUADRILATERAL" && this.currentAnnotation !== null) {
      this.x_points = [];
      this.y_points = [];
    }
    this.accumulator = [];
  }
}
