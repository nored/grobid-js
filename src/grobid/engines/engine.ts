// Port of org.grobid.core.engines.Engine.
// Upstream: grobid-core/src/main/java/org/grobid/core/engines/Engine.java
//
// Adaptations:
// - File I/O for batch methods uses `node:fs`; for `runLanguageId(path, ext)`
//   we read a window of the input file.
// - Apache Commons `Pair.getLeft()` → our `Pair.a` (see utilities/pair.ts).
// - Upstream's commented-out `Engine.getEngine(boolean isparallelExec)`
//   block is preserved as a comment.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";

import { BibDataSet } from "../data/bib-data-set.js";
import { BiblioItem } from "../data/biblio-item.js";
import { ChemicalEntity } from "../data/chemical-entity.js";
import type { Date as GrobidDate } from "../data/date.js";
import { type Affiliation } from "../data/affiliation.js";
import type { PatentItem } from "../data/patent-item.js";
import type { Person } from "../data/person.js";
import { Document } from "../document/document.js";
import { DocumentSource } from "../document/document-source.js";
import { GrobidAnalysisConfig, GrobidAnalysisConfigBuilder } from "./config/grobid-analysis-config.js";
import { GrobidException } from "../exceptions/grobid-exception.js";
import { GrobidPoolingFactory } from "../factory/grobid-pooling-factory.js";
import type { Flavor } from "../grobid-models.js";
import { Language } from "../lang/language.js";
import { Consolidation } from "../utilities/consolidation.js";
import { LanguageUtilities } from "../utilities/language-utilities.js";
import { Utilities } from "../utilities/utilities.js";
import type { CntManager } from "../utilities/counters/cnt-manager.js";
import { CntManagerFactory } from "../utilities/counters/impl/cnt-manager-factory.js";
import { CrossrefClient } from "../utilities/crossref/crossref-client.js";
import { getLogger } from "../utilities/logger.js";
import { EngineParsers } from "./engine-parsers.js";

const LOGGER = getLogger("Engine");

/**
 * Class for managing the extraction of bibliographical information from PDF
 * documents or raw text.
 */
export class Engine {
  private readonly parsers: EngineParsers = new EngineParsers();
  //TODO: when using one instance of Engine in e.g. grobid-service, then make this field not static
  private static cntManagerField: CntManager = CntManagerFactory.getCntManager();

  // The list of accepted languages
  // the languages are encoded in ISO 3166
  // if null, all languages are accepted.
  private acceptedLanguages: string[] | null = null;

  /**
   * Parse a sequence of authors from a header, i.e. containing possibly
   * reference markers.
   *
   * @param authorSequence - the string corresponding to a raw sequence of names
   * @return the list of structured author object
   */
  async processAuthorsHeader(authorSequence: string): Promise<Person[] | null> {
    const result: Person[] | null = await this.parsers.getAuthorParser().processingHeader(authorSequence);
    return result;
  }

  /**
   * Parse a sequence of authors from a citation, i.e. containing no reference
   * markers.
   *
   * @param authorSequence - the string corresponding to a raw sequence of names
   * @return the list of structured author object
   */
  async processAuthorsCitation(authorSequence: string): Promise<Person[] | null> {
    const result: Person[] | null = await this.parsers
      .getAuthorParser()
      .processingCitation(authorSequence);
    return result;
  }

  /**
   * Parse a list of independent sequences of authors from citations.
   *
   * @param authorSequences - the list of strings corresponding each to a raw sequence of
   *                        names.
   * @return the list of all recognized structured author objects for each
   *         sequence of authors.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  processAuthorsCitationLists(authorSequences: string[]): Person[][] | null {
    return null;
  }

  /**
   * Parse a text block corresponding to an affiliation+address.
   *
   * @param addressBlock - the string corresponding to a raw affiliation+address
   * @return the list of all recognized structured affiliation objects.
   */
  async processAffiliation(addressBlock: string): Promise<Affiliation[] | null> {
    return await this.parsers.getAffiliationAddressParser().processing(addressBlock);
  }

  /**
   * Parse a list of text blocks corresponding to an affiliation+address.
   *
   * @param addressBlocks - the list of strings corresponding each to a raw
   *                      affiliation+address.
   * @return the list of all recognized structured affiliation objects for
   *         each sequence of affiliation + address block.
   */
  async processAffiliations(addressBlocks: string[]): Promise<(Affiliation[] | null)[] | null> {
    let results: (Affiliation[] | null)[] | null = null;
    for (const addressBlock of addressBlocks) {
      const localRes: Affiliation[] | null = await this.parsers
        .getAffiliationAddressParser()
        .processing(addressBlock);
      if (results === null) {
        results = [];
      }
      results.push(localRes);
    }
    return results;
  }

  /**
   * Parse a raw string containing dates.
   *
   * @param dateBlock - the string containing raw dates.
   * @return the list of all structured date objects recognized in the string.
   */
  async processDate(dateBlock: string): Promise<GrobidDate[] | null> {
    const result: GrobidDate[] | null = await this.parsers.getDateParser().process(dateBlock);
    return result;
  }

  /**
   * Parse a list of raw dates.
   *
   * @param dateBlocks - the list of strings each containing raw dates.
   * @return the list of all structured date objects recognized in the string
   *         for each inputed string.
   */
  /*processDates(dateBlocks: string[]): GrobidDate[][] | null {
    return null;
  }*/

