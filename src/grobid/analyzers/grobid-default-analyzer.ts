// Port of org.grobid.core.analyzers.GrobidDefaultAnalyzer.
// Upstream: grobid-core/src/main/java/org/grobid/core/analyzers/GrobidDefaultAnalyzer.java
//
// Default tokenizer adequate for all Indo-European languages.

import type { Analyzer } from "./analyzer.js";
import type { Language } from "../lang/language.js";
import { LayoutToken } from "../layout/layout-token.js";
import { UnicodeUtil } from "../utilities/unicode-util.js";

// ─────────────────────────────────────────────────────────────────────────────
// Verbatim copy of TextUtilities.delimiters (TextUtilities.java line 27-30):
//   public static final String punctuations =
//     " •*,:;?.!)-−–\"“”‘’'`$]*♦♥♣♠ 。、，・";
//   public static final String fullPunctuations =
//     "(（[ •*,:;?.!/)）-−–‐«»„\"“”‘’'`$#@]*♦♥♣♠ 。、，・";
//   public static String delimiters = "\n\r\t\f ‌" + fullPunctuations;
// TextUtilities is not yet ported; switch to TextUtilities.delimiters once
// that file lands. Same precedent as `src/grobid/lexicon/fast-matcher.ts`.
// ─────────────────────────────────────────────────────────────────────────────
const FULL_PUNCTUATIONS =
  "(（[ •*,:;?.!/)）-−–‐«»„\"“”‘’'`$#@]*♦♥♣♠ 。、，・";
const DELIMITERS = "\n\r\t\f ‌" + FULL_PUNCTUATIONS;

/**
 * Java `StringTokenizer(text, delimiters, true)` — returns both tokens and
 * delimiters in source order. A run of non-delimiter chars is one token; each
 * delimiter char is one token.
 *
 * Mirrors the same helper in `lexicon/fast-matcher.ts`.
 */
function* stringTokenizerKeepDelims(text: string, delims: string): Generator<string> {
  let buf = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (delims.indexOf(ch) !== -1) {
      if (buf.length > 0) {
        yield buf;
        buf = "";
      }
      yield ch;
    } else {
      buf += ch;
    }
  }
  if (buf.length > 0) yield buf;
}

/**
 * Default tokenizer adequate for all Indo-European languages.
 */
export class GrobidDefaultAnalyzer implements Analyzer {
  private static instance: GrobidDefaultAnalyzer | undefined;

  static getInstance(): GrobidDefaultAnalyzer {
    if (GrobidDefaultAnalyzer.instance === undefined) {
      //double check idiom
      // synchronized (instanceController) {
      if (GrobidDefaultAnalyzer.instance === undefined)
        GrobidDefaultAnalyzer.getNewInstance();
      // }
    }
    return GrobidDefaultAnalyzer.instance!;
  }

  /**
   * Creates a new instance.
   */
  private static getNewInstance(): void {
    GrobidDefaultAnalyzer.instance = new GrobidDefaultAnalyzer();
  }

  /**
   * Hidden constructor
   */
  private constructor() {}

  static readonly delimiters: string = DELIMITERS;

  // the following regex is used to separate alphabetical and numerical character subsequences
  // note: see about using \p{N} for unicode digits
  // Upstream Java: "(?<=[\\p{L}])(?=\\d)|(?<=\\d)(?=\\D)"
  private static readonly REGEX: RegExp = /(?<=[\p{L}])(?=\d)|(?<=\d)(?=\D)/u;

  getName(): string {
    return "DefaultGrobidAnalyzer";
  }

  tokenize(text: string, lang?: Language | null): string[] {
    const result: string[] = [];
    // as a default analyzer, language is not considered
    void lang;
    const normalised = UnicodeUtil.normaliseText(text);
    const t = normalised ?? "";
    for (const tok of stringTokenizerKeepDelims(t, GrobidDefaultAnalyzer.delimiters)) {
      result.push(tok);
    }
    return result;
  }

  retokenize(chunks: string[]): string[] {
    const result: string[] = [];
    for (let chunk of chunks) {
      chunk = UnicodeUtil.normaliseText(chunk) ?? "";
      for (const tok of stringTokenizerKeepDelims(chunk, GrobidDefaultAnalyzer.delimiters)) {
        result.push(tok);
      }
    }
    return result;
  }

