// Port of org.grobid.core.utilities.ElementCounter.
// Upstream: grobid-core/src/main/java/org/grobid/core/utilities/ElementCounter.java

import { ElementCounterItem } from "./element-counter-item.js";

/**
 * Frequency counter over arbitrary keys. Insertion order is preserved
 * (matches Java's LinkedHashMap). Used by upstream for label / token
 * frequency tracking during training and post-processing.
 */
export class ElementCounter<T> {
  private cnts: Map<T, number>;

  constructor(initial?: Map<T, number>) {
    this.cnts = initial ?? new Map();
  }

  /** Increment count for `obj` by `val` (defaults to 1). */
  i(obj: T, val: number = 1): void {
    const cur = this.cnts.get(obj);
    this.cnts.set(obj, (cur ?? 0) + val);
  }

  cnt(obj: T): number {
    return this.cnts.get(obj) ?? 0;
  }

  getCnts(): Map<T, number> {
    return this.cnts;
  }

  /** Jackson-style bulk setter. */
  setCountItems(items: ElementCounterItem<T>[]): void {
    for (const i of items) {
      const item = i.getItem();
      const cnt = i.getCnt();
      if (item !== undefined && cnt !== undefined) {
        this.cnts.set(item, cnt);
      }
    }
  }

  /** Entries sorted by count desc. */
  getSortedCounts(): [T, number][] {
    return [...this.cnts.entries()].sort((a, b) => b[1] - a[1]);
  }

  size(): number {
    return this.cnts.size;
  }

  getCountItems(): ElementCounterItem<T>[] {
    return [...this.cnts.entries()].map(([k, v]) => new ElementCounterItem<T>(k, v));
  }

  toString(): string {
    return `ElementCounter{cnts=${JSON.stringify([...this.cnts.entries()])}}`;
  }
}