  /**
   * Apply a parsing model for a given single raw reference string
   *
   * @param reference   the reference string to be processed
   * @param consolidate the consolidation option allows GROBID to exploit Crossref web services for improving header
   *                    information. 0 (no consolidation, default value), 1 (consolidate the citation and inject extra
   *                    metadata) or 2 (consolidate the citation and inject DOI only)
   * @return the recognized bibliographical object
   */
  async processRawReference(reference: string | null, consolidate: number): Promise<BiblioItem | null> {
    if (reference !== null) {
      reference = reference.replace(/\\/g, "");
    }
    // Upstream passes `reference` (possibly null) directly through; the
    // CitationParser TS port narrows to non-null, so cast here.
    return await this.parsers.getCitationParser().processingString(reference as string, consolidate);
  }

  /**
   * Apply a parsing model for a set of raw reference text
   *
   * @param references  the list of raw reference strings to be processed
   * @param consolidate the consolidation option allows GROBID to exploit Crossref web services for improving header
   *                    information. 0 (no consolidation, default value), 1 (consolidate the citation and inject extra
   *                    metadata) or 2 (consolidate the citation and inject DOI only)
   * @return the list of recognized bibliographical objects
   */
  async processRawReferences(references: string[] | null, consolidate: number): Promise<BiblioItem[]> {
    const finalResults: BiblioItem[] = [];
    if (references === null || references.length === 0) return finalResults;

    const rawResults: (BiblioItem | null)[] | null = await this.parsers
      .getCitationParser()
      .processingStringMultiple(references, 0);
    if (rawResults === null || rawResults.length === 0) return finalResults;
    // Upstream uses `List<BiblioItem>`; rows are never null in practice, but
    // the TS port types them as nullable. Filter to non-null for type safety.
    const results: BiblioItem[] = rawResults.filter((b): b is BiblioItem => b !== null);
    if (results.length === 0) return finalResults;

    // consolidation in a second stage to take advantage of parallel calls
    if (consolidate === 0) {
      return results;
    } else {
      // prepare for set consolidation
      const bibDataSetResults: BibDataSet[] = [];
      for (const bib of results) {
        const bds: BibDataSet = new BibDataSet();
        bds.setResBib(bib);
        bds.setRawBib(bib.getReference());
        bibDataSetResults.push(bds);
      }

      const consolidator: Consolidation = Consolidation.getInstance();
      if (consolidator.getCntManager() === null) consolidator.setCntManager(Engine.cntManagerField);
      let resConsolidation: Map<number, BiblioItem> | null = null;
      try {
        // NOTE: upstream Java's `Consolidation.consolidate(List<BibDataSet>)`
        // is renamed in the TS port to `consolidateBatch` to disambiguate
        // from the single-item overload.
        resConsolidation = consolidator.consolidateBatch(bibDataSetResults);
      } catch (e) {
        throw new GrobidException(
          "An exception occured while running consolidation on bibliographical references.",
          e,
        );
      }
      if (resConsolidation !== null) {
        for (let i = 0; i < bibDataSetResults.length; i++) {
          const resCitation: BiblioItem | null = bibDataSetResults[i]!.getResBib();
          const bibo: BiblioItem | undefined = resConsolidation.get(i);
          if (bibo !== undefined && bibo !== null && resCitation !== null) {
            if (consolidate === 1) BiblioItem.correct(resCitation, bibo);
            else if (consolidate === 2) BiblioItem.injectIdentifiers(resCitation, bibo);
          }
          if (resCitation !== null) finalResults.push(resCitation);
        }
      }
    }

    return finalResults;
  }

  /**
   * Constructor for the Grobid engine instance.
   */
  constructor(loadModels: boolean) {
    /*
     * Runtime.getRuntime().addShutdownHook(new Thread() {
		 *
		 * @Override public void run() { try { close(); } catch (IOException e)
		 * { LOGGER.error("Failed to close all resources: " + e); } } });
		 */
    if (loadModels) this.parsers.initAll();
  }

  /**
   * Apply a parsing model to the reference block of a PDF file
   *
   * @param inputFile   the path of the PDF file to be processed
   * @param md5Str      MD5 digest of the PDF file to be processed (optional)
   * @param consolidate the consolidation option allows GROBID to exploit Crossref web services for improving header
   *                    information. 0 (no consolidation, default value), 1 (consolidate the citation and inject extra
   *                    metadata) or 2 (consolidate the citation and inject DOI only)
   * @return the list of parsed references as bibliographical objects enriched
   *         with citation contexts
   */
  processReferences(inputFile: string, consolidate: number): Promise<BibDataSet[]>;
  processReferences(inputFile: string, md5Str: string, consolidate: number): Promise<BibDataSet[]>;
  async processReferences(inputFile: string, arg2: number | string, arg3?: number): Promise<BibDataSet[]> {
    if (typeof arg2 === "string") {
      return await this.parsers
        .getCitationParser()
        .processingReferenceSection(inputFile, arg2, this.parsers.getReferenceSegmenterParser(), arg3 as number);
    }
    return await this.parsers
      .getCitationParser()
      .processingReferenceSection(inputFile, this.parsers.getReferenceSegmenterParser(), arg2);
  }

  /**
   * Download a PDF file.
   *
   * @param url     URL of the PDF to download
   * @param dirName directory where to store the downloaded PDF
   * @param name file name
   */
  downloadPDF(url: string, dirName: string, name: string): string {
    return Utilities.uploadFile(url, dirName, name);
  }

  /**
   * Give the list of languages for which an extraction is allowed. If null,
   * any languages will be processed
   *
   * @return the list of languages to be processed coded in ISO 3166.
   */
  getAcceptedLanguages(): string[] | null {
    return this.acceptedLanguages;
  }