  /**
   * Tokenize text returning list of LayoutTokens.
   */
  tokenizeWithLayoutToken(text: string, language?: Language | null): LayoutToken[] {
    const result: LayoutToken[] = [];
    const normalised = UnicodeUtil.normaliseText(text);
    const t = normalised ?? "";
    const tokens = this.tokenize(t, language ?? null);
    let pos = 0;
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i]!;
      const layoutToken = new LayoutToken();
      layoutToken.setText(tok);
      layoutToken.setOffset(pos);
      result.push(layoutToken);
      pos += tok.length;
      if (i < tokens.length - 1 && tokens[i + 1] === "\n") {
        layoutToken.setNewLineAfter(true);
      }
    }

    return result;
  }

  /**
   * To tokenize an existing list of tokens. Only useful if input tokens have
   * been tokenized with a non-default Grobid tokenizer.
   * Note: the coordinates of the subtokens are not recomputed here (at least for
   * the moment).
   *
   * 1/74 -> "1", "/", "74"
   */
  retokenizeFromLayoutToken(tokens: LayoutToken[]): LayoutToken[] {
    const result: LayoutToken[] = [];
    for (const token of tokens) {
      const tt = token.getText();
      if (tt === null || tt.trim().length === 0) {
        result.push(token);
      } else {
        const tokenText = tt;
        const subtokens = this.tokenize(tokenText);
        let offset = token.getOffset();
        for (let i = 0; i < subtokens.length; i++) {
          const layoutToken = new LayoutToken();
          layoutToken.setText(subtokens[i]!);
          layoutToken.setOffset(offset);

          // coordinates - TODO: refine the width/X for the sub token
          layoutToken.setX(token.getX());
          layoutToken.setY(token.getY());
          layoutToken.setHeight(token.getHeight());
          layoutToken.setWidth(token.getWidth());
          layoutToken.setPage(token.getPage());

          offset += subtokens[i]!.length;
          result.push(layoutToken);
        }
      }
    }
    return result;
  }

  /**
   * To tokenize mixture of alphabetical and numerical characters by separating
   * separate alphabetical and numerical character subsequences. To be used
   * when relevant.
   *
   * 1m74 -> "1", "m", "74"
   */
  retokenizeSubdigits(chunks: string[]): string[] {
    const result: string[] = [];
    for (const token of chunks) {
      // we split "letter" characters and digits
      const subtokens = token.split(GrobidDefaultAnalyzer.REGEX);
      for (let i = 0; i < subtokens.length; i++) {
        result.push(subtokens[i]!);
      }
    }
    return result;
  }

  /**
   * To tokenize mixture of alphabetical and numerical characters by separating
   * separate alphabetical and numerical character subsequences. To be used
   * when relevant.
   *
   * 1m74 -> tokens.add(new LayoutToken("1"));
   *         tokens.add(new LayoutToken("m"));
   *         tokens.add(new LayoutToken("74"));
   */
  retokenizeSubdigitsWithLayoutToken(chunks: string[]): LayoutToken[] {
    const result: LayoutToken[] = [];
    let offset = 0;
    for (const token of chunks) {
      // we split "letter" characters and digits
      const subtokens = token.split(GrobidDefaultAnalyzer.REGEX);
      for (let i = 0; i < subtokens.length; i++) {
        const layoutToken = new LayoutToken();
        layoutToken.setText(subtokens[i]!);
        layoutToken.setOffset(offset);
        offset += subtokens[i]!.length;
        result.push(layoutToken);
      }
    }
    return result;
  }

  /**
   * To tokenize mixture of alphabetical and numerical characters by separating
   * separate alphabetical and numerical character subsequences. To be used
   * when relevant.
   * Input is a list of LayoutToken, but the coordinates of the subtokens are however
   * not recomputed here (at least for the moment).
   *
   * 1m74 -> tokens.add(new LayoutToken("1"));
   *         tokens.add(new LayoutToken("m"));
   *         tokens.add(new LayoutToken("74"));
   */
  retokenizeSubdigitsFromLayoutToken(tokens: LayoutToken[]): LayoutToken[] {
    const result: LayoutToken[] = [];
    for (const token of tokens) {
      // we split "letter" characters and digits
      const tt = token.getText();
      if (tt === null || tt.trim().length === 0) {
        result.push(token);
      } else {
        const tokenText = tt;
        const subtokens = tokenText.split(GrobidDefaultAnalyzer.REGEX);
        let offset = token.getOffset();
        for (let i = 0; i < subtokens.length; i++) {
          const layoutToken = new LayoutToken();
          layoutToken.setText(subtokens[i]!);
          layoutToken.setOffset(offset);

          // coordinates - TODO: refine the width/X for the sub token
          layoutToken.setX(token.getX());
          layoutToken.setY(token.getY());
          layoutToken.setHeight(token.getHeight());
          layoutToken.setWidth(token.getWidth());
          layoutToken.setPage(token.getPage());

          offset += subtokens[i]!.length;
          result.push(layoutToken);
        }
      }
    }
    return result;
  }
}
