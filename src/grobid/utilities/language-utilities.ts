// Port of org.grobid.core.utilities.LanguageUtilities.
// Upstream: grobid-core/src/main/java/org/grobid/core/utilities/LanguageUtilities.java

import { GrobidException } from "../exceptions/grobid-exception.js";
import type { Language } from "../lang/language.js";
import {
  newLanguageDetectorFactory,
  type LanguageDetectorFactory,
} from "../lang/language-detector-factory.js";
import { GrobidProperties } from "./grobid-properties.js";
import { getLogger } from "./logger.js";

const LOGGER = getLogger("LanguageUtilities");

/**
 * Class for using language guessers (singleton).
 */
export class LanguageUtilities {
  static readonly LOGGER = LOGGER;

  private static instance: LanguageUtilities | null = null;

  //private boolean useLanguageId = false;
  private ldf: LanguageDetectorFactory | null = null;

  static getInstance(): LanguageUtilities {
    if (LanguageUtilities.instance === null) {
      // JS is single-threaded; the upstream double-checked locking collapses to a single check.
      if (LanguageUtilities.instance === null) {
        LanguageUtilities.instance = new LanguageUtilities();
      }
    }
    return LanguageUtilities.instance!;
  }

  private constructor() {
    const className = GrobidProperties.getLanguageDetectorFactory();
    try {
      this.ldf = newLanguageDetectorFactory(className);
    } catch (e) {
      // Upstream distinguishes ClassCastException / ClassNotFoundException /
      // InstantiationException / IllegalAccessException with bespoke messages.
      // In the TS port the registry lookup either throws (unknown FQCN) or
      // returns a properly-typed instance, so we wrap the underlying error.
      throw new GrobidException(
        "Class " +
          className +
          " were not found in the classpath. " +
          "Make sure that it is provided correctly is in the classpath",
        e,
      );
    }
  }

  /**
   * Basic run for language identification, return the language code and
   * confidence score separated by a semicolon
   *
   * @param text text to classify
   * @return language ids concatenated with ;
   */
  runLanguageId(text: string): Language | null;
  /**
   * Less basic run for language identification, where a maximum length of text is used to
   * identify the language. The goal is to avoid wasting resources using a too long piece of
   * text, when normally only a small chunk is enough for a safe language prediction.
   * Return a Language object consisting of the language code and a confidence score.
   *
   * @param text text to classify
   * @param maxLength maximum length of text to be used to identify the language, expressed in characters
   * @return language Language object consisting of the language code and a confidence score
   */
  runLanguageId(text: string, maxLength: number): Language | null;
  runLanguageId(text: string, maxLength?: number): Language | null {
    try {
      if (maxLength === undefined) {
        return this.ldf!.getInstance().detect(text);
      }
      let max = text.length;
      if (maxLength < max) max = maxLength;
      return this.ldf!.getInstance().detect(text.substring(0, max));
    } catch (e) {
      LOGGER.warn("Cannot detect language. ", e);
      return null;
    }
  }
}