  /**
   * Add a language to the list of accepted languages.
   *
   * @param lang the language in ISO 3166 to be added
   */
  addAcceptedLanguages(lang: string): void {
    if (this.acceptedLanguages === null) {
      this.acceptedLanguages = [];
    }
    this.acceptedLanguages.push(lang);
  }

  /**
   * Perform a language identification
   *
   * @param ext part
   * @return language
   */
  runLanguageId(filePath: string): Language | null;
  runLanguageId(filePath: string, ext: string): Language | null;
  runLanguageId(filePath: string, ext?: string): Language | null {
    if (ext === undefined) {
      return this.runLanguageId(filePath, "body");
    }
    try {
      // we just skip the 50 first lines and get the next approx. 5000
      // first characters,
      // which should give a close to ~100% accuracy for the supported languages
      let text = "";
      const fullPath = filePath.substring(0, filePath.length - 3) + ext;
      const content: string = readFileSync(fullPath, { encoding: "utf-8" });
      const lines: string[] = content.split("\n");
      let nbChar = 0;
      for (const line of lines) {
        if (nbChar >= 5000) break;
        if (line.length === 0) continue;
        text += " " + line;
        nbChar += line.length;
      }
      const languageUtilities: LanguageUtilities = LanguageUtilities.getInstance();
      return languageUtilities.runLanguageId(text);
    } catch (e) {
      throw new GrobidException("An exception occurred while running Grobid.", e);
    }
  }

  /**
   * Apply a parsing model for the header of a PDF file, using
   * first three pages of the PDF
   */
  processHeader(
    inputFile: string,
    consolidate: number,
    includeRawAffiliations: boolean,
    includeRawCopyrights: boolean,
    includeDiscardedText: boolean,
    result: BiblioItem,
  ): Promise<string>;
  processHeader(
    inputFile: string,
    md5Str: string,
    consolidate: number,
    includeRawAffiliations: boolean,
    includeRawCopyrights: boolean,
    includeDiscardedText: boolean,
    startPage: number,
    endPage: number,
    result: BiblioItem,
  ): Promise<string>;
  processHeader(inputFile: string, result: BiblioItem): Promise<string>;
  processHeader(inputFile: string, config: GrobidAnalysisConfig, result: BiblioItem): Promise<string>;
  processHeader(
    inputFile: string,
    md5Str: string | null,
    config: GrobidAnalysisConfig,
    result: BiblioItem,
  ): Promise<string>;
  async processHeader(
    inputFile: string,
    arg2?: number | string | BiblioItem | GrobidAnalysisConfig | null,
    arg3?: boolean | number | GrobidAnalysisConfig | BiblioItem,
    arg4?: boolean | BiblioItem,
    arg5?: boolean,
    arg6?: boolean | BiblioItem | number,
    arg7?: number,
    arg8?: number,
    arg9?: BiblioItem,
  ): Promise<string> {
    // Overload 1: (inputFile, result)
    if (arg2 instanceof BiblioItem) {
      return await this.processHeaderImpl(inputFile, null, GrobidAnalysisConfig.defaultInstance(), arg2);
    }
    // Overload 2: (inputFile, config, result)
    if (arg2 instanceof GrobidAnalysisConfig && arg3 instanceof BiblioItem) {
      return await this.processHeaderImpl(inputFile, null, arg2, arg3);
    }
    // Overload 3: (inputFile, md5Str, config, result)
    if ((typeof arg2 === "string" || arg2 === null) && arg3 instanceof GrobidAnalysisConfig && arg4 instanceof BiblioItem) {
      return await this.processHeaderImpl(inputFile, arg2 as string | null, arg3, arg4);
    }
    // Overload 4: (inputFile, consolidate:number, includeRawAffiliations, includeRawCopyrights, includeDiscardedText, result)
    if (
      typeof arg2 === "number" &&
      typeof arg3 === "boolean" &&
      typeof arg4 === "boolean" &&
      typeof arg5 === "boolean" &&
      arg6 instanceof BiblioItem
    ) {
      const config: GrobidAnalysisConfig = new GrobidAnalysisConfigBuilder()
        .startPage(0)
        .endPage(2)
        .consolidateHeader(arg2)
        .includeRawAffiliations(arg3)
        .includeRawCopyrights(arg4)
        // Fixed from upstream: upstream Java's 6-arg `processHeader` builder
        // calls `.includeRawCopyrights(includeDiscardedText)` here, silently
        // overwriting the previous `.includeRawCopyrights(includeRawCopyrights)`
        // and dropping `includeDiscardedText` on the floor. The correct call
        // is `.includeDiscardedText(...)`.
        .includeDiscardedText(arg5)
        .build();
      return await this.processHeaderImpl(inputFile, null, config, arg6);
    }
    // Overload 5: (inputFile, md5Str, consolidate:number, includeRawAffiliations, includeRawCopyrights, includeDiscardedText, startPage, endPage, result)
    if (
      typeof arg2 === "string" &&
      typeof arg3 === "number" &&
      typeof arg4 === "boolean" &&
      typeof arg5 === "boolean" &&
      typeof arg6 === "boolean"
    ) {
      const config: GrobidAnalysisConfig = new GrobidAnalysisConfigBuilder()
        .startPage(arg7 as number)
        .endPage(arg8 as number)
        .consolidateHeader(arg3)
        .includeRawAffiliations(arg4)
        .includeRawCopyrights(arg5)
        .includeDiscardedText(arg6)
        .build();
      return await this.processHeaderImpl(inputFile, arg2, config, arg9 as BiblioItem);
    }
    throw new Error("Engine.processHeader: unsupported overload");
  }

