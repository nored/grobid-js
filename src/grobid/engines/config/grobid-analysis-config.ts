// Port of org.grobid.core.engines.config.GrobidAnalysisConfig.
// Upstream: grobid-core/src/main/java/org/grobid/core/engines/config/GrobidAnalysisConfig.java
//
// Adaptations:
// - Java `File` for `pdfAssetPath` is preserved as a `string` path — the JS
//   port handles file I/O outside `src/grobid/`.
// - The inner `GrobidAnalysisConfigBuilder` is exported as a top-level
//   class, with a static alias on `GrobidAnalysisConfig` so callers can
//   still write `GrobidAnalysisConfig.GrobidAnalysisConfigBuilder`.

import type { Analyzer } from "../../analyzers/analyzer.js";
import { Flavor } from "../../grobid-models.js";
import { InvalidGrobidAnalysisConfig } from "./invalid-grobid-analysis-config.js";

/**
 * A class representing the runtime configuration values needed in the analysis chain
 * TODO: clean up the docs
 * consolidateHeader    - the consolidation option allows GROBID to exploit Crossref or biblio-glutton
 *                             web services for improving header information
 * consolidateCitations - the consolidation option allows GROBID to exploit Crossref or biblio-glutton
 *                             web services for improving citations information
 * consolidateFunders - the consolidation option allows GROBID to exploit Crossref or biblio-glutton
 *                             web services for improving funder information
 * includeRawCitations - the raw bibliographical string is added to parsed results
 * assetPath if not null, the PDF assets (embedded images) will be extracted and
 * saved under the indicated repository path
 * startPage give the starting page to consider in case of segmentation of the
 * PDF, -1 for the first page (default)
 * endPage give the end page to consider in case of segmentation of the
 * PDF, -1 for the last page (default)
 * generateIDs if true, generate random attribute id on the textual elements of
 * the resulting TEI
 * generateTeiCoordinates give the list of TEI elements for which the coordinates
 * of the corresponding element in the original PDF should be included in the
 * resulting TEI
 * analyzer in case a particular Grobid Analyzer to be used for
 * tokenizing/filtering text
 */
export class GrobidAnalysisConfig {
  // give the starting page to consider in case of segmentation of the
  // PDF, -1 for the first page (default)
  private startPage: number = -1;

  // give the end page to consider in case of segmentation of the
  // PDF, -1 for the last page (default)
  private endPage: number = -1;

  // if consolidate citations
  private consolidateCitations: number = 0;

  // if consolidate header
  private consolidateHeader: number = 0;

  // if consolidate funders
  private consolidateFunders: number = 0;

  // if the raw affiliation string should be included in the parsed results
  private includeRawAffiliations: boolean = false;

  // if the raw bibliographical string should be included in the parsed results
  private includeRawCitations: boolean = false;

  // if the raw copyrights/license string should be included in the parsed results
  private includeRawCopyrights: boolean = false;

  //if the text marked as <other> in fulltext and header should be retained
  private includeDiscardedText: boolean = false;

  /// === TEI-specific settings ==

  // if true, generate random attribute id on the textual elements of
  // the resulting TEI
  private generateTeiIds: boolean = false;

  // generates the coordinates in the PDF corresponding
  // to the TEI full text substructures (e.g. reference markers)
  // for the given list of TEI elements
  private generateTeiCoordinates: string[] | null = null;

  // if true, include image references into TEI
  private generateImageReferences: boolean = false;

  private withXslStylesheet: boolean = false;

  // if not null, the PDF assets (embedded images) will be extracted
  // and saved under the indicated repository path
  private pdfAssetPath: string | null = null;

  // transform images to PNGs
  private preprocessImages: boolean = true;

  private processVectorGraphics: boolean = false;

  // a particular Grobid Analyzer to be used for tokenizing/filtering text
  private analyzer: Analyzer | null = null;

  // if true, the TEI text will be segmented into sentences
  private withSentenceSegmentation: boolean = false;

  private flavor: string | null = null;

  private constructor() {}

  isIncludeDiscardedText(): boolean {
    return this.includeDiscardedText;
  }

  setIncludeDiscardedText(includeDiscardedText: boolean): void {
    this.includeDiscardedText = includeDiscardedText;
  }

