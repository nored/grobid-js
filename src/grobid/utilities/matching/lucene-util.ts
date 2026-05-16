// Port of org.grobid.core.utilities.matching.LuceneUtil.
// Upstream: grobid-core/src/main/java/org/grobid/core/utilities/matching/LuceneUtil.java
//
// The upstream class wraps Apache Lucene 4.5 (`StandardAnalyzer`,
// `TokenStream`, `CharTermAttribute`). There is no faithful JS port of
// Lucene; this file mirrors the public surface in terms of an `Analyzer`
// interface implemented by the caller. The `tokenizeString` /
// `normalizeString` helpers operate purely against that interface.

import { Pair } from "../pair.js";

export interface Token {
  term: string;
  type: string;
}

export interface Analyzer {
  /**
   * Tokenize the given input string. Mirrors Lucene's
   * `analyzer.tokenStream(field, reader)` followed by the loop in
   * `readerToTokens`.
   */
  tokenize(input: string): Token[];
}

/**
 * A minimal Lucene-compatible analyzer that splits on non-letter/digit runs
 * and lowercases tokens, intended to stand in for `StandardAnalyzer` in pure
 * JS. The token type is reported as `"word"` for word-like tokens and
 * `"<NUM>"` for digit-only tokens (matching Lucene's StandardTokenizer
 * conventions).
 */
export class StandardAnalyzer implements Analyzer {
  public tokenize(input: string): Token[] {
    const tokens: Token[] = [];
    const re = /[\p{L}\p{N}]+/gu;
    let m: RegExpExecArray | null;
    while ((m = re.exec(input)) !== null) {
      const raw = m[0];
      let type = "<ALPHANUM>";
      if (/^\d+$/.test(raw)) type = "<NUM>";
      tokens.push({ term: raw.toLowerCase(), type });
    }
    return tokens;
  }
}

export class LuceneUtil {
  private constructor() {}

  /**
   * @return a StandardAnalyzer without stop-words
   */
  public static createStandardAnalyzer(): StandardAnalyzer {
    return new StandardAnalyzer();
  }

  public static normalizeString(analyzer: Analyzer, input: string): string {
    const tokens: string[] = LuceneUtil.tokenizeString(analyzer, input);
    // Joiner.on(' ').join(tokens)
    return tokens.join(" ");
  }

  public static normalizeTokens(_analyzer: Analyzer, tokens: string[]): string {
    void _analyzer;
    return tokens.join(" ");
  }

  /**
   * Convert a Reader to a List of Tokens.
   */
  private static readerToTokens(analyzer: Analyzer, input: string): string[] {
    const coll: string[] = [];
    const ts = analyzer.tokenize(input);
    for (const t of ts) {
      coll.push(t.term);
    }
    return coll;
  }

  public static tokenizeString(analyzer: Analyzer, input: string): string[] {
    try {
      return LuceneUtil.readerToTokens(analyzer, input);
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : String(e));
    }
  }

  public static tokenizeWithTokenTypes(
    analyzer: Analyzer,
    input: string,
  ): Pair<string, string>[] {
    const coll: Pair<string, string>[] = [];
    try {
      const ts = analyzer.tokenize(input);
      for (const t of ts) {
        coll.push(new Pair<string, string>(t.term, t.type));
      }
    } catch (e) {
      throw new Error(
        "Error during tokenization" + ": " + (e instanceof Error ? e.message : String(e)),
      );
    }
    return coll;
  }
}
