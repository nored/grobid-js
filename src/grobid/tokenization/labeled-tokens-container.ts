// Port of org.grobid.core.tokenization.LabeledTokensContainer.
// Upstream: grobid-core/src/main/java/org/grobid/core/tokenization/LabeledTokensContainer.java

import type { TaggingLabel } from "../engines/label/tagging-label.js";
import { TaggingLabels } from "../engines/label/tagging-labels.js";
import type { LayoutToken } from "../layout/layout-token.js";

/**
 * Representing labeled tokens and stuff
 */
export class LabeledTokensContainer {
  private layoutTokens: LayoutToken[];
  private token: string;
  private taggingLabel: TaggingLabel;
  private beginning: boolean;
  private trailingSpace: boolean = false;
  private trailingNewLine: boolean = false;
  private featureString: string | null = null;

  constructor(layoutTokens: LayoutToken[], token: string, taggingLabel: TaggingLabel, beginning: boolean) {
    this.layoutTokens = layoutTokens;
    this.token = token;
    this.taggingLabel = taggingLabel;
    this.beginning = beginning;
  }

  getLayoutTokens(): LayoutToken[] {
    return this.layoutTokens;
  }

  getToken(): string {
    return this.token;
  }

  getTaggingLabel(): TaggingLabel {
    return this.taggingLabel;
  }

  isBeginning(): boolean {
    return this.beginning;
  }

  getPlainLabel(): string {
    return this.taggingLabel.getLabel();
  }

  getFullLabel(): string {
    return this.isBeginning()
      ? TaggingLabels.GROBID_START_ENTITY_LABEL_PREFIX + this.taggingLabel.getLabel()
      : this.taggingLabel.getLabel();
  }

  isTrailingSpace(): boolean {
    return this.trailingSpace;
  }

  isTrailingNewLine(): boolean {
    return this.trailingNewLine;
  }

  setTrailingSpace(trailingSpace: boolean): void {
    this.trailingSpace = trailingSpace;
  }

  setTrailingNewLine(trailingNewLine: boolean): void {
    this.trailingNewLine = trailingNewLine;
  }

  getFeatureString(): string | null {
    return this.featureString;
  }

  setFeatureString(featureString: string | null): void {
    this.featureString = featureString;
  }

  toString(): string {
    return this.token + " (" + this.getFullLabel() + ")";
  }
}
