// Port of `org.grobid.core.jni.PythonEnvironmentConfig`.
// Upstream: grobid-core/src/main/java/org/grobid/core/jni/PythonEnvironmentConfig.java
//
// ADAPTATION: this class is part of the DeLFT bring-up path — it locates a
// CPython virtual environment so that JEP can load the matching libpython.
// JS cannot embed Python at all, so we follow the same "throw on first
// runtime call" pattern used elsewhere in this package (e.g.
// `DeLFTModel`, `JEPThreadPool`).
//
// We still expose the full Java surface (constructor + every public method +
// every static method) so that callers — notably `main/LibraryLoader.ts` —
// type-check. The only call site we know of (`LibraryLoader.load()`) guards
// the use behind a `GrobidCRFEngine.DELFT` membership check; non-DeLFT
// pipelines never instantiate this class.

import { GrobidException } from "../exceptions/grobid-exception.js";

const NOT_SUPPORTED = "DeLFT not supported in JS port";

/**
 * Mirrors `java.nio.file.Path`. We don't have a structural Path type; the
 * Java methods that return `Path` are typed as `string` here for use in any
 * future replacement implementation that decides to wire this up.
 */
export type JavaPath = string;

export class PythonEnvironmentConfig {
  // Field set preserved verbatim from the Java declaration order.
  private virtualEnv: JavaPath | null;
  private sitePackagesPath: JavaPath | null;
  private jepPath: JavaPath | null;
  private active: boolean;
  private pythonVersion: string | null;

  /**
   * Port of upstream's constructor. Throws immediately — DeLFT cannot run
   * inside the JS engine. The arguments are still captured for fidelity so
   * that subclassing / forwarding stays type-checked.
   */
  constructor(
    virtualEnv: JavaPath | null,
    sitePackagesPath: JavaPath | null,
    jepPath: JavaPath | null,
    pythonVersion: string | null,
    active: boolean,
  ) {
    this.virtualEnv = virtualEnv;
    this.sitePackagesPath = sitePackagesPath;
    this.jepPath = jepPath;
    this.active = active;
    this.pythonVersion = pythonVersion;
    throw new GrobidException(NOT_SUPPORTED);
  }

  /** Port of `isEmpty()`. */
  isEmpty(): boolean {
    void this.virtualEnv;
    throw new GrobidException(NOT_SUPPORTED);
  }

  getVirtualEnv(): JavaPath | null {
    throw new GrobidException(NOT_SUPPORTED);
  }

  getSitePackagesPath(): JavaPath | null {
    void this.sitePackagesPath;
    throw new GrobidException(NOT_SUPPORTED);
  }

  getNativeLibPath(): JavaPath | null {
    throw new GrobidException(NOT_SUPPORTED);
  }

  getNativeLibPaths(): JavaPath[] {
    throw new GrobidException(NOT_SUPPORTED);
  }

  getJepPath(): JavaPath | null {
    void this.jepPath;
    throw new GrobidException(NOT_SUPPORTED);
  }

  isActive(): boolean {
    void this.active;
    throw new GrobidException(NOT_SUPPORTED);
  }

  getPythonVersion(): string | null {
    void this.pythonVersion;
    throw new GrobidException(NOT_SUPPORTED);
  }

  /** Port of `getInstanceForVirtualEnv`. */
  static getInstanceForVirtualEnv(
    _virtualEnv: string | null,
    _activeVirtualEnv: string | null,
  ): PythonEnvironmentConfig {
    throw new GrobidException(NOT_SUPPORTED);
  }

  /** Port of `getActiveVirtualEnv`. */
  static getActiveVirtualEnv(): string | null {
    throw new GrobidException(NOT_SUPPORTED);
  }

  /** Port of `getInstance()`. */
  static getInstance(): PythonEnvironmentConfig {
    throw new GrobidException(NOT_SUPPORTED);
  }
}
