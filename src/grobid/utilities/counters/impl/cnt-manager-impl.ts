// Port of org.grobid.core.utilities.counters.impl.CntManagerImpl.
// Upstream: grobid-core/src/main/java/org/grobid/core/utilities/counters/impl/CntManagerImpl.java
//
// Upstream uses java.util.concurrent ConcurrentHashMap for thread safety; we
// use plain `Map` since the JS runtime is single-threaded.

import type { Countable } from "../../../engines/counters/countable.js";
import type { CntManager } from "../cnt-manager.js";
import type { CntsMetric } from "../cnts-metric.js";
import type { Counter } from "../counter.js";

import { CounterImpl } from "./counter-impl.js";

export class CntManagerImpl implements CntManager {
  private classCounters: Map<string, Map<string, Counter>> = new Map();
  private strCnts: Map<string, Map<string, Counter>> = new Map();
  private metrics: Map<string, CntsMetric> | null = null;

  private checkGroupName(groupName: string): void {
    if (this.classCounters.has(groupName)) {
      throw new Error(
        "Group name " + groupName + " coincides with the enum type counter name",
      );
    }
  }

  private checkClass(class1: string): void {
    if (this.strCnts.has(class1)) {
      throw new Error(
        "Enum class name " + class1 + " coincides with the string type counter name",
      );
    }
  }

  public i(eOrGroup: Countable | string, valOrName?: number | string, val?: number): void {
    if (typeof eOrGroup === "string") {
      // i(group, name) or i(group, name, val)
      const group = eOrGroup;
      const name = valOrName as string;
      const v = val === undefined ? 1 : val;
      this.checkGroupName(group);

      if (!this.strCnts.has(group)) {
        this.strCnts.set(group, new Map<string, Counter>());
      }
      const cntMap = this.strCnts.get(group)!;
      if (!cntMap.has(name)) {
        cntMap.set(name, new CounterImpl());
      }
      const cnt = cntMap.get(name)!;
      cnt.i(v);
    } else {
      // i(Countable) or i(Countable, val)
      const e = eOrGroup;
      const v = valOrName === undefined ? 1 : (valOrName as number);
      const groupName = this.getCounterEnclosingName(e);
      this.checkClass(groupName);

      if (!this.classCounters.has(groupName)) {
        this.classCounters.set(groupName, new Map<string, Counter>());
      }
      const cntMap = this.classCounters.get(groupName)!;

      if (!cntMap.has(e.getName())) {
        cntMap.set(e.getName(), new CounterImpl());
      }
      const cnt = cntMap.get(e.getName())!;
      cnt.i(v);
    }
  }

  public cnt(eOrGroup: Countable | string, name?: string): number {
    if (typeof eOrGroup === "string") {
      const group = eOrGroup;
      const cntMap = this.strCnts.get(group);
      if (cntMap === undefined) {
        return 0;
      }
      const cnt = cntMap.get(name!);
      return cnt === undefined ? 0 : cnt.cnt();
    } else {
      const e = eOrGroup;
      const cntMap = this.classCounters.get(this.getCounterEnclosingName(e));
      if (cntMap === undefined) {
        return 0;
      }
      const cnt = cntMap.get(e.getName());
      return cnt === undefined ? 0 : cnt.cnt();
    }
  }

  public getCounter(eOrGroup: Countable | string, name?: string): Counter {
    if (typeof eOrGroup === "string") {
      const group = eOrGroup;
      this.checkGroupName(group);
      if (!this.strCnts.has(group)) {
        this.strCnts.set(group, new Map<string, Counter>());
      }
      const cntMap = this.strCnts.get(group)!;
      if (!cntMap.has(name!)) {
        cntMap.set(name!, new CounterImpl());
      }
      return cntMap.get(name!)!;
    } else {
      const e = eOrGroup;
      this.checkClass(e.getName());
      // Upstream Java has a bug here: it puts under e.getName() but reads under enclosing class name.
      // Preserved verbatim.
      if (!this.classCounters.has(e.getName())) {
        this.classCounters.set(e.getName(), new Map<string, Counter>());
      }

      const enclosingName = this.getCounterEnclosingName(e);
      if (!this.classCounters.has(enclosingName)) {
        this.classCounters.set(enclosingName, new Map<string, Counter>());
      }
      const cntMap = this.classCounters.get(enclosingName)!;
      if (!cntMap.has(e.getName())) {
        cntMap.set(e.getName(), new CounterImpl());
      }
      return cntMap.get(e.getName())!;
    }
  }

  public getCounters(
    countableClass: { new (...args: unknown[]): Countable } | string,
  ): Map<string, number> {
    const toReturn: Map<string, number> = new Map();
    // In Java this is Class<? extends Countable> with .getName() returning the fully-qualified
    // class name. Our port accepts either a string (the group name) directly or a constructor
    // function whose `.name` is the simple class name; callers using the constructor form must
    // ensure the name matches the group name recorded by `getCounterEnclosingName`.
    const key: string =
      typeof countableClass === "string"
        ? countableClass
        : (countableClass as { name: string }).name;
    const stringCounterMap = this.classCounters.get(key);
    if (stringCounterMap !== undefined) {
      for (const innerKey of stringCounterMap.keys()) {
        toReturn.set(innerKey, stringCounterMap.get(innerKey)!.cnt());
      }
    }
    return toReturn;
  }

