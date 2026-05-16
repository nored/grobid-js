// Pluggable VLM extractor for non-Latin documents.
//
// NOTE: No upstream Java equivalent. GROBID's CRFs are English-trained and
// produce degraded header output on non-Latin scripts (Cyrillic, CJK, Arabic,
// Greek, etc.). When `nonLatinHandling: "fallback-vlm"` is selected in
// `Grobid.processPdf`, this module's currently-registered extractor is asked
// to recover the title and author list from page 1.
//
// Following the same pattern as `setReTokenizerFactory` in
// `analyzers/grobid-analyzer.ts`: the default implementation throws. Consumers
// register a real implementation (e.g. one that shells out to Claude or
// Gemini Vision) by calling `setNonLatinVlmExtractor(...)`.
//
// Keeping the API minimal: we accept a PDF path + the detected script, and we
// expect back a structured title and a structured author list. The extractor
// is fully responsible for rendering the page and calling its VLM of choice;
// grobid-js does NOT bundle a renderer or a model.

/** A single author parsed by the VLM extractor. */
export interface VlmAuthor {
  /** Given name (forename). */
  forename?: string;
  /** Family name (surname). */
  surname?: string;
  /** Affiliation string as printed (line-joined). */
  affiliation?: string;
  /** Email if visible. */
  email?: string;
}

/** Structured payload the VLM extractor returns. */
export interface VlmHeaderExtraction {
  /** Document title, in the original script. */
  title?: string;
  /** Title transliterated/translated to English, when the model also returns one. */
  englishTitle?: string;
  /** Authors, in document order. */
  authors?: VlmAuthor[];
  /** Abstract, in the original script. Optional. */
  abstract?: string;
  /** Free-form notes the model wants to attach. */
  notes?: string;
}

/** Arguments passed to the extractor. */
export interface VlmExtractorArgs {
  /** Absolute path to the PDF on disk. */
  pdfPath: string;
  /** Detected dominant script (e.g. "cyrillic"). */
  script: string;
  /** Coarse language hint when known (BCP-47 short code, e.g. "ru"). */
  langHint: string | null;
}

/** Public extractor interface. */
export interface NonLatinVlmExtractor {
  extractHeader(args: VlmExtractorArgs): Promise<VlmHeaderExtraction>;
}

// Default: throw on use. Mirrors `ReTokenizerFactory`'s registration pattern.
let extractor: NonLatinVlmExtractor = {
  async extractHeader(args: VlmExtractorArgs): Promise<VlmHeaderExtraction> {
    throw new Error(
      "NonLatinVlmExtractor not registered; cannot run fallback-vlm on '" +
        args.pdfPath +
        "' (script=" + args.script + "). " +
        "Register an extractor via setNonLatinVlmExtractor(...)."
    );
  },
};

/**
 * Register a VLM extractor implementation. Replaces any previously-registered
 * extractor (last-write-wins, intentional — there's no useful fan-out here).
 */
export function setNonLatinVlmExtractor(impl: NonLatinVlmExtractor): void {
  extractor = impl;
}

/** Read the currently-registered extractor. Throws on use if no real one is registered. */
export function getNonLatinVlmExtractor(): NonLatinVlmExtractor {
  return extractor;
}

/** Reset to the default throwing extractor. Mostly useful in tests. */
export function resetNonLatinVlmExtractor(): void {
  extractor = {
    async extractHeader(args: VlmExtractorArgs): Promise<VlmHeaderExtraction> {
      throw new Error(
        "NonLatinVlmExtractor not registered; cannot run fallback-vlm on '" +
          args.pdfPath +
          "' (script=" + args.script + "). " +
          "Register an extractor via setNonLatinVlmExtractor(...)."
      );
    },
  };
}
