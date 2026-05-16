// Port of org.grobid.core.utilities.counters.CntsMetric.
// Upstream: grobid-core/src/main/java/org/grobid/core/utilities/counters/CntsMetric.java

import type { CntManager } from "./cnt-manager.js";

export interface CntsMetric {
  getMetricString(cntManager: CntManager): string;
}
