// Port of org.grobid.core.engines.counters.TableRejectionCounters.
// Upstream: grobid-core/src/main/java/org/grobid/core/engines/counters/TableRejectionCounters.java

import type { Countable } from "./countable.js";

const GROUP = "org.grobid.core.engines.counters.TableRejectionCounters";

export class TableRejectionCounters {
  static readonly CANNOT_PARSE_LABEL_TO_INT: Countable = {
    getName(): string {
      return "CANNOT_PARSE_LABEL_TO_INT";
    },
    getGroupName(): string {
      return GROUP;
    },
  };

  static readonly HEADER_NOT_STARTS_WITH_TABLE_WORD: Countable = {
    getName(): string {
      return "HEADER_NOT_STARTS_WITH_TABLE_WORD";
    },
    getGroupName(): string {
      return GROUP;
    },
  };

  static readonly HEADER_AND_CONTENT_INTERSECT: Countable = {
    getName(): string {
      return "HEADER_AND_CONTENT_INTERSECT";
    },
    getGroupName(): string {
      return GROUP;
    },
  };

  // Fixed from upstream: upstream's `HEADER_AREA_BIGGER_THAN_CONTENT.getName()`
  // returns the sibling string `"HEADER_NOT_STARTS_WITH_TABLE_WORD"`, a
  // copy-paste bug. Returns its own identifier as the constant name implies.
  static readonly HEADER_AREA_BIGGER_THAN_CONTENT: Countable = {
    getName(): string {
      return "HEADER_AREA_BIGGER_THAN_CONTENT";
    },
    getGroupName(): string {
      return GROUP;
    },
  };

  static readonly CONTENT_SIZE_TOO_SMALL: Countable = {
    getName(): string {
      return "CONTENT_SIZE_TOO_SMALL";
    },
    getGroupName(): string {
      return GROUP;
    },
  };

  static readonly CONTENT_WIDTH_TOO_SMALL: Countable = {
    getName(): string {
      return "CONTENT_WIDTH_TOO_SMALL";
    },
    getGroupName(): string {
      return GROUP;
    },
  };

  static readonly FEW_TOKENS_IN_HEADER: Countable = {
    getName(): string {
      return "FEW_TOKENS_IN_HEADER";
    },
    getGroupName(): string {
      return GROUP;
    },
  };

  static readonly FEW_TOKENS_IN_CONTENT: Countable = {
    getName(): string {
      return "FEW_TOKENS_IN_CONTENT";
    },
    getGroupName(): string {
      return GROUP;
    },
  };

  static readonly EMPTY_LABEL_OR_HEADER_OR_CONTENT: Countable = {
    getName(): string {
      return "EMPTY_LABEL_OR_HEADER_OR_CONTENT";
    },
    getGroupName(): string {
      return GROUP;
    },
  };

  static readonly HEADER_AND_CONTENT_DIFFERENT_PAGES: Countable = {
    getName(): string {
      return "HEADER_AND_CONTENT_DIFFERENT_PAGES";
    },
    getGroupName(): string {
      return GROUP;
    },
  };

  static readonly HEADER_NOT_CONSECUTIVE: Countable = {
    getName(): string {
      return "HEADER_NOT_CONSECUTIVE";
    },
    getGroupName(): string {
      return GROUP;
    },
  };
}