  // Mutators exposed only to the builder; in TS we mark them package-private
  // by convention (the builder is colocated in this module).
  /** @internal */ _setConsolidateHeader(v: number): void { this.consolidateHeader = v; }
  /** @internal */ _setConsolidateCitations(v: number): void { this.consolidateCitations = v; }
  /** @internal */ _setConsolidateFunders(v: number): void { this.consolidateFunders = v; }
  /** @internal */ _setIncludeRawAffiliations(v: boolean): void { this.includeRawAffiliations = v; }
  /** @internal */ _setIncludeRawCitations(v: boolean): void { this.includeRawCitations = v; }
  /** @internal */ _setIncludeRawCopyrights(v: boolean): void { this.includeRawCopyrights = v; }
  /** @internal */ _setStartPage(v: number): void { this.startPage = v; }
  /** @internal */ _setEndPage(v: number): void { this.endPage = v; }
  /** @internal */ _setGenerateTeiIds(v: boolean): void { this.generateTeiIds = v; }
  /** @internal */ _setPdfAssetPath(v: string | null): void { this.pdfAssetPath = v; }
  /** @internal */ _setGenerateTeiCoordinates(v: string[] | null): void { this.generateTeiCoordinates = v; }
  /** @internal */ _setWithXslStylesheet(v: boolean): void { this.withXslStylesheet = v; }
  /** @internal */ _setPreprocessImages(v: boolean): void { this.preprocessImages = v; }
  /** @internal */ _setProcessVectorGraphics(v: boolean): void { this.processVectorGraphics = v; }
  /** @internal */ _setWithSentenceSegmentation(v: boolean): void { this.withSentenceSegmentation = v; }
  /** @internal */ _setAnalyzer(v: Analyzer | null): void { this.analyzer = v; }
  /** @internal */ _setFlavor(v: string | null): void { this.flavor = v; }
  /** @internal */ _setGenerateImageReferences(v: boolean): void { this.generateImageReferences = v; }

  // BUILDER

  static GrobidAnalysisConfigBuilder: typeof GrobidAnalysisConfigBuilder;

  static builder(): GrobidAnalysisConfigBuilder;
  static builder(config: GrobidAnalysisConfig): GrobidAnalysisConfigBuilder;
  static builder(config?: GrobidAnalysisConfig): GrobidAnalysisConfigBuilder {
    if (config === undefined) return new GrobidAnalysisConfigBuilder();
    return new GrobidAnalysisConfigBuilder(config);
  }

  static defaultInstance(): GrobidAnalysisConfig {
    return new GrobidAnalysisConfig();
  }

  /** @internal — factory used by the colocated builder. */
  static _newEmpty(): GrobidAnalysisConfig {
    return new GrobidAnalysisConfig();
  }

  toStringTEI(): string {
    const sb: string[] = [];

    sb.push("startPage=", String(this.startPage));
    sb.push(", endPage=", String(this.endPage));
    sb.push(", consolidateCitations=", String(this.consolidateCitations));
    sb.push(", consolidateHeader=", String(this.consolidateHeader));
    sb.push(", consolidateFunders=", String(this.consolidateFunders));
    sb.push(", includeRawAffiliations=", String(this.includeRawAffiliations));
    sb.push(", includeRawCitations=", String(this.includeRawCitations));
    sb.push(", includeRawCopyrights=", String(this.includeRawCopyrights));
    sb.push(", generateTeiIds=", String(this.generateTeiIds));
    sb.push(", generateTeiCoordinates=", String(this.generateTeiCoordinates));
    sb.push(", flavor=", String(this.flavor));

    return sb.join("");
  }

  getStartPage(): number {
    return this.startPage;
  }

  getEndPage(): number {
    return this.endPage;
  }

  getConsolidateCitations(): number {
    return this.consolidateCitations;
  }

  getConsolidateHeader(): number {
    return this.consolidateHeader;
  }

  getConsolidateFunders(): number {
    return this.consolidateFunders;
  }

  getIncludeRawAffiliations(): boolean {
    return this.includeRawAffiliations;
  }

  getIncludeRawCitations(): boolean {
    return this.includeRawCitations;
  }

  getIncludeRawCopyrights(): boolean {
    return this.includeRawCopyrights;
  }

  isGenerateTeiIds(): boolean {
    return this.generateTeiIds;
  }

  getGenerateTeiCoordinates(): string[] | null {
    return this.generateTeiCoordinates;
  }

  isGenerateTeiCoordinates(): boolean;
  isGenerateTeiCoordinates(type: string): boolean;
  isGenerateTeiCoordinates(type?: string): boolean {
    if (type === undefined) {
      return this.getGenerateTeiCoordinates() !== null && (this.getGenerateTeiCoordinates() as string[]).length > 0;
    }
    return this.getGenerateTeiCoordinates() !== null && (this.getGenerateTeiCoordinates() as string[]).indexOf(type) !== -1;
  }

  getPdfAssetPath(): string | null {
    return this.pdfAssetPath;
  }

  isWithXslStylesheet(): boolean {
    return this.withXslStylesheet;
  }

  isGenerateImageReferences(): boolean {
    return this.generateImageReferences;
  }

