// Port of org.grobid.core.engines.counters.Countable.
// Upstream: grobid-core/src/main/java/org/grobid/core/engines/counters/Countable.java
//
// Upstream Countable is a marker interface implemented by enum types nested
// inside grouping classes (e.g. `CitationParserCounters$Counters`). The Java
// CntManagerImpl uses `e.getClass().getEnclosingClass().getName()` to derive
// the group name. TypeScript has no class introspection equivalent, so the
// canonical port adds `getGroupName()` as a sibling to `getName()` and each
// Countable value supplies the group name explicitly.

export interface Countable {
  getName(): string;
  getGroupName(): string;
}
