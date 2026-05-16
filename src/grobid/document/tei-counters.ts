// Port of org.grobid.core.document.TEICounters.
// Upstream: grobid-core/src/main/java/org/grobid/core/document/TEICounters.java
//
// General debugging counters.

/**
 * General debugging counters.
 *
 * Upstream TEICounters.java line 6-8.
 */
export enum TEICounters {
  CITATION_FIGURE_REF_MARKER_MISSED_SUBSTITUTION = "CITATION_FIGURE_REF_MARKER_MISSED_SUBSTITUTION",
  TEI_POSITION_REF_MARKERS_OFFSET_TOO_LARGE = "TEI_POSITION_REF_MARKERS_OFFSET_TOO_LARGE",
  TEI_POSITION_REF_MARKERS_TOK_NOT_FOUND = "TEI_POSITION_REF_MARKERS_TOK_NOT_FOUND",
  CITATION_FIGURE_REF_MARKER_SUBSTITUTED = "CITATION_FIGURE_REF_MARKER_SUBSTITUTED",
}
