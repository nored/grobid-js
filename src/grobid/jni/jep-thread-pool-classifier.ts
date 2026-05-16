// Port of `org.grobid.core.jni.JEPThreadPoolClassifier`.
// Upstream: grobid-core/src/main/java/org/grobid/core/jni/JEPThreadPoolClassifier.java
//
// ADAPTATION: same as `jep-thread-pool.ts` — JEP-based Python embedding is
// unavailable in the JS port, so every method throws. The Java surface is
// preserved so consumers of `DeLFTClassifierModel` keep compiling.

import { GrobidException } from "../exceptions/grobid-exception.js";
import type { Jep, Runnable, Callable } from "./jep-thread-pool.js";

const NOT_SUPPORTED = "DeLFT not supported in JS port";

export class JEPThreadPoolClassifier {
  private static _instance: JEPThreadPoolClassifier | undefined;

  private POOL_SIZE: number = 1;

  /** Port of `JEPThreadPoolClassifier.getInstance()`. */
  static getInstance(): JEPThreadPoolClassifier {
    if (JEPThreadPoolClassifier._instance === undefined) {
      JEPThreadPoolClassifier.getNewInstance();
    }
    return JEPThreadPoolClassifier._instance!;
  }

  private static getNewInstance(): void {
    JEPThreadPoolClassifier._instance = new JEPThreadPoolClassifier();
  }

  private constructor() {
    void this.POOL_SIZE;
  }

  getJEPInstance(): Jep {
    throw new GrobidException(NOT_SUPPORTED);
  }

  run(_task: Runnable): void {
    throw new GrobidException(NOT_SUPPORTED);
  }

  call(_task: Callable<string>): string {
    throw new GrobidException(NOT_SUPPORTED);
  }

  closeCurrentJEPInstance(): void {
    throw new GrobidException(NOT_SUPPORTED);
  }

  shutdown(): void {
    throw new GrobidException(NOT_SUPPORTED);
  }
}