  private async processHeaderImpl(
    inputFile: string,
    md5Str: string | null,
    config: GrobidAnalysisConfig,
    result: BiblioItem | null,
  ): Promise<string> {
    // normally the BiblioItem reference must not be null, but if it is the
    // case, we still continue
    // with a new instance, so that the resulting TEI string is still
    // delivered
    if (result === null) {
      result = new BiblioItem();
    }
    // HeaderParser.processing types `md5Str` as `string`; upstream Java
    // passes null directly. Cast preserves the null path.
    const resultTEI = await this.parsers
      .getHeaderParser()
      .processing(inputFile, md5Str as string, result, config);
    // Upstream uses Apache Commons `Pair.getLeft()`; our Pair exposes `.a`.
    return resultTEI.a;
  }

  /**
   * Apply a parsing model for the header of a PDF file combined with an extraction and parsing of
   * funding information (outside the header possibly)
   */
  processHeaderFunding(
    inputFile: string,
    consolidateHeader: number,
    consolidateFunders: number,
    includeRawAffiliations: boolean,
    includeRawCopyrights: boolean,
    includeDiscardedText: boolean,
  ): Promise<string>;
  processHeaderFunding(
    inputFile: string,
    md5Str: string | null,
    consolidateHeader: number,
    consolidateFunders: number,
    includeRawAffiliations: boolean,
    includeRawCopyrights: boolean,
    includeDiscardedText: boolean,
  ): Promise<string>;
  processHeaderFunding(inputFile: string, config: GrobidAnalysisConfig): Promise<string>;
  processHeaderFunding(inputFile: string, md5Str: string | null, config: GrobidAnalysisConfig): Promise<string>;
  async processHeaderFunding(
    inputFile: string,
    arg2: number | string | null | GrobidAnalysisConfig,
    arg3?: number | GrobidAnalysisConfig,
    arg4?: number | boolean,
    arg5?: boolean,
    arg6?: boolean,
    arg7?: boolean,
  ): Promise<string> {
    // (inputFile, config)
    if (arg2 instanceof GrobidAnalysisConfig) {
      return await this.processHeaderFundingImpl(inputFile, null, arg2);
    }
    // (inputFile, md5Str|null, config)
    if ((typeof arg2 === "string" || arg2 === null) && arg3 instanceof GrobidAnalysisConfig) {
      return await this.processHeaderFundingImpl(inputFile, arg2 as string | null, arg3);
    }
    // (inputFile, consolidateHeader, consolidateFunders, includeRawAffiliations, includeRawCopyrights, includeDiscardedText)
    if (
      typeof arg2 === "number" &&
      typeof arg3 === "number" &&
      typeof arg4 === "boolean" &&
      typeof arg5 === "boolean" &&
      typeof arg6 === "boolean"
    ) {
      const config: GrobidAnalysisConfig = new GrobidAnalysisConfigBuilder()
        .consolidateHeader(arg2)
        .consolidateFunders(arg3)
        .includeRawAffiliations(arg4)
        .includeRawCopyrights(arg5)
        .includeDiscardedText(arg6)
        .build();
      return await this.processHeaderFundingImpl(inputFile, null, config);
    }
    // (inputFile, md5Str, consolidateHeader, consolidateFunders, includeRawAffiliations, includeRawCopyrights, includeDiscardedText)
    if (
      (typeof arg2 === "string" || arg2 === null) &&
      typeof arg3 === "number" &&
      typeof arg4 === "number" &&
      typeof arg5 === "boolean" &&
      typeof arg6 === "boolean" &&
      typeof arg7 === "boolean"
    ) {
      const config: GrobidAnalysisConfig = new GrobidAnalysisConfigBuilder()
        .consolidateHeader(arg3)
        .consolidateFunders(arg4)
        .includeRawAffiliations(arg5)
        .includeRawCopyrights(arg6)
        .includeDiscardedText(arg7)
        .build();
      return await this.processHeaderFundingImpl(inputFile, arg2 as string | null, config);
    }
    throw new Error("Engine.processHeaderFunding: unsupported overload");
  }

  private async processHeaderFundingImpl(
    inputFile: string,
    md5Str: string | null,
    config: GrobidAnalysisConfig,
  ): Promise<string> {
    const fullTextParser = this.parsers.getFullTextParser();
    LOGGER.debug("Starting processing fullTextToTEI on " + inputFile);
    const time = Date.now();
    const resultDoc: Document = await fullTextParser.processingHeaderFunding(inputFile, md5Str, config);
    LOGGER.debug(
      "Ending processing fullTextToTEI on " + inputFile + ". Time to process: " + (Date.now() - time) + "ms",
    );
    return resultDoc.getTei() ?? "";
  }

  /**
   * Create training data for the monograph model based on the application of
   * the current monograph text model on a new PDF
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  createTrainingMonograph(inputFile: string, pathRaw: string, pathTEI: string, id: number): void {
    // Upstream binds `doc` to the return value but never uses it; preserved.
    void this.parsers.getMonographParser().createTrainingFromPDF(inputFile, pathRaw, pathTEI, id);
  }

  /**
   * Generate blank training data from provided directory of PDF documents, i.e. where TEI files are text only
   * without tags. This can be used to start from scratch any new model.
   */
  createTrainingBlank(inputFile: string, pathRaw: string, pathTEI: string, id: number): void {
    this.parsers.getSegmentationParser().createBlankTrainingData(inputFile, pathRaw, pathTEI, id);
  }

