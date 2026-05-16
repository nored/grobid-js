// Port of org.grobid.core.layout.LayoutTokenization.
// Upstream: grobid-core/src/main/java/org/grobid/core/layout/LayoutTokenization.java

import type { LayoutToken } from "./layout-token.js";

/**
 * Bag of LayoutToken with array-of-tokens-style accumulation. Upstream's
 * code uses this in lieu of `List<LayoutToken>` in places that originally
 * had two storage axes (token vs. layout-token) but later collapsed to one.
 *
 * NB: upstream's `addToken`/`addTokens` have a copy-paste bug where the
 * append only runs in the `else` branch (the first call when the list is
 * null leaves it empty). We preserve that bug verbatim — downstream code
 * may have grown around it.
 */
export class LayoutTokenization {
  private tokenization: LayoutToken[] | null;

  constructor(tokens?: LayoutToken[]) {
    this.tokenization = tokens ?? [];
  }

  getTokenization(): LayoutToken[] | null {
    return this.tokenization;
  }

  addToken(token: LayoutToken): void {
    if (this.tokenization === null) {
      this.tokenization = [];
    } else {
      this.tokenization.push(token);
    }
  }

  addTokens(tokens: LayoutToken[]): void {
    if (this.tokenization === null) {
      this.tokenization = [];
    } else {
      this.tokenization.push(...tokens);
    }
  }

  setTokenization(tokens: LayoutToken[]): void {
    this.tokenization = tokens;
  }

  size(): number {
    return this.tokenization?.length ?? 0;
  }
}