  public getCountersByGroup(group: string): Map<string, number> {
    const toReturn: Map<string, number> = new Map();
    if (this.strCnts.has(group)) {
      const m = this.strCnts.get(group)!;
      for (const [key, value] of m.entries()) {
        toReturn.set(key, value.cnt());
      }
    }
    return toReturn;
  }

  public getAllCounters(): Map<string, Map<string, number>> {
    const map: Map<string, Map<string, number>> = new Map();
    for (const e of this.classCounters.keys()) {
      // The Java original uses Class.forName(e); for our port we just collect the inner counts
      // directly from classCounters since we cannot reflectively load classes.
      const inner = this.classCounters.get(e)!;
      const m: Map<string, number> = new Map();
      for (const [innerKey, counter] of inner.entries()) {
        m.set(innerKey, counter.cnt());
      }
      map.set(e, m);
    }

    for (const e of this.strCnts.keys()) {
      map.set(e, this.getCountersByGroup(e));
    }

    return map;
  }

  public flattenAllCounters(separator: string): Map<string, number> {
    const map: Map<string, number> = new Map();
    for (const [groupKey, groupVal] of this.getAllCounters().entries()) {
      for (const [eKey, eVal] of groupVal.entries()) {
        map.set(groupKey + separator + eKey, eVal);
      }
    }
    return map;
  }

  public addMetric(name: string, cntsMetric: CntsMetric): void {
    if (this.metrics === null) {
      this.metrics = new Map();
    }
    this.metrics.set(name, cntsMetric);
  }

  public removeMetric(name: string): void {
    if (this.metrics === null) {
      this.metrics = new Map();
    }
    this.metrics.delete(name);
  }

  public toString(): string {
    const sb: string[] = [];
    for (const [mKey, mVal] of this.getAllCounters().entries()) {
      sb.push(
        "\n************************************************************************************\n",
      );
      sb.push("COUNTER: ");
      sb.push(mKey);
      sb.push(
        "\n************************************************************************************",
      );
      sb.push(
        "\n------------------------------------------------------------------------------------\n",
      );
      let maxLength = 0;
      for (const csKey of mVal.keys()) {
        if (maxLength < csKey.length) {
          maxLength = csKey.length;
        }
      }

      for (const [csKey, csVal] of mVal.entries()) {
        sb.push("  ");
        sb.push(csKey);
        sb.push(": ");
        // Java: new String(new char[maxLength - cs.getKey().length()]).replace('\0', ' ')
        sb.push(" ".repeat(maxLength - csKey.length));
        sb.push(String(csVal));
        sb.push("\n");
      }
      sb.push(
        "====================================================================================\n",
      );
    }

    if (this.metrics !== null && this.metrics.size > 0) {
      sb.push(
        "\n++++++++++++++++++++++++++++++ METRICS +++++++++++++++++++++++++++++++++++++++++++++\n",
      );
      for (const [k, v] of this.metrics.entries()) {
        sb.push(k);
        sb.push(": ");
        sb.push(v.getMetricString(this));
        sb.push("\n");
      }
    }
    sb.push(
      "====================================================================================\n",
    );

    return sb.join("");
  }

  public equals(o: unknown): boolean {
    if (this === o) return true;
    if (o === null || o === undefined) return false;
    if (!(o instanceof CntManagerImpl)) return false;
    // Compare maps by key/value equality (CounterImpl.equals handles individual entries).
    return (
      CntManagerImpl.mapEquals(this.classCounters, o.classCounters) &&
      CntManagerImpl.mapEquals(this.strCnts, o.strCnts)
    );
  }

  public hashCode(): number {
    let result = this.classCounters !== null ? this.classCounters.size : 0;
    result = (31 * result + (this.strCnts !== null ? this.strCnts.size : 0)) | 0;
    return result;
  }

  protected getCounterEnclosingName(e: Countable): string {
    // Java uses e.getClass().getEnclosingClass().getName() falling back to e.getClass().getName().
    // Our Countable interface exposes getGroupName() to provide the enclosing class identity
    // (see countable.ts for context).
    return e.getGroupName();
  }

  private static mapEquals(
    a: Map<string, Map<string, Counter>>,
    b: Map<string, Map<string, Counter>>,
  ): boolean {
    if (a.size !== b.size) return false;
    for (const [key, value] of a.entries()) {
      const other = b.get(key);
      if (other === undefined) return false;
      if (value.size !== other.size) return false;
      for (const [innerKey, innerValue] of value.entries()) {
        const otherInner = other.get(innerKey);
        if (otherInner === undefined) return false;
        if (innerValue.cnt() !== otherInner.cnt()) return false;
      }
    }
    return true;
  }
}