  /**
   * Create training data for all models based on the application of
   * the current full text model on a new PDF
   */
  createTraining(
    inputFile: string,
    pathRaw: string,
    pathTEI: string,
    id: number,
    flavor: Flavor | null,
  ): void {
    LOGGER.info(inputFile);
    // Upstream binds the result to `doc` and discards it; preserved.
    void this.parsers
      .getFullTextParser(flavor)
      .createTraining(inputFile, pathRaw, pathTEI, id, flavor);
  }

  /**
   * Parse and convert the current article into TEI.
   */
  fullTextToTEI(inputFile: string, config: GrobidAnalysisConfig): Promise<string>;
  fullTextToTEI(inputFile: string, flavor: Flavor | null, config: GrobidAnalysisConfig): Promise<string>;
  fullTextToTEI(
    inputFile: string,
    flavor: Flavor | null,
    md5Str: string | null,
    config: GrobidAnalysisConfig,
  ): Promise<string>;
  async fullTextToTEI(
    inputFile: string,
    arg2: GrobidAnalysisConfig | Flavor | null,
    arg3?: GrobidAnalysisConfig | string | null,
    arg4?: GrobidAnalysisConfig,
  ): Promise<string> {
    if (arg2 instanceof GrobidAnalysisConfig) {
      return (await this.fullTextToTEIDoc(inputFile, null, null, arg2)).getTei() ?? "";
    }
    if (arg3 instanceof GrobidAnalysisConfig) {
      return (await this.fullTextToTEIDoc(inputFile, arg2 as Flavor | null, null, arg3)).getTei() ?? "";
    }
    return (await this.fullTextToTEIDoc(inputFile, arg2 as Flavor | null, arg3 as string | null, arg4 as GrobidAnalysisConfig)).getTei() ?? "";
  }

  fullTextToTEIDoc(inputFile: string, config: GrobidAnalysisConfig): Promise<Document>;
  fullTextToTEIDoc(
    inputFile: string,
    flavor: Flavor | null,
    md5Str: string | null,
    config: GrobidAnalysisConfig,
  ): Promise<Document>;
  fullTextToTEIDoc(documentSource: DocumentSource, flavor: Flavor | null, config: GrobidAnalysisConfig): Promise<Document>;
  async fullTextToTEIDoc(
    arg1: string | DocumentSource,
    arg2: GrobidAnalysisConfig | Flavor | null,
    arg3?: GrobidAnalysisConfig | string | null,
    arg4?: GrobidAnalysisConfig,
  ): Promise<Document> {
    if (arg1 instanceof DocumentSource) {
      const flavor: Flavor | null = arg2 as Flavor | null;
      const config: GrobidAnalysisConfig = arg3 as GrobidAnalysisConfig;
      const fullTextParser = this.parsers.getFullTextParser(flavor);
      LOGGER.debug("Starting processing fullTextToTEI on " + arg1);
      const time = Date.now();
      const resultDoc: Document = await fullTextParser.processing(arg1, flavor, config);
      LOGGER.debug(
        "Ending processing fullTextToTEI on " + arg1 + ". Time to process: " + (Date.now() - time) + "ms",
      );
      return resultDoc;
    }
    if (arg2 instanceof GrobidAnalysisConfig) {
      return await this.fullTextToTEIDoc(arg1, null, null, arg2);
    }
    const inputFile = arg1;
    const flavor: Flavor | null = arg2 as Flavor | null;
    const md5Str: string | null = (arg3 as string | null) ?? null;
    const config: GrobidAnalysisConfig = arg4 as GrobidAnalysisConfig;
    const fullTextParser = this.parsers.getFullTextParser(flavor);
    LOGGER.debug("Starting processing fullTextToTEI on " + inputFile);
    const time = Date.now();
    const resultDoc: Document = await fullTextParser.processing(inputFile, flavor, md5Str, config);
    LOGGER.debug(
      "Ending processing fullTextToTEI on " + inputFile + ". Time to process: " + (Date.now() - time) + "ms",
    );
    return resultDoc;
  }

  /**
   * Process all the PDF in a given directory with a segmentation process and
   * produce the corresponding training data format files for manual
   * correction.
   */
  batchCreateTraining(
    directoryPath: string,
    resultPath: string,
    ind: number,
    flavor: Flavor | null,
  ): number {
    try {
      const refFiles: string[] = readdirSync(directoryPath).filter((name) => {
        LOGGER.info(name);
        return name.endsWith(".pdf") || name.endsWith(".PDF");
      });

      if (refFiles === null) return 0;

      LOGGER.info(refFiles.length + " files to be processed.");

      let n = 0;
      if (ind === -1) {
        // for undefined identifier (value at -1), we initialize it to 0
        n = 1;
      }
      for (const pdfFileName of refFiles) {
        const pdfFile = path.join(directoryPath, pdfFileName);
        try {
          this.createTraining(pdfFile, resultPath, resultPath, ind + n, flavor);
        } catch (exp) {
          LOGGER.error("An error occured while processing the following pdf: " + pdfFile, exp);
        }
        if (ind !== -1) n++;
      }

      return refFiles.length;
    } catch (exp) {
      throw new GrobidException("An exception occured while running Grobid batch.", exp);
    }
  }

