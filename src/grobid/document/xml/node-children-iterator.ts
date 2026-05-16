// Port of org.grobid.core.document.xml.NodeChildrenIterator.
// Upstream: grobid-core/src/main/java/org/grobid/core/document/xml/NodeChildrenIterator.java
//
// Iterates the children of a XOM node, optionally filtering by a blacklist
// of element local names (or "text" for Text nodes).

import { Element, Text } from "./xml-builder-utils.js";
import type { Node } from "./xml-builder-utils.js";

/**
 * Predicate (upstream inner class lines 16-27): retains a node when:
 *  - it is a `Text` node and "text" is NOT in the blacklist, OR
 *  - it is an `Element` and its local name is NOT in the blacklist.
 */
class BlacklistElementNamePredicate {
  private blacklistElements: Set<string> = new Set<string>();

  constructor(...elementNames: string[]) {
    for (const n of elementNames) {
      this.blacklistElements.add(n);
    }
  }

  // Upstream line 24-26.
  apply(input: Node): boolean {
    return (
      (input instanceof Text && !this.blacklistElements.has("text")) ||
      (input instanceof Element && !this.blacklistElements.has((input as Element).getLocalName()))
    );
  }
}

/**
 * Upstream NodeChildrenIterator.java line 15-70.
 *
 * Provides `iterator()` and also `[Symbol.iterator]()` so the instance can
 * be used directly in `for...of`.
 */
export class NodeChildrenIterator implements Iterable<Node>, Iterator<Node> {
  // Upstream line 30-31.
  private node: Node | null;
  private cur: number;
  // Optional filter when produced via `get(parent, ...blacklist)`.
  private filter: BlacklistElementNamePredicate | null = null;

  // Upstream line 33-36 — private constructor.
  private constructor(node: Node | null) {
    this.node = node;
    this.cur = 0;
  }

  // Upstream line 38-41.
  iterator(): NodeChildrenIterator {
    return this;
  }

  [Symbol.iterator](): NodeChildrenIterator {
    return this;
  }

  private childCount(): number {
    if (this.node instanceof Element) return this.node.getChildCount();
    return 0;
  }

  private childAt(index: number): Node {
    if (this.node instanceof Element) return this.node.getChild(index);
    throw new Error("NoSuchElementException");
  }

  // Upstream line 43-46.
  hasNext(): boolean {
    if (this.node === null) return false;
    if (this.filter === null) {
      return this.cur < this.childCount();
    }
    // With a filter, scan ahead until we find a passing element.
    while (this.cur < this.childCount()) {
      if (this.filter.apply(this.childAt(this.cur))) {
        return true;
      }
      this.cur++;
    }
    return false;
  }

  // Upstream line 48-55.
  next(): IteratorResult<Node> {
    if (this.node === null || this.cur === this.childCount()) {
      if (this.filter === null) {
        return { value: undefined as unknown as Node, done: true };
      }
    }
    if (this.filter !== null) {
      while (this.cur < this.childCount()) {
        const child = this.childAt(this.cur++);
        if (this.filter.apply(child)) {
          return { value: child, done: false };
        }
      }
      return { value: undefined as unknown as Node, done: true };
    }
    return { value: this.childAt(this.cur++), done: false };
  }

  // Upstream line 57-60.
  remove(): void {
    throw new Error("UnsupportedOperationException");
  }

  // Upstream line 62-64.
  static get(parent: Node): Iterable<Node>;
  // Upstream line 66-68.
  static get(parent: Node, ...blacklistedNodes: string[]): Iterable<Node>;
  static get(parent: Node, ...blacklistedNodes: string[]): Iterable<Node> {
    const it = new NodeChildrenIterator(parent);
    if (blacklistedNodes.length > 0) {
      it.filter = new BlacklistElementNamePredicate(...blacklistedNodes);
    }
    return it;
  }
}
