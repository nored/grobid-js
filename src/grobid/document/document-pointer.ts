// Port of org.grobid.core.document.DocumentPointer.
// Upstream: grobid-core/src/main/java/org/grobid/core/document/DocumentPointer.java
//
// Class representing a pointer within a PDF document — a block index and a
// token index within a block (not global token index).

import type { Document } from "./document.js";

/**
 * Class representing a pointer within a PDF document, basically a block
 * index and then a token index within a block (not global token index).
 *
 * Upstream DocumentPointer.java line 9-72.
 */
export class DocumentPointer {
  // Upstream line 10.
  static readonly START_DOCUMENT_POINTER: DocumentPointer = new DocumentPointer(0, 0, 0);

  // Upstream line 13-15.
  private readonly blockPtr: number;
  private readonly tokenBlockPos: number;
  private readonly tokenDocPos: number;

  // Upstream line 17-23.
  constructor(blockPtr: number, tokenDocPos: number, tokenBlockPos: number);
  // Upstream line 25-27.
  constructor(doc: Document, blockIndex: number, tokenDocPos: number);
  constructor(
    blockPtrOrDoc: number | Document,
    tokenDocPosOrBlockIndex: number,
    tokenBlockPosOrTokenDocPos: number
  ) {
    if (typeof blockPtrOrDoc === "number") {
      // Primary constructor.
      const blockPtr = blockPtrOrDoc;
      const tokenDocPos = tokenDocPosOrBlockIndex;
      const tokenBlockPos = tokenBlockPosOrTokenDocPos;
      // Upstream line 18-19: Preconditions.checkArgument.
      if (!(tokenDocPos >= tokenBlockPos)) {
        throw new Error("IllegalArgumentException: tokenDocPos >= tokenBlockPos");
      }
      if (!(tokenBlockPos >= 0)) {
        throw new Error("IllegalArgumentException: tokenBlockPos >= 0");
      }
      this.tokenDocPos = tokenDocPos;
      this.tokenBlockPos = tokenBlockPos;
      this.blockPtr = blockPtr;
    } else {
      // Document overload.
      const doc = blockPtrOrDoc;
      const blockIndex = tokenDocPosOrBlockIndex;
      const tokenDocPos = tokenBlockPosOrTokenDocPos;
      const tokenBlockPos = tokenDocPos - doc.getBlocks()[blockIndex]!.getStartToken();
      // Upstream line 18-19: Preconditions.checkArgument.
      if (!(tokenDocPos >= tokenBlockPos)) {
        throw new Error("IllegalArgumentException: tokenDocPos >= tokenBlockPos");
      }
      if (!(tokenBlockPos >= 0)) {
        throw new Error("IllegalArgumentException: tokenBlockPos >= 0");
      }
      this.blockPtr = blockIndex;
      this.tokenDocPos = tokenDocPos;
      this.tokenBlockPos = tokenBlockPos;
    }
  }

  // Upstream line 30-32: Ints.compare semantics — return tokenDocPos - other.tokenDocPos as -1/0/1.
  compareTo(o: DocumentPointer): number {
    if (this.tokenDocPos < o.tokenDocPos) return -1;
    if (this.tokenDocPos > o.tokenDocPos) return 1;
    return 0;
  }

  // Upstream line 34-36.
  getBlockPtr(): number {
    return this.blockPtr;
  }

  // Upstream line 38-40.
  getTokenBlockPos(): number {
    return this.tokenBlockPos;
  }

  // Upstream line 42-44.
  getTokenDocPos(): number {
    return this.tokenDocPos;
  }

  // Upstream line 46-49.
  toString(): string {
    return (
      "DocPtr(Block No: " +
      this.blockPtr +
      "; Token position in block: " +
      this.tokenBlockPos +
      "; position of token in doc: " +
      this.tokenDocPos +
      ")"
    );
  }

  // Upstream line 51-63.
  equals(o: unknown): boolean {
    if (this === o) return true;
    if (o === null || o === undefined) return false;
    if (!(o instanceof DocumentPointer)) return false;
    const that = o as DocumentPointer;
    if (this.blockPtr !== that.blockPtr) return false;
    if (this.tokenBlockPos !== that.tokenBlockPos) return false;
    if (this.tokenDocPos !== that.tokenDocPos) return false;
    return true;
  }

  // Upstream line 65-71. Java's `31 * x + y` integer arithmetic; emulate with Math.imul/|0.
  hashCode(): number {
    let result = this.blockPtr;
    result = (Math.imul(31, result) + this.tokenBlockPos) | 0;
    result = (Math.imul(31, result) + this.tokenDocPos) | 0;
    return result;
  }
}
