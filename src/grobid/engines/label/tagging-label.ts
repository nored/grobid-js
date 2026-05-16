// Port of org.grobid.core.engines.label.TaggingLabel.
// Upstream: grobid-core/src/main/java/org/grobid/core/engines/label/TaggingLabel.java

import type { GrobidModel } from "../../grobid-model.js";
import type { Countable } from "../counters/countable.js";

/**
 * A CRF tagging label, scoped to a specific Grobid model (header / fulltext /
 * citation / etc.). Implementations: `TaggingLabelImpl` for the standard set
 * declared in `TaggingLabels`, plus the segmentation-specific labels in
 * `SegmentationLabels`.
 */
export interface TaggingLabel extends Countable {
  getGrobidModel(): GrobidModel;
  getLabel(): string;
}
