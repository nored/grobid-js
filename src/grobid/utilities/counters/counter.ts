// Port of org.grobid.core.utilities.counters.Counter.
// Upstream: grobid-core/src/main/java/org/grobid/core/utilities/counters/Counter.java

export interface Counter {
  i(): void;
  i(val: number): void;
  cnt(): number;
  set(val: number): void;
}
