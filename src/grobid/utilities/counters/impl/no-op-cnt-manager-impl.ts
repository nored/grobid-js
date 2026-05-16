// Port of org.grobid.core.utilities.counters.impl.NoOpCntManagerImpl.
// Upstream: grobid-core/src/main/java/org/grobid/core/utilities/counters/impl/NoOpCntManagerImpl.java

import type { Countable } from "../../../engines/counters/countable.js";
import type { CntManager } from "../cnt-manager.js";
import type { CntsMetric } from "../cnts-metric.js";
import type { Counter } from "../counter.js";

export class NoOpCntManagerImpl implements CntManager {
  public i(_eOrGroup: Countable | string, _valOrName?: number | string, _val?: number): void {
    void _eOrGroup;
    void _valOrName;
    void _val;
  }

  public cnt(_eOrGroup: Countable | string, _name?: string): number {
    void _eOrGroup;
    void _name;
    return 0;
  }

  public getCounter(_eOrGroup: Countable | string, _name?: string): Counter {
    void _eOrGroup;
    void _name;
    return null as unknown as Counter;
  }

  public getCounters(
    _countableClass: { new (...args: unknown[]): Countable } | string,
  ): Map<string, number> {
    void _countableClass;
    return null as unknown as Map<string, number>;
  }

  public getCountersByGroup(_group: string): Map<string, number> {
    void _group;
    return null as unknown as Map<string, number>;
  }

  public getAllCounters(): Map<string, Map<string, number>> {
    return null as unknown as Map<string, Map<string, number>>;
  }

  public flattenAllCounters(_separator: string): Map<string, number> {
    void _separator;
    return null as unknown as Map<string, number>;
  }

  public addMetric(_name: string, _cntsMetric: CntsMetric): void {
    void _name;
    void _cntsMetric;
  }

  public removeMetric(_name: string): void {
    void _name;
  }
}
