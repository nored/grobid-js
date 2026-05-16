// Port of org.grobid.core.utilities.ConsolidationCounters.
// Upstream: grobid-core/src/main/java/org/grobid/core/utilities/ConsolidationCounters.java

import type { Countable } from "../engines/counters/countable.js";

const GROUP = "org.grobid.core.utilities.ConsolidationCounters";

/**
 * Counters for keeping track of consolidation activity and results
 */
export class ConsolidationCounters {
  static readonly CONSOLIDATION: Countable = {
    getName(): string {
      return "CONSOLIDATION";
    },
    getGroupName(): string {
      return GROUP;
    },
  };
  static readonly CONSOLIDATION_SUCCESS: Countable = {
    getName(): string {
      return "CONSOLIDATION_SUCCESS";
    },
    getGroupName(): string {
      return GROUP;
    },
  };
  static readonly CONSOLIDATION_PER_DOI: Countable = {
    getName(): string {
      return "CONSOLIDATION_PER_DOI";
    },
    getGroupName(): string {
      return GROUP;
    },
  };
  static readonly CONSOLIDATION_PER_DOI_SUCCESS: Countable = {
    getName(): string {
      return "CONSOLIDATION_PER_DOI_SUCCESS";
    },
    getGroupName(): string {
      return GROUP;
    },
  };
  static readonly TOTAL_BIB_REF: Countable = {
    getName(): string {
      return "TOTAL_BIB_REF";
    },
    getGroupName(): string {
      return GROUP;
    },
  };
}
