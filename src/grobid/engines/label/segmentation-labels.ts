// Port of org.grobid.core.engines.label.SegmentationLabels.
// Upstream: grobid-core/src/main/java/org/grobid/core/engines/label/SegmentationLabels.java

import { GrobidModels } from "../../grobid-models.js";
import type { TaggingLabel } from "./tagging-label.js";
import { TaggingLabelImpl } from "./tagging-label-impl.js";
import { TaggingLabels } from "./tagging-labels.js";

/**
 * cover page <cover>,
 * document header <header>,
 * page footer <footnote>,
 * page header <headnote>,
 * note in margin <marginnote>,
 * document body <body>,
 * bibliographical section <references>,
 * page number <page>,
 * annexes <annex>,
 * acknowledgement <acknowledgement>,
 * availability <availability>,
 * funding <funding>,
 * other <other>,
 * toc <toc> -> not yet used because not yet training data for this
 */
export class SegmentationLabels extends TaggingLabels {
  static override readonly COVER_LABEL: string = "<cover>";
  static override readonly HEADER_LABEL: string = "<header>";
  static readonly FOOTNOTE_LABEL: string = "<footnote>";
  static readonly HEADNOTE_LABEL: string = "<headnote>";
  static readonly MARGINNOTE_LABEL: string = "<marginnote>";
  static readonly BODY_LABEL: string = "<body>";
  static readonly PAGE_NUMBER_LABEL: string = "<page>";
  static override readonly ANNEX_LABEL: string = "<annex>";
  static readonly REFERENCES_LABEL: string = "<references>";
  static readonly ACKNOWLEDGEMENT_LABEL: string = "<acknowledgement>";
  static override readonly TOC_LABEL: string = "<toc>";

  protected constructor() {
    super();
  }

  static readonly COVER: TaggingLabel = new TaggingLabelImpl(GrobidModels.SEGMENTATION, SegmentationLabels.COVER_LABEL);
  static readonly HEADER: TaggingLabel = new TaggingLabelImpl(GrobidModels.SEGMENTATION, SegmentationLabels.HEADER_LABEL);
  static readonly FOOTNOTE: TaggingLabel = new TaggingLabelImpl(GrobidModels.SEGMENTATION, SegmentationLabels.FOOTNOTE_LABEL);
  static readonly HEADNOTE: TaggingLabel = new TaggingLabelImpl(GrobidModels.SEGMENTATION, SegmentationLabels.HEADNOTE_LABEL);
  static readonly MARGINNOTE: TaggingLabel = new TaggingLabelImpl(GrobidModels.SEGMENTATION, SegmentationLabels.MARGINNOTE_LABEL);
  static readonly BODY: TaggingLabel = new TaggingLabelImpl(GrobidModels.SEGMENTATION, SegmentationLabels.BODY_LABEL);
  static readonly PAGE_NUMBER: TaggingLabel = new TaggingLabelImpl(GrobidModels.SEGMENTATION, SegmentationLabels.PAGE_NUMBER_LABEL);
  static readonly ANNEX: TaggingLabel = new TaggingLabelImpl(GrobidModels.SEGMENTATION, SegmentationLabels.ANNEX_LABEL);
  static readonly REFERENCES: TaggingLabel = new TaggingLabelImpl(GrobidModels.SEGMENTATION, SegmentationLabels.REFERENCES_LABEL);
  static readonly ACKNOWLEDGEMENT: TaggingLabel = new TaggingLabelImpl(GrobidModels.SEGMENTATION, SegmentationLabels.ACKNOWLEDGEMENT_LABEL);

  static readonly AVAILABILITY: TaggingLabel = new TaggingLabelImpl(GrobidModels.SEGMENTATION, TaggingLabels.AVAILABILITY_LABEL);
  static readonly CONFLICT_OF_INTEREST: TaggingLabel = new TaggingLabelImpl(GrobidModels.SEGMENTATION, TaggingLabels.CONFLICT_OF_INTEREST_LABEL);
  static readonly AUTHOR_CONTRIBUTION: TaggingLabel = new TaggingLabelImpl(GrobidModels.SEGMENTATION, TaggingLabels.AUTHOR_CONTRIBUTION_LABEL);
  static readonly FUNDING: TaggingLabel = new TaggingLabelImpl(GrobidModels.SEGMENTATION, TaggingLabels.FUNDING_LABEL);
  static readonly TOC: TaggingLabel = new TaggingLabelImpl(GrobidModels.SEGMENTATION, SegmentationLabels.TOC_LABEL);
}

// Java's `static {}` initialiser block — forwards to the protected static
// `register` on `TaggingLabels`. Emitted as a top-level IIFE.
(function registerSegmentation(): void {
  const r = (label: TaggingLabel): void => {
    (TaggingLabels as unknown as { register(l: TaggingLabel): void }).register(label);
  };
  r(SegmentationLabels.COVER);
  r(SegmentationLabels.HEADER);
  r(SegmentationLabels.FOOTNOTE);
  r(SegmentationLabels.HEADNOTE);
  r(SegmentationLabels.MARGINNOTE);
  r(SegmentationLabels.BODY);
  r(SegmentationLabels.PAGE_NUMBER);
  r(SegmentationLabels.ANNEX);
  r(SegmentationLabels.REFERENCES);
  r(SegmentationLabels.ACKNOWLEDGEMENT);
  r(SegmentationLabels.AVAILABILITY);
  r(SegmentationLabels.FUNDING);
  r(SegmentationLabels.TOC);
  r(SegmentationLabels.CONFLICT_OF_INTEREST);
  r(SegmentationLabels.AUTHOR_CONTRIBUTION);
})();
