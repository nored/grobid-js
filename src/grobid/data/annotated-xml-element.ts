// Port of org.grobid.core.data.AnnotatedXMLElement.
// Upstream: grobid-core/src/main/java/org/grobid/core/data/AnnotatedXMLElement.java

import { OffsetPosition } from "../utilities/offset-position.js";

/**
 * Represents an annotation in an XML node. The annotation is composed of
 * the XML element node and the offset position.
 *
 * Java upstream stores `nu.xom.Element` for the node. We mirror it as an
 * opaque `unknown` here (the future port of `XmlBuilderUtils` will define
 * the concrete element type).
 */
export class AnnotatedXMLElement {
  private offsetPosition: OffsetPosition;
  private annotationNode: unknown;

  constructor(annotationNode: unknown, offsetPosition: OffsetPosition) {
    this.annotationNode = annotationNode;
    this.offsetPosition = offsetPosition;
  }

  getOffsetPosition(): OffsetPosition {
    return this.offsetPosition;
  }

  setOffsetPosition(offsetPosition: OffsetPosition): void {
    this.offsetPosition = offsetPosition;
  }

  getAnnotationNode(): unknown {
    return this.annotationNode;
  }

  setAnnotationNode(annotationNode: unknown): void {
    this.annotationNode = annotationNode;
  }
}
