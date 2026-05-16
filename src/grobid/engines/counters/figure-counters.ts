// Port of org.grobid.core.engines.counters.FigureCounters.
// Upstream: grobid-core/src/main/java/org/grobid/core/engines/counters/FigureCounters.java

import type { Countable } from "./countable.js";

const GROUP = "org.grobid.core.engines.counters.FigureCounters";

export class FigureCounters {
  static readonly TOO_MANY_FIGURES_PER_PAGE: Countable = {
    getName(): string {
      return "TOO_MANY_FIGURES_PER_PAGE";
    },
    getGroupName(): string {
      return GROUP;
    },
  };

  static readonly STANDALONE_FIGURES: Countable = {
    getName(): string {
      return "STANDALONE_FIGURES";
    },
    getGroupName(): string {
      return GROUP;
    },
  };

  static readonly SKIPPED_BAD_STANDALONE_FIGURES: Countable = {
    getName(): string {
      return "SKIPPED_BAD_STANDALONE_FIGURES";
    },
    getGroupName(): string {
      return GROUP;
    },
  };

  static readonly SKIPPED_SMALL_STANDALONE_FIGURES: Countable = {
    getName(): string {
      return "SKIPPED_SMALL_STANDALONE_FIGURES";
    },
    getGroupName(): string {
      return GROUP;
    },
  };

  static readonly SKIPPED_BIG_STANDALONE_FIGURES: Countable = {
    getName(): string {
      return "SKIPPED_BIG_STANDALONE_FIGURES";
    },
    getGroupName(): string {
      return GROUP;
    },
  };

  static readonly ASSIGNED_GRAPHICS_TO_FIGURES: Countable = {
    getName(): string {
      return "ASSIGNED_GRAPHICS_TO_FIGURES";
    },
    getGroupName(): string {
      return GROUP;
    },
  };

  static readonly SKIPPED_DUE_TO_MISMATCH_OF_CAPTIONS_AND_VECTOR_AND_BITMAP_GRAPHICS: Countable = {
    getName(): string {
      return "SKIPPED_DUE_TO_MISMATCH_OF_CAPTIONS_AND_VECTOR_AND_BITMAP_GRAPHICS";
    },
    getGroupName(): string {
      return GROUP;
    },
  };
}
