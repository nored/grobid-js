// Port of org.grobid.core.lang.LanguageDetectorFactory.
// Upstream: grobid-core/src/main/java/org/grobid/core/lang/LanguageDetectorFactory.java
//
// ADAPTATION: Java reflection → TS registry.
//
// Upstream is a single-method interface that callers instantiate via
// `Class.forName(...).newInstance()` based on a configured class name string
// in GrobidProperties (e.g. "org.grobid.core.lang.impl.CybozuLanguageDetectorFactory").
// Reflection by class-name string is not available in JS, so concrete factory
// implementations register themselves in a module-level registry, and the
// dispatcher in this file looks them up by their upstream Java class name.
// Runtime behavior is equivalent: a configured string maps to a singleton
// LanguageDetector instance.

import type { LanguageDetector } from "./language-detector.js";

/**
 * Factory for language detector instance
 */
export interface LanguageDetectorFactory {
  getInstance(): LanguageDetector;
}

// --- TS-only registry below this line (no upstream equivalent) ----------

type FactoryCtor = new () => LanguageDetectorFactory;

const registry: Map<string, FactoryCtor> = new Map<string, FactoryCtor>();

/**
 * Register a concrete `LanguageDetectorFactory` constructor under its
 * upstream Java FQCN (e.g. `"org.grobid.core.lang.impl.CybozuLanguageDetectorFactory"`).
 *
 * This is the JS replacement for `Class.forName(name).newInstance()`. Concrete
 * factory modules call this at module load time.
 */
export function registerLanguageDetectorFactory(name: string, ctor: FactoryCtor): void {
  registry.set(name, ctor);
}

/**
 * Look up and instantiate a registered factory by its upstream FQCN.
 * Throws if the name is not registered (equivalent to Java's
 * `ClassNotFoundException`).
 */
export function newLanguageDetectorFactory(name: string): LanguageDetectorFactory {
  const ctor = registry.get(name);
  if (ctor === undefined) {
    throw new Error("LanguageDetectorFactory not registered for name: " + name);
  }
  return new ctor();
}