  isPreprocessImages(): boolean {
    return this.preprocessImages;
  }

  isProcessVectorGraphics(): boolean {
    return this.processVectorGraphics;
  }

  getAnalyzer(): Analyzer | null {
    return this.analyzer;
  }

  isWithSentenceSegmentation(): boolean {
    return this.withSentenceSegmentation;
  }

  getFlavor(): string | null {
    return this.flavor;
  }
}

export class GrobidAnalysisConfigBuilder {
  config: GrobidAnalysisConfig;

  constructor(config?: GrobidAnalysisConfig) {
    this.config = GrobidAnalysisConfig._newEmpty();
    if (config !== undefined) {
      // TODO add more properties
      this.config._setIncludeRawAffiliations(config.getIncludeRawAffiliations());
      this.config._setIncludeRawCitations(config.getIncludeRawCitations());
    }
  }

  consolidateHeader(consolidate: number): GrobidAnalysisConfigBuilder {
    this.config._setConsolidateHeader(consolidate);
    return this;
  }

  /**
   * @param consolidate the consolidation option allows GROBID to exploit Crossref web services for improving header
   *                    information. 0 (no consolidation, default value), 1 (consolidate the citation and inject extra
   *                    metadata) or 2 (consolidate the citation and inject DOI only)
   */
  consolidateCitations(consolidate: number): GrobidAnalysisConfigBuilder {
    this.config._setConsolidateCitations(consolidate);
    return this;
  }

  consolidateFunders(consolidate: number): GrobidAnalysisConfigBuilder {
    this.config._setConsolidateFunders(consolidate);
    return this;
  }

  includeRawAffiliations(rawAffiliations: boolean): GrobidAnalysisConfigBuilder {
    this.config._setIncludeRawAffiliations(rawAffiliations);
    return this;
  }

  includeRawCitations(rawCitations: boolean): GrobidAnalysisConfigBuilder {
    this.config._setIncludeRawCitations(rawCitations);
    return this;
  }

  includeRawCopyrights(rawCopyrights: boolean): GrobidAnalysisConfigBuilder {
    this.config._setIncludeRawCopyrights(rawCopyrights);
    return this;
  }

  includeDiscardedText(includeDiscardedText: boolean): GrobidAnalysisConfigBuilder {
    this.config.setIncludeDiscardedText(includeDiscardedText);
    return this;
  }

  startPage(p: number): GrobidAnalysisConfigBuilder {
    this.config._setStartPage(p);
    return this;
  }

  endPage(p: number): GrobidAnalysisConfigBuilder {
    this.config._setEndPage(p);
    return this;
  }

  generateTeiIds(b: boolean): GrobidAnalysisConfigBuilder {
    this.config._setGenerateTeiIds(b);
    return this;
  }

  pdfAssetPath(p: string | null): GrobidAnalysisConfigBuilder {
    this.config._setPdfAssetPath(p);
    return this;
  }

  generateTeiCoordinates(elements: string[] | null): GrobidAnalysisConfigBuilder {
    this.config._setGenerateTeiCoordinates(elements);
    return this;
  }

  withXslStylesheet(b: boolean): GrobidAnalysisConfigBuilder {
    this.config._setWithXslStylesheet(b);
    return this;
  }

  withPreprocessImages(b: boolean): GrobidAnalysisConfigBuilder {
    this.config._setPreprocessImages(b);
    return this;
  }

  withProcessVectorGraphics(b: boolean): GrobidAnalysisConfigBuilder {
    this.config._setProcessVectorGraphics(b);
    return this;
  }

  withSentenceSegmentation(b: boolean): GrobidAnalysisConfigBuilder {
    this.config._setWithSentenceSegmentation(b);
    return this;
  }

  analyzer(a: Analyzer | null): GrobidAnalysisConfigBuilder {
    this.config._setAnalyzer(a);
    return this;
  }

  flavor(a: Flavor | null): GrobidAnalysisConfigBuilder {
    if (a !== null) {
      this.config._setFlavor(a.getLabel());
    }
    return this;
  }

  build(): GrobidAnalysisConfig {
    this.postProcessAndValidate();
    return this.config;
  }

  private postProcessAndValidate(): void {
    if (this.config.getPdfAssetPath() !== null) {
      this.config._setGenerateImageReferences(true);
    }

    if (this.config.isGenerateImageReferences() && this.config.getPdfAssetPath() === null) {
      throw new InvalidGrobidAnalysisConfig("Generating image references is switched on, but no pdf asset path is provided");
    }
  }
}

// Inner-class alias preserved for upstream call sites.
GrobidAnalysisConfig.GrobidAnalysisConfigBuilder = GrobidAnalysisConfigBuilder;
