// Port of org.grobid.core.utilities.OffsetPosition.
// Upstream: grobid-core/src/main/java/org/grobid/core/utilities/OffsetPosition.java

/**
 * Half-open `[start, end)` offset range. Used by feature factories and
 * lexicon matchers to mark spans inside a token stream or character offset
 * range. Upstream exposes `start`/`end` as public mutable fields; we mirror
 * that contract (some upstream code rewrites end positions in place).
 */
export class OffsetPosition {
  start: number = -1;
  end: number = -1;

  constructor(start?: number, end?: number) {
    if (start !== undefined) this.start = start;
    if (end !== undefined) this.end = end;
  }

  overlaps(pos: OffsetPosition): boolean {
    return !(this.end <= pos.start || this.start >= pos.end);
  }

  toString(): string {
    return `${this.start}\t${this.end}`;
  }

  /**
   * Java `Comparable<OffsetPosition>` ordering: by start asc, then by end
   * asc. Returns -1/0/1 like Java's `compareTo`.
   */
  compareTo(pos: OffsetPosition): number {
    if (pos.start < this.start) return 1;
    if (pos.start > this.start) return -1;
    if (pos.end < this.end) return 1;
    if (pos.end > this.end) return -1;
    return 0;
  }

  equals(o: unknown): boolean {
    if (this === o) return true;
    if (!(o instanceof OffsetPosition)) return false;
    return this.start === o.start && this.end === o.end;
  }
}
