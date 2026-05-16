// Port of org.grobid.core.engines.counters.ReferenceMarkerMatcherCounters.
// Upstream: grobid-core/src/main/java/org/grobid/core/engines/counters/ReferenceMarkerMatcherCounters.java

import type { Countable } from "./countable.js";

const GROUP = "org.grobid.core.engines.counters.ReferenceMarkerMatcherCounters";

export class ReferenceMarkerMatcherCounters {
  static readonly MATCHED_REF_MARKERS: Countable = {
    getName(): string {
      return "MATCHED_REF_MARKERS";
    },
    getGroupName(): string {
      return GROUP;
    },
  };

  static readonly UNMATCHED_REF_MARKERS: Countable = {
    getName(): string {
      return "UNMATCHED_REF_MARKERS";
    },
    getGroupName(): string {
      return GROUP;
    },
  };

  static readonly NO_CANDIDATES: Countable = {
    getName(): string {
      return "NO_CANDIDATES";
    },
    getGroupName(): string {
      return GROUP;
    },
  };

  static readonly MANY_CANDIDATES: Countable = {
    getName(): string {
      return "MANY_CANDIDATES";
    },
    getGroupName(): string {
      return GROUP;
    },
  };

  static readonly STYLE_AUTHORS: Countable = {
    getName(): string {
      return "STYLE_AUTHORS";
    },
    getGroupName(): string {
      return GROUP;
    },
  };

  static readonly STYLE_NUMBERED: Countable = {
    getName(): string {
      return "STYLE_NUMBERED";
    },
    getGroupName(): string {
      return GROUP;
    },
  };

  static readonly MATCHED_REF_MARKERS_AFTER_POST_FILTERING: Countable = {
    getName(): string {
      return "MATCHED_REF_MARKERS_AFTER_POST_FILTERING";
    },
    getGroupName(): string {
      return GROUP;
    },
  };

  static readonly MANY_CANDIDATES_AFTER_POST_FILTERING: Countable = {
    getName(): string {
      return "MANY_CANDIDATES_AFTER_POST_FILTERING";
    },
    getGroupName(): string {
      return GROUP;
    },
  };

  static readonly NO_CANDIDATES_AFTER_POST_FILTERING: Countable = {
    getName(): string {
      return "NO_CANDIDATES_AFTER_POST_FILTERING";
    },
    getGroupName(): string {
      return GROUP;
    },
  };

  static readonly STYLE_OTHER: Countable = {
    getName(): string {
      return "STYLE_OTHER";
    },
    getGroupName(): string {
      return GROUP;
    },
  };

  static readonly INPUT_REF_STRINGS_CNT: Countable = {
    getName(): string {
      return "INPUT_REF_STRINGS_CNT";
    },
    getGroupName(): string {
      return GROUP;
    },
  };
}
