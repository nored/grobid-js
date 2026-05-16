// Port of org.grobid.core.utilities.Triple.
// Upstream: grobid-core/src/main/java/org/grobid/core/utilities/Triple.java

/**
 * Immutable 3-tuple. Upstream exposes Guava-style `getAFunction`/`getBFunction`/
 * `getCFunction` extractors for use with `Function<Triple, X>` — we omit those
 * Guava-specific projections; callers can use `(t) => t.getA()` directly.
 */
export class Triple<A, B, C> {
  private readonly _a: A;
  private readonly _b: B;
  private readonly _c: C;

  constructor(a: A, b: B, c: C) {
    this._a = a;
    this._b = b;
    this._c = c;
  }

  getA(): A {
    return this._a;
  }

  getB(): B {
    return this._b;
  }

  getC(): C {
    return this._c;
  }

  toString(): string {
    return `('${this._a}'; '${this._b}'; '${this._c}')`;
  }

  static equals<A, B, C>(
    x: Triple<A, B, C> | null | undefined,
    y: Triple<A, B, C> | null | undefined,
  ): boolean {
    if (x === y) return true;
    if (!x || !y) return false;
    return Object.is(x.getA(), y.getA()) && Object.is(x.getB(), y.getB()) && Object.is(x.getC(), y.getC());
  }
}
