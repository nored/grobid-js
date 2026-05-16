// Port of org.grobid.core.utilities.ElementCounterItem.
// Upstream: grobid-core/src/main/java/org/grobid/core/utilities/ElementCounterItem.java

/**
 * Simple (item, count) pair. Used by ElementCounter for serialization.
 */
export class ElementCounterItem<T> {
  private readonly item: T | undefined;
  private readonly cnt: number | undefined;

  constructor(item?: T, cnt?: number) {
    this.item = item;
    this.cnt = cnt;
  }

  getItem(): T | undefined {
    return this.item;
  }

  getCnt(): number | undefined {
    return this.cnt;
  }
}
