// Port of org.grobid.core.lang.SentenceDetector.
// Upstream: grobid-core/src/main/java/org/grobid/core/lang/SentenceDetector.java

import type { Language } from "./language.js";
import type { OffsetPosition } from "../utilities/offset-position.js";

/**
 * Interface for sentence recognition method/library
 */
export interface SentenceDetector {
  /**
   * Detects sentence boundaries
   * @param text text to detect sentence boundaries
   * @return a list of offset positions indicating start and end character
   *         position of the recognized sentence in the text
   */
  detect(text: string): OffsetPosition[];

  /**
   * Detects sentence boundaries using a specified language
   * @param text text to detect sentence boundaries
   * @param lang language to be used for detecting sentence boundaries
   * @return a list of offset positions indicating start and end character
   *         position of the recognized sentence in the text
   */
  detect(text: string, lang: Language | null): OffsetPosition[];
}
