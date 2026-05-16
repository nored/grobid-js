// Port of org.grobid.core.GrobidModel.
// Upstream: grobid-core/src/main/java/org/grobid/core/GrobidModel.java

/**
 * Identifies a trained CRF model (e.g. "header", "fulltext", "citation").
 * Implementations: the GrobidModels enum (predefined names) and any
 * user-supplied flavor. Used as a key by `TaggingLabel`, `EngineParsers`,
 * feature factories, etc.
 */
export interface GrobidModel {
  getFolderName(): string;
  getModelPath(): string;
  getModelName(): string;
  getTemplateName(): string;
  toString(): string;
}
