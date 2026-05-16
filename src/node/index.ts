// Public Node entry point for grobid-js.
//
// Consumers import the `Grobid` class (a thin wrapper over the upstream-faithful
// engine in `src/grobid/`) and call `processPdf(path)` to get a TEI XML string.
// Lower-level building blocks — the upstream `Engine`, `GrobidProperties`,
// `Lexicon`, `GrobidAnalysisConfig` — are exported as well so advanced callers
// can drive the pipeline directly.

export { Grobid, DEFAULT_TEI_COORDINATE_ELEMENTS } from "./grobid.js";
export type { GrobidOptions } from "./grobid.js";

// Non-Latin script handling: detection helpers + the VLM-extractor plug-in
// API consumers register for the `nonLatinHandling: "fallback-vlm"` mode.
export {
  detectScript,
  detectScriptFromTokens,
  classifyChar,
  hintLanguageForScript,
  NON_LATIN_SCRIPTS,
  DEFAULT_SAMPLE_SIZE,
  MIN_NON_LATIN_COUNT,
} from "../grobid/utilities/script-detector.js";
export type { Script } from "../grobid/utilities/script-detector.js";
export {
  setNonLatinVlmExtractor,
  getNonLatinVlmExtractor,
  resetNonLatinVlmExtractor,
} from "../grobid/utilities/non-latin-vlm-extractor.js";
export type {
  NonLatinVlmExtractor,
  VlmAuthor,
  VlmExtractorArgs,
  VlmHeaderExtraction,
} from "../grobid/utilities/non-latin-vlm-extractor.js";

// Asset distribution helpers — useful for pre-fetching models in CI / build
// pipelines, and for Electron apps bundling assets at build time.
export {
  resolveModelsDir,
  resolveLexiconDir,
  MODEL_ASSETS,
  LEXICON_ASSETS,
  EXTENDED_LEXICON_ASSETS,
  REQUIRED_MODELS,
  OPTIONAL_MODELS,
  GROBID_PINNED_TAG,
} from "./asset-distribution.js";
export type {
  AssetSpec,
  DownloadProgress,
  ResolveOptions,
} from "./asset-distribution.js";

// pdfalto binary resolver — exposed for hosts that ship their own pdfalto
// (e.g. Electron apps bundling a signed copy inside the resource path).
export { resolvePdfaltoBinary } from "./pdfalto-binary.js";
export type { PdfaltoBinaryOptions } from "./pdfalto-binary.js";

// arXiv / DOI fallback post-processor — exposed for callers who want to
// run the canonical-metadata lookup directly against a TEI string (e.g.
// when consuming TEI from a different upstream source).
export {
  applyFallbackMetadata,
  fetchArxivMetadata,
  fetchCrossrefMetadata,
} from "./arxiv-fallback.js";
export type { CanonicalMetadata } from "./arxiv-fallback.js";

// Upstream-faithful engine and surrounding types. These are the building
// blocks `Grobid.processPdf` itself uses; re-exporting them lets advanced
// integrations construct GrobidAnalysisConfig directly or call other
// Engine entry points (e.g. `processReferences`, `processHeader`).
export { Engine } from "../grobid/engines/engine.js";
export {
  GrobidAnalysisConfig,
  GrobidAnalysisConfigBuilder,
} from "../grobid/engines/config/grobid-analysis-config.js";
export { GrobidProperties } from "../grobid/utilities/grobid-properties.js";
export { Lexicon } from "../grobid/lexicon/lexicon.js";
export { GrobidModels, Flavor } from "../grobid/grobid-models.js";
