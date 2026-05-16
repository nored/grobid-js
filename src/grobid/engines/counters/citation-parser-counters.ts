// Port of org.grobid.core.engines.counters.CitationParserCounters.
// Upstream: grobid-core/src/main/java/org/grobid/core/engines/counters/CitationParserCounters.java

import type { Countable } from "./countable.js";

const GROUP = "org.grobid.core.engines.counters.CitationParserCounters";

export class CitationParserCounters {
  static readonly SEGMENTED_REFERENCES: Countable = {
    getName(): string {
      return "SEGMENTED_REFERENCES";
    },
    getGroupName(): string {
      return GROUP;
    },
  };

  static readonly NULL_SEGMENTED_REFERENCES_LIST: Countable = {
    getName(): string {
      return "NULL_SEGMENTED_REFERENCES_LIST";
    },
    getGroupName(): string {
      return GROUP;
    },
  };

  static readonly EMPTY_REFERENCES_BLOCKS: Countable = {
    getName(): string {
      return "EMPTY_REFERENCES_BLOCKS";
    },
    getGroupName(): string {
      return GROUP;
    },
  };

  static readonly NOT_EMPTY_REFERENCES_BLOCKS: Countable = {
    getName(): string {
      return "NOT_EMPTY_REFERENCES_BLOCKS";
    },
    getGroupName(): string {
      return GROUP;
    },
  };
}