  /**
   * Process all the PDF in a given directory with a monograph process and
   * produce the corresponding training data format files for manual
   * correction.
   */
  batchCreateTrainingMonograph(directoryPath: string, resultPath: string, ind: number): number {
    try {
      const refFiles: string[] = readdirSync(directoryPath).filter((name) => {
        LOGGER.info(name);
        return name.endsWith(".pdf") || name.endsWith(".PDF");
      });

      if (refFiles === null) return 0;

      LOGGER.info(refFiles.length + " files to be processed.");

      let n = 0;
      if (ind === -1) {
        // for undefined identifier (value at -1), we initialize it to 0
        n = 1;
      }
      for (const pdfFileName of refFiles) {
        const pdfFile = path.join(directoryPath, pdfFileName);
        try {
          this.createTrainingMonograph(pdfFile, resultPath, resultPath, ind + n);
        } catch (exp) {
          LOGGER.error("An error occured while processing the following pdf: " + pdfFile, exp);
        }
        if (ind !== -1) n++;
      }

      return refFiles.length;
    } catch (exp) {
      throw new GrobidException("An exception occured while running Grobid batch.", exp);
    }
  }

  /**
   * Process all the PDF in a given directory with a pdf extraction and
   * produce blank training data.
   */
  batchCreateTrainingBlank(directoryPath: string, resultPath: string, ind: number): number {
    try {
      const refFiles: string[] = readdirSync(directoryPath).filter((name) => {
        LOGGER.info(name);
        return name.endsWith(".pdf") || name.endsWith(".PDF");
      });

      if (refFiles === null) return 0;

      LOGGER.info(refFiles.length + " files to be processed.");

      let n = 0;
      if (ind === -1) {
        // for undefined identifier (value at -1), we initialize it to 0
        n = 1;
      }
      for (const pdfFileName of refFiles) {
        const pdfFile = path.join(directoryPath, pdfFileName);
        try {
          this.createTrainingBlank(pdfFile, resultPath, resultPath, ind + n);
        } catch (exp) {
          LOGGER.error("An error occured while processing the following pdf: " + pdfFile, exp);
        }
        if (ind !== -1) n++;
      }

      return refFiles.length;
    } catch (exp) {
      throw new GrobidException("An exception occured while running Grobid batch.", exp);
    }
  }

  /**
   * Get the TEI XML string corresponding to the recognized header text
   */
  static header2TEI(resHeader: BiblioItem): string {
    return resHeader.toTEI(0);
  }

  /**
   * Get the BibTeX string corresponding to the recognized header text
   */
  static header2BibTeX(resHeader: BiblioItem): string {
    return resHeader.toBibTeX();
  }

  /**
   * Get the TEI XML string corresponding to the recognized citation section,
   * with pointers and advanced structuring
   */
  static references2TEI(pathArg: string, resBib: BibDataSet[]): string {
    const result: string[] = [];
    result.push("<listbibl>\n");

    let p = 0;
    for (const bib of resBib) {
      const bit: BiblioItem = bib.getResBib() as BiblioItem;
      bit.setPath(pathArg);
      result.push("\n");
      result.push(bit.toTEI(p));
      p++;
    }
    result.push("\n</listbibl>\n");
    return result.join("");
  }

  /**
   * Get the BibTeX string corresponding to the recognized citation section
   */
  references2BibTeX(pathArg: string, resBib: BibDataSet[]): string {
    const result: string[] = [];

    for (const bib of resBib) {
      const bit: BiblioItem = bib.getResBib() as BiblioItem;
      bit.setPath(pathArg);
      result.push("\n");
      result.push(bit.toBibTeX());
    }

    return result.join("");
  }

  /**
   * Get the TEI XML string corresponding to the recognized citation section
   * for a particular citation
   */
  static reference2TEI(pathArg: string, resBib: BibDataSet[] | null, i: number): string {
    const result: string[] = [];

    if (resBib !== null) {
      if (i <= resBib.length) {
        const bib: BibDataSet = resBib[i] as BibDataSet;
        const bit: BiblioItem = bib.getResBib() as BiblioItem;
        bit.setPath(pathArg);
        result.push(bit.toTEI(i));
      }
    }

    return result.join("");
  }

  /**
   * Get the BibTeX string corresponding to the recognized citation section
   * for a given citation
   */
  static reference2BibTeX(pathArg: string, resBib: BibDataSet[] | null, i: number): string {
    const result: string[] = [];

    if (resBib !== null) {
      if (i <= resBib.length) {
        const bib: BibDataSet = resBib[i] as BibDataSet;
        const bit: BiblioItem = bib.getResBib() as BiblioItem;
        bit.setPath(pathArg);
        result.push(bit.toBibTeX());
      }
    }

    return result.join("");
  }

  /**
   * Extract and parse both patent and non patent references within a patent text.
   */
  async processAllCitationsInPatent(
    text: string,
    nplResults: BibDataSet[] | null,
    patentResults: PatentItem[] | null,
    consolidateCitations: number,
    includeRawCitations: boolean,
  ): Promise<string | null> {
    if (nplResults === null && patentResults === null) {
      return null;
    }
    // we initialize the attribute individually for readability...
    const filterDuplicate = false;
    const texts: string[] = [];
    texts.push(text);
    return await this.parsers
      .getReferenceExtractor()
      .extractAllReferencesString(
        texts,
        filterDuplicate,
        consolidateCitations,
        includeRawCitations,
        patentResults,
        nplResults,
      );
  }

  /**
   * Extract and parse both patent and non patent references within a patent in ST.36 format.
   */
  async processAllCitationsInXMLPatent(
    xmlPath: string,
    nplResults: BibDataSet[] | null,
    patentResults: PatentItem[] | null,
    consolidateCitations: number,
    includeRawCitations: boolean,
  ): Promise<string | null> {
    if (nplResults === null && patentResults === null) {
      return null;
    }
    // we initialize the attribute individually for readability...
    const filterDuplicate = false;
    return await this.parsers
      .getReferenceExtractor()
      .extractAllReferencesXMLFile(
        xmlPath,
        filterDuplicate,
        consolidateCitations,
        includeRawCitations,
        patentResults,
        nplResults,
      );
  }

