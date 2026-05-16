// Port of org.grobid.core.analyzers.Analyzer.
// Upstream: grobid-core/src/main/java/org/grobid/core/analyzers/Analyzer.java

import type { LayoutToken } from "../layout/layout-token.js";
import type { Language } from "../lang/language.js";

/**
 * Abstract analyzer for tokenizing/filtering text.
 */
export interface Analyzer {
  // Upstream declares two `tokenize` overloads, collapsed into one signature.
  tokenize(text: string, lang?: Language | null): string[];

  retokenize(chunks: string[]): string[];

  tokenizeWithLayoutToken(text: string, lang?: Language | null): LayoutToken[];

  retokenizeFromLayoutToken(tokens: LayoutToken[]): LayoutToken[];

  retokenizeSubdigits(chunks: string[]): string[];

  retokenizeSubdigitsWithLayoutToken(chunks: string[]): LayoutToken[];

  retokenizeSubdigitsFromLayoutToken(tokens: LayoutToken[]): LayoutToken[];

  getName(): string;
}
