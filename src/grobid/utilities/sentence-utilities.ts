// Port of org.grobid.core.utilities.SentenceUtilities.
// Upstream: grobid-core/src/main/java/org/grobid/core/utilities/SentenceUtilities.java
//
// Class for using sentence segmentation (singleton). The actual sentence segmentation implementation
// is specified in the Grobid configuration. See org.grobid.core.lang.impl.* for the available
// implementations.

import { GrobidException } from "../exceptions/grobid-exception.js";
import type { Language } from "../lang/language.js";
import {
  newSentenceDetectorFactory,
  type SentenceDetectorFactory,
} from "../lang/sentence-detector-factory.js";
import { LayoutToken } from "../layout/layout-token.js";
import { GrobidProperties } from "./grobid-properties.js";
import { getLogger } from "./logger.js";
import { OffsetPosition } from "./offset-position.js";

const LOGGER = getLogger("SentenceUtilities");

export class SentenceUtilities {
  static readonly LOGGER = LOGGER;

  private static instance: SentenceUtilities | null = null;

  private sdf: SentenceDetectorFactory | null = null;

  static getInstance(): SentenceUtilities {
    if (SentenceUtilities.instance === null) {
      // JS is single-threaded; the upstream double-checked locking collapses to a single check.
      if (SentenceUtilities.instance === null) {
        LOGGER.debug("synchronized getNewInstance");
        SentenceUtilities.instance = new SentenceUtilities();
      }
    }
    return SentenceUtilities.instance!;
  }

