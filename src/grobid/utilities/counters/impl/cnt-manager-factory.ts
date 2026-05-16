// Port of org.grobid.core.utilities.counters.impl.CntManagerFactory.
// Upstream: grobid-core/src/main/java/org/grobid/core/utilities/counters/impl/CntManagerFactory.java

import type { CntManager } from "../cnt-manager.js";

import { CntManagerImpl } from "./cnt-manager-impl.js";
import { NoOpCntManagerImpl } from "./no-op-cnt-manager-impl.js";

export class CntManagerFactory {
  public static getCntManager(): CntManager {
    return new CntManagerImpl();
  }

  public static getNoOpCntManager(): CntManager {
    return new NoOpCntManagerImpl();
  }
}
