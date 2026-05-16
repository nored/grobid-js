// Port of org.grobid.core.engines.label.TaggingLabelImpl.
// Upstream: grobid-core/src/main/java/org/grobid/core/engines/label/TaggingLabelImpl.java
//
// Adaptations:
// - Java's Apache `EqualsBuilder` / `HashCodeBuilder` are inlined as plain
//   structural equality on `(grobidModel, label)`. JS has no native hashCode
//   contract; we expose `equals(other)` as a method so callers can compare
//   value-wise. Reference equality used in upstream `==` comparisons (see
//   `TaggingTokenClusteror`) is preserved via the `TaggingLabels` cache.

import type { GrobidModel } from "../../grobid-model.js";
import type { TaggingLabel } from "./tagging-label.js";
import { TaggingLabels } from "./tagging-labels.js";

/**
 * Representing label that can be tagged
 */
export class TaggingLabelImpl implements TaggingLabel {
  static readonly serialVersionUID: number = 1;

  private readonly grobidModel: GrobidModel;
  private readonly label: string;

  constructor(grobidModel: GrobidModel, label: string) {
    this.grobidModel = grobidModel;
    this.label = label;
  }

  getGrobidModel(): GrobidModel {
    return this.grobidModel;
  }

  getLabel(): string {
    return this.label;
  }

  equals(o: unknown): boolean {
    if (this === o) return true;
    if (!(o instanceof TaggingLabelImpl)) return false;
    const that = o;
    return this.getGrobidModel() === that.getGrobidModel() && this.getLabel() === that.getLabel();
  }

  // hashCode() in Java is `new HashCodeBuilder(17, 37).append(grobidModel).append(label).toHashCode()`.
  // JS doesn't have a native hashCode contract — exposed as a method for
  // callers that want a deterministic numeric digest.
  hashCode(): number {
    let h = 17;
    const m = this.grobidModel;
    const mh = m == null ? 0 : TaggingLabelImpl.stringHash((m as { getModelName(): string }).getModelName());
    h = h * 37 + mh;
    h = h * 37 + (this.label == null ? 0 : TaggingLabelImpl.stringHash(this.label));
    return h;
  }

  private static stringHash(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    }
    return h;
  }

  getName(): string {
    const tmp = this.getLabel().replace(/[<>]/g, "");
    return (
      this.getGrobidModel().getModelName() +
      "_" +
      tmp.split(TaggingLabels.GROBID_START_ENTITY_LABEL_PREFIX).join("")
    ).toUpperCase();
  }

  // Java derives the counter group name from the runtime class via
  // `e.getClass().getName()` (TaggingLabelImpl has no enclosing class).
  getGroupName(): string {
    return "org.grobid.core.engines.label.TaggingLabelImpl";
  }
}
