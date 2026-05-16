// Port of org.grobid.core.lang.LanguageDetector.
// Upstream: grobid-core/src/main/java/org/grobid/core/lang/LanguageDetector.java

import type { Language } from "./language.js";

/**
 * Interface for language recognition method/library
 */
export interface LanguageDetector {
  /**
   * Detects a language id that must consist of two letter together with a confidence coefficient.
   * If coefficient cannot be provided for some reason, it should be 1.0
   * @param text text to detect a language from
   * @return a language id together with a confidence coefficient
   */
  detect(text: string): Language;
}