  /**
   * Extract and parse both patent and non patent references within a patent
   * in PDF format.
   */
  async processAllCitationsInPDFPatent(
    pdfPath: string,
    nplResults: BibDataSet[] | null,
    patentResults: PatentItem[] | null,
    consolidateCitations: number,
    includeRawCitations: boolean,
  ): Promise<string | null> {
    if (nplResults === null && patentResults === null) {
      return null;
    }
    // we initialize the attribute individually for readability...
    const filterDuplicate = false;
    return await this.parsers
      .getReferenceExtractor()
      .extractAllReferencesPDFFile(
        pdfPath,
        filterDuplicate,
        consolidateCitations,
        includeRawCitations,
        patentResults,
        nplResults,
      );
  }

  /**
   * Extract and parse both patent and non patent references within a patent
   * in PDF format. Results are provided as JSON annotations.
   */
  async annotateAllCitationsInPDFPatent(
    pdfPath: string,
    consolidateCitations: number,
    includeRawCitations: boolean,
  ): Promise<string | null> {
    const nplResults: BibDataSet[] = [];
    const patentResults: PatentItem[] = [];
    // we initialize the attribute individually for readability...
    const filterDuplicate = false;
    return await this.parsers
      .getReferenceExtractor()
      .annotateAllReferencesPDFFile(
        pdfPath,
        filterDuplicate,
        consolidateCitations,
        includeRawCitations,
        patentResults,
        nplResults,
      );
  }

  /*processCitationPatentTEI(teiPath: string, outTeiPath: string, consolidateCitations: number): void {
        try {
            InputStream inputStream = new FileInputStream(new File(teiPath));
            OutputStream output = new FileOutputStream(new File(outTeiPath));
            const parser = new TeiStAXParser(inputStream, output, false, consolidateCitations);
            parser.parse();
            inputStream.close();
            output.close();
        } catch (e) {
            throw new GrobidException("An exception occured while running Grobid.", e);
        }
    }*/

  /**
   * Process an XML patent document with a patent citation extraction and
   * produce the corresponding training data format files for manual
   * correction.
   */
  createTrainingPatentCitations(pathXML: string, resultPath: string): void {
    this.parsers.getReferenceExtractor().generateTrainingData(pathXML, resultPath);
  }

  /**
   * Process all the XML patent documents in a given directory with a patent
   * citation extraction.
   */
  batchCreateTrainingPatentcitations(directoryPath: string, resultPath: string): number {
    try {
      const refFiles: string[] = readdirSync(directoryPath).filter(
        (name) =>
          name.endsWith(".xml") ||
          name.endsWith(".XML") ||
          name.endsWith(".xml.gz") ||
          name.endsWith(".XML.gz"),
      );

      if (refFiles === null) return 0;

      // System.out.println(refFiles.length + " files to be processed.");

      let n = 0;
      for (; n < refFiles.length; n++) {
        const xmlFile = path.join(directoryPath, refFiles[n] as string);
        this.createTrainingPatentCitations(xmlFile, resultPath);
      }

      return refFiles.length;
    } catch (e) {
      throw new GrobidException("An exception occured while running Grobid.", e);
    }
  }

  /**
   * Extract chemical names from text.
   */
  async extractChemicalEntities(text: string): Promise<ChemicalEntity[] | null> {
    return await this.parsers.getChemicalParser().extractChemicalEntities(text);
  }

  /**
   * Print the abstract content. Useful for term extraction.
   */
  getAbstract(doc: Document): string {
    let abstr: string = doc.getResHeader()!.getAbstract() ?? "";
    abstr = abstr.replace(/@BULLET/g, " • ");
    return abstr;
  }

  /**
   * Process all the .txt in a given directory to generate pre-labeld training data for
   * the citation model. Input file expects one raw reference string per line.
   */
  async batchCreateTrainingCitation(directoryPath: string, resultPath: string): Promise<number> {
    try {
      const refFiles: string[] = readdirSync(directoryPath).filter((name) => {
        LOGGER.info(name);
        return name.endsWith(".txt");
      });

      if (refFiles === null) return 0;

      LOGGER.info(refFiles.length + " files to be processed.");

      let n = 0;
      for (const txtFileName of refFiles) {
        const txtFile = path.join(directoryPath, txtFileName);
        try {
          // read file line by line, assuming one reference string per line
          const allInput: string[] = [];

          try {
            const content: string = readFileSync(txtFile, { encoding: "utf-8" });
            for (const line of content.split("\n")) {
              allInput.push(line.trim());
            }
          } catch (e) {
            LOGGER.error("Error reading file " + txtFile, e);
          }

          // process the training generation
          const bufferReference: string[] | null = await this.parsers
            .getCitationParser()
            .trainingExtraction(allInput);

          // write the XML training file
          if (bufferReference !== null && bufferReference.length > 0) {
            bufferReference.push("\n");

            const out: string[] = [];
            out.push(
              '<?xml version="1.0" ?>\n<TEI xml:space="preserve" xmlns="http://www.tei-c.org/ns/1.0" ' +
                'xmlns:xlink="http://www.w3.org/1999/xlink" ' +
                '\n xmlns:mml="http://www.w3.org/1998/Math/MathML">\n',
            );

            out.push(
              '\t<teiHeader>\n\t\t<fileDesc xml:id="_' +
                n +
                '"/>\n\t</teiHeader>\n\t<text>\n\t\t<front/>\n\t\t<body/>\n\t\t<back>\n',
            );

            out.push("<listBibl>\n");

            out.push(bufferReference.join(""));

            out.push("\t\t</listBibl>\n\t</back>\n\t</text>\n</TEI>\n");

            writeFileSync(
              path.join(resultPath, txtFileName.replace(".txt", ".training.references.tei.xml")),
              out.join(""),
              { encoding: "utf-8" },
            );
          }
        } catch (exp) {
          LOGGER.error("An error occured while processing the following pdf: " + txtFile, exp);
        }
        n++;
      }

      return refFiles.length;
    } catch (exp) {
      throw new GrobidException("An exception occured while running Grobid batch.", exp);
    }
  }

