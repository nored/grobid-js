// Port of org.grobid.core.lang.SentenceDetectorFactory.
// Upstream: grobid-core/src/main/java/org/grobid/core/lang/SentenceDetectorFactory.java
//
// ADAPTATION: Java reflection → TS registry (same pattern as
// LanguageDetectorFactory). Upstream callers do
// `Class.forName(GrobidProperties.getSentenceDetectorFactory()).newInstance()`;
// here, concrete factory modules register themselves under their upstream
// FQCN and the dispatcher looks them up. Runtime behavior is equivalent.

import type { SentenceDetector } from "./sentence-detector.js";

/**
 * Factory for sentence detector instance
 */
export interface SentenceDetectorFactory {
  getInstance(): SentenceDetector;
}

// --- TS-only registry below this line (no upstream equivalent) ----------

type FactoryCtor = new () => SentenceDetectorFactory;

const registry: Map<string, FactoryCtor> = new Map<string, FactoryCtor>();

/**
 * Register a concrete `SentenceDetectorFactory` constructor under its
 * upstream Java FQCN (e.g.
 * `"org.grobid.core.lang.impl.PragmaticSentenceDetectorFactory"`).
 */
export function registerSentenceDetectorFactory(name: string, ctor: FactoryCtor): void {
  registry.set(name, ctor);
}

/**
 * Look up and instantiate a registered factory by its upstream FQCN.
 */
export function newSentenceDetectorFactory(name: string): SentenceDetectorFactory {
  const ctor = registry.get(name);
  if (ctor === undefined) {
    throw new Error("SentenceDetectorFactory not registered for name: " + name);
  }
  return new ctor();
}