  private constructor() {
    const className = GrobidProperties.getSentenceDetectorFactory();
    try {
      this.sdf = newSentenceDetectorFactory(className);
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
   * Basic run for sentence identification, return the offset positions of the
   * identified sentences
   *
   * @param text text to segment into sentences
   * @param lang specified language to be used when segmenting text
   * @return list of offset positions for the identified sentence, relative to the input text
   */
  runSentenceDetection(text: string | null, lang?: Language | null): OffsetPosition[] | null;
  runSentenceDetection(text: string | null, forbidden: OffsetPosition[]): OffsetPosition[] | null;
  runSentenceDetection(
    text: string | null,
    forbidden: OffsetPosition[] | null,
    textLayoutTokens: LayoutToken[] | null,
    lang: Language | null,
  ): OffsetPosition[] | null;
  runSentenceDetection(
    text: string | null,
    arg2?: OffsetPosition[] | Language | null,
    textLayoutTokens?: LayoutToken[] | null,
    lang?: Language | null,
  ): OffsetPosition[] | null {
    // Dispatch based on the second argument's shape, matching the upstream overload set:
    //   (text)
    //   (text, Language lang)
    //   (text, List<OffsetPosition> forbidden)
    //   (text, List<OffsetPosition> forbidden, List<LayoutToken> tokens, Language lang)
    if (arg2 === undefined) {
      return this._runSentenceDetectionSimple(text, null);
    }
    if (Array.isArray(arg2)) {
      // (text, forbidden) or (text, forbidden, tokens, lang)
      return this._runSentenceDetectionFull(
        text,
        arg2,
        textLayoutTokens ?? null,
        lang ?? null,
      );
    }
    // arg2 is a Language (or null when called as runSentenceDetection(text, null) for lang)
    return this._runSentenceDetectionSimple(text, arg2 as Language | null);
  }

  private _runSentenceDetectionSimple(
    text: string | null,
    lang: Language | null,
  ): OffsetPosition[] | null {
    if (text === null) return null;
    try {
      if (lang === null) {
        return this.sdf!.getInstance().detect(text);
      }
      return this.sdf!.getInstance().detect(text, lang);
    } catch (e) {
      LOGGER.warn("Cannot detect sentences. ", e);
      return null;
    }
  }

  /**
   * Run for sentence identification with some forbidden span constraints, return the offset positions of the
   * identified sentences without sentence boundaries within a forbidden span (typically a reference marker
   * and we don't want a sentence end/start in the middle of that). The original LayoutToken objects are
   * provided, which allows to apply additional heuristics based on document layout and font features.
   */
  private _runSentenceDetectionFull(
    text: string | null,
    forbidden: OffsetPosition[] | null,
    textLayoutTokens: LayoutToken[] | null,
    lang: Language | null,
  ): OffsetPosition[] | null {
    if (text === null) return null;
    try {
      const sentencePositions: OffsetPosition[] = this.sdf!.getInstance().detect(text, lang);

      // to be sure, we sort the forbidden positions
      if (forbidden === null) return sentencePositions;
      forbidden.sort((a, b) => a.compareTo(b));

      // cancel sentence boundaries within the forbidden spans
      const finalSentencePositions = SentenceUtilities.correctSentencePositions(sentencePositions, forbidden);

      // as a heuristics for all implementations, because they clearly all fail for this case, we
      // attached to the right sentence the numerical bibliographical references markers expressed
      // in superscript just *after* the final sentence comma, e.g.
      // "Laboratory tests at the time of injury were not predictive of outcome. 32"
      // or
      // "CSF-1 has been linked to tumor growth and progression in breast cancer, 5,6 and has been
      // shown to effectively reduce the number of tumor-associated macrophages in different tumor
      // types. 4,5"
      // or
      // "Even if the symmetry is s- like, it does not necessarily indicate that the
      // superconductivity is not exotic, because the s- like symmetry or the fully gapped state
      // may be realized by the pairing mediated by the interband excitations of the electrons. 23) "

      if (finalSentencePositions.length === 0) {
        // this should normally not happen, but it happens (depending on sentence splitter, usually the text
        // is just a punctuation)
        // in this case we consider the current text as a unique sentence as fall back
        finalSentencePositions.push(new OffsetPosition(0, text.length));
      }

      if (textLayoutTokens === null || textLayoutTokens.length === 0)
        return finalSentencePositions;

      let pos = 0;

      // init sentence index
      let currentSentenceIndex = 0;
      let sentenceChunk = text.substring(
        finalSentencePositions[currentSentenceIndex]!.start,
        finalSentencePositions[currentSentenceIndex]!.end,
      );
      let moved = false;

      // iterate on layout tokens in sync with sentences
      for (let i = 0; i < textLayoutTokens.length; i++) {
        const token = textLayoutTokens[i]!;
        if (token.getText() === null || token.getText()!.length === 0) continue;

        if (SentenceUtilities.toSkipToken(token.getText()!)) continue;

        const newPos = sentenceChunk.indexOf(token.getText()!, pos);

        if (newPos !== -1) {
          pos = newPos;
          moved = true;
        } else {
          // before moving to the next sentence, we check if a ref marker in superscript just follow
          let pushedEnd = 0;
          let buffer = 0;
          let j = i;
          for (; j < textLayoutTokens.length; j++) {
            const nextToken = textLayoutTokens[j]!;
            if (nextToken.getText() === null || nextToken.getText()!.length === 0) continue;

            // we don't look beyond an end of line (to prevent from numbered list/notes)
            if (nextToken.getText() === "\n") break;

            // we don't look beyond the text length
            if (finalSentencePositions[currentSentenceIndex]!.end + nextToken.getText()!.length + buffer >= text.length)
              break;

            if (SentenceUtilities.toSkipTokenNoHyphen(nextToken.getText()!)) {
              buffer += nextToken.getText()!.length;
              continue;
            }

            if (SentenceUtilities.isValidSuperScriptNumericalReferenceMarker(nextToken)) {
              pushedEnd += buffer + nextToken.getText()!.length;
              buffer = 0;
            } else break;
          }

          if (pushedEnd > 0) {
            const newPosition = finalSentencePositions[currentSentenceIndex]!;
            newPosition.end += pushedEnd + 1;
            finalSentencePositions[currentSentenceIndex] = newPosition;
            // push also the beginning of the next sentence
            if (currentSentenceIndex + 1 < finalSentencePositions.length) {
              const newNextPosition = finalSentencePositions[currentSentenceIndex + 1]!;

              // it could  be that the extra added ref marker was entirely the next sentence, which should be then removed
              if (newNextPosition.start + pushedEnd + buffer >= newNextPosition.end) {
                finalSentencePositions.splice(currentSentenceIndex + 1, 1);
              } else {
                newNextPosition.start += pushedEnd + buffer;
                finalSentencePositions[currentSentenceIndex + 1] = newNextPosition;
              }
            }
            pushedEnd = 0;
            buffer = 0;
            i = j - 1;
          }

          if (moved) {
            currentSentenceIndex++;
            if (currentSentenceIndex >= finalSentencePositions.length) break;
            sentenceChunk = text.substring(
              finalSentencePositions[currentSentenceIndex]!.start,
              finalSentencePositions[currentSentenceIndex]!.end,
            );
            moved = false;
          }
          pos = 0;
        }

        if (currentSentenceIndex >= finalSentencePositions.length) break;
      }

      // other heuristics/post-corrections based on layout/style features of the tokens could be added
      // here, for instance non-breakable italic or bold chunks, or adding sentence split based on
      // spacing/indent

      return finalSentencePositions;
    } catch (e) {
      LOGGER.warn("Cannot detect sentences. ", e);
      return null;
    }
  }

  static correctSentencePositions(
    sentencePositions: OffsetPosition[],
    forbiddenPositions: OffsetPosition[],
  ): OffsetPosition[] {
    const finalSentencePositions: OffsetPosition[] = [];
    let forbiddenIndex = 0;
    for (let j = 0; j < sentencePositions.length; j++) {
      const position = new OffsetPosition(sentencePositions[j]!.start, sentencePositions[j]!.end);
      for (let i = forbiddenIndex; i < forbiddenPositions.length; i++) {
        const forbiddenPos = forbiddenPositions[i]!;
        if (forbiddenPos.end < position.end) continue;
        if (forbiddenPos.start > position.end) break;
        while ((forbiddenPos.start < position.end && position.end < forbiddenPos.end)) {
          if (j + 1 < sentencePositions.length) {
            position.end = sentencePositions[j + 1]!.end;
            j++;
            forbiddenIndex = i;
          } else break;
        }
      }
      finalSentencePositions.push(position);
    }
    return finalSentencePositions;
  }

  /**
   * Return true if the token should be skipped when considering sentence content.
   */
  static toSkipToken(tok: string): boolean {
    // the hyphen is considered to be skipped to cover the case of word hyphenation
    if (tok === "-" || tok === " " || tok === "\n" || tok === "\t") return true;
    else return false;
  }

  static toSkipTokenNoHyphen(tok: string): boolean {
    if (tok === " " || tok === "\n" || tok === "\t") return true;
    else return false;
  }

  /**
   * Return true if the token is a valid numerical reference markers ([0-9,())\-\]\[) in supercript.
   */
  private static isValidSuperScriptNumericalReferenceMarker(token: LayoutToken): boolean {
    const tok = token.getText();
    if (tok === null) {
      // should never be the case, but we can just skip the token
      return true;
    }
    if (token.isSuperscript() && /^[0-9,\-\(\)\[\]]+$/.test(token.getText()!)) {
      //System.out.println("isValidSuperScriptNumericalReferenceMarker: " + token.getText() + " -> true");
      return true;
    } else {
      //System.out.println("isValidSuperScriptNumericalReferenceMarker: " + token.getText() + " -> false");
      return false;
    }
  }
}
