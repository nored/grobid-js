// Port of `org.grobid.core.jni.JEPThreadPool`.
// Upstream: grobid-core/src/main/java/org/grobid/core/jni/JEPThreadPool.java
//
// ADAPTATION: JEP (Java Embedded Python) is not available in the JS port —
// the whole pool exists in upstream to keep a CPython interpreter pinned to
// a dedicated worker thread because JEP requires that. There is no
// equivalent in Node/JS. Every public method throws.
//
// The Java surface is preserved verbatim (singleton accessor, `run`,
// `call`, `getJEPInstance`, `closeCurrentJEPInstance`, `shutdown`) so that
// `DeLFTModel` / `DeLFTClassifierModel` and any other callers keep
// compiling.

import { GrobidException } from "../exceptions/grobid-exception.js";

const NOT_SUPPORTED = "DeLFT not supported in JS port";

/** Mirrors `jep.Jep` — opaque placeholder; no operations are valid. */
export type Jep = never;

/** Mirrors `java.lang.Runnable`. */
export type Runnable = () => void;

/** Mirrors `java.util.concurrent.Callable<T>`. */
export type Callable<T> = () => T;

export class JEPThreadPool {
  private static _instance: JEPThreadPool | undefined;

  /** Mirrors upstream's private `POOL_SIZE` field (kept for fidelity). */
  private POOL_SIZE: number = 1;

  /**
   * Port of `JEPThreadPool.getInstance()`. The double-checked-locking dance
   * in the Java code (`if (instance == null) getNewInstance()`) is preserved
   * structurally even though JS is single-threaded.
   */
  static getInstance(): JEPThreadPool {
    if (JEPThreadPool._instance === undefined) {
      JEPThreadPool.getNewInstance();
    }
    return JEPThreadPool._instance!;
  }

  private static getNewInstance(): void {
    JEPThreadPool._instance = new JEPThreadPool();
  }

  /** Mirrors upstream's private constructor. */
  private constructor() {
    void this.POOL_SIZE;
  }

  /** Port of `JEPThreadPool.getJEPInstance()`. */
  getJEPInstance(): Jep {
    throw new GrobidException(NOT_SUPPORTED);
  }

  /** Port of `JEPThreadPool.run(Runnable)`. */
  run(_task: Runnable): void {
    throw new GrobidException(NOT_SUPPORTED);
  }

  /** Port of `JEPThreadPool.call(Callable<String>)`. */
  call(_task: Callable<string>): string {
    throw new GrobidException(NOT_SUPPORTED);
  }

  /** Port of `JEPThreadPool.closeCurrentJEPInstance()`. */
  closeCurrentJEPInstance(): void {
    throw new GrobidException(NOT_SUPPORTED);
  }

  /** Port of `JEPThreadPool.shutdown()`. */
  shutdown(): void {
    throw new GrobidException(NOT_SUPPORTED);
  }
}
