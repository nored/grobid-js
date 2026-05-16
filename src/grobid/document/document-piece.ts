// Port of org.grobid.core.document.DocumentPiece.
// Upstream: grobid-core/src/main/java/org/grobid/core/document/DocumentPiece.java
//
// A pair of `DocumentPointer`s describing a contiguous piece of a document.

import { DocumentPointer } from "./document-pointer.js";

/**
 * Upstream DocumentPiece.java line 3-33.
 *
 * Implements `Comparable<DocumentPiece>` upstream — exposed via `compareTo`.
 */
export class DocumentPiece {
  // Upstream line 5-6 — public for easier access upstream, but private fields with getters here.
  private readonly a: DocumentPointer;
  private readonly b: DocumentPointer;

  // Upstream line 8-14.
  constructor(a: DocumentPointer, b: DocumentPointer) {
    if (a.compareTo(b) > 0) {
      throw new Error("IllegalArgumentException: Invalid document piece: " + a + "-" + b);
    }
    this.a = a;
    this.b = b;
  }

  // Upstream line 16-18.
  getLeft(): DocumentPointer {
    return this.a;
  }

  // Upstream line 20-22.
  getRight(): DocumentPointer {
    return this.b;
  }

  // Upstream line 24-27.
  toString(): string {
    return "(" + this.a + " - " + this.b + ")";
  }

  // Upstream line 29-32.
  compareTo(o: DocumentPiece): number {
    return this.a.compareTo(o.a);
  }
}