  /**
   * Return all the reference titles. Maybe useful for term extraction.
   */
  printRefTitles(resBib: BibDataSet[]): string {
    const accumulated: string[] = [];
    for (const bib of resBib) {
      const bit: BiblioItem = bib.getResBib() as BiblioItem;

      if (bit.getTitle() !== null) {
        accumulated.push(bit.getTitle() as string);
        accumulated.push("\n");
      }
    }

    return accumulated.join("");
  }

  /**
   * Process a text corresponding to a funding and/or acknowledgement section
   * and retun the extracted entities as JSON annotations
   */
  async processFundingAcknowledgement(text: string, config: GrobidAnalysisConfig): Promise<string> {
    const result: string[] = [];

    try {
      // Upstream calls `processing(text, config)`; the TS port renamed the
      // string overload to `processingText` to disambiguate from the private
      // tokens-level overload.
      const localResult = await this.parsers
        .getFundingAcknowledgementParser()
        .processingText(text, config);

      if (localResult === null || localResult.getLeft() === null) result.push(text);
      else result.push(localResult.getLeft().toXML());
    } catch (exp) {
      throw new GrobidException(
        "An exception occurred while running Grobid funding-acknowledgement model.",
        exp,
      );
    }

    return result.join("");
  }

  close(): void {
    CrossrefClient.getInstance().close();
    this.parsers.close();
  }

  static setCntManager(cntManager: CntManager): void {
    Engine.cntManagerField = cntManager;
  }

  static getCntManager(): CntManager {
    return Engine.cntManagerField;
  }

  getParsers(): EngineParsers {
    return this.parsers;
  }

  /**
   * @return a new engine from GrobidFactory if the execution is parallel,
   *         else return the instance of engine.
   */
  /*public static Engine getEngine(boolean isparallelExec) {
        return isparallelExec ? GrobidPoolingFactory.getEngineFromPool()
                : GrobidFactory.getInstance().getEngine();
    }*/
  static getEngine(preload: boolean): Promise<Engine> {
    return GrobidPoolingFactory.getEngineFromPool(preload);
  }

  fullTextToBlank(inputFile: string, config: GrobidAnalysisConfig): string;
  fullTextToBlank(inputFile: string, md5Str: string | null, config: GrobidAnalysisConfig): string;
  fullTextToBlank(
    inputFile: string,
    arg2: GrobidAnalysisConfig | string | null,
    arg3?: GrobidAnalysisConfig,
  ): string {
    if (arg2 instanceof GrobidAnalysisConfig) {
      return this.fullTextToBlankDoc(inputFile, null, arg2).getTei() ?? "";
    }
    return this.fullTextToBlankDoc(inputFile, arg2 as string | null, arg3 as GrobidAnalysisConfig).getTei() ?? "";
  }

  fullTextToBlankDoc(inputFile: string, config: GrobidAnalysisConfig): Document;
  fullTextToBlankDoc(inputFile: string, md5Str: string | null, config: GrobidAnalysisConfig): Document;
  fullTextToBlankDoc(documentSource: DocumentSource, config: GrobidAnalysisConfig): Document;
  fullTextToBlankDoc(
    arg1: string | DocumentSource,
    arg2: GrobidAnalysisConfig | string | null,
    arg3?: GrobidAnalysisConfig,
  ): Document {
    if (arg1 instanceof DocumentSource) {
      const fullTextBlankParser = this.parsers.getFullTextBlankParser();
      LOGGER.debug("Starting processing fullTextToBlank on " + arg1);
      const time = Date.now();
      const resultDoc: Document = fullTextBlankParser.process(arg1, arg2 as GrobidAnalysisConfig);
      LOGGER.debug(
        "Ending processing fullTextToBlank on " + arg1 + ". Time to process: " + (Date.now() - time) + "ms",
      );
      return resultDoc;
    }
    if (arg2 instanceof GrobidAnalysisConfig) {
      return this.fullTextToBlankDoc(arg1, null, arg2);
    }
    // Upstream's `process(File, String md5Str, GrobidAnalysisConfig)` overload
    // is named `processFile` in the TS port (where `process` takes a
    // DocumentSource). The behaviour matches.
    const fullTextBlankParser = this.parsers.getFullTextBlankParser();
    LOGGER.debug("Starting processing fullTextToBlank on " + arg1);
    const time = Date.now();
    const resultDoc: Document = fullTextBlankParser.processFile(
      arg1,
      arg2 as string,
      arg3 as GrobidAnalysisConfig,
    );
    LOGGER.debug(
      "Ending processing fullTextToBlank on " + arg1 + ". Time to process: " + (Date.now() - time) + "ms",
    );
    return resultDoc;
  }
}

// Keep `existsSync` referenced for future parity with upstream's file-existence
// guards in batch methods; currently unused but imported alongside the other
// fs primitives for consistency.
void existsSync;
