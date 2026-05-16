// Port of org.grobid.core.analyzers.GrobidAnalyzer.
// Upstream: grobid-core/src/main/java/org/grobid/core/analyzers/GrobidAnalyzer.java
//
// An Analyzer able to dispatch text to be tokenized to the adequate analyzer
// given a specified language. The language might be preliminary set by the
// language recognizer or manually if it is already known by the context of
// usage of the text.

import type { Analyzer } from "./analyzer.js";
import { ArabicChars } from "./arabic-chars.js";
import { GrobidDefaultAnalyzer } from "./grobid-default-analyzer.js";
import { Language } from "../lang/language.js";
import { LayoutToken } from "../layout/layout-token.js";
import { LayoutTokensUtil } from "../utilities/layout-tokens-util.js";
import { UnicodeUtil } from "../utilities/unicode-util.js";
import { getLogger } from "../utilities/logger.js";

const LOGGER = getLogger("GrobidAnalyzer");

// ─────────────────────────────────────────────────────────────────────────────
// External dependency: `org.grobid.nlp.textboundaries.ReTokenizer{,Factory}`
// lives in the `grobid-nlp` sibling library (not in `grobid-core` source).
// No TS port exists yet. We declare the minimal interface surface used here
// (only `ReTokenizer.tokensAsList(String): List<String>` and
// `ReTokenizerFactory.create(String): ReTokenizer`) so that the file
// typechecks. The actual implementation must be plugged in by a registration
// call at runtime — same pattern as the registry adaptations in
// `lang/language-detector-factory.ts`.
// ─────────────────────────────────────────────────────────────────────────────

export interface ReTokenizer {
  tokensAsList(text: string): string[];
}

export interface ReTokenizerFactory {
  create(name: string): ReTokenizer;
}

// Default factory: throws (matches upstream behavior when the underlying
// native library is missing).  Callers register a real factory at runtime via
// `setReTokenizerFactory`.
let reTokenizerFactory: ReTokenizerFactory = {
  create(name: string): ReTokenizer {
    throw new Error(
      "ReTokenizerFactory not registered; cannot create ReTokenizer for '" +
        name +
        "'. Register a factory via setReTokenizerFactory(...)."
    );
  },
};

/**
 * Plug-in point for the `grobid-nlp` ReTokenizer implementation. TS replacement
 * for upstream's `ReTokenizerFactory.create(name)` static dispatch.
 */
export function setReTokenizerFactory(factory: ReTokenizerFactory): void {
  reTokenizerFactory = factory;
}

/**
 * An Analyzer able to dispatch text to be tokenized to the adequate analyzer
 * given a specified language.
 */
export class GrobidAnalyzer implements Analyzer {
  private static instance: GrobidAnalyzer | undefined;

  private jaAnalyzer: ReTokenizer | null = null;
  private krAnalyzer: ReTokenizer | null = null;
  private zhAnalyzer: ReTokenizer | null = null;

  static getInstance(): GrobidAnalyzer {
    if (GrobidAnalyzer.instance === undefined) {
      //double check idiom
      // synchronized (GrobidAnalyzer.class) {
      if (GrobidAnalyzer.instance === undefined) {
        GrobidAnalyzer.getNewInstance();
      }
      // }
    }
    return GrobidAnalyzer.instance!;
  }

  /**
   * Creates a new instance.
   */
  private static getNewInstance(): void {
    LOGGER.debug("Get new instance of GrobidAnalyzer");
    GrobidAnalyzer.instance = new GrobidAnalyzer();
  }

  /**
   * Hidden constructor
   */
  private constructor() {
    try {
      this.krAnalyzer = reTokenizerFactory.create("ko_g");
    } catch (e) {
      LOGGER.error("Invalid kr tokenizer", e);
    }
  }

  getName(): string {
    return "GrobidAnalyzer";
  }

