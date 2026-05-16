// Port of org.grobid.core.engines.citations.ReferenceSegmenter.
// Upstream: grobid-core/src/main/java/org/grobid/core/engines/citations/ReferenceSegmenter.java

import type { Document } from "../../document/document.js";
import type { LabeledReferenceResult } from "./labeled-reference-result.js";

export interface ReferenceSegmenter {
  // Java upstream returns `List<LabeledReferenceResult>` which may be null
  // when no reference block is found in the document segmentation.
  extract(referenceBlock: string): Promise<LabeledReferenceResult[] | null>;
  extract(document: Document): Promise<LabeledReferenceResult[] | null>;
}
