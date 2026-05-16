// Port of org.grobid.core.utilities.counters.CntManager.
// Upstream: grobid-core/src/main/java/org/grobid/core/utilities/counters/CntManager.java

import type { Countable } from "../../engines/counters/countable.js";

import type { CntsMetric } from "./cnts-metric.js";
import type { Counter } from "./counter.js";

export interface CntManager {
  i(e: Countable): void;
  i(e: Countable, val: number): void;
  i(group: string, name: string): void;
  i(group: string, name: string, val: number): void;

  cnt(e: Countable): number;
  cnt(group: string, name: string): number;

  getCounter(e: Countable): Counter;
  getCounter(group: string, name: string): Counter;

  getCounters(countableClass: { new (...args: unknown[]): Countable } | string): Map<string, number>;
  getCountersByGroup(group: string): Map<string, number>;

  getAllCounters(): Map<string, Map<string, number>>;

  flattenAllCounters(separator: string): Map<string, number>;

  addMetric(name: string, cntsMetric: CntsMetric): void;
  removeMetric(name: string): void;
}