  /**
   * Tokenizer entry point
   */
  tokenize(text: string, lang?: Language | null): string[] {
    if (lang === undefined) lang = null;
    let result: string[] = [];
    if ((text === null) || (text.length === 0)) {
      return result;
    }
    try {
      //if (lang != null)
      //System.out.println("---> tokenize: " + text + " // " + lang.getLang());

      if ((lang === null) || (lang.getLang() === null)) {
        // default Indo-European languages
        result = GrobidDefaultAnalyzer.getInstance().tokenize(text);
      } else if (lang.isJapaneses()) {
        // Japanese analyser
        if (this.jaAnalyzer === null)
          this.jaAnalyzer = reTokenizerFactory.create("ja_g");
        result = this.jaAnalyzer.tokensAsList(text);
      } else if (lang.isChinese()) {
        // Chinese analyser
        if (this.zhAnalyzer === null)
          this.zhAnalyzer = reTokenizerFactory.create("zh_g");
        result = this.zhAnalyzer.tokensAsList(text);
      } else if (lang.isKorean()) {
        // Korean analyser
        /*if (krAnalyzer == null)
            krAnalyzer = ReTokenizerFactory.create("ko_g");*/
        result = this.krAnalyzer!.tokensAsList(text);
      } else if (lang.isArabic()) {
        // Arabic analyser
        result = GrobidDefaultAnalyzer.getInstance().tokenize(text);
        let p = 0;
        for (const token of result) {
          // string being immutable in Java, I think we can't do better that this:
          const newToken: string[] = [];
          for (let i = 0; i < token.length; i++) {
            newToken.push(ArabicChars.arabicCharacters(token.charAt(i)));
          }
          result[p] = newToken.join("");
          p++;
        }
      } else {
        // default Indo-European languages
        result = GrobidDefaultAnalyzer.getInstance().tokenize(text);
      }
    } catch (e) {
      LOGGER.error("Invalid tokenizer", e);
    }
    return result;
  }

  /**
   * Re-tokenizer entry point to be applied to text already tokenized in the PDF representation
   */
  retokenize(textTokenized: string[], lang?: Language | null): string[] {
    if (lang === undefined) lang = null;
    // Upstream initializes `result` to null in the second overload (line 138) —
    // we preserve that and only mutate via reassignment / .push so the
    // null-path bug parity is preserved.
    let result: string[] | null = null;
    if ((textTokenized === null) || (textTokenized.length === 0)) {
      return [];
    }
    try {
      if ((lang === null) || (lang.getLang() === null)) {
        // default Indo-European languages
        result = GrobidDefaultAnalyzer.getInstance().retokenize(textTokenized);
      } else if (lang.isJapaneses()) {
        // Japanese analyser
        if (this.jaAnalyzer === null)
          this.jaAnalyzer = reTokenizerFactory.create("ja_g");
        for (const chunk of textTokenized) {
          const localResult: string[] = this.jaAnalyzer.tokensAsList(chunk);
          result!.push(...localResult);
        }
      } else if (lang.isChinese()) {
        // Chinese analyser
        if (this.zhAnalyzer === null)
          this.zhAnalyzer = reTokenizerFactory.create("zh_g");
        for (const chunk of textTokenized) {
          const localResult: string[] = this.zhAnalyzer.tokensAsList(chunk);
          result!.push(...localResult);
        }
      } else if (lang.isKorean()) {
        // Korean analyser
        /*if (krAnalyzer == null)
            krAnalyzer = ReTokenizerFactory.create("ko_g");*/
        for (const chunk of textTokenized) {
          const localResult: string[] = this.krAnalyzer!.tokensAsList(chunk);
          result!.push(...localResult);
        }
      } else if (lang.isArabic()) {
        // Arabic analyser
        for (const token of textTokenized) {
          const newToken: string[] = [];
          for (let i = 0; i < token.length; i++) {
            newToken.push(ArabicChars.arabicCharacters(token.charAt(i)));
          }
          result!.push(newToken.join(""));
        }
      } else {
        // default Indo-European languages
        result = GrobidDefaultAnalyzer.getInstance().retokenize(textTokenized);
      }
    } catch (e) {
      LOGGER.error("Invalid tokenizer", e);
    }
    return result as string[];
  }

  tokenizeWithLayoutToken(text: string, lang?: Language | null): LayoutToken[] {
    if (lang === undefined) lang = null;
    text = UnicodeUtil.normaliseText(text) ?? "";
    const tokens = this.tokenize(text, lang);
    return LayoutTokensUtil.getLayoutTokensForTokenizedText(tokens);
  }

  retokenizeFromLayoutToken(tokens: LayoutToken[]): LayoutToken[] {
    return GrobidDefaultAnalyzer.getInstance().retokenizeFromLayoutToken(tokens);
  }

  retokenizeSubdigits(chunks: string[]): string[] {
    return GrobidDefaultAnalyzer.getInstance().retokenizeSubdigits(chunks);
  }

  retokenizeSubdigitsWithLayoutToken(chunks: string[]): LayoutToken[] {
    return GrobidDefaultAnalyzer.getInstance().retokenizeSubdigitsWithLayoutToken(chunks);
  }

  retokenizeSubdigitsFromLayoutToken(tokens: LayoutToken[]): LayoutToken[] {
    return GrobidDefaultAnalyzer.getInstance().retokenizeSubdigitsFromLayoutToken(tokens);
  }
}
