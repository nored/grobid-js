// Port of org.grobid.core.utilities.Pair.
// Upstream: grobid-core/src/main/java/org/grobid/core/utilities/Pair.java

/**
 * Immutable 2-tuple. Java upstream exposes `a`/`b` as public final fields
 * and also provides `getA()`/`getB()` getters; we mirror both. `equals` /
 * `hashCode` from the Java version don't have direct JS equivalents (no
 * structural equality at the language level); use `Pair.equals(p, q)` for
 * deep equality when needed.
 */
export class Pair<A, B> {
  readonly a: A;
  readonly b: B;

  constructor(a: A, b: B) {
    this.a = a;
    this.b = b;
  }

  getA(): A {
    return this.a;
  }

  getB(): B {
    return this.b;
  }

  toString(): string {
    return `('${this.a}'; '${this.b}')`;
  }

  static equals<A, B>(x: Pair<A, B> | null | undefined, y: Pair<A, B> | null | undefined): boolean {
    if (x === y) return true;
    if (!x || !y) return false;
    return Object.is(x.a, y.a) && Object.is(x.b, y.b);
  }
}
