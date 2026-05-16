// Port of org.grobid.core.document.xml.NodesIterator.
// Upstream: grobid-core/src/main/java/org/grobid/core/document/xml/NodesIterator.java
//
// Iterates a XOM `Nodes` collection (the result of an XPath query). In TS we
// expose the iterator-of-Node interface used by callers — TS `Symbol.iterator`
// makes the value usable in `for...of` loops, matching Java's `Iterable<Node>`.

import type { Node } from "./xml-builder-utils.js";

/**
 * `Iterable<Node>` and `Iterator<Node>` wrapper around an array of nodes.
 *
 * Upstream NodesIterator.java line 9-41.
 */
export class NodesIterator implements Iterable<Node>, Iterator<Node> {
  // Upstream line 10-11.
  private nodes: Node[];
  private cur: number;

  constructor(nodes: Node[]) {
    this.nodes = nodes;
    this.cur = 0;
  }

  // Upstream line 18-21: `iterator()` returns `this`.
  iterator(): NodesIterator {
    return this;
  }

  [Symbol.iterator](): NodesIterator {
    return this;
  }

  // Upstream line 23-26.
  hasNext(): boolean {
    return this.cur < this.nodes.length;
  }

  // Upstream line 28-35.
  next(): IteratorResult<Node> {
    if (this.cur === this.nodes.length) {
      // Match Java's NoSuchElementException semantics by returning done.
      return { value: undefined as unknown as Node, done: true };
    }
    return { value: this.nodes[this.cur++] as Node, done: false };
  }

  // Upstream line 37-40.
  remove(): void {
    throw new Error("UnsupportedOperationException");
  }
}
