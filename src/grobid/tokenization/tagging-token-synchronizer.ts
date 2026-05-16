// Port of org.grobid.core.tokenization.TaggingTokenSynchronizer.
// Upstream: grobid-core/src/main/java/org/grobid/core/tokenization/TaggingTokenSynchronizer.java
//
// Adaptations:
// - Guava's `Iterators.peekingIterator` for `LayoutToken` is replicated by a
//   small index-based cursor on `tokenizations` (peek = index lookup, next =
//   read + advance).
// - Implements both Java `Iterator<T>` (`hasNext`/`next`) and `Iterable<T>`;
//   in TS we additionally expose `[Symbol.iterator]()` to allow `for..of`.

import type { GrobidModel } from "../grobid-model.js";
import { TaggingLabels } from "../engines/label/tagging-labels.js";
import { GenericTaggerUtils } from "../engines/tagging/generic-tagger-utils.js";
import type { LayoutToken } from "../layout/layout-token.js";
import { LayoutTokensUtil } from "../utilities/layout-tokens-util.js";
import { Triple } from "../utilities/triple.js";
import { LabeledTokensContainer } from "./labeled-tokens-container.js";

/**
 * Synchronize tagging result and layout tokens
 */
export class TaggingTokenSynchronizer
  implements Iterator<LabeledTokensContainer | null>, Iterable<LabeledTokensContainer | null>
{
  private readonly grobidModel: GrobidModel;
  private readonly tokensAndLabels: (Triple<string, string, string | null> | null)[];
  private tokensAndLabelsIdx: number = 0;
  private tokenizationsIdx: number = 0;
  private tokensAndLabelsPtr: number = 0;
  private tokenizationsPtr: number = 0;
  private readonly tokenizations: LayoutToken[];

  constructor(grobidModel: GrobidModel, result: string, tokenizations: LayoutToken[]);
  constructor(
    grobidModel: GrobidModel,
    result: string,
    tokenizations: LayoutToken[],
    addFeatureStrings: boolean,
  );
  constructor(
    grobidModel: GrobidModel,
    tokensAndLabels: (Triple<string, string, string | null> | null)[],
    tokenizations: LayoutToken[],
  );
  constructor(
    grobidModel: GrobidModel,
    arg2: string | (Triple<string, string, string | null> | null)[],
    tokenizations: LayoutToken[],
    addFeatureStrings: boolean = false,
  ) {
    this.grobidModel = grobidModel;
    if (typeof arg2 === "string") {
      this.tokensAndLabels = GenericTaggerUtils.getTokensWithLabelsAndFeatures(arg2, addFeatureStrings);
    } else {
      this.tokensAndLabels = arg2;
    }
    this.tokenizations = tokenizations;
  }

  hasNext(): boolean {
    return this.tokensAndLabelsIdx < this.tokensAndLabels.length;
  }

  /** null value indicates an empty line in a tagging result */
  next(): IteratorResult<LabeledTokensContainer | null> {
    if (!this.hasNext()) return { value: null, done: true };
    const p = this.tokensAndLabels[this.tokensAndLabelsIdx++] as Triple<string, string, string | null> | null;

    if (p === null) {
      return { value: null, done: false };
    }

    const resultToken = p.getA();
    const label = p.getB();
    const featureString = p.getC();

    const layoutTokenBuffer: LayoutToken[] = [];
    let stop = false;
    let addSpace = false;
    let newLine = false;
    const preTokenizationPtr = this.tokenizationsPtr;

    while (!stop && this.tokenizationsIdx < this.tokenizations.length) {
      const layoutToken = this.tokenizations[this.tokenizationsIdx++] as LayoutToken;

      (layoutToken as unknown as { addLabel(l: ReturnType<typeof TaggingLabels.labelFor>): void }).addLabel(
        TaggingLabels.labelFor(this.grobidModel, label),
      );

      layoutTokenBuffer.push(layoutToken);
      const tokOriginal = layoutToken.t() as string;

      if (LayoutTokensUtil.newLineToken(tokOriginal)) {
        newLine = true;
      } else if (LayoutTokensUtil.spaceyToken(tokOriginal)) {
        addSpace = true;
      } else if (tokOriginal.replace(/[ \n]/g, "") === resultToken) {
        stop = true;
      } else if (tokOriginal.length === 0) {
        // no op
      } else {
        throw new Error(this.prepareErrorMessage(preTokenizationPtr));
      }
      this.tokenizationsPtr++;
    }

    //filling spaces to the end, instead of appending spaces to the next container
    while (this.tokenizationsIdx < this.tokenizations.length) {
      const nextToken = this.tokenizations[this.tokenizationsIdx] as LayoutToken;
      const nt = nextToken.t() as string;
      if (LayoutTokensUtil.spaceyToken(nt) || LayoutTokensUtil.newLineToken(nt)) {
        const layoutToken = this.tokenizations[this.tokenizationsIdx++] as LayoutToken;
        layoutTokenBuffer.push(layoutToken);
        this.tokenizationsPtr++;
        if (LayoutTokensUtil.newLineToken(layoutToken.t() as string)) {
          newLine = true;
        } else if (LayoutTokensUtil.spaceyToken(layoutToken.t() as string)) {
          addSpace = true;
        }
      } else {
        break;
      }
    }

    //resultToken = LayoutTokensUtil.removeSpecialVariables(resultToken);

    this.tokensAndLabelsPtr++;
    const labeledTokensContainer = new LabeledTokensContainer(
      layoutTokenBuffer,
      resultToken,
      TaggingLabels.labelFor(this.grobidModel, label),
      GenericTaggerUtils.isBeginningOfEntity(label),
    );

    labeledTokensContainer.setFeatureString(featureString);
    labeledTokensContainer.setTrailingSpace(addSpace);
    labeledTokensContainer.setTrailingNewLine(newLine);

    return { value: labeledTokensContainer, done: false };
  }

  private prepareErrorMessage(preTokenizationPtr: number): string {
    const limit = 5;
    const sb: string[] = [];
    for (
      let i = Math.max(0, this.tokensAndLabelsPtr - limit);
      i < Math.min(this.tokensAndLabelsPtr + limit, this.tokensAndLabels.length);
      i++
    ) {
      const s = this.tokensAndLabels[i];
      if (s !== null && s !== undefined) {
        const str = i === this.tokensAndLabelsPtr ? "-->\t'" + s.getA() + "'" : "\t'" + s.getA() + "'";
        sb.push(str, "\n");
      }
    }

    const sb2: string[] = [];
    for (
      let i = Math.max(0, preTokenizationPtr - limit * 2);
      i < Math.min(preTokenizationPtr + limit * 2, this.tokenizations.length);
      i++
    ) {
      const s = this.tokenizations[i] as LayoutToken;
      const str = i === preTokenizationPtr ? "-->\t'" + s.t() + "'" : "\t'" + s.t() + "'";
      sb2.push(str, "\n");
    }

    return (
      "IMPLEMENTATION ERROR: " +
      "tokens (at pos: " +
      this.tokensAndLabelsPtr +
      ") got dissynchronized with tokenizations (at pos: " +
      this.tokenizationsPtr +
      " )\n" +
      "labelsAndTokens +-: \n" +
      sb.join("") +
      "\n" +
      "tokenizations +-: " +
      sb2.join("")
    );
  }

  // Java's `Iterator.remove()` → preserved as a throwing stub.
  remove(): void {
    throw new Error("UnsupportedOperationException");
  }

  [Symbol.iterator](): Iterator<LabeledTokensContainer | null> {
    return this;
  }
}
