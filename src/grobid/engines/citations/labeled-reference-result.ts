// Port of org.grobid.core.engines.citations.LabeledReferenceResult.
// Upstream: grobid-core/src/main/java/org/grobid/core/engines/citations/LabeledReferenceResult.java

import type { BoundingBox } from "../../layout/bounding-box.js";
import type { LayoutToken } from "../../layout/layout-token.js";

export class LabeledReferenceResult {
  private label: string | null = null;
  private readonly referenceText: string;
  private features: string | null = null; // optionally the vector of features corresponding to the token referenceText
  private coordinates: BoundingBox[] | null = null;
  private tokens: LayoutToken[] | null = null;

  constructor(referenceText: string);
  constructor(
    label: string,
    referenceText: string,
    referenceTokens: LayoutToken[],
    features: string,
    coordinates: BoundingBox[],
  );
  constructor(
    a: string,
    b?: string,
    c?: LayoutToken[],
    d?: string,
    e?: BoundingBox[],
  ) {
    if (b === undefined) {
      this.referenceText = a;
    } else {
      this.label = a;
      this.referenceText = b;
      this.tokens = c as LayoutToken[];
      this.features = d as string;
      this.coordinates = e as BoundingBox[];
    }
  }

  getLabel(): string | null {
    return this.label;
  }

  getReferenceText(): string {
    return this.referenceText;
  }

  getFeatures(): string | null {
    return this.features;
  }

  getCoordinates(): BoundingBox[] | null {
    return this.coordinates;
  }

  getTokens(): LayoutToken[] | null {
    return this.tokens;
  }

  toString(): string {
    return "** " + (this.label === null ? "" : this.label) + " ** " + this.referenceText;
  }
}
