// Port of org.grobid.core.tokenization.TaggingTokenCluster.
// Upstream: grobid-core/src/main/java/org/grobid/core/tokenization/TaggingTokenCluster.java
//
// Adaptations:
// - Guava's `Function`, `Iterables.concat`, `Iterables.transform`, and
//   `Joiner.on("\n").join(...)` are inlined as plain JS array operations.

import type { TaggingLabel } from "../engines/label/tagging-label.js";
import type { LayoutToken } from "../layout/layout-token.js";
import { LabeledTokensContainer } from "./labeled-tokens-container.js";

/**
 * Cluster of related tokens
 */
export class TaggingTokenCluster {
  static readonly CONTAINERS_TO_FEATURE_BLOCK: (cont: LabeledTokensContainer | null) => string = (
    labeledTokensContainer: LabeledTokensContainer | null,
  ): string => {
    if (labeledTokensContainer === null) {
      return "\n";
    }

    if (labeledTokensContainer.getFeatureString() === null) {
      throw new Error(
        "This method must be called when feature string is not empty for LabeledTokenContainers",
      );
    }
    return labeledTokensContainer.getFeatureString() as string;
  };

  private labeledTokensContainers: LabeledTokensContainer[] = [];
  private taggingLabel: TaggingLabel;

  constructor(taggingLabel: TaggingLabel) {
    this.taggingLabel = taggingLabel;
  }

  addLabeledTokensContainer(cont: LabeledTokensContainer): void {
    this.labeledTokensContainers.push(cont);
  }

  getLabeledTokensContainers(): LabeledTokensContainer[] {
    return this.labeledTokensContainers;
  }

  getTaggingLabel(): TaggingLabel {
    return this.taggingLabel;
  }

  toString(): string {
    const sb: string[] = [];
    for (const c of this.labeledTokensContainers) {
      sb.push(c.toString(), "\n");
    }
    sb.push("\n");
    return sb.join("");
  }

  getLastContainer(): LabeledTokensContainer | null {
    if (this.labeledTokensContainers.length === 0) {
      return null;
    }
    return this.labeledTokensContainers[this.labeledTokensContainers.length - 1] as LabeledTokensContainer;
  }

  concatTokens(): LayoutToken[] {
    const out: LayoutToken[] = [];
    for (const c of this.labeledTokensContainers) {
      for (const t of c.getLayoutTokens()) out.push(t);
    }
    return out;
  }

  getFeatureBlock(): string {
    return this.labeledTokensContainers
      .map((c) => TaggingTokenCluster.CONTAINERS_TO_FEATURE_BLOCK(c))
      .join("\n");
  }
}
