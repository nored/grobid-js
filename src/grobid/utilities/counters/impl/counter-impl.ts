// Port of org.grobid.core.utilities.counters.impl.CounterImpl.
// Upstream: grobid-core/src/main/java/org/grobid/core/utilities/counters/impl/CounterImpl.java
//
// Upstream wraps a `java.util.concurrent.atomic.AtomicLong`. JS is
// single-threaded; a plain `number` mirrors the semantics within one event
// loop turn.

import type { Counter } from "../counter.js";

export class CounterImpl implements Counter {
  private cntVal: number = 0;

  public constructor(cnt?: number) {
    if (cnt !== undefined) {
      this.cntVal = cnt;
    }
  }

  public i(val?: number): void {
    if (val === undefined) {
      // incrementAndGet
      this.cntVal = this.cntVal + 1;
    } else {
      // addAndGet
      this.cntVal = this.cntVal + val;
    }
  }

  public cnt(): number {
    return this.cntVal;
  }

  public set(val: number): void {
    this.cntVal = val;
  }

  public equals(o: unknown): boolean {
    if (this === o) return true;
    if (o === null || o === undefined) return false;
    if (!(o instanceof CounterImpl)) return false;
    return this.cntVal === o.cntVal;
  }

  public hashCode(): number {
    return this.cntVal | 0;
  }
}
