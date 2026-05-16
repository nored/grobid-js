// Port of org.grobid.core.utilities.LevenshteinDistanceAligment.
// Upstream: grobid-core/src/main/java/org/grobid/core/utilities/LevenshteinDistanceAligment.java
//
// Lazy-evaluated Levenshtein distance + alignment, following L. Allison's
// O(|a|·D(a,b)) lazy dynamic-programming algorithm. Class name's "Aligment"
// typo is preserved verbatim from upstream so cross-references match.

export enum LevenshteinOp {
  Start = "Start",
  Match = "Match",
  Insert = "Insert",
  Delete = "Delete",
  Substitute = "Substitute",
}

class Diagonal<E> {
  readonly offset: number;
  /** Left sequence. */
  private readonly a: E[];
  /** Top sequence. */
  private readonly b: E[];
  /** Below-left diagonal. */
  prev: Diagonal<E> | null;
  /** Above-right diagonal. */
  next: Diagonal<E> | null = null;
  /** Computed elements; never empty after construction. */
  private readonly elements: number[] = [];

  constructor(a: E[], b: E[], diagBelow: Diagonal<E> | null, offset: number) {
    if (Math.abs(offset) > b.length) {
      throw new Error(`offset out of range: ${offset}`);
    }
    this.a = a;
    this.b = b;
    this.prev = diagBelow;
    this.offset = offset;
    this.elements.push(Math.abs(offset));
  }

  getBelow(): Diagonal<E> {
    if (this.prev === null) {
      if (this.offset !== 0) throw new Error("expected main diagonal");
      // lower half has a, b switched
      this.prev = new Diagonal<E>(this.b, this.a, this, -1);
    }
    return this.prev;
  }

  getAbove(): Diagonal<E> {
    if (this.next === null) {
      this.next = new Diagonal<E>(this.a, this.b, this, this.offset >= 0 ? this.offset + 1 : this.offset - 1);
    }
    return this.next;
  }

  /** Entry to the left of position i on this diagonal. */
  getW(i: number): number {
    return this.getBelow().get(this.offset === 0 ? i - 1 : i);
  }

  /** Entry above position i on this diagonal. */
  getN(i: number): number {
    return this.getAbove().get(i - 1);
  }

  /** Compute element j of this diagonal, memoizing along the way. */
  get(j: number): number {
    if (j < this.elements.length) return this.elements[j]!;
    let me = this.elements[this.elements.length - 1]!;
    while (this.elements.length <= j) {
      const nw = me;
      const i = this.elements.length;
      if (eq(this.a[i - 1]!, this.b[Math.abs(this.offset) + i - 1]!)) {
        me = nw;
      } else {
        const w = this.getW(i);
        if (w < nw) {
          me = 1 + w;
        } else {
          const n = this.getN(i);
          me = 1 + Math.min(nw, n);
        }
      }
      this.elements.push(me);
    }
    return me;
  }

  getOp(i: number): LevenshteinOp {
    if (i === 0) {
      if (this.offset === 0) return LevenshteinOp.Start;
      if (this.offset > 0) return LevenshteinOp.Insert;
      return LevenshteinOp.Delete;
    } else if (this.offset + i - 1 >= 0) {
      if (eq(this.a[i - 1]!, this.b[this.offset + i - 1]!)) return LevenshteinOp.Match;
      const me = this.get(i);
      const w = this.getW(i);
      const nw = this.get(i - 1);
      if (me === 1 + w) return this.offset >= 0 ? LevenshteinOp.Insert : LevenshteinOp.Delete;
      if (me === 1 + nw) return LevenshteinOp.Substitute;
      return this.offset >= 0 ? LevenshteinOp.Delete : LevenshteinOp.Insert;
    } else {
      const me = this.get(i);
      const w = this.getW(i);
      const nw = this.get(i - 1);
      if (me === 1 + w) return this.offset >= 0 ? LevenshteinOp.Insert : LevenshteinOp.Delete;
      if (me === 1 + nw) return LevenshteinOp.Substitute;
      return this.offset >= 0 ? LevenshteinOp.Delete : LevenshteinOp.Insert;
    }
  }
}

function eq<E>(x: E, y: E): boolean {
  if (x === y) return true;
  // Allow user-defined .equals for boxed types.
  const e = (x as { equals?: (o: unknown) => boolean })?.equals;
  if (typeof e === "function") return e.call(x, y);
  return false;
}

export class LevenshteinDistanceAligment<E> {
  private readonly a: E[];
  private readonly b: E[];
  private diag!: Diagonal<E>;
  private dist: number = 0;
  private twist: boolean = false;

  constructor(aIn: E[], bIn: E[]) {
    if (aIn.length < bIn.length) {
      this.a = aIn;
      this.b = bIn;
      this.twist = false;
    } else {
      this.a = bIn;
      this.b = aIn;
      this.twist = true;
    }
    this.compute();
  }

  private compute(): void {
    const mainDiag = new Diagonal<E>(this.a, this.b, null, 0);
    const lba = this.b.length - this.a.length;
    let cur: Diagonal<E>;
    if (lba >= 0) {
      cur = mainDiag;
      for (let i = 0; i < lba; i++) cur = cur.getAbove();
    } else {
      cur = mainDiag.getBelow();
      // Java `~lba` is bitwise NOT — equivalent to `-lba - 1`.
      const iters = -lba - 1;
      for (let i = 0; i < iters; i++) cur = cur.getAbove();
    }
    this.diag = cur;
    this.dist = this.diag.get(Math.min(this.a.length, this.b.length));
  }

  getDistance(): number {
    return this.dist;
  }

  getAlignment(): LevenshteinOp[] {
    let diag: Diagonal<E> | null = this.diag;
    const reversed: LevenshteinOp[] = [];
    let i = Math.min(this.a.length, this.b.length);
    while (true) {
      if (diag === null) break;
      const op = diag.getOp(i);
      switch (op) {
        case LevenshteinOp.Match:
        case LevenshteinOp.Substitute:
          i--;
          break;
        case LevenshteinOp.Insert:
          if (diag.offset === 0) {
            diag = diag.prev;
            i--;
          } else if (diag.offset >= 0) {
            diag = diag.prev;
          } else {
            diag = diag.next;
            i--;
          }
          break;
        case LevenshteinOp.Delete:
          if (diag.offset === 0) {
            diag = diag.next;
            i--;
          } else if (diag.offset >= 0) {
            diag = diag.next;
            i--;
          } else {
            diag = diag.prev;
          }
          break;
        case LevenshteinOp.Start:
          return this.twistResult(reversed.reverse());
      }
      reversed.push(op);
    }
    return this.twistResult(reversed.reverse());
  }

  private twistResult(ops: LevenshteinOp[]): LevenshteinOp[] {
    if (!this.twist) return ops;
    return ops.map((op) => {
      if (op === LevenshteinOp.Delete) return LevenshteinOp.Insert;
      if (op === LevenshteinOp.Insert) return LevenshteinOp.Delete;
      return op;
    });
  }

  static str2chararray(x: string): string[] {
    return [...x];
  }
}
