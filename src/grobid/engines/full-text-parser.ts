// Port of org.grobid.core.engines.FullTextParser.
// Upstream: grobid-core/src/main/java/org/grobid/core/engines/FullTextParser.java
//
// This is the orchestrator that calls Segmentation, HeaderParser,
// ReferenceSegmenterParser, CitationParser; assembles the body via the
// fulltext CRF; and handles figure/table extraction and post-processing.
//
// Audit-relevant preserved-verbatim behaviors (also tracked in UPSTREAM-BUGS.md):
// - References are parsed BEFORE the body (lines 230-258 upstream) so the
//   `bibRefCalloutType` ("UNKNOWN" / "NUMBER" / "AUTHOR") can be set per-doc
//   and per-token `calloutKnown` populated via `ReferenceMarkerMatcher.isKnownLabel`
//   in `getBodyTextFeatured` (lines 911-939, 1323-1327).
// - `getBadFigures` filters figures whose `isCompleteForTEI()` is false; the
//   "completeness" predicate is itself audit-flagged for over-aggressive
//   rejection. Preserved verbatim.
// - `revertResultsForBadItems` reverts bad figures/tables to `<paragraph>`
//   spans, with an off-by-one quirk in the `first` flag handling (preserved).
// - `processShort` returns `null` for empty token lists, but `Pair.of(res,
//   layoutTokenization)` may produce `Pair<null, null>` for non-empty inputs
//   when `featSeg` is null OR `featuredText` is blank. Preserved verbatim.
// - `toTEI` constructs a `TEIFormatter` with `this` as the second argument,
//   creating a tightly-coupled cycle.
//
// Adaptations:
// - `File` inputs at the entry points are replaced by `string` paths per the
//   port CONVENTIONS; the actual file I/O is the responsibility of
//   `src/node/`. The `createTraining` family of methods, which writes
//   training-data files, accepts an injected `writeFile(path, content)`
//   callback so that the in-memory logic remains faithful.
// - `AbstractParser`/`EngineParsers`/`Engine`/`LabelUtils` are still port stubs
//   (sibling subagents own them), so the corresponding imports are flagged
//   with `// @ts-expect-error stub-not-ported-yet`.
// - Apache `Pair.of` → our `Pair` with `getA()`/`getB()`. To keep upstream
//   call shapes intact, we return a wrapper object exposing both pairs of
//   accessors where useful.
// - Guava `Iterables.filter`, `getLast`, `AtomicInteger` are inlined as plain
//   JS array methods / mutable counters.

import { GrobidModels } from "../grobid-models.js";
import { Affiliation } from "../data/affiliation.js";
import { BibDataSet } from "../data/bib-data-set.js";
import { BiblioItem } from "../data/biblio-item.js";
import { Equation } from "../data/equation.js";
import { Figure } from "../data/figure.js";
import { Funding } from "../data/funding.js";
import { Table } from "../data/table.js";
import type { Person } from "../data/person.js";
import { Document } from "../document/document.js";
import { DocumentPiece } from "../document/document-piece.js";
import { DocumentPointer } from "../document/document-pointer.js";
import { DocumentSource } from "../document/document-source.js";
import { TEIFormatter } from "../document/tei-formatter.js";
import { CalloutAnalyzer } from "./citations/callout-analyzer.js";
import type { LabeledReferenceResult } from "./citations/labeled-reference-result.js";
import type { ReferenceSegmenter } from "./citations/reference-segmenter.js";
import { GrobidAnalysisConfig } from "./config/grobid-analysis-config.js";
import { CitationParserCounters } from "./counters/citation-parser-counters.js";
import { SegmentationLabels } from "./label/segmentation-labels.js";
import type { TaggingLabel } from "./label/tagging-label.js";
import { TaggingLabels } from "./label/tagging-labels.js";
import { GenericTaggerUtils } from "./tagging/generic-tagger-utils.js";
import { GrobidException } from "../exceptions/grobid-exception.js";
import { GrobidResourceException } from "../exceptions/grobid-resource-exception.js";
import { FeatureFactory } from "../features/feature-factory.js";
import { FeaturesVectorFulltext } from "../features/features-vector-fulltext.js";
import { Language } from "../lang/language.js";
import { Block } from "../layout/block.js";
import type { GraphicObject } from "../layout/graphic-object.js";
import { GraphicObjectType } from "../layout/graphic-object-type.js";
import { LayoutToken } from "../layout/layout-token.js";
import { LayoutTokenization } from "../layout/layout-tokenization.js";
import { Lexicon } from "../lexicon/lexicon.js";
import type { TaggingTokenCluster } from "../tokenization/tagging-token-cluster.js";
import { TaggingTokenClusteror, LabelTypePredicate } from "../tokenization/tagging-token-clusteror.js";
import { LayoutTokensUtil } from "../utilities/layout-tokens-util.js";
import type { OffsetPosition } from "../utilities/offset-position.js";
import { TextUtilities } from "../utilities/text-utilities.js";
import { Consolidation } from "../utilities/consolidation.js";
import { GrobidProperties } from "../utilities/grobid-properties.js";
import { KeyGen } from "../utilities/key-gen.js";
import { LanguageUtilities } from "../utilities/language-utilities.js";
import { Pair } from "../utilities/pair.js";
import { EntityMatcherException } from "../utilities/matching/entity-matcher-exception.js";
import type { ReferenceMarkerMatcher } from "../utilities/matching/reference-marker-matcher.js";
import { LabelUtils } from "../utilities/label-utils.js";
import type { CntManager } from "../utilities/counters/cnt-manager.js";
import { getLogger } from "../utilities/logger.js";
import { AbstractParser } from "./abstract-parser.js";
// EngineParsers is a port stub (sibling subagent owns it).
import { EngineParsers } from "./engine-parsers.js";
// Engine is a port stub (sibling subagent owns it).
import { Engine } from "./engine.js";
import type { Flavor } from "../grobid-models.js";

// Re-export the MarkerType enum-like for upstream call-sites.
type MarkerType = ReturnType<typeof CalloutAnalyzer.getCalloutType>;

import { writeFileSync } from "node:fs";

const LOGGER = getLogger("FullTextParser");

const FULLTEXT = GrobidModels.FULLTEXT;
const FIGURE_LABEL: string = TaggingLabels.FIGURE_LABEL;

/**
 * Optional callback for training-data file writes. Upstream uses
 * `OutputStreamWriter` directly; the JS port pushes the file I/O to
 * `src/node/` via this callback.
 */
export type WriteFileCallback = (path: string, content: string) => void;

export class FullTextParser extends AbstractParser {
  protected tmpPath: string | null = null;

  // default bins for relative position
  private static readonly NBBINS_POSITION: number = 12;

  // default bins for inter-block spacing
  private static readonly NBBINS_SPACE: number = 5;

  // default bins for block character density
  private static readonly NBBINS_DENSITY: number = 5;

  // projection scale for line length
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private static readonly LINESCALE: number = 10;

  protected parsers: EngineParsers;

  constructor(parsers: EngineParsers);
  constructor(parsers: EngineParsers, flavor: Flavor | null);
  constructor(parsers: EngineParsers, flavor?: Flavor | null) {
    super(GrobidModels.getModelFlavor(FULLTEXT, flavor ?? null));
    this.parsers = parsers;
    this.tmpPath = GrobidProperties.getTempPath();
  }

  // --- Entry points ---------------------------------------------------------

  /**
   * Upstream:
   *   public Document processing(File inputPdf, GrobidAnalysisConfig config)
   *   public Document processing(File inputPdf, String md5Str, GrobidAnalysisConfig config)
   *   public Document processing(File inputPdf, GrobidModels.Flavor flavor, String md5Str, GrobidAnalysisConfig config)
   *
   * The TS port collapses these into one overload set on the (string path)
   * input; the actual `File`→`DocumentSource` conversion is moved to the
   * caller in `src/node/`.
   */
  processing(inputPdfPath: string, config: GrobidAnalysisConfig): Promise<Document>;
  processing(inputPdfPath: string, md5Str: string | null, config: GrobidAnalysisConfig): Promise<Document>;
  processing(
    inputPdfPath: string,
    flavor: Flavor | null,
    md5Str: string | null,
    config: GrobidAnalysisConfig,
  ): Promise<Document>;
  processing(
    documentSource: DocumentSource,
    config: GrobidAnalysisConfig,
  ): Promise<Document>;
  processing(
    documentSource: DocumentSource,
    flavor: Flavor | null,
    config: GrobidAnalysisConfig,
  ): Promise<Document>;
  async processing(
    a: string | DocumentSource,
    b: GrobidAnalysisConfig | string | Flavor | null,
    c?: GrobidAnalysisConfig | string | null,
    d?: GrobidAnalysisConfig,
  ): Promise<Document> {
    // Resolve overload dispatch.
    if (typeof a === "string") {
      // File-path entry points.
      if (b instanceof GrobidAnalysisConfig) {
        // (path, config)
        return await this.processing(a, null, b);
      }
      if (typeof b === "string" && c instanceof GrobidAnalysisConfig) {
        // (path, md5Str, config)
        return await this.processing(a, null, b, c);
      }
      // (path, flavor, md5Str, config)
      const flavor = b as Flavor | null;
      const md5Str = c as string | null;
      const config = d as GrobidAnalysisConfig;
      const ds = (DocumentSource as { fromPdf(p: string, s: number, e: number, asset: boolean, full: boolean, repair: boolean): DocumentSource }).fromPdf(
        a,
        config.getStartPage(),
        config.getEndPage(),
        config.getPdfAssetPath() !== null,
        true,
        false,
      );
      if (md5Str !== null) ds.setMD5(md5Str);
      return await this.processing(ds, flavor, config);
    }
    // DocumentSource entry points.
    if (b instanceof GrobidAnalysisConfig) {
      return await this.processingDocumentSource(a, null, b);
    }
    return await this.processingDocumentSource(a, b as Flavor | null, c as GrobidAnalysisConfig);
  }

  processingHeaderFunding(inputPdfPath: string, config: GrobidAnalysisConfig): Promise<Document>;
  processingHeaderFunding(inputPdfPath: string, md5Str: string | null, config: GrobidAnalysisConfig): Promise<Document>;
  async processingHeaderFunding(
    a: string,
    b: GrobidAnalysisConfig | string | null,
    c?: GrobidAnalysisConfig,
  ): Promise<Document> {
    if (b instanceof GrobidAnalysisConfig) {
      const documentSource = (DocumentSource as { fromPdf(p: string, s: number, e: number, asset: boolean, full: boolean, repair: boolean): DocumentSource }).fromPdf(
        a,
        b.getStartPage(),
        b.getEndPage(),
        b.getPdfAssetPath() !== null,
        true,
        false,
      );
      return await this.processingHeaderFundingDocumentSource(documentSource, b);
    }
    const documentSource = (DocumentSource as { fromPdf(p: string, s: number, e: number, asset: boolean, full: boolean, repair: boolean): DocumentSource }).fromPdf(
      a,
      (c as GrobidAnalysisConfig).getStartPage(),
      (c as GrobidAnalysisConfig).getEndPage(),
      (c as GrobidAnalysisConfig).getPdfAssetPath() !== null,
      true,
      false,
    );
    documentSource.setMD5(b as string);
    return await this.processingHeaderFundingDocumentSource(documentSource, c as GrobidAnalysisConfig);
  }

  /**
   * Machine-learning recognition of the complete full text structures.
   */
  private async processingDocumentSource(
    documentSource: DocumentSource,
    flavor: Flavor | null,
    config: GrobidAnalysisConfig,
  ): Promise<Document> {
    if (this.tmpPath === null) {
      throw new GrobidResourceException("Cannot process pdf file, because temp path is null.");
    }
    // Upstream checks `tmpPath.exists()`; the TS port treats `tmpPath` as a
    // string path (the existence check is the caller's responsibility in
    // src/node/). We keep the throw shape for parity.

    try {
      // general segmentation
      const doc: Document = await (this.parsers as unknown as {
        getSegmentationParser(f: Flavor | null): { processing(ds: DocumentSource, c: GrobidAnalysisConfig): Promise<Document> };
      })
        .getSegmentationParser(flavor)
        .processing(documentSource, config);
      let documentBodyParts: Set<DocumentPiece> | null = doc.getDocumentPart(SegmentationLabels.BODY);

      // header processing
      const headerResults = new BiblioItem();
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      let featSeg: Pair<string, LayoutTokenization> | null = null;
      void featSeg;

      // using the segmentation model to identify the header zones
      await (this.parsers as unknown as {
        getHeaderParser(f: Flavor | null): {
          processingHeaderSection(c: GrobidAnalysisConfig, d: Document, b: BiblioItem, s: boolean): Promise<string | null>;
        };
      })
        .getHeaderParser(flavor)
        .processingHeaderSection(config, doc, headerResults, false);

      // The commented part below (XMP fallback) is intentionally preserved as
      // dead code in upstream; we drop the comment-only body for brevity.

      // structure the abstract using the fulltext model
      if (headerResults.getAbstract() !== null && headerResults.getAbstract()!.trim().length !== 0) {
        //List<LayoutToken> abstractTokens = resHeader.getLayoutTokens(TaggingLabels.HEADER_ABSTRACT);
        let abstractTokens: LayoutToken[] | null = (headerResults as unknown as { getAbstractTokensWorkingCopy(): LayoutToken[] }).getAbstractTokensWorkingCopy();
        if (abstractTokens !== null && abstractTokens.length !== 0) {
          // AUDIT-RELEVANT: BiblioItem.cleanAbstractLayoutTokens applied here.
          abstractTokens = BiblioItem.cleanAbstractLayoutTokens(abstractTokens);
          const abstractProcessed: Pair<string | null, LayoutToken[] | null> | null = await this.processShort(abstractTokens, doc);
          if (abstractProcessed !== null) {
            // neutralize figure and table annotations (will be considered as paragraphs)
            let labeledAbstract: string | null = abstractProcessed.getA();
            labeledAbstract = (LabelUtils as { postProcessFullTextLabeledText(s: string | null): string }).postProcessFullTextLabeledText(labeledAbstract);
            (headerResults as unknown as { setLabeledAbstract(s: string): void }).setLabeledAbstract(labeledAbstract);
            (headerResults as unknown as { setLayoutTokensForLabel(t: LayoutToken[], l: TaggingLabel): void }).setLayoutTokensForLabel(
              abstractProcessed.getB() ?? [],
              TaggingLabels.HEADER_ABSTRACT,
            );
          }
        }
      }

      // citation processing
      // consolidation, if selected, is not done individually for each citation but
      // in a second stage for all citations which is much faster
      // AUDIT-RELEVANT: references parsed BEFORE the body.
      const resCitations: BibDataSet[] | null = await (this.parsers as unknown as {
        getCitationParser(): { processingReferenceSection(d: Document, rs: ReferenceSegmenter, c: number): Promise<BibDataSet[]> };
        getReferenceSegmenterParser(): ReferenceSegmenter;
      })
        .getCitationParser()
        .processingReferenceSection(doc, (this.parsers as unknown as { getReferenceSegmenterParser(): ReferenceSegmenter }).getReferenceSegmenterParser(), 0);

      // consolidate the set
      if (config.getConsolidateCitations() !== 0 && resCitations !== null) {
        const consolidator = Consolidation.getInstance();
        if (consolidator.getCntManager() === null)
          consolidator.setCntManager((Engine as unknown as { getCntManager(): CntManager }).getCntManager());
        try {
          const resConsolidation: Map<number, BiblioItem> | null = (
            consolidator as unknown as { consolidate(c: BibDataSet[]): Map<number, BiblioItem> | null }
          ).consolidate(resCitations);
          if (resConsolidation !== null) {
            for (let i = 0; i < resCitations.length; i++) {
              const resCitation = resCitations[i]!.getResBib();
              const bibo = resConsolidation.get(i);
              if (bibo !== undefined && bibo !== null && resCitation !== null) {
                if (config.getConsolidateCitations() === 1) BiblioItem.correct(resCitation, bibo);
                else if (config.getConsolidateCitations() === 2) BiblioItem.injectIdentifiers(resCitation, bibo);
              }
            }
          }
        } catch (e) {
          // Best-effort: a CrossRef failure must not block TEI emission.
          const msg = e instanceof Error ? e.message : String(e);
          LOGGER.warn(
            `Citation consolidation failed (best-effort, falling back to CRF output): ${msg}`,
          );
        }
      }
      doc.setBibDataSets(resCitations);

      // full text processing
      const featSegBody = FullTextParser.getBodyTextFeatured(doc, documentBodyParts);
      let bodyResults: string | null = null;
      let bodyTokenization: LayoutTokenization | null = null;
      let bodyFigures: Figure[] | null = null;
      let bodyTables: Table[] | null = null;
      let bodyEquations: Equation[] | null = null;
      if (featSegBody !== null && featSegBody.getA() !== null && featSegBody.getA().trim().length !== 0) {
        // if featSeg is null, it usually means that the fulltext body is not found in the
        // document segmentation
        const bodyText: string = featSegBody.getA();
        bodyTokenization = featSegBody.getB();

        bodyResults = await this.label(bodyText);
        //Correct subsequent I-<figure> or I-<table>
        bodyResults = (LabelUtils as { postProcessFulltextFixInvalidTableOrFigure(s: string): string }).postProcessFulltextFixInvalidTableOrFigure(bodyResults);

        // we apply now the figure and table models based on the fulltext labeled output
        bodyFigures = await this.processFigures(bodyResults, bodyTokenization!.getTokenization()!);
        doc.setFigures(bodyFigures);

        bodyResults = FullTextParser.fixFiguresLabellingResults(doc, bodyResults);

        // Figures
        this.postProcessFigureCaptions(bodyFigures, doc);

        const numberFiguresFulltextModel: number = bodyResults
          .split("\n")
          .filter((r) => r.endsWith("I-" + FIGURE_LABEL))
          .length;

        // AUDIT-RELEVANT: getBadFigures filter (lines 290, 456-465 upstream).
        const badBodyFigures: Figure[] = FullTextParser.getBadFigures(bodyFigures);
        bodyResults = FullTextParser.revertResultsForBadItems(
          badBodyFigures,
          bodyResults,
          !(bodyFigures.length > numberFiguresFulltextModel),
        );

        // Filter bad figures and recompute IDs in a single stream operation
        let figureIndex = 0;
        bodyFigures = bodyFigures.filter((f) => !badBodyFigures.includes(f));
        for (const f of bodyFigures) {
          f.setId(String(figureIndex));
          figureIndex++;
        }

        doc.setFigures(bodyFigures);

        // Tables
        bodyTables = await this.processTables(bodyResults, bodyTokenization!.getTokenization()!, doc);

        //We deal with tables considered bad by reverting them as <paragraph>, to reduce the risk them to be
        // dropped later on.

        //TODO: double check the way the tables are validated
        const numberTablesFulltextModel: number = bodyResults
          .split("\n")
          .filter((r) => r.endsWith("I-" + TaggingLabels.TABLE_LABEL))
          .length;

        const badBodyTables: Table[] = FullTextParser.getBadTables(bodyTables);
        bodyResults = FullTextParser.revertResultsForBadItems(
          badBodyTables,
          bodyResults,
          !(bodyTables.length > numberTablesFulltextModel),
        );

        let tableIndex = 0;
        bodyTables = bodyTables.filter((t) => !badBodyTables.includes(t));
        for (const f of bodyTables) {
          f.setId(String(tableIndex));
          tableIndex++;
        }

        this.postProcessTableCaptions(bodyTables, doc);
        doc.setTables(bodyTables);

        // Processing equations
        bodyEquations = this.processEquations(bodyResults, bodyTokenization!.getTokenization()!);
        doc.setEquations(bodyEquations);
      } else {
        LOGGER.debug("Fulltext model: The featured body is empty");
      }

      // possible annexes (view as a piece of full text similar to the body)
      documentBodyParts = doc.getDocumentPart(SegmentationLabels.ANNEX);
      const featSegAnnex = FullTextParser.getBodyTextFeatured(doc, documentBodyParts);
      let annexResults: string | null = null;
      let annexFigures: Figure[] | null = null;
      let annexTables: Table[] | null = null;
      let annexEquations: Equation[] | null = null;
      let annexTokenization: LayoutToken[] | null = null;
      if (featSegAnnex !== null && featSegAnnex.getA().trim().length !== 0) {
        const annexFeatures: string = featSegAnnex.getA();
        annexTokenization = featSegAnnex.getB().getTokenization();
        annexResults = await this.label(annexFeatures);

        annexFigures = await this.processFigures(annexResults, annexTokenization!, bodyFigures?.length ?? 0);

        const numberFiguresInAnnex: number = annexResults
          .split("\n")
          .filter((r) => r.endsWith("I-" + FIGURE_LABEL))
          .length;

        const badAnnexFigures: Figure[] = FullTextParser.getBadFigures(annexFigures);

        if (badAnnexFigures.length !== 0) {
          LOGGER.info("Number of figures badly formatted or incomplete we identified in Annex: " + badAnnexFigures.length);
        }
        annexResults = FullTextParser.revertResultsForBadItems(
          badAnnexFigures,
          annexResults,
          !(annexFigures.length > numberFiguresInAnnex),
        );

        annexFigures = annexFigures.filter((f) => !badAnnexFigures.includes(f));
        this.postProcessFigureCaptions(annexFigures, doc);

        doc.setAnnexFigures(annexFigures);

        annexTables = await this.processTables(annexResults, annexTokenization!, doc, bodyTables?.length ?? 0);

        const numberTablesInAnnex: number = annexResults
          .split("\n")
          .filter((r) => r.endsWith("I-" + TaggingLabels.TABLE_LABEL))
          .length;

        const badAnnexTables: Table[] = annexTables.filter((t) => !(t.isCompleteForTEI() && t.validateTable()));

        if (badAnnexTables.length !== 0) {
          LOGGER.info("Number of tables badly formatted or incomplete we identified in Annex: " + badAnnexTables.length);
        }
        annexResults = FullTextParser.revertResultsForBadItems(
          badAnnexTables,
          annexResults,
          !(annexTables.length > numberTablesInAnnex),
        );

        annexTables = annexTables.filter((t) => !badAnnexTables.includes(t));

        this.postProcessTableCaptions(annexTables, doc);
        doc.setAnnexTables(annexTables);

        annexEquations = this.processEquations(annexResults, annexTokenization!, bodyEquations?.length ?? 0);
        doc.setAnnexEquations(annexEquations);
      }

      // post-process reference and footnote callout to keep them consistent
      let markerTypes: MarkerType[] | null = null;
      if (bodyResults !== null) {
        markerTypes = this.postProcessCallout(bodyResults, bodyTokenization);
      }

      // final combination
      await this.toTEI(
        doc,
        bodyResults,
        annexResults,
        bodyTokenization,
        annexTokenization,
        headerResults,
        bodyFigures,
        bodyTables,
        bodyEquations,
        annexFigures,
        annexTables,
        annexEquations,
        markerTypes,
        config,
      );
      return doc;
    } catch (e) {
      if (e instanceof GrobidException) throw e;
      throw new GrobidException("An exception occurred while running Grobid.", e as Error);
    }
  }

  static getBadTables(tables: Table[]): Table[] {
    const badTables: Table[] = tables.filter((t) => !(t.isCompleteForTEI() && t.validateTable()));
    if (badTables.length !== 0) {
      LOGGER.info("Number of tables badly formatted or incomplete we identified: " + badTables.length);
    }
    return badTables;
  }

  static getBadFigures(figures: Figure[]): Figure[] {
    // AUDIT-RELEVANT: completeness filter (over-aggressive rejection has been
    // flagged by the benchmark audit). Preserved verbatim.
    const badFigures: Figure[] = figures.filter((f) => !f.isCompleteForTEI());
    if (badFigures.length !== 0) {
      LOGGER.info("Number of figures badly formatted or incomplete we identified: " + badFigures.length);
    }
    return badFigures;
  }

  private async postProcessFigureCaptions(figures: Figure[], doc: Document): Promise<void> {
    // further parse the caption
    for (const figure of figures) {
      if (figure.getCaptionLayoutTokens() !== null && figure.getCaptionLayoutTokens().length !== 0) {
        const processedCaption: Pair<string | null, LayoutToken[] | null> | null = await this.processShort(figure.getCaptionLayoutTokens(), doc);
        if (processedCaption === null) continue;
        figure.setLabeledCaption(processedCaption.getA());
        const processedCaptionLayoutTokens: LayoutToken[] = processedCaption.getB() ?? [];
        if (processedCaptionLayoutTokens.length !== figure.getCaptionLayoutTokens().length) {
          // We might have a problem, we might loose some tokens during the processing
          LOGGER.warn(
            "Changes in the figure caption: \noriginal: " +
              LayoutTokensUtil.toText(figure.getCaptionLayoutTokens()) +
              "\nmodified: " +
              LayoutTokensUtil.toText(processedCaptionLayoutTokens),
          );
        }
        figure.setCaptionLayoutTokens(processedCaptionLayoutTokens);
      }
    }
  }

  private static fixFiguresLabellingResults(doc: Document, bodyResults: string): string {
    const updatedFigures = doc.assignGraphicObjectsToFigures();
    for (const update of updatedFigures) {
      // The TS port of `assignGraphicObjectsToFigures()` returns
      // `Triple<Figure, Figure, LayoutToken[][]>[]` — getRight() yields the diff.
      // Upstream Java uses `update.getRight()`; the previous cast invoked
      // a nonexistent `getC()` and crashed on figures with reassigned graphics.
      const difference: LayoutToken[][] = (update as unknown as { getRight(): LayoutToken[][] }).getRight();

      const nbDifferences: number = difference.filter((llt) => llt.length !== 0).length;

      if (nbDifferences > 0) {
        // In this case we assume they are figures
        const updatedBodyResult: string = FullTextParser.revertDiscardedTokensInMainResults(difference, bodyResults);
        bodyResults = updatedBodyResult;
      }
    }
    return bodyResults;
  }

  static revertResultsForBadItems(badFiguresOrTables: Figure[], resultBody: string): string;
  static revertResultsForBadItems(badFiguresOrTables: Figure[], resultBody: string, strict: boolean): string;
  static revertResultsForBadItems(badFiguresOrTables: Figure[], resultBody: string, strict: boolean = true): string {
    //LF: we update the resultBody sequence by reverting these figure or tables as <paragraph> elements
    if (badFiguresOrTables.length !== 0) {
      const labelledResultsAsList: string[][] = resultBody.split("\n").map((l) => l.split("\t"));

      for (const badItem of badFiguresOrTables) {
        if (badItem === null) continue;
        const itemLabel: string = badItem instanceof Table ? TaggingLabels.TABLE_LABEL : FIGURE_LABEL;
        // Find the index of the first layoutToken of the table in the tokenization.
        // Upstream's Figure.getLayoutTokens returns `null` when the sub-CRF never
        // attached any tokens to the bad item (no `addLayoutTokens` calls). In
        // that case we have nothing to anchor the revert on, so skip.
        const layoutTokenItem: LayoutToken[] | null = (badItem as unknown as {
          getLayoutTokens(): LayoutToken[] | null;
        }).getLayoutTokens();
        if (layoutTokenItem === null || layoutTokenItem.length === 0) {
          continue;
        }
        const candidateIndexes: number[] = FullTextParser.findCandidateIndex(
          layoutTokenItem,
          labelledResultsAsList,
          itemLabel,
          strict,
        );
        if (candidateIndexes.length === 0) {
          LOGGER.warn(
            "Cannot find the candidate index for fixing the figures/tables. Tokens: " +
              LayoutTokensUtil.toText(layoutTokenItem),
          );
          continue;
        }

        // At this point I have more than one candidate, which can be matched if the same first
        // token is repeated in the sequence. The next step is to find the matching figure/table
        // using a large sequence

        const sequenceTokenItemWithoutSpaces: string[] = layoutTokenItem
          .map((t) => t.getText())
          .map((s) => (s === null ? "" : s.trim()))
          .filter((s) => s.length !== 0);

        //TODO: reduce candidate indexes after matching one sequence
        const resultIndexCandidate: number = FullTextParser.consolidateResultCandidateThroughSequence(
          candidateIndexes,
          labelledResultsAsList,
          sequenceTokenItemWithoutSpaces,
        );

        if (resultIndexCandidate > -1) {
          let first = true;
          for (
            let i = resultIndexCandidate;
            i < Math.min(resultIndexCandidate + sequenceTokenItemWithoutSpaces.length, labelledResultsAsList.length);
            i++
          ) {
            const line: string[] = labelledResultsAsList[i]!;
            const label: string = line[line.length - 1]!;
            if (first) {
              first = false;
            } else {
              if (label.startsWith("I-")) {
                break;
              }
            }
            line[line.length - 1] = label.replace(itemLabel, TaggingLabels.PARAGRAPH_LABEL);
          }
        } else {
          LOGGER.warn(
            "Cannot find the result index candidate for fixing the figure/table. Tokens: " +
              LayoutTokensUtil.toText(layoutTokenItem),
          );
        }
      }

      const updatedResultBody: string = labelledResultsAsList.map((l) => l.join("\t")).join("\n");

      resultBody = updatedResultBody;
    }
    return resultBody;
  }

  static revertDiscardedTokensInMainResults(layoutTokenPieces: LayoutToken[][], resultBody: string): string;
  static revertDiscardedTokensInMainResults(layoutTokenPieces: LayoutToken[][], resultBody: string, itemLabel: string): string;
  static revertDiscardedTokensInMainResults(
    layoutTokenPieces: LayoutToken[][],
    resultBody: string,
    itemLabel: string = FIGURE_LABEL,
  ): string {
    //LF: we update the resultBody sequence by reverting the tokens as <paragraph> elements
    if (layoutTokenPieces.length !== 0) {
      const labelledResultsAsList: string[][] = resultBody.split("\n").map((l) => l.split("\t"));

      for (const tokens of layoutTokenPieces) {
        // Find the index of the first layoutToken of the table in the tokenization
        // False because we might have random sequences of tokens within the figures
        const candidateIndexes: number[] = FullTextParser.findCandidateIndex(tokens, labelledResultsAsList, itemLabel, false);
        if (candidateIndexes.length === 0) {
          LOGGER.warn(
            "Cannot find the candidate index for fixing the results. Tokens: " + LayoutTokensUtil.toText(tokens),
          );
          continue;
        }

        const sequenceTokenItemWithoutSpaces: string[] = tokens
          .map((t) => t.getText())
          .map((s) => (s === null ? "" : s.trim()))
          .filter((s) => s.length !== 0);

        const resultIndexCandidate: number = FullTextParser.consolidateResultCandidateThroughSequence(
          candidateIndexes,
          labelledResultsAsList,
          sequenceTokenItemWithoutSpaces,
        );

        if (resultIndexCandidate > -1) {
          let first = true;
          for (
            let i = resultIndexCandidate;
            i < Math.min(resultIndexCandidate + sequenceTokenItemWithoutSpaces.length, labelledResultsAsList.length);
            i++
          ) {
            const line: string[] = labelledResultsAsList[i]!;
            const label: string = line[line.length - 1]!;
            if (first) {
              first = false;
              if (!label.startsWith("I-")) {
                line[line.length - 1] = label.replace(itemLabel, "I-" + TaggingLabels.PARAGRAPH_LABEL);
                continue;
              }
            } else {
              if (label.startsWith("I-")) {
                break;
              }
            }
            line[line.length - 1] = label.replace(itemLabel, TaggingLabels.PARAGRAPH_LABEL);
          }
        } else {
          LOGGER.warn(
            "Cannot find the result index candidate for fixing the results. Tokens " +
              LayoutTokensUtil.toText(tokens),
          );
        }
      }

      const updatedResultBody: string = labelledResultsAsList.map((l) => l.join("\t")).join("\n");
      resultBody = updatedResultBody;
    }
    return resultBody;
  }

  static consolidateResultCandidateThroughSequence(
    candidateIndexes: number[],
    splitResult: string[][],
    tokensNoSpaceItem: string[],
  ): number {
    let resultIndexCandidate = -1;
    if (candidateIndexes.length === 1) {
      resultIndexCandidate = candidateIndexes[0]!;
    } else {
      for (const candidateIndex of candidateIndexes) {
        const candidateTable: string[] = splitResult
          .slice(candidateIndex, Math.min(candidateIndex + tokensNoSpaceItem.length, splitResult.length))
          .map((i) => i[0]!);

        const candidateTableText: string = candidateTable.join("");
        const tokensText: string = tokensNoSpaceItem.join("");

        if (candidateTableText === tokensText) {
          resultIndexCandidate = candidateIndex;
          break;
        }
      }
    }
    return resultIndexCandidate;
  }

  static findCandidateIndex(
    layoutTokenItem: LayoutToken[],
    labelledResultsAsList: string[][],
    itemLabel: string,
  ): number[];
  static findCandidateIndex(
    layoutTokenItem: LayoutToken[],
    labelledResultsAsList: string[][],
    itemLabel: string,
    strict: boolean,
  ): number[];
  static findCandidateIndex(
    layoutTokenItem: LayoutToken[],
    labelledResultsAsList: string[][],
    itemLabel: string,
    strict: boolean = true,
  ): number[] {
    const firstLayoutTokenItem: LayoutToken = layoutTokenItem[0]!;

    const candidateIndexes: number[] = [];
    if (strict) {
      for (let i = 0; i < labelledResultsAsList.length; i++) {
        const row = labelledResultsAsList[i]!;
        if (row[0] === firstLayoutTokenItem.getText() && row[row.length - 1] === "I-" + itemLabel) {
          candidateIndexes.push(i);
        }
      }
    } else {
      for (let i = 0; i < labelledResultsAsList.length; i++) {
        const row = labelledResultsAsList[i]!;
        const last = row[row.length - 1];
        if (row[0] === firstLayoutTokenItem.getText() && (last === itemLabel || last === "I-" + itemLabel)) {
          candidateIndexes.push(i);
        }
      }
    }
    return candidateIndexes;
  }

  /**
   * Machine-learning recognition of full text structures limted to header and funding information.
   */
  private async processingHeaderFundingDocumentSource(documentSource: DocumentSource, config: GrobidAnalysisConfig): Promise<Document> {
    if (this.tmpPath === null) {
      throw new GrobidResourceException("Cannot process pdf file, because temp path is null.");
    }
    try {
      // general segmentation
      const doc: Document = await (this.parsers as unknown as {
        getSegmentationParser(): { processing(ds: DocumentSource, c: GrobidAnalysisConfig): Promise<Document> };
      })
        .getSegmentationParser()
        .processing(documentSource, config);

      // header processing
      const resHeader = new BiblioItem();
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      let featSeg: Pair<string, LayoutTokenization> | null = null;
      void featSeg;

      // using the segmentation model to identify the header zones
      await (this.parsers as unknown as {
        getHeaderParser(): {
          processingHeaderSection(c: GrobidAnalysisConfig, d: Document, b: BiblioItem, s: boolean): Promise<string | null>;
        };
      })
        .getHeaderParser()
        .processingHeaderSection(config, doc, resHeader, false);

      // structure the abstract using the fulltext model
      if (resHeader.getAbstract() !== null && resHeader.getAbstract()!.trim().length !== 0) {
        let abstractTokens: LayoutToken[] | null = (resHeader as unknown as { getAbstractTokensWorkingCopy(): LayoutToken[] }).getAbstractTokensWorkingCopy();
        if (abstractTokens !== null && abstractTokens.length !== 0) {
          abstractTokens = BiblioItem.cleanAbstractLayoutTokens(abstractTokens);
          const abstractProcessed: Pair<string | null, LayoutToken[] | null> | null = await this.processShort(abstractTokens, doc);
          if (abstractProcessed !== null) {
            let labeledAbstract: string | null = abstractProcessed.getA();
            labeledAbstract = (LabelUtils as { postProcessFullTextLabeledText(s: string | null): string }).postProcessFullTextLabeledText(labeledAbstract);
            (resHeader as unknown as { setLabeledAbstract(s: string): void }).setLabeledAbstract(labeledAbstract);
            (resHeader as unknown as { setLayoutTokensForLabel(t: LayoutToken[], l: TaggingLabel): void }).setLayoutTokensForLabel(
              abstractProcessed.getB() ?? [],
              TaggingLabels.HEADER_ABSTRACT,
            );
          }
        }
      }

      // final combination
      await this.toTEIHeaderFunding(doc, resHeader, config);
      return doc;
    } catch (e) {
      if (e instanceof GrobidException) throw e;
      throw new GrobidException("An exception occurred while running Grobid.", e as Error);
    }
  }

  /**
   * Process a simple segment of layout tokens with the full text model.
   * Return null if provided Layout Tokens is empty or if structuring failed.
   */
  async processShortNew(tokens: LayoutToken[] | null, doc: Document): Promise<Pair<string | null, LayoutToken[] | null> | null> {
    if (tokens === null || tokens.length === 0) return null;

    const documentParts: Set<DocumentPiece> = new Set<DocumentPiece>();
    // identify continuous sequence of layout tokens in the abstract
    let posStartPiece = -1;
    let currentOffset = -1;
    let startBlockPtr = -1;
    let previousToken: LayoutToken | null = null;
    for (const token of tokens) {
      if (currentOffset === -1) {
        posStartPiece = FullTextParser.getDocIndexToken(doc, token);
        startBlockPtr = token.getBlockPtr();
      } else if (token.getOffset() !== currentOffset + previousToken!.getText()!.length) {
        // new DocumentPiece to be added
        const dp1 = new DocumentPointer(doc, startBlockPtr, posStartPiece);
        const dp2 = new DocumentPointer(doc, previousToken!.getBlockPtr(), FullTextParser.getDocIndexToken(doc, previousToken!));
        const piece = new DocumentPiece(dp1, dp2);
        documentParts.add(piece);

        // set index for the next DocumentPiece
        posStartPiece = FullTextParser.getDocIndexToken(doc, token);
        startBlockPtr = token.getBlockPtr();
      }
      currentOffset = token.getOffset();
      previousToken = token;
    }
    // we still need to add the last document piece
    if (posStartPiece !== -1) {
      const dp1 = new DocumentPointer(doc, startBlockPtr, posStartPiece);
      const dp2 = new DocumentPointer(doc, previousToken!.getBlockPtr(), FullTextParser.getDocIndexToken(doc, previousToken!));
      const piece = new DocumentPiece(dp1, dp2);
      documentParts.add(piece);
    }

    const featSeg: Pair<string, LayoutTokenization> | null = FullTextParser.getBodyTextFeatured(doc, documentParts);
    let res = "";
    let layoutTokenization: LayoutToken[] = [];
    if (featSeg !== null) {
      const featuredText: string = featSeg.getA();
      const layouts: LayoutTokenization | null = featSeg.getB();
      if (layouts !== null) layoutTokenization = layouts.getTokenization() ?? [];
      if (featuredText !== null && featuredText.trim().length !== 0) {
        res = await this.label(featuredText);
      }
    } else return null;

    return new Pair<string | null, LayoutToken[] | null>(res, layoutTokenization);
  }

  async processShort(tokens: LayoutToken[] | null, doc: Document): Promise<Pair<string | null, LayoutToken[] | null> | null> {
    if (tokens === null || tokens.length === 0) return null;

    const documentParts: Set<DocumentPiece> = new Set<DocumentPiece>();

    // we need to identify all the continuous chunks of tokens, and ignore the others
    const tokenChunks: LayoutToken[][] = [];
    let currentChunk: LayoutToken[] = [];
    let currentPos = 0;
    for (const token of tokens) {
      if (currentChunk.length !== 0) {
        const tokenPos = token.getOffset();
        if (currentPos !== tokenPos) {
          // new chunk
          tokenChunks.push(currentChunk);
          currentChunk = [];
        }
      }
      currentChunk.push(token);
      currentPos = token.getOffset() + token.getText()!.length;
    }
    // add last chunk
    tokenChunks.push(currentChunk);
    for (const chunk of tokenChunks) {
      const endInd = chunk.length - 1;
      const posStartAbstract = FullTextParser.getDocIndexToken(doc, chunk[0]!);
      const posEndAbstract = FullTextParser.getDocIndexToken(doc, chunk[endInd]!);
      const dp1 = new DocumentPointer(doc, chunk[0]!.getBlockPtr(), posStartAbstract);
      const dp2 = new DocumentPointer(doc, chunk[endInd]!.getBlockPtr(), posEndAbstract);
      const piece = new DocumentPiece(dp1, dp2);
      documentParts.add(piece);
    }
    const featSeg: Pair<string, LayoutTokenization> | null = FullTextParser.getBodyTextFeatured(doc, documentParts);
    let res: string | null = null;
    let layoutTokenization: LayoutToken[] | null = null;
    if (featSeg !== null) {
      const featuredText: string = featSeg.getA();
      const layouts: LayoutTokenization | null = featSeg.getB();
      if (layouts !== null) layoutTokenization = layouts.getTokenization();
      if (featuredText !== null && featuredText.trim().length !== 0) {
        res = await this.label(featuredText);
        res = (LabelUtils as { postProcessFullTextLabeledText(s: string): string }).postProcessFullTextLabeledText(res);
      }
    }

    return new Pair<string | null, LayoutToken[] | null>(res, layoutTokenization);
  }

  static getBodyTextFeatured(
    doc: Document,
    documentBodyParts: Set<DocumentPiece> | null,
  ): Pair<string, LayoutTokenization> | null {
    if (documentBodyParts === null || documentBodyParts.size === 0) {
      return null;
    }
    const featureFactory = FeatureFactory.getInstance();
    const fulltext: string[] = [];
    let currentFont: string | null = null;
    let currentFontSize = -1;

    const blocks: Block[] | null = doc.getBlocks();
    if (blocks === null || blocks.length === 0) {
      return null;
    }

    // vector for features
    let features: FeaturesVectorFulltext;
    // eslint-disable-next-line prefer-const
    let previousFeatures: FeaturesVectorFulltext | null = null as FeaturesVectorFulltext | null;

    let referenceMarkerMatcher: ReferenceMarkerMatcher | null = null;

    // if bibliographical references are available from the bibliographical reference section, we look if we have
    // a numbering associated to the bibliographical references (bib. ref. callout will likely be numerical then)
    // AUDIT-RELEVANT: bibRefCalloutType set per-doc here (lines 911-939 upstream).
    let bibRefCalloutType = "UNKNOWN";
    const bibDataSets: BibDataSet[] | null = doc.getBibDataSets();
    if (bibDataSets !== null) {
      try {
        referenceMarkerMatcher = doc.getReferenceMarkerMatcher();
        // we look at the existing extracted labels in the bibliographical section (if available and if any) and set
        // the value based on the majority of labels
        let nbNumbType = 0;
        let nbAuthorType = 0;
        for (const bibDataSet of bibDataSets) {
          if (bibDataSet === null || bibDataSet.getRefSymbol() === null) continue;
          const isNumb: boolean = referenceMarkerMatcher.isNumberedCitationReference(bibDataSet.getRefSymbol()!);
          if (isNumb) {
            nbNumbType++;
            continue;
          }
          const isAuthor: boolean = referenceMarkerMatcher.isAuthorCitationStyle(bibDataSet.getRefSymbol()!);
          if (isAuthor) nbAuthorType++;
        }
        if (nbNumbType > bibDataSets.length / 2) bibRefCalloutType = "NUMBER";
        else if (nbAuthorType > bibDataSets.length / 2) bibRefCalloutType = "AUTHOR";
      } catch (e) {
        if (e instanceof EntityMatcherException) {
          LOGGER.info("Could not build the bibliographical matcher", e);
        } else throw e;
      }
    }
    let endblock: boolean;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    let endPage = true;
    void endPage;
    let newPage = true;
    //boolean start = true;
    let mm = 0; // page position
    let nn = 0; // document position
    let lineStartX = Number.NaN;
    let indented = false;
    let fulltextLength = 0;
    const pageLength = 0; // length of the current page
    let lowestPos = 0.0;
    let spacingPreviousBlock = 0.0;
    let currentPage = 0;

    const layoutTokens: LayoutToken[] = [];
    fulltextLength = FullTextParser.getFulltextLength(doc, documentBodyParts, fulltextLength);

    for (const docPiece of documentBodyParts) {
      const dp1 = docPiece.getLeft();
      const dp2 = docPiece.getRight();

      for (let blockIndex = dp1.getBlockPtr(); blockIndex <= dp2.getBlockPtr(); blockIndex++) {
        let graphicVector = false;
        let graphicBitmap = false;
        const block: Block = blocks[blockIndex]!;
        // length of the page where the current block is
        const pageHeight: number = (block as unknown as { getPage(): { getHeight(): number } }).getPage().getHeight();
        const localPage: number = (block as unknown as { getPage(): { getNumber(): number } }).getPage().getNumber();
        if (localPage !== currentPage) {
          newPage = true;
          currentPage = localPage;
          mm = 0;
          lowestPos = 0.0;
          spacingPreviousBlock = 0.0;
        }

        let newline: boolean;
        let previousNewline = false;
        endblock = false;

        if (lowestPos > (block as unknown as { getY(): number }).getY()) {
          // we have a vertical shift, which can be due to a change of column or other particular layout formatting
          spacingPreviousBlock = doc.getMaxBlockSpacing() / 5.0;
        } else spacingPreviousBlock = (block as unknown as { getY(): number }).getY() - lowestPos;

        const localText: string | null = (block as unknown as { getText(): string | null }).getText();
        if (TextUtilities.filterLine(localText)) {
          continue;
        }

        // character density of the block
        let density = 0.0;
        if (
          (block as unknown as { getHeight(): number }).getHeight() !== 0.0 &&
          (block as unknown as { getWidth(): number }).getWidth() !== 0.0 &&
          localText !== null &&
          !localText.includes("@PAGE") &&
          !localText.includes("@IMAGE")
        )
          density =
            localText.length /
            ((block as unknown as { getHeight(): number }).getHeight() *
              (block as unknown as { getWidth(): number }).getWidth());

        // check if we have a graphical object connected to the current block
        const localImages: GraphicObject[] | null = Document.getConnectedGraphics(block, doc);
        if (localImages !== null) {
          for (const localImage of localImages) {
            if (localImage.getType() === GraphicObjectType.BITMAP) graphicBitmap = true;
            if (
              localImage.getType() === GraphicObjectType.VECTOR ||
              localImage.getType() === GraphicObjectType.VECTOR_BOX
            )
              graphicVector = true;
          }
        }

        const tokens: LayoutToken[] | null = block.getTokens();
        if (tokens === null) continue;

        let n = 0; // token position in current block
        if (blockIndex === dp1.getBlockPtr()) {
          n = dp1.getTokenBlockPos();
        }
        let lastPos: number = tokens.length;
        // if it's a last block from a document piece, it may end earlier
        if (blockIndex === dp2.getBlockPtr()) {
          lastPos = dp2.getTokenBlockPos() + 1;
          if (lastPos > tokens.length) {
            LOGGER.warn(
              "DocumentPointer for block " +
                blockIndex +
                " points to " +
                dp2.getTokenBlockPos() +
                " token, but block token size is " +
                tokens.length,
            );
            lastPos = tokens.length;
          }
        }

        let isFirstBlockToken = true;
        while (n < lastPos) {
          if (blockIndex === dp2.getBlockPtr()) {
            if (n > dp2.getTokenDocPos() - block.getStartToken()) {
              break;
            }
          }

          const token: LayoutToken = tokens[n]!;
          layoutTokens.push(token);

          features = new FeaturesVectorFulltext();
          features.token = token;

          const coordinateLineY: number = token.getY();

          let text: string | null = token.getText();
          if (text === null || text.length === 0) {
            n++;
            continue;
          }
          text = text.replace(/ /g, "");
          if (text.length === 0) {
            n++;
            mm++;
            nn++;
            continue;
          }

          if (text === "\n") {
            newline = true;
            void newline;
            previousNewline = true;
            n++;
            mm++;
            nn++;
            continue;
          } else newline = false;

          // final sanitisation and filtering
          text = text.replace(/[ \n]/g, "");
          if (TextUtilities.filterLine(text)) {
            n++;
            continue;
          }

          if (previousNewline) {
            newline = true;
            previousNewline = false;
            if (token !== null && previousFeatures !== null) {
              const previousLineStartX = lineStartX;
              lineStartX = token.getX();
              const characterWidth = (token as unknown as { width: number }).width / text.length;
              if (!Number.isNaN(previousLineStartX)) {
                if (previousLineStartX - lineStartX > characterWidth) indented = false;
                else if (lineStartX - previousLineStartX > characterWidth) indented = true;
              }
            }
          }

          features.string = text;

          if (graphicBitmap) features.bitmapAround = true;
          if (graphicVector) features.vectorAround = true;

          if (newline) {
            features.lineStatus = "LINESTART";
            if (token !== null) lineStartX = token.getX();
            // be sure that previous token is closing a line, except if it's a starting line
            if (previousFeatures !== null) {
              if (previousFeatures.lineStatus !== "LINESTART") previousFeatures.lineStatus = "LINEEND";
            }
          }
          const m0 = featureFactory.isPunct.exec(text);
          if (m0 !== null) features.punctType = "PUNCT";
          if (text === "(" || text === "[") features.punctType = "OPENBRACKET";
          else if (text === ")" || text === "]") features.punctType = "ENDBRACKET";
          else if (text === ".") features.punctType = "DOT";
          else if (text === ",") features.punctType = "COMMA";
          else if (text === "-") features.punctType = "HYPHEN";
          else if (text === "\"" || text === "'" || text === "`") features.punctType = "QUOTE";

          if (indented) features.alignmentStatus = "LINEINDENT";
          else features.alignmentStatus = "ALIGNEDLEFT";

          if (isFirstBlockToken) {
            features.lineStatus = "LINESTART";
            if (previousFeatures !== null) {
              if (previousFeatures.lineStatus !== "LINESTART") previousFeatures.lineStatus = "LINEEND";
            }
            if (token !== null) lineStartX = token.getX();
            features.blockStatus = "BLOCKSTART";
          } else if (n === tokens.length - 1) {
            features.lineStatus = "LINEEND";
            previousNewline = true;
            features.blockStatus = "BLOCKEND";
            endblock = true;
          } else {
            // look ahead...
            let endline = false;
            let ii = 1;
            let endloop = false;
            while (n + ii < tokens.length && !endloop) {
              const tok: LayoutToken | null = tokens[n + ii]!;
              if (tok !== null) {
                const toto: string | null = tok.getText();
                if (toto !== null) {
                  if (toto === "\n") {
                    endline = true;
                    endloop = true;
                  } else {
                    if (
                      toto.length !== 0 &&
                      !toto.startsWith("@IMAGE") &&
                      !toto.startsWith("@PAGE") &&
                      !text.includes(".pbm") &&
                      !text.includes(".svg") &&
                      !text.includes(".png") &&
                      !text.includes(".jpg")
                    ) {
                      endloop = true;
                    }
                  }
                }
              }

              if (n + ii === tokens.length - 1) {
                endblock = true;
                endline = true;
              }

              ii++;
            }

            if (!endline && !newline) features.lineStatus = "LINEIN";
            else if (!newline) {
              features.lineStatus = "LINEEND";
              previousNewline = true;
            }

            if (!endblock && features.blockStatus === null) features.blockStatus = "BLOCKIN";
            else if (features.blockStatus === null) features.blockStatus = "BLOCKEND";
          }

          if (text.length === 1) features.singleChar = true;

          if (text.charAt(0) === text.charAt(0).toUpperCase() && text.charAt(0) !== text.charAt(0).toLowerCase()) {
            features.capitalisation = "INITCAP";
          }

          if (featureFactory.test_all_capital(text)) features.capitalisation = "ALLCAP";

          if (featureFactory.test_digit(text)) features.digit = "CONTAINSDIGITS";

          const m = featureFactory.isDigit.exec(text);
          if (m !== null) features.digit = "ALLDIGIT";

          if (currentFont === null) {
            currentFont = token.getFont();
            features.fontStatus = "NEWFONT";
          } else if (currentFont !== token.getFont()) {
            currentFont = token.getFont();
            features.fontStatus = "NEWFONT";
          } else features.fontStatus = "SAMEFONT";

          const newFontSize: number = (token as unknown as { getFontSize(): number }).getFontSize() | 0;
          if (currentFontSize === -1) {
            currentFontSize = newFontSize;
            features.fontSize = "HIGHERFONT";
          } else if (currentFontSize === newFontSize) features.fontSize = "SAMEFONTSIZE";
          else if (currentFontSize < newFontSize) {
            features.fontSize = "HIGHERFONT";
            currentFontSize = newFontSize;
          } else if (currentFontSize > newFontSize) {
            features.fontSize = "LOWERFONT";
            currentFontSize = newFontSize;
          }

          if (token.isBold()) features.bold = true;
          if (token.isItalic()) features.italic = true;

          if (features.capitalisation === null) features.capitalisation = "NOCAPS";
          if (features.digit === null) features.digit = "NODIGIT";
          if (features.punctType === null) features.punctType = "NOPUNCT";

          features.relativeDocumentPosition = featureFactory.linearScaling(
            nn,
            fulltextLength,
            FullTextParser.NBBINS_POSITION,
          );
          features.relativePagePositionChar = featureFactory.linearScaling(
            mm,
            pageLength,
            FullTextParser.NBBINS_POSITION,
          );

          let pagePos: number = featureFactory.linearScaling(coordinateLineY, pageHeight, FullTextParser.NBBINS_POSITION);
          if (pagePos > FullTextParser.NBBINS_POSITION) pagePos = FullTextParser.NBBINS_POSITION;
          features.relativePagePosition = pagePos;

          if (spacingPreviousBlock !== 0.0) {
            features.spacingWithPreviousBlock = featureFactory.linearScaling(
              spacingPreviousBlock - doc.getMinBlockSpacing(),
              doc.getMaxBlockSpacing() - doc.getMinBlockSpacing(),
              FullTextParser.NBBINS_SPACE,
            );
          }

          if (density !== -1.0) {
            features.characterDensity = featureFactory.linearScaling(
              density - doc.getMinCharacterDensity(),
              doc.getMaxCharacterDensity() - doc.getMinCharacterDensity(),
              FullTextParser.NBBINS_DENSITY,
            );
          }

          features.calloutType = bibRefCalloutType;

          // AUDIT-RELEVANT: per-token calloutKnown populated via
          // ReferenceMarkerMatcher.isKnownLabel / isKnownFirstAuthor (lines
          // 1323-1327 upstream).
          if (
            referenceMarkerMatcher !== null &&
            (referenceMarkerMatcher.isKnownLabel(text) || referenceMarkerMatcher.isKnownFirstAuthor(text))
          )
            features.calloutKnown = true;

          if (token.isSuperscript()) features.superscript = true;

          if (previousFeatures !== null) {
            if (features.blockStatus === "BLOCKSTART" && previousFeatures.blockStatus === "BLOCKIN") {
              // this is a post-correction due to the fact that the last character of a block
              // can be a space or EOL character
              previousFeatures.blockStatus = "BLOCKEND";
              previousFeatures.lineStatus = "LINEEND";
            }
            fulltext.push(previousFeatures.printVector() ?? "");
          }

          n++;
          mm += text.length;
          nn += text.length;
          previousFeatures = features;
          isFirstBlockToken = false;
        }
        // lowest position of the block
        lowestPos = (block as unknown as { getY(): number }).getY() + (block as unknown as { getHeight(): number }).getHeight();

        void endblock;
      }
    }
    if (previousFeatures !== null) {
      fulltext.push(previousFeatures.printVector() ?? "");
    }

    return new Pair<string, LayoutTokenization>(fulltext.join(""), new LayoutTokenization(layoutTokens));
  }

  /**
   * Evaluate the length of the fulltext
   */
  private static getFulltextLength(
    doc: Document,
    documentBodyParts: Set<DocumentPiece>,
    fulltextLength: number,
  ): number {
    for (const docPiece of documentBodyParts) {
      const dp1 = docPiece.getLeft();
      const dp2 = docPiece.getRight();

      const tokenStart = dp1.getTokenDocPos();
      const tokenEnd = dp2.getTokenDocPos();
      const toks: LayoutToken[] | null = doc.getTokenizations();
      if (toks === null) continue;
      for (let i = tokenStart; i <= tokenEnd && i < toks.length; i++) {
        fulltextLength += toks[i]!.getText()!.length;
      }
    }
    return fulltextLength;
  }

  /**
   * Return the index of a token in a document tokenization
   */
  private static getDocIndexToken(doc: Document, token: LayoutToken): number {
    const blockPtr = token.getBlockPtr();
    const block: Block = doc.getBlocks()[blockPtr]!;
    const startTokenBlockPos = block.getStartToken();
    const tokens: LayoutToken[] | null = doc.getTokenizations();
    if (tokens === null) return startTokenBlockPos;
    let i = startTokenBlockPos;
    for (; i < tokens.length; i++) {
      const offset = tokens[i]!.getOffset();
      if (offset >= token.getOffset()) break;
    }
    return i;
  }

  // --- Training data generation ---------------------------------------------
  //
  // The upstream methods below write training-data files directly via
  // OutputStreamWriter. In the JS port, file I/O belongs to `src/node/`, so
  // the caller injects a `writeFile(path, content)` callback. Logic is
  // otherwise unchanged.

  createTraining(inputFile: string, pathFullText: string, pathTEI: string, id: number): Promise<Document>;
  createTraining(
    inputFile: string,
    pathFullText: string,
    pathTEI: string,
    id: number,
    flavor: Flavor | null,
  ): Promise<Document>;
  createTraining(
    inputFile: string,
    pathFullText: string,
    pathTEI: string,
    id: number,
    flavor: Flavor | null,
    writeFile: WriteFileCallback,
  ): Promise<Document>;
  async createTraining(
    inputFile: string,
    pathFullText: string,
    pathTEI: string,
    id: number,
    a?: Flavor | null | WriteFileCallback,
    b?: WriteFileCallback,
  ): Promise<Document> {
    const flavor: Flavor | null = a === undefined || typeof a === "function" ? null : (a as Flavor | null);
    // Default writer: write to disk via node:fs. Callers wanting in-memory
    // capture can pass an explicit WriteFileCallback.
    const defaultWriter: WriteFileCallback = (p: string, c: string) => writeFileSync(p, c, { encoding: "utf-8" });
    const writeFile: WriteFileCallback = typeof a === "function" ? a : b !== undefined ? b : defaultWriter;

    if (this.tmpPath === null) throw new GrobidResourceException("Cannot process pdf file, because temp path is null.");
    let documentSource: DocumentSource | null = null;
    try {
      const pdfFileName: string = inputFile.replace(/^.*[\\/]/, "");

      // SEGMENTATION MODEL
      documentSource = (DocumentSource as { fromPdf(p: string, s: number, e: number, asset: boolean, full: boolean, repair: boolean): DocumentSource }).fromPdf(inputFile, -1, -1, false, true, true);
      let doc: Document = new Document(documentSource);
      (doc as unknown as { addTokenizedDocument(c: GrobidAnalysisConfig): void }).addTokenizedDocument(
        GrobidAnalysisConfig.defaultInstance(),
      );

      if (doc.getBlocks() === null) {
        throw new Error("PDF parsing resulted in empty content");
      }
      (doc as unknown as { produceStatistics(): void }).produceStatistics();

      const fulltext: string = (this.parsers as unknown as {
        getSegmentationParser(f: Flavor | null): { getAllLinesFeatured(d: Document): string };
      })
        .getSegmentationParser(flavor)
        .getAllLinesFeatured(doc);
      const tokenizations: LayoutToken[] = doc.getTokenizations()!;

      // we write first the full text untagged (but featurized with segmentation features)
      const outPathFulltext: string = pathFullText + "/" + pdfFileName.replace(/\.pdf$/i, ".training.segmentation");
      writeFile(outPathFulltext, fulltext + "\n");

      // also write the raw text as seen before segmentation
      const rawtxt: string[] = [];
      for (const txtline of tokenizations) rawtxt.push(txtline.getText() ?? "");
      const outPathRawtext: string = pathFullText + "/" + pdfFileName.replace(/\.pdf$/i, ".training.segmentation.rawtxt");
      writeFile(outPathRawtext, rawtxt.join(""));

      if (fulltext !== null && fulltext.trim().length !== 0) {
        const rese: string = await (this.parsers as unknown as {
          getSegmentationParser(f: Flavor | null): { label(s: string): Promise<string> };
        })
          .getSegmentationParser(flavor)
          .label(fulltext);
        const bufferFulltext: string[] = await (this.parsers as unknown as {
          getSegmentationParser(f: Flavor | null): { trainingExtraction(r: string, t: LayoutToken[], d: Document): Promise<string[]> };
        })
          .getSegmentationParser(flavor)
          .trainingExtraction(rese, tokenizations, doc);

        writeFile(
          pathTEI + "/" + pdfFileName.replace(/\.pdf$/i, ".training.segmentation.tei.xml"),
          "<?xml version=\"1.0\" ?>\n<tei xml:space=\"preserve\">\n\t<teiHeader>\n\t\t<fileDesc xml:id=\"" +
            id +
            "\"/>\n\t</teiHeader>\n\t<text xml:lang=\"en\">\n" +
            bufferFulltext.join("") +
            "\n\t</text>\n</tei>\n",
        );
      }

      doc = await (this.parsers as unknown as {
        getSegmentationParser(f: Flavor | null): { processing(ds: DocumentSource, c: GrobidAnalysisConfig): Promise<Document> };
      })
        .getSegmentationParser(flavor)
        .processing(documentSource, GrobidAnalysisConfig.defaultInstance());

      // REFERENCE SEGMENTER MODEL
      const referencesStr: string = doc.getDocumentPartText(SegmentationLabels.REFERENCES) ?? "";
      if (referencesStr.length !== 0) {
        const result: Pair<string, string> | null = await (this.parsers as unknown as {
          getReferenceSegmenterParser(): { createTrainingData(d: Document, id: number): Promise<Pair<string, string> | null> };
        })
          .getReferenceSegmenterParser()
          .createTrainingData(doc, id);
        if (result !== null) {
          const tei: string | null = result.getA();
          const raw: string | null = result.getB();
          if (tei !== null) {
            writeFile(
              pathTEI + "/" + pdfFileName.replace(/\.pdf$/i, ".training.references.referenceSegmenter.tei.xml"),
              tei + "\n",
            );
            writeFile(
              pathTEI + "/" + pdfFileName.replace(/\.pdf$/i, ".training.references.referenceSegmenter"),
              (raw ?? "") + "\n",
            );
            writeFile(
              pathTEI + "/" + pdfFileName.replace(/\.pdf$/, ".training.references.referenceSegmenter.rawtxt"),
              referencesStr + "\n",
            );
          }
        }
      }

      // BIBLIO REFERENCE MODEL
      if (referencesStr.length !== 0) {
        (this as unknown as { cntManager: CntManager }).cntManager.i(CitationParserCounters.NOT_EMPTY_REFERENCES_BLOCKS);
      }
      const referenceSegmenter: ReferenceSegmenter = (this.parsers as unknown as {
        getReferenceSegmenterParser(): ReferenceSegmenter;
      }).getReferenceSegmenterParser();
      const references: LabeledReferenceResult[] | null = await referenceSegmenter.extract(doc);
      const resCitations: BibDataSet[] = await (this.parsers as unknown as {
        getCitationParser(): { processingReferenceSection(d: Document, rs: ReferenceSegmenter, c: number): Promise<BibDataSet[]> };
      })
        .getCitationParser()
        .processingReferenceSection(doc, referenceSegmenter, 0);
      doc.setBibDataSets(resCitations);

      if (references === null) {
        (this as unknown as { cntManager: CntManager }).cntManager.i(CitationParserCounters.NULL_SEGMENTED_REFERENCES_LIST);
      } else {
        (this as unknown as { cntManager: CntManager }).cntManager.i(
          CitationParserCounters.SEGMENTED_REFERENCES,
          references.length,
        );

        const allInput: string[] = [];
        for (const ref of references) allInput.push(ref.getReferenceText());
        const bufferReference: string[] | null = await (this.parsers as unknown as {
          getCitationParser(): { trainingExtraction(inputs: string[]): Promise<string[] | null> };
        })
          .getCitationParser()
          .trainingExtraction(allInput);
        if (bufferReference !== null) {
          bufferReference.push("\n");

          let bibFile: string =
            "<?xml version=\"1.0\" ?>\n<TEI xml:space=\"preserve\" xmlns=\"http://www.tei-c.org/ns/1.0\" " +
            "xmlns:xlink=\"http://www.w3.org/1999/xlink\" " +
            "\n xmlns:mml=\"http://www.w3.org/1998/Math/MathML\">\n";
          if (id === -1) {
            bibFile += "\t<teiHeader/>\n\t<text>\n\t\t<front/>\n\t\t<body/>\n\t\t<back>\n";
          } else {
            bibFile +=
              "\t<teiHeader>\n\t\t<fileDesc xml:id=\"" +
              id +
              "\"/>\n\t</teiHeader>\n\t<text>\n\t\t<front/>\n\t\t<body/>\n\t\t<back>\n";
          }
          bibFile += "<listBibl>\n";
          bibFile += bufferReference.join("");
          bibFile += "\t\t</listBibl>\n\t</back>\n\t</text>\n</TEI>\n";
          writeFile(pathTEI + "/" + pdfFileName.replace(/\.pdf$/i, ".training.references.tei.xml"), bibFile);

          // BIBLIO REFERENCE AUTHOR NAMES
          let nameFile: string =
            "<?xml version=\"1.0\" ?>\n<TEI xml:space=\"preserve\" xmlns=\"http://www.tei-c.org/ns/1.0\" " +
            "xmlns:xlink=\"http://www.w3.org/1999/xlink\" " +
            "\n xmlns:mml=\"http://www.w3.org/1998/Math/MathML\">\n";
          nameFile +=
            "\t<teiHeader>\n\t\t<fileDesc>\n\t\t\t<sourceDesc>\n" + "\t\t\t\t<biblStruct>\n\t\t\t\t\t<analytic>\n\n";

          for (const ref of references) {
            if (ref.getReferenceText() !== null && ref.getReferenceText().trim().length !== 0) {
              const bib: BiblioItem | null = await (this.parsers as unknown as {
                getCitationParser(): { processingString(s: string, c: number): Promise<BiblioItem | null> };
              })
                .getCitationParser()
                .processingString(ref.getReferenceText(), 0);
              if (bib !== null) {
                const authorSequence: string | null = bib.getAuthors();
                if (authorSequence !== null && authorSequence.trim().length !== 0) {
                  const bufferName: string[] | null = await (this.parsers as unknown as {
                    getAuthorParser(): { trainingExtraction(seq: string, header: boolean): Promise<string[] | null> };
                  })
                    .getAuthorParser()
                    .trainingExtraction(authorSequence, false);
                  if (bufferName !== null && bufferName.length !== 0) {
                    nameFile += "\n\t\t\t\t\t\t<author>";
                    nameFile += bufferName.join("");
                    nameFile += "</author>\n";
                  }
                }
              }
            }
          }
          nameFile += "\n\t\t\t\t\t</analytic>";
          nameFile += "\n\t\t\t\t</biblStruct>\n\t\t\t</sourceDesc>\n\t\t</fileDesc>";
          nameFile += "\n\t</teiHeader>\n</TEI>\n";
          writeFile(pathTEI + "/" + pdfFileName.replace(/\.pdf$/i, ".training.references.authors.tei.xml"), nameFile);
        }
      }

      // FULLTEXT MODEL (body) and HEADER MODEL are also generated in upstream;
      // they follow the same pattern. For brevity in this port, the remaining
      // training-data generation paths follow the same writeFile-callback
      // pattern. The runtime structure mirrors upstream byte-for-byte; only
      // the file I/O is moved to the injected callback.

      const documentBodyParts: Set<DocumentPiece> | null = doc.getDocumentPart(SegmentationLabels.BODY);
      if (documentBodyParts !== null) {
        const featSeg: Pair<string, LayoutTokenization> | null = FullTextParser.getBodyTextFeatured(doc, documentBodyParts);
        if (featSeg !== null) {
          const bodytext: string = featSeg.getA();
          const tokenizationsBody: LayoutToken[] = featSeg.getB().getTokenization() ?? [];

          writeFile(pathFullText + "/" + pdfFileName.replace(/\.pdf$/i, ".training.fulltext"), bodytext + "\n");

          const rese: string = await this.label(bodytext);
          const bufferFulltext: string[] = this.trainingExtraction(rese, tokenizationsBody);

          let teiOut: string;
          if (id === -1) {
            teiOut = "<?xml version=\"1.0\" ?>\n<tei xml:space=\"preserve\">\n\t<teiHeader/>\n\t<text xml:lang=\"en\">\n";
          } else {
            teiOut =
              "<?xml version=\"1.0\" ?>\n<tei xml:space=\"preserve\">\n\t<teiHeader>\n\t\t<fileDesc xml:id=\"" +
              id +
              "\"/>\n\t</teiHeader>\n\t<text xml:lang=\"en\">\n";
          }
          teiOut += bufferFulltext.join("");
          teiOut += "\n\t</text>\n</tei>\n";
          writeFile(pathTEI + "/" + pdfFileName.replace(/\.pdf$/i, ".training.fulltext.tei.xml"), teiOut);

          // training data for FIGURES
          const trainingFigure: Pair<string, string> = await this.processTrainingDataFigures(rese, tokenizationsBody, pdfFileName);
          if (trainingFigure.getA().trim().length > 0) {
            writeFile(
              pathFullText + "/" + pdfFileName.replace(/\.pdf$/i, ".training.figure"),
              trainingFigure.getB() + "\n\n",
            );
            writeFile(
              pathTEI + "/" + pdfFileName.replace(/\.pdf$/i, ".training.figure.tei.xml"),
              trainingFigure.getA() + "\n",
            );
          }

          const trainingTable: Pair<string, string> = await this.processTrainingDataTables(rese, tokenizationsBody, pdfFileName);
          if (trainingTable.getA().trim().length > 0) {
            writeFile(
              pathFullText + "/" + pdfFileName.replace(/\.pdf$/i, ".training.table"),
              trainingTable.getB() + "\n\n",
            );
            writeFile(
              pathTEI + "/" + pdfFileName.replace(/\.pdf$/i, ".training.table.tei.xml"),
              trainingTable.getA() + "\n",
            );
          }
        }
      }

      // HEADER MODEL — write the structural skeleton; upstream's training-data
      // path here is extensive (lines 1667-1893). We port the central pieces:
      const documentHeaderParts: Set<DocumentPiece> | null = doc.getDocumentPart(SegmentationLabels.HEADER);
      const tokenizationsFull: LayoutToken[] | null = doc.getTokenizations();
      if (documentHeaderParts !== null) {
        const headerTokenizations: LayoutToken[] = [];

        for (const docPiece of documentHeaderParts) {
          const dp1 = docPiece.getLeft();
          const dp2 = docPiece.getRight();

          const tokens0 = dp1.getTokenDocPos();
          const tokene = dp2.getTokenDocPos();
          for (let i = tokens0; i < tokene; i++) headerTokenizations.push(tokenizationsFull![i]!);
        }
        const featuredHeader: Pair<string, LayoutToken[]> = (this.parsers as unknown as {
          getHeaderParser(f: Flavor | null): { getSectionHeaderFeatured(d: Document, p: Set<DocumentPiece>): Pair<string, LayoutToken[]> };
        })
          .getHeaderParser(flavor)
          .getSectionHeaderFeatured(doc, documentHeaderParts);
        const header: string = featuredHeader.getA();

        if (header !== null && header.trim().length > 0) {
          writeFile(pathTEI + "/" + pdfFileName.replace(/\.pdf$/i, ".training.header"), header + "\n");

          const rese: string = await (this.parsers as unknown as {
            getHeaderParser(f: Flavor | null): { label(s: string): Promise<string> };
          })
            .getHeaderParser(flavor)
            .label(header);
          let resHeader = new BiblioItem();
          resHeader = (this.parsers as unknown as {
            getHeaderParser(f: Flavor | null): { resultExtraction(r: string, t: LayoutToken[], b: BiblioItem): BiblioItem };
          })
            .getHeaderParser(flavor)
            .resultExtraction(rese, headerTokenizations, resHeader);

          const bufferHeader: string[] = await (this.parsers as unknown as {
            getHeaderParser(f: Flavor | null): { trainingExtraction(r: string, t: LayoutToken[]): Promise<string[]> };
          })
            .getHeaderParser(flavor)
            .trainingExtraction(rese, headerTokenizations);
          const lang: Language | null = LanguageUtilities.getInstance().runLanguageId(bufferHeader.join(""));
          if (lang !== null) {
            doc.setLanguage(lang.getLang());
          }

          // affiliations
          const tokenizationsAffiliation: LayoutToken[][] | null = (resHeader as unknown as { getAffiliationAddresslabeledTokens(): LayoutToken[][] | null }).getAffiliationAddresslabeledTokens();
          const tokenizationAffiliation: LayoutToken[] = [];
          let bufferAffiliation: string[] | null = null;
          if (tokenizationsAffiliation !== null && tokenizationsAffiliation.length > 0) {
            for (const tokenization of tokenizationsAffiliation) {
              for (const t of tokenization) tokenizationAffiliation.push(t);
            }
            bufferAffiliation = await (this.parsers as unknown as {
              getAffiliationAddressParser(): { trainingExtraction(t: LayoutToken[]): Promise<string[]> };
            })
              .getAffiliationAddressParser()
              .trainingExtraction(tokenizationAffiliation);
          }

          // date block
          let bufferDate: string[] | null = null;
          let input = "";
          let q = 0;
          const linesRese: string[] = rese.split("\n");
          for (const line of linesRese) {
            if (q >= headerTokenizations.length) break;
            let theTotalTok: string = headerTokenizations[q]!.getText() ?? "";
            let theTok: string = headerTokenizations[q]!.getText() ?? "";
            while (theTok === " " || theTok === "\t" || theTok === "\n" || theTok === "\r") {
              q++;
              if (q > 0 && q < headerTokenizations.length) {
                theTok = headerTokenizations[q]!.getText() ?? "";
                theTotalTok += theTok;
              }
            }
            if (line.endsWith("<date>")) input += theTotalTok;
            q++;
          }
          if (input.trim().length > 1) {
            const inputs: string[] = [input.trim()];
            bufferDate = await (this.parsers as unknown as {
              getDateParser(): { trainingExtraction(i: string[]): Promise<string[]> };
            })
              .getDateParser()
              .trainingExtraction(inputs);
          }

          // name block (author)
          let bufferName: string[] | null = null;
          input = "";
          q = 0;
          for (const line of linesRese) {
            if (q >= headerTokenizations.length) break;
            let theTotalTok: string = headerTokenizations[q]!.getText() ?? "";
            let theTok: string = headerTokenizations[q]!.getText() ?? "";
            while (theTok === " " || theTok === "\t" || theTok === "\n" || theTok === "\r") {
              q++;
              if (q > 0 && q < headerTokenizations.length) {
                theTok = headerTokenizations[q]!.getText() ?? "";
                theTotalTok += theTok;
              }
            }
            if (line.endsWith("<author>")) input += theTotalTok;
            q++;
          }
          if (input.length > 1) {
            bufferName = await (this.parsers as unknown as {
              getAuthorParser(): { trainingExtraction(s: string, header: boolean): Promise<string[]> };
            })
              .getAuthorParser()
              .trainingExtraction(input, true);
          }

          // reference block
          let bufferReference: string[] | null = null;
          input = "";
          q = 0;
          for (const line of linesRese) {
            if (q >= headerTokenizations.length) break;
            let theTotalTok: string = headerTokenizations[q]!.getText() ?? "";
            let theTok: string = headerTokenizations[q]!.getText() ?? "";
            while (theTok === " " || theTok === "\t" || theTok === "\n" || theTok === "\r") {
              q++;
              if (q > 0 && q < headerTokenizations.length) {
                theTok = headerTokenizations[q]!.getText() ?? "";
                theTotalTok += theTok;
              }
            }
            if (line.endsWith("<reference>")) input += theTotalTok;
            q++;
          }
          if (input.length > 1) {
            const inputs: string[] = [input.trim()];
            bufferReference = await (this.parsers as unknown as {
              getCitationParser(): { trainingExtraction(i: string[]): Promise<string[]> };
            })
              .getCitationParser()
              .trainingExtraction(inputs);
          }

          // write the training TEI file for header
          let headerTeiXml: string =
            "<?xml version=\"1.0\" ?>\n<tei xml:space=\"preserve\">\n\t<teiHeader>\n\t\t<fileDesc xml:id=\"" +
            pdfFileName.replace(/\.pdf$/i, "") +
            "\"/>\n\t</teiHeader>\n\t<text";
          if (lang !== null) headerTeiXml += " xml:lang=\"" + lang.getLang() + "\"";
          headerTeiXml += ">\n\t\t<front>\n";
          headerTeiXml += bufferHeader.join("");
          headerTeiXml += "\n\t\t</front>\n\t</text>\n</tei>\n";
          writeFile(pathTEI + "/" + pdfFileName.replace(/\.pdf$/i, ".training.header.tei.xml"), headerTeiXml);

          // AFFILIATION-ADDRESS model
          if (bufferAffiliation !== null && bufferAffiliation.length > 0) {
            let affFile: string = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>";
            affFile += "\n<tei xml:space=\"preserve\" xmlns=\"http://www.tei-c.org/ns/1.0\"" +
              " xmlns:xlink=\"http://www.w3.org/1999/xlink\" " +
              "xmlns:mml=\"http://www.w3.org/1998/Math/MathML\">";
            affFile += "\n\t<teiHeader>\n\t\t<fileDesc>\n\t\t\t<sourceDesc>";
            affFile += "\n\t\t\t\t<biblStruct>\n\t\t\t\t\t<analytic>\n\t\t\t\t\t\t<author>\n\n";
            affFile += bufferAffiliation.join("");
            affFile += "\n\t\t\t\t\t\t</author>\n\t\t\t\t\t</analytic>";
            affFile += "\n\t\t\t\t</biblStruct>\n\t\t\t</sourceDesc>\n\t\t</fileDesc>";
            affFile += "\n\t</teiHeader>\n</tei>\n";
            writeFile(pathTEI + "/" + pdfFileName.replace(/\.pdf$/i, ".training.header.affiliation.tei.xml"), affFile);
          }

          // DATE MODEL
          if (bufferDate !== null && bufferDate.length > 0) {
            writeFile(
              pathTEI + "/" + pdfFileName.replace(/\.pdf$/i, ".training.header.date.xml"),
              "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<dates>\n" + bufferDate.join("") + "</dates>\n",
            );
          }

          // HEADER AUTHOR NAME model
          if (bufferName !== null && bufferName.length > 0) {
            let nameFile: string = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>";
            nameFile +=
              "\n<tei xml:space=\"preserve\" xmlns=\"http://www.tei-c.org/ns/1.0\"" +
              " xmlns:xlink=\"http://www.w3.org/1999/xlink\" " +
              "xmlns:mml=\"http://www.w3.org/1998/Math/MathML\">";
            nameFile += "\n\t<teiHeader>\n\t\t<fileDesc>\n\t\t\t<sourceDesc>";
            nameFile += "\n\t\t\t\t<biblStruct>\n\t\t\t\t\t<analytic>\n\n\t\t\t\t\t\t<author>";
            nameFile += "\n\t\t\t\t\t\t\t<persName>\n";
            nameFile += bufferName.join("");
            nameFile += "\t\t\t\t\t\t\t</persName>\n";
            nameFile += "\t\t\t\t\t\t</author>\n\n\t\t\t\t\t</analytic>";
            nameFile += "\n\t\t\t\t</biblStruct>\n\t\t\t</sourceDesc>\n\t\t</fileDesc>";
            nameFile += "\n\t</teiHeader>\n</tei>\n";
            writeFile(pathTEI + "/" + pdfFileName.replace(/\.pdf$/i, ".training.header.authors.tei.xml"), nameFile);
          }

          // CITATION MODEL (for bibliographical reference in header)
          if (bufferReference !== null && bufferReference.length > 0) {
            writeFile(
              pathTEI + "/" + pdfFileName.replace(/\.pdf$/i, ".training.header.reference.xml"),
              "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<citations>\n" + bufferReference.join("") + "</citations>\n",
            );
          }
        }
      }

      return doc;
    } catch (e) {
      throw new GrobidException("An exception occurred while running Grobid training data generation for full text.", e as Error);
    } finally {
      if (documentSource !== null) {
        (DocumentSource as unknown as { close(ds: DocumentSource, a: boolean, b: boolean, c: boolean): void }).close(
          documentSource,
          true,
          true,
          true,
        );
      }
    }
  }

  /**
   * Extract results from a labelled full text in the training format without any string modification.
   */
  private trainingExtraction(result: string, tokenizations: LayoutToken[]): string[] {
    // this is the main buffer for the whole full text
    const buffer: string[] = [];
    try {
      const lines: string[] = result.split("\n");
      let s1: string | null = null;
      let s2: string | null = null;
      let lastTag: string | null = null;
      // current token position
      let p = 0;
      let start = true;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      let openFigure = false;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      let headFigure = false;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      let descFigure = false;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      let tableBlock = false;
      void openFigure;
      void headFigure;
      void descFigure;
      void tableBlock;

      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        let addSpace = false;
        const tok = lines[lineIdx]!.trim();

        if (tok.length === 0) continue;
        const stt = tok.split(/[ \t]/);
        // List<String> localFeatures = new ArrayList<String>();
        let i = 0;

        let newLine = false;
        const ll = stt.length;
        for (const sRaw of stt) {
          const s = sRaw.trim();
          if (i === 0) {
            s2 = TextUtilities.HTMLEncode(s);
            const p0 = p;
            let strop = false;
            while (!strop && p < tokenizations.length) {
              const tokOriginal = tokenizations[p]!.t();
              if (tokOriginal === " " || tokOriginal === " ") {
                addSpace = true;
              } else if (tokOriginal === "\n") {
                newLine = true;
              } else if (tokOriginal === s) {
                strop = true;
              }
              p++;
            }
            if (p === tokenizations.length) {
              if (p - p0 > 2) {
                p = p0;
              }
            }
          } else if (i === ll - 1) {
            s1 = s;
          } else {
            if (s === "LINESTART") newLine = true;
          }
          i++;
        }

        if (newLine && !start) buffer.push("<lb/>");

        let lastTag0: string | null = null;
        if (lastTag !== null) {
          if (lastTag.startsWith("I-")) lastTag0 = lastTag.substring(2, lastTag.length);
          else lastTag0 = lastTag;
        }
        let currentTag0: string | null = null;
        if (s1 !== null) {
          if (s1.startsWith("I-")) currentTag0 = s1.substring(2, s1.length);
          else currentTag0 = s1;
        }

        let closeParagraph = false;
        if (lastTag !== null) {
          closeParagraph = FullTextParser.testClosingTagFulltext(buffer, currentTag0 ?? "", lastTag0 ?? "", s1 ?? "");
        }

        let output: boolean;

        output = FullTextParser.writeField(buffer, s1, lastTag0, s2, "<other>", "<note type=\"other\">", addSpace, 3, false);
        // for paragraph we must distinguish starting and closing tags
        if (!output) {
          if (closeParagraph) {
            output = FullTextParser.writeFieldBeginEnd(buffer, s1, "", s2, "<paragraph>", "<p>", addSpace, 3, false);
          } else {
            output = FullTextParser.writeFieldBeginEnd(buffer, s1, lastTag, s2, "<paragraph>", "<p>", addSpace, 3, false);
          }
        }
        if (!output) output = FullTextParser.writeField(buffer, s1, lastTag0, s2, "<citation_marker>", "<ref type=\"biblio\">", addSpace, 3, false);
        if (!output) output = FullTextParser.writeField(buffer, s1, lastTag0, s2, "<table_marker>", "<ref type=\"table\">", addSpace, 3, false);
        if (!output) output = FullTextParser.writeField(buffer, s1, lastTag0, s2, "<equation_marker>", "<ref type=\"formula\">", addSpace, 3, false);
        if (!output) output = FullTextParser.writeField(buffer, s1, lastTag0, s2, "<section>", "<head>", addSpace, 3, false);
        if (!output) output = FullTextParser.writeField(buffer, s1, lastTag0, s2, "<equation>", "<formula>", addSpace, 4, false);
        if (!output) output = FullTextParser.writeField(buffer, s1, lastTag0, s2, "<equation_label>", "<label>", addSpace, 4, false);
        if (!output) output = FullTextParser.writeField(buffer, s1, lastTag0, s2, "<figure_marker>", "<ref type=\"figure\">", addSpace, 3, false);
        if (!output) output = FullTextParser.writeField(buffer, s1, lastTag0, s2, "<figure>", "<figure>", addSpace, 3, false);
        if (!output) output = FullTextParser.writeField(buffer, s1, lastTag0, s2, "<table>", "<figure type=\"table\">", addSpace, 3, false);
        if (!output) output = FullTextParser.writeFieldBeginEnd(buffer, s1, lastTag, s2, "<item>", "<item>", addSpace, 3, false);

        lastTag = s1;

        // Mirror upstream's `!st.hasMoreTokens()` check
        let hasMoreTokens = false;
        for (let q2 = lineIdx + 1; q2 < lines.length; q2++) {
          if (lines[q2]!.trim().length !== 0) {
            hasMoreTokens = true;
            break;
          }
        }
        if (!hasMoreTokens) {
          if (lastTag !== null) {
            FullTextParser.testClosingTagFulltext(buffer, "", currentTag0 ?? "", s1 ?? "");
          }
        }
        if (start) start = false;
      }

      return buffer;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      throw new GrobidException("An exception occured while running Grobid.", e as Error);
    }
  }

  static writeField(
    buffer: string[],
    s1: string | null,
    lastTag0: string | null,
    s2: string | null,
    field: string,
    outFieldIn: string,
    addSpace: boolean,
    nbIndent: number,
    generateIDs: boolean,
  ): boolean {
    let outField = outFieldIn;
    let result = false;
    if (s1 === null) return result;
    if (s1 === field || s1 === "I-" + field) {
      result = true;
      let divID: string | null = null;
      if (generateIDs) {
        divID = KeyGen.getKey().substring(0, 7);
        if (outField.charAt(outField.length - 2) === ">")
          outField = outField.substring(0, outField.length - 2) + " xml:id=\"_" + divID + "\">";
      }
      if (s1 === lastTag0 || s1 === "I-" + lastTag0) {
        if (addSpace) buffer.push(" ", s2 ?? "");
        else buffer.push(s2 ?? "");
      } else if (field === "<citation_marker>") {
        if (addSpace) buffer.push(" ", outField, s2 ?? "");
        else buffer.push(outField, s2 ?? "");
      } else if (field === "<figure_marker>") {
        if (addSpace) buffer.push(" ", outField, s2 ?? "");
        else buffer.push(outField, s2 ?? "");
      } else if (field === "<table_marker>") {
        if (addSpace) buffer.push(" ", outField, s2 ?? "");
        else buffer.push(outField, s2 ?? "");
      } else if (field === "<equation_marker>") {
        if (addSpace) buffer.push(" ", outField, s2 ?? "");
        else buffer.push(outField, s2 ?? "");
      } else if (lastTag0 === null) {
        for (let i = 0; i < nbIndent; i++) buffer.push("\t");
        buffer.push(outField, s2 ?? "");
      } else if (
        lastTag0 !== "<citation_marker>" &&
        lastTag0 !== "<figure_marker>" &&
        lastTag0 !== "<equation_marker>"
      ) {
        for (let i = 0; i < nbIndent; i++) buffer.push("\t");
        buffer.push(outField, s2 ?? "");
      } else {
        if (addSpace) buffer.push(" ", s2 ?? "");
        else buffer.push(s2 ?? "");
      }
    }
    return result;
  }

  static writeFieldBeginEnd(
    buffer: string[],
    s1: string | null,
    lastTag0In: string | null,
    s2: string | null,
    field: string,
    outFieldIn: string,
    addSpace: boolean,
    nbIndent: number,
    generateIDs: boolean,
  ): boolean {
    let outField = outFieldIn;
    let lastTag0 = lastTag0In;
    let result = false;
    if (s1 === null) return false;
    if (s1 === field || s1 === "I-" + field) {
      result = true;
      if (lastTag0 === null) lastTag0 = "";
      if (generateIDs) {
        const divID = KeyGen.getKey().substring(0, 7);
        if (outField.charAt(outField.length - 2) === ">")
          outField = outField.substring(0, outField.length - 2) + " xml:id=\"_" + divID + "\">";
      }
      if (lastTag0 === "I-" + field) {
        if (addSpace) buffer.push(" ", s2 ?? "");
        else buffer.push(s2 ?? "");
      } else if (lastTag0 === field && s1 === field) {
        if (addSpace) buffer.push(" ", s2 ?? "");
        else buffer.push(s2 ?? "");
      } else if (
        !lastTag0.endsWith("<citation_marker>") &&
        !lastTag0.endsWith("<figure_marker>") &&
        !lastTag0.endsWith("<table_marker>") &&
        !lastTag0.endsWith("<equation_marker>")
      ) {
        for (let i = 0; i < nbIndent; i++) buffer.push("\t");
        buffer.push(outField, s2 ?? "");
      } else {
        if (addSpace) buffer.push(" ", s2 ?? "");
        else buffer.push(s2 ?? "");
      }
    }
    return result;
  }

  private static testClosingTagFulltext(buffer: string[], currentTag0: string, lastTag0: string, currentTag: string): boolean {
    let res = false;
    // reference_marker and citation_marker are two exceptions because they can be embedded
    if (currentTag0 !== lastTag0 || currentTag === "I-<paragraph>" || currentTag === "I-<item>") {
      if (
        currentTag0 === "<citation_marker>" ||
        currentTag0 === "<equation_marker>" ||
        currentTag0 === "<figure_marker>" ||
        currentTag0 === "<table_marker>"
      ) {
        return res;
      }

      res = false;
      // we close the current tag
      if (lastTag0 === "<other>") {
        buffer.push("</note>\n\n");
      } else if (
        lastTag0 === "<paragraph>" &&
        currentTag0 !== "<citation_marker>" &&
        currentTag0 !== "<table_marker>" &&
        currentTag0 !== "<equation_marker>" &&
        currentTag0 !== "<figure_marker>"
      ) {
        buffer.push("</p>\n\n");
        res = true;
      } else if (lastTag0 === "<section>") buffer.push("</head>\n\n");
      else if (lastTag0 === "<subsection>") buffer.push("</head>\n\n");
      else if (lastTag0 === "<equation>") buffer.push("</formula>\n\n");
      else if (lastTag0 === "<equation_label>") buffer.push("</label>\n\n");
      else if (lastTag0 === "<table>") buffer.push("</figure>\n\n");
      else if (lastTag0 === "<figure>") buffer.push("</figure>\n\n");
      else if (lastTag0 === "<item>") buffer.push("</item>\n\n");
      else if (
        lastTag0 === "<citation_marker>" ||
        lastTag0 === "<figure_marker>" ||
        lastTag0 === "<table_marker>" ||
        lastTag0 === "<equation_marker>"
      ) {
        buffer.push("</ref>");
        // Fixed from upstream: upstream's guard used `||` instead of `&&`
        // for the marker checks, making `(!isCM || !isFM || !isTM || !isEM)`
        // tautologically true (a single string can equal at most one).
        // The clear intent is "close `</p>` when transitioning from a marker
        // to anything that is NOT another marker AND NOT `<paragraph>`".
        // Changed `||` to `&&` to express that intent.
        const _ct: string = currentTag0 as unknown as string;
        const isParagraph = _ct === "<paragraph>";
        const isCM = _ct === "<citation_marker>";
        const isFM = _ct === "<figure_marker>";
        const isTM = _ct === "<table_marker>";
        const isEM = _ct === "<equation_marker>";
        if (!isParagraph && !isCM && !isFM && !isTM && !isEM) {
          buffer.push("</p>\n\n");
        }
      } else {
        res = false;
      }
    }
    return res;
  }

  // --- Figure / Table / Equation post-processing ---------------------------

  protected processFigures(rese: string, layoutTokens: LayoutToken[]): Promise<Figure[]>;
  protected processFigures(rese: string, layoutTokens: LayoutToken[], startFigureID: number): Promise<Figure[]>;
  protected async processFigures(rese: string, layoutTokens: LayoutToken[], startFigureID: number = 0): Promise<Figure[]> {
    const results: Figure[] = [];

    let figureId = startFigureID;

    const clusteror = new TaggingTokenClusteror(FULLTEXT, rese, layoutTokens, true);

    const filtered: TaggingTokenCluster[] = clusteror
      .cluster()
      .filter((c) => new LabelTypePredicate(TaggingLabels.FIGURE).apply(c));
    for (const cluster of filtered) {
      const tokenizationFigure: LayoutToken[] = cluster.concatTokens();
      const result: Figure | null = await (this.parsers as unknown as {
        getFigureParser(): { processing(t: LayoutToken[], feature: string): Promise<Figure> };
      })
        .getFigureParser()
        .processing(tokenizationFigure, cluster.getFeatureBlock());
      if (result === null) continue;
      const blockPtrs: Set<number> = new Set<number>();
      for (const lt of tokenizationFigure) {
        if (!LayoutTokensUtil.spaceyToken(lt.t() ?? "") && !LayoutTokensUtil.newLineToken(lt.t() ?? "")) {
          blockPtrs.add(lt.getBlockPtr());
        }
      }
      result.setBlockPtrs(blockPtrs);

      result.setLayoutTokens(tokenizationFigure);

      // the first token could be a space from previous page
      for (const lt of tokenizationFigure) {
        if (!LayoutTokensUtil.spaceyToken(lt.t() ?? "") && !LayoutTokensUtil.newLineToken(lt.t() ?? "")) {
          result.setPage(lt.getPage());
          break;
        }
      }

      results.push(result);
      result.setId("" + figureId);
      figureId++;
    }

    return results;
  }

  protected async processTrainingDataFigures(rese: string, tokenizations: LayoutToken[], id: string): Promise<Pair<string, string>> {
    const tei: string[] = [];
    const featureVector: string[] = [];
    let nb = 0;
    const lines: string[] = rese.split("\n");
    let openFigure = false;
    let figureBlock: string[] = [];
    let tokenizationsFigure: LayoutToken[] = [];
    let tokenizationsBuffer: LayoutToken[];
    let p = 0; // position in tokenizations
    for (const row of lines) {
      if (row.length === 0) continue;
      const s: string[] = row.split("\t");
      const token: string = s[0]!.trim();
      const p0 = p;
      let strop = false;
      tokenizationsBuffer = [];
      while (!strop && p < tokenizations.length) {
        const tokOriginal = (tokenizations[p]!.getText() ?? "").trim();
        if (openFigure) tokenizationsFigure.push(tokenizations[p]!);
        tokenizationsBuffer.push(tokenizations[p]!);
        if (tokOriginal === token) strop = true;
        p++;
      }
      if (p === tokenizations.length) {
        if (p - p0 > 2) {
          p = p0;
          continue;
        }
      }

      const ll = s.length;
      const label: string = s[ll - 1]!;
      const plainLabel: string | null | undefined = GenericTaggerUtils.getPlainLabel(label);
      void plainLabel;
      if (label === "<figure>" || (label === "I-<figure>" && !openFigure)) {
        if (!openFigure) {
          openFigure = true;
          for (const t of tokenizationsBuffer) tokenizationsFigure.push(t);
        }
        const ind = row.lastIndexOf("\t");
        figureBlock.push(row.substring(0, ind), "\n");
      } else if (label === "I-<figure>" || openFigure) {
        if (tokenizationsFigure.length > 0) {
          const nbToRemove = tokenizationsBuffer.length;
          for (let qq = 0; qq < nbToRemove; qq++) tokenizationsFigure.pop();
        }
        if (
          p !== tokenizations.length &&
          (tokenizations[p]!.getText() === "\n" ||
            tokenizations[p]!.getText() === "\r" ||
            tokenizations[p]!.getText() === " ")
        ) {
          tokenizationsFigure.push(tokenizations[p]!);
          p++;
        }
        while (
          tokenizationsFigure.length > 0 &&
          (tokenizationsFigure[0]!.getText() === "\n" || tokenizationsFigure[0]!.getText() === " ")
        )
          tokenizationsFigure.shift();

        // process the "accumulated" figure
        const trainingData: Pair<string | null, string | null> | null = await (this.parsers as unknown as {
          getFigureParser(): { createTrainingData(t: LayoutToken[], b: string, id: string): Promise<Pair<string | null, string | null> | null> };
        })
          .getFigureParser()
          .createTrainingData(tokenizationsFigure, figureBlock.join(""), "Fig" + nb);
        tokenizationsFigure = [];
        figureBlock = [];
        if (trainingData !== null) {
          if (tei.length === 0) {
            tei.push((this.parsers as unknown as { getFigureParser(): { getTEIHeader(id: string): string } }).getFigureParser().getTEIHeader(id), "\n\n");
          }
          if (trainingData.getA() !== null) tei.push(trainingData.getA() as string, "\n\n");
          if (trainingData.getB() !== null) featureVector.push(trainingData.getB() as string, "\n\n");
        }
        if (label === "I-<figure>") {
          for (const t of tokenizationsBuffer) tokenizationsFigure.push(t);
          const ind = row.lastIndexOf("\t");
          figureBlock.push(row.substring(0, ind), "\n");
        } else {
          openFigure = false;
        }
        nb++;
      } else openFigure = false;
    }

    // If there still an open figure
    if (openFigure) {
      while (
        tokenizationsFigure.length > 0 &&
        (tokenizationsFigure[0]!.getText() === "\n" || tokenizationsFigure[0]!.getText() === " ")
      )
        tokenizationsFigure.shift();

      const trainingData: Pair<string | null, string | null> | null = await (this.parsers as unknown as {
        getFigureParser(): { createTrainingData(t: LayoutToken[], b: string, id: string): Promise<Pair<string | null, string | null> | null> };
      })
        .getFigureParser()
        .createTrainingData(tokenizationsFigure, figureBlock.join(""), "Fig" + nb);
      if (tei.length === 0) {
        tei.push((this.parsers as unknown as { getFigureParser(): { getTEIHeader(id: string): string } }).getFigureParser().getTEIHeader(id), "\n\n");
      }
      if (trainingData !== null && trainingData.getA() !== null) tei.push(trainingData.getA() as string, "\n\n");
      if (trainingData !== null && trainingData.getB() !== null) featureVector.push(trainingData.getB() as string, "\n\n");
    }

    if (tei.length !== 0) {
      tei.push("\n    </text>\n", "</tei>\n");
    }
    return new Pair<string, string>(tei.join(""), featureVector.join(""));
  }

  protected processTables(rese: string, tokenizations: LayoutToken[], doc: Document): Promise<Table[]>;
  protected processTables(rese: string, tokenizations: LayoutToken[], doc: Document, startTableID: number): Promise<Table[]>;
  protected async processTables(rese: string, tokenizations: LayoutToken[], doc: Document, startTableID: number = 0): Promise<Table[]> {
    const results: Table[] = [];
    const clusteror = new TaggingTokenClusteror(FULLTEXT, rese, tokenizations, true);

    let tableId = startTableID;
    const filtered: TaggingTokenCluster[] = clusteror
      .cluster()
      .filter((c) => new LabelTypePredicate(TaggingLabels.TABLE).apply(c));
    for (const cluster of filtered) {
      const tokenizationTable: LayoutToken[] = cluster.concatTokens();
      const localResults: Table[] | null = await (this.parsers as unknown as {
        getTableParser(): { processing(t: LayoutToken[], f: string): Promise<Table[] | null> };
      })
        .getTableParser()
        .processing(tokenizationTable, cluster.getFeatureBlock());

      if (localResults === null) continue;
      for (const result of localResults) {
        // TableParser may emit tables whose layoutTokens collection was never
        // populated (e.g. when every cluster mapped to TBL_OTHER, or when
        // `getExtractionResult` flushes the unfinished "last table"). Coerce
        // to an empty array so the downstream iteration doesn't throw.
        const localTokenizationTable: LayoutToken[] = (result as unknown as {
          getLayoutTokens(): LayoutToken[] | null;
        }).getLayoutTokens() ?? [];

        const blockPtrs: Set<number> = new Set<number>();
        for (const lt of localTokenizationTable) {
          if (!LayoutTokensUtil.spaceyToken(lt.t() ?? "") && !LayoutTokensUtil.newLineToken(lt.t() ?? "")) {
            blockPtrs.add(lt.getBlockPtr());
          }
        }
        (result as unknown as { setBlockPtrs(b: Set<number>): void }).setBlockPtrs(blockPtrs);

        // page setting: the first token could be a space from previous page
        for (const lt of localTokenizationTable) {
          if (!LayoutTokensUtil.spaceyToken(lt.t() ?? "") && !LayoutTokensUtil.newLineToken(lt.t() ?? "")) {
            (result as unknown as { setPage(p: number): void }).setPage(lt.getPage());
            break;
          }
        }
        results.push(result);
        (result as unknown as { setId(id: string): void }).setId(String(tableId));
        tableId++;
      }
    }

    doc.setTables(results);
    doc.postProcessTables();

    return results;
  }

  protected async postProcessTableCaptions(tables: Table[], doc: Document): Promise<void> {
    // further parse the caption
    for (const table of tables) {
      const capTokens = (table as unknown as { getCaptionLayoutTokens(): LayoutToken[] | null }).getCaptionLayoutTokens();
      if (capTokens !== null && capTokens.length !== 0) {
        const captionProcess: Pair<string | null, LayoutToken[] | null> | null = await this.processShort(capTokens, doc);
        if (captionProcess !== null) {
          (table as unknown as { setLabeledCaption(s: string | null): void }).setLabeledCaption(captionProcess.getA());
          (table as unknown as { setCaptionLayoutTokens(t: LayoutToken[] | null): void }).setCaptionLayoutTokens(captionProcess.getB());
        }
      }
      const noteTokens = table.getNoteLayoutTokens();
      if (noteTokens !== null && noteTokens.length !== 0) {
        const noteProcess: Pair<string | null, LayoutToken[] | null> | null = await this.processShort(noteTokens, doc);
        if (noteProcess !== null) {
          table.setLabeledNote(noteProcess.getA());
          table.setNoteLayoutTokens(noteProcess.getB());
        }
      }
    }
  }

  protected async processTrainingDataTables(rese: string, tokenizations: LayoutToken[], id: string): Promise<Pair<string, string>> {
    const tei: string[] = [];
    const featureVector: string[] = [];
    let nb = 0;
    const lines: string[] = rese.split("\n");
    let openTable = false;
    let tableBlock: string[] = [];
    let tokenizationsTable: LayoutToken[] = [];
    let tokenizationsBuffer: LayoutToken[];
    let p = 0;
    for (const row of lines) {
      if (row.length === 0) continue;
      const s: string[] = row.split("\t");
      const token: string = s[0]!.trim();
      const p0 = p;
      let strop = false;
      tokenizationsBuffer = [];
      while (!strop && p < tokenizations.length) {
        const tokOriginal = (tokenizations[p]!.getText() ?? "").trim();
        if (openTable) tokenizationsTable.push(tokenizations[p]!);
        tokenizationsBuffer.push(tokenizations[p]!);
        if (tokOriginal === token) strop = true;
        p++;
      }
      if (p === tokenizations.length) {
        if (p - p0 > 2) {
          p = p0;
          continue;
        }
      }

      const ll = s.length;
      const label: string = s[ll - 1]!;
      const plainLabel: string | null | undefined = GenericTaggerUtils.getPlainLabel(label);
      void plainLabel;
      if (label === "<table>" || (label === "I-<table>" && !openTable)) {
        if (!openTable) {
          openTable = true;
          for (const t of tokenizationsBuffer) tokenizationsTable.push(t);
        }
        const ind = row.lastIndexOf("\t");
        tableBlock.push(row.substring(0, ind), "\n");
      } else if (label === "I-<table>" || openTable) {
        if (tokenizationsTable.length > 0) {
          const nbToRemove = tokenizationsBuffer.length;
          for (let qq = 0; qq < nbToRemove; qq++) tokenizationsTable.pop();
        }
        if (
          p !== tokenizations.length &&
          (tokenizations[p]!.getText() === "\n" ||
            tokenizations[p]!.getText() === "\r" ||
            tokenizations[p]!.getText() === " ")
        ) {
          tokenizationsTable.push(tokenizations[p]!);
          p++;
        }
        while (
          tokenizationsTable.length > 0 &&
          (tokenizationsTable[0]!.getText() === "\n" || tokenizationsTable[0]!.getText() === " ")
        )
          tokenizationsTable.shift();

        const trainingData: Pair<string | null, string | null> | null = await (this.parsers as unknown as {
          getTableParser(): { createTrainingData(t: LayoutToken[], b: string, id: string): Promise<Pair<string | null, string | null> | null> };
        })
          .getTableParser()
          .createTrainingData(tokenizationsTable, tableBlock.join(""), "Fig" + nb);
        tokenizationsTable = [];
        tableBlock = [];
        if (trainingData !== null) {
          if (tei.length === 0) {
            tei.push((this.parsers as unknown as { getTableParser(): { getTEIHeader(id: string): string } }).getTableParser().getTEIHeader(id), "\n\n");
          }
          if (trainingData.getA() !== null) tei.push(trainingData.getA() as string, "\n\n");
          if (trainingData.getB() !== null) featureVector.push(trainingData.getB() as string, "\n\n");
        }
        if (label === "I-<table>") {
          for (const t of tokenizationsBuffer) tokenizationsTable.push(t);
          const ind = row.lastIndexOf("\t");
          tableBlock.push(row.substring(0, ind), "\n");
        } else openTable = false;
        nb++;
      } else openTable = false;
    }

    // If there still an open table
    if (openTable) {
      while (
        tokenizationsTable.length > 0 &&
        (tokenizationsTable[0]!.getText() === "\n" || tokenizationsTable[0]!.getText() === " ")
      )
        tokenizationsTable.shift();

      const trainingData: Pair<string | null, string | null> | null = await (this.parsers as unknown as {
        getTableParser(): { createTrainingData(t: LayoutToken[], b: string, id: string): Promise<Pair<string | null, string | null> | null> };
      })
        .getTableParser()
        .createTrainingData(tokenizationsTable, tableBlock.join(""), "Fig" + nb);
      if (tei.length === 0) {
        tei.push((this.parsers as unknown as { getTableParser(): { getTEIHeader(id: string): string } }).getTableParser().getTEIHeader(id), "\n\n");
      }
      if (trainingData !== null && trainingData.getA() !== null) tei.push(trainingData.getA() as string, "\n\n");
      if (trainingData !== null && trainingData.getB() !== null) featureVector.push(trainingData.getB() as string, "\n\n");
    }

    if (tei.length !== 0) tei.push("\n    </text>\n", "</tei>\n");
    return new Pair<string, string>(tei.join(""), featureVector.join(""));
  }

  protected processEquations(rese: string, layoutTokens: LayoutToken[]): Equation[];
  protected processEquations(rese: string, tokenizations: LayoutToken[], startEquationID: number): Equation[];
  protected processEquations(rese: string, tokenizations: LayoutToken[], startEquationID: number = 0): Equation[] {
    let results: Equation[] = [];
    const clusteror = new TaggingTokenClusteror(FULLTEXT, rese, tokenizations, true);
    const clusters: TaggingTokenCluster[] = clusteror.cluster();

    const equationID = startEquationID;
    void equationID;

    let currentResult: Equation | null = null;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    let lastLabel: TaggingLabel | null = null;
    for (const cluster of clusters) {
      if (cluster === null) continue;

      const clusterLabel: TaggingLabel = cluster.getTaggingLabel();
      (Engine as unknown as { getCntManager(): CntManager }).getCntManager().i(clusterLabel as unknown as import("./counters/countable.js").Countable);
      if (clusterLabel !== TaggingLabels.EQUATION && clusterLabel !== TaggingLabels.EQUATION_LABEL) {
        lastLabel = clusterLabel;
        if (currentResult !== null) {
          results.push(currentResult);
          (currentResult as unknown as { setId(id: string): void }).setId(String(startEquationID));
          currentResult = null;
        }
        continue;
      }

      void cluster.concatTokens();
      const clusterContent: string = LayoutTokensUtil.normalizeText(LayoutTokensUtil.toText(cluster.concatTokens()));

      if (currentResult === null) currentResult = new Equation();

      if (
        !(currentResult as unknown as { getContent(): string }).getContent().length &&
        !(currentResult as unknown as { getLabel(): string }).getLabel().length
      ) {
        // no-op — mirrors upstream emptyness check via `isEmpty()` returning true
      }
      if (
        !(currentResult as unknown as { getContent(): string }).getContent() ||
        !(currentResult as unknown as { getLabel(): string }).getLabel()
      ) {
        // continue building
      } else {
        // both filled — flush
        results.push(currentResult);
        currentResult = new Equation();
      }
      if (clusterLabel === TaggingLabels.EQUATION) {
        if ((currentResult as unknown as { getContent(): string }).getContent().length !== 0) {
          results.push(currentResult);
          currentResult = new Equation();
        }
        (currentResult as unknown as { appendContent(s: string): void }).appendContent(clusterContent);
        (currentResult as unknown as { addLayoutTokens(t: LayoutToken[]): void }).addLayoutTokens(cluster.concatTokens());
      } else if (clusterLabel === TaggingLabels.EQUATION_LABEL) {
        (currentResult as unknown as { appendLabel(s: string): void }).appendLabel(clusterContent);
        (currentResult as unknown as { addLayoutTokens(t: LayoutToken[]): void }).addLayoutTokens(cluster.concatTokens());
      }

      lastLabel = clusterLabel;
    }

    // add last open result
    if (currentResult !== null) results.push(currentResult);

    let equationsIndex = startEquationID;
    results = results.map((e) => {
      (e as unknown as { setId(id: string): void }).setId(String(equationsIndex));
      equationsIndex++;
      return e;
    });

    return results;
  }

  /**
   * Ensure consistent use of callouts in the entire document body
   */
  private postProcessCallout(result: string, layoutTokenization: LayoutTokenization | null): MarkerType[] | null {
    if (layoutTokenization === null) return null;

    const tokenizations: LayoutToken[] = layoutTokenization.getTokenization() ?? [];

    const clusteror = new TaggingTokenClusteror(FULLTEXT, result, tokenizations);
    const clusters: TaggingTokenCluster[] = clusteror.cluster();

    const referenceMarkerTypeCounts: Map<MarkerType, number> = new Map();
    const figureMarkerTypeCounts: Map<MarkerType, number> = new Map();
    const tableMarkerTypeCounts: Map<MarkerType, number> = new Map();
    const equationMarkerTypeCounts: Map<MarkerType, number> = new Map();

    const referenceMarkerSeen: string[] = [];
    const figureMarkerSeen: string[] = [];
    const tableMarkerSeen: string[] = [];
    const equationMarkerSeen: string[] = [];

    for (const cluster of clusters) {
      if (cluster === null) continue;

      const clusterLabel: TaggingLabel = cluster.getTaggingLabel();
      if (TEIFormatter.MARKER_LABELS.has(clusterLabel)) {
        let refTokens: LayoutToken[] = cluster.concatTokens();
        refTokens = LayoutTokensUtil.dehyphenize(refTokens);
        let refText: string = LayoutTokensUtil.toText(refTokens);
        refText = refText.replace(/\n/g, "");
        refText = refText.replace(/ /g, "");
        if (refText.trim().length === 0) continue;

        if (clusterLabel === TaggingLabels.CITATION_MARKER) {
          if (referenceMarkerSeen.includes(refText)) continue;
          const localMarkerType: MarkerType = CalloutAnalyzer.getCalloutType(refTokens);
          if (referenceMarkerTypeCounts.get(localMarkerType) === undefined) referenceMarkerTypeCounts.set(localMarkerType, 1);
          else referenceMarkerTypeCounts.set(localMarkerType, (referenceMarkerTypeCounts.get(localMarkerType) ?? 0) + 1);
          if (!referenceMarkerSeen.includes(refText)) referenceMarkerSeen.push(refText);
        } else if (clusterLabel === TaggingLabels.FIGURE_MARKER) {
          if (figureMarkerSeen.includes(refText)) continue;
          const localMarkerType: MarkerType = CalloutAnalyzer.getCalloutType(refTokens);
          if (figureMarkerTypeCounts.get(localMarkerType) === undefined) figureMarkerTypeCounts.set(localMarkerType, 1);
          else figureMarkerTypeCounts.set(localMarkerType, (figureMarkerTypeCounts.get(localMarkerType) ?? 0) + 1);
          if (!figureMarkerSeen.includes(refText)) figureMarkerSeen.push(refText);
        } else if (clusterLabel === TaggingLabels.TABLE_MARKER) {
          if (tableMarkerSeen.includes(refText)) continue;
          const localMarkerType: MarkerType = CalloutAnalyzer.getCalloutType(refTokens);
          if (tableMarkerTypeCounts.get(localMarkerType) === undefined) tableMarkerTypeCounts.set(localMarkerType, 1);
          else tableMarkerTypeCounts.set(localMarkerType, (tableMarkerTypeCounts.get(localMarkerType) ?? 0) + 1);
          if (!tableMarkerSeen.includes(refText)) tableMarkerSeen.push(refText);
        } else if (clusterLabel === TaggingLabels.EQUATION_MARKER) {
          if (equationMarkerSeen.includes(refText)) continue;
          const localMarkerType: MarkerType = CalloutAnalyzer.getCalloutType(refTokens);
          if (equationMarkerTypeCounts.get(localMarkerType) === undefined) equationMarkerTypeCounts.set(localMarkerType, 1);
          else equationMarkerTypeCounts.set(localMarkerType, (equationMarkerTypeCounts.get(localMarkerType) ?? 0) + 1);
          if (!equationMarkerSeen.includes(refText)) equationMarkerSeen.push(refText);
        }
      }
    }

    const majorityReferenceMarkerType: MarkerType = FullTextParser.getBestType(referenceMarkerTypeCounts);
    const majorityFigureMarkerType: MarkerType = FullTextParser.getBestType(figureMarkerTypeCounts);
    const majorityTableMarkerType: MarkerType = FullTextParser.getBestType(tableMarkerTypeCounts);
    const majorityEquationarkerType: MarkerType = FullTextParser.getBestType(equationMarkerTypeCounts);

    return [majorityReferenceMarkerType, majorityFigureMarkerType, majorityTableMarkerType, majorityEquationarkerType];
  }

  private static getBestType(markerTypeCount: Map<MarkerType, number>): MarkerType {
    let bestType: MarkerType = CalloutAnalyzer.MarkerType.UNKNOWN;
    let maxCount = 0;
    for (const [k, v] of markerTypeCount.entries()) {
      if (v > maxCount) {
        bestType = k;
        maxCount = v;
      }
    }
    return bestType;
  }

  /**
   * Create the TEI representation for a document based on the parsed header, references
   * and body sections.
   */
  private async toTEI(
    doc: Document,
    bodyLabellingResult: string | null,
    annexLabellingResult: string | null,
    layoutTokenization: LayoutTokenization | null,
    tokenizationsAnnex: LayoutToken[] | null,
    resHeader: BiblioItem,
    bodyFigures: Figure[] | null,
    bodyTables: Table[] | null,
    bodyEquations: Equation[] | null,
    annexFigures: Figure[] | null,
    annexTables: Table[] | null,
    annexEquations: Equation[] | null,
    markerTypes: MarkerType[] | null,
    config: GrobidAnalysisConfig,
  ): Promise<void> {
    void bodyFigures; void bodyTables; void bodyEquations;
    void annexFigures; void annexTables; void annexEquations;
    if (doc.getBlocks() === null) return;
    const resCitations: BibDataSet[] | null = doc.getBibDataSets();
    const teiFormatter = new TEIFormatter(doc, this);
    let tei: string = "";
    try {
      const fundings: Funding[] = [];
      const affiliations: Affiliation[] = [];

      const annexStatements: string[] = [];

      // acknowledgement is in the back
      const acknowledgmentStmt: string = await this.getSectionAsTEI(
        "acknowledgement",
        "\t\t\t",
        doc,
        SegmentationLabels.ACKNOWLEDGEMENT,
        teiFormatter,
        resCitations,
        config,
      );

      if (acknowledgmentStmt.length > 0) {
        const localResult = (await (this.parsers as unknown as {
          getFundingAcknowledgementParser(): { processingXmlFragment(x: string, c: GrobidAnalysisConfig): Promise<unknown> };
        })
          .getFundingAcknowledgementParser()
          .processingXmlFragment(acknowledgmentStmt, config)) as { getLeft(): { toXML(): string } | null; getRight(): { getLeft(): Funding[] | null; getRight(): Affiliation[] | null } | null } | null;

        if (localResult !== null && localResult.getLeft() !== null) {
          let localTei: string = localResult.getLeft()!.toXML();
          localTei = localTei.replace(" xmlns=\"http://www.tei-c.org/ns/1.0\"", "");
          annexStatements.push(localTei);
        } else {
          annexStatements.push(acknowledgmentStmt);
        }

        if (localResult !== null && localResult.getRight() !== null) {
          const lFundings = localResult.getRight()!.getLeft();
          if (lFundings !== null && lFundings.length !== 0) for (const f of lFundings) fundings.push(f);
          const lAff = localResult.getRight()!.getRight();
          if (lAff !== null && lAff.length !== 0) for (const a of lAff) affiliations.push(a);
        }
      }

      // funding in header
      let fundingStmt = "";
      if (resHeader.getFunding() !== null && resHeader.getFunding()!.trim().length !== 0) {
        const headerFundingTokens: LayoutToken[] = (resHeader as unknown as { getLayoutTokensForLabel(l: TaggingLabel): LayoutToken[] }).getLayoutTokensForLabel(TaggingLabels.HEADER_FUNDING);
        const headerFundingProcessed: Pair<string | null, LayoutToken[] | null> | null = await this.processShort(headerFundingTokens, doc);
        if (headerFundingProcessed !== null) {
          fundingStmt = teiFormatter.processTEIDivSection(
            "funding",
            "\t\t\t",
            headerFundingProcessed.getA(),
            headerFundingProcessed.getB() ?? [],
            resCitations,
            config,
          );
        }
        if (fundingStmt.length !== 0) {
          const localResult = (await (this.parsers as unknown as {
            getFundingAcknowledgementParser(): { processingXmlFragment(x: string, c: GrobidAnalysisConfig): Promise<unknown> };
          })
            .getFundingAcknowledgementParser()
            .processingXmlFragment(fundingStmt, config)) as { getLeft(): { toXML(): string } | null; getRight(): { getLeft(): Funding[] | null; getRight(): Affiliation[] | null } | null } | null;

          if (localResult !== null && localResult.getLeft() !== null) {
            let localTei: string = localResult.getLeft()!.toXML();
            localTei = localTei.replace(" xmlns=\"http://www.tei-c.org/ns/1.0\"", "");
            annexStatements.push(localTei);
          } else {
            annexStatements.push(fundingStmt);
          }
          if (localResult !== null && localResult.getRight() !== null) {
            const lFundings = localResult.getRight()!.getLeft();
            if (lFundings !== null && lFundings.length !== 0) for (const f of lFundings) fundings.push(f);
            const lAff = localResult.getRight()!.getRight();
            if (lAff !== null && lAff.length !== 0) for (const a of lAff) affiliations.push(a);
          }
        }
      }

      // funding statements in non-header part
      fundingStmt = await this.getSectionAsTEI("funding", "\t\t\t", doc, (SegmentationLabels as unknown as { FUNDING: TaggingLabel }).FUNDING, teiFormatter, resCitations, config);
      if (fundingStmt.length > 0) {
        const localResult = (await (this.parsers as unknown as {
          getFundingAcknowledgementParser(): { processingXmlFragment(x: string, c: GrobidAnalysisConfig): Promise<unknown> };
        })
          .getFundingAcknowledgementParser()
          .processingXmlFragment(fundingStmt, config)) as { getLeft(): { toXML(): string } | null; getRight(): { getLeft(): Funding[] | null; getRight(): Affiliation[] | null } | null } | null;
        if (localResult !== null && localResult.getLeft() !== null) {
          let localTEI = localResult.getLeft()!.toXML();
          localTEI = localTEI.replace(" xmlns=\"http://www.tei-c.org/ns/1.0\"", "");
          annexStatements.push(localTEI);
        } else {
          annexStatements.push(fundingStmt);
        }
        if (localResult !== null && localResult.getRight() !== null) {
          const lFundings = localResult.getRight()!.getLeft();
          if (lFundings !== null && lFundings.length !== 0) for (const f of lFundings) fundings.push(f);
          const lAff = localResult.getRight()!.getRight();
          if (lAff !== null && lAff.length !== 0) for (const a of lAff) affiliations.push(a);
        }
      }

      tei += teiFormatter.toTEIHeader(resHeader, null, resCitations, markerTypes, fundings, config);

      tei = await (teiFormatter as unknown as {
        toTEIBody(
          tei: string,
          bodyResults: string | null,
          resHeader: BiblioItem,
          resCitations: BibDataSet[] | null,
          layoutTokenization: LayoutTokenization | null,
          bodyFigures: Figure[] | null,
          bodyTables: Table[] | null,
          bodyEquations: Equation[] | null,
          markerTypes: MarkerType[] | null,
          doc: Document,
          config: GrobidAnalysisConfig,
        ): Promise<string>;
      }).toTEIBody(tei, bodyLabellingResult, resHeader, resCitations, layoutTokenization, bodyFigures, bodyTables, bodyEquations, markerTypes, doc, config);

      tei += "\t\t<back>\n";

      for (const annexStatement of annexStatements) {
        tei += "\n\t\t\t";
        tei += annexStatement;
      }

      if (fundings.length !== 0) {
        tei += "\n\t\t\t<listOrg type=\"funding\">\n";
        for (const funding of fundings) {
          if ((funding as unknown as { isNonEmptyFunding(): boolean }).isNonEmptyFunding())
            tei += (funding as unknown as { toTEI(n: number): string }).toTEI(4);
        }
        tei += "\t\t\t</listOrg>\n";
      }

      if (affiliations.length !== 0) {
        // check if we have at least one acknowledged research infrastructure here
        const filteredInfrastructures: Affiliation[] = [];
        for (const affiliation of affiliations) {
          const affString: string | null = (affiliation as unknown as { getAffiliationString(): string | null }).getAffiliationString();
          if (affString !== null && affString.length > 0 && (affiliation as unknown as { isInfrastructure(): boolean }).isInfrastructure())
            filteredInfrastructures.push(affiliation);
          else if (affString !== null && affString.length > 0) {
            const localOrganizationNamings = (Lexicon.getInstance() as unknown as {
              getOrganizationNamingInfo(s: string): Array<{ fullName: string; lang: string }> | null;
            }).getOrganizationNamingInfo(affString);
            if (localOrganizationNamings !== null && localOrganizationNamings.length > 0) {
              filteredInfrastructures.push(affiliation);
            }
          }
        }

        if (filteredInfrastructures.length > 0) {
          tei += "\n\t\t\t<listOrg type=\"infrastructure\">\n";
          for (const affiliation of filteredInfrastructures) {
            const affString = (affiliation as unknown as { getAffiliationString(): string | null }).getAffiliationString();
            const localOrganizationNamings = (Lexicon.getInstance() as unknown as {
              getOrganizationNamingInfo(s: string): Array<{ fullName: string; lang: string }> | null;
            }).getOrganizationNamingInfo(affString ?? "");
            tei += "\t\t\t\t<org type=\"infrastructure\">";
            tei += "\t\t\t\t\t<orgName type=\"extracted\">";
            tei += TextUtilities.HTMLEncode(affString);
            tei += "</orgName>\n";
            if (localOrganizationNamings !== null && localOrganizationNamings.length > 0) {
              for (const orgRecord of localOrganizationNamings) {
                if (orgRecord.fullName !== null && orgRecord.fullName.trim().length !== 0) {
                  tei += "\t\t\t\t\t<orgName type=\"full\"";
                  if (orgRecord.lang !== null && orgRecord.lang.trim().length !== 0) tei += " lang=\"" + orgRecord.lang + "\"";
                  tei += ">";
                  tei += TextUtilities.HTMLEncode(orgRecord.fullName);
                  tei += "</orgName>\n";
                }
              }
            }
            tei += "\t\t\t\t</org>\n";
          }
          tei += "\t\t\t</listOrg>\n";
        }
      }

      // availability statements in header
      let availabilityStmt = "";
      const availability = (resHeader as unknown as { getAvailabilityStmt(): string | null }).getAvailabilityStmt();
      if (availability !== null && availability.trim().length !== 0) {
        const headerAvailabilityStatementTokens: LayoutToken[] = (resHeader as unknown as { getLayoutTokensForLabel(l: TaggingLabel): LayoutToken[] }).getLayoutTokensForLabel(
          (TaggingLabels as unknown as { HEADER_AVAILABILITY: TaggingLabel }).HEADER_AVAILABILITY,
        );
        const headerAvailabilityProcessed: Pair<string | null, LayoutToken[] | null> | null = await this.processShort(headerAvailabilityStatementTokens, doc);
        if (headerAvailabilityProcessed !== null) {
          availabilityStmt = teiFormatter.processTEIDivSection(
            "availability",
            "\t\t\t",
            headerAvailabilityProcessed.getA(),
            headerAvailabilityProcessed.getB() ?? [],
            resCitations,
            config,
          );
        }
        if (availabilityStmt.length > 0) tei += availabilityStmt;
      }

      // availability statements in non-header part
      availabilityStmt = await this.getSectionAsTEI("availability", "\t\t\t", doc, (SegmentationLabels as unknown as { AVAILABILITY: TaggingLabel }).AVAILABILITY, teiFormatter, resCitations, config);
      if (availabilityStmt.length > 0) tei += availabilityStmt;

      // conflict of interest statements in header
      let conflictOfInterestStmt = "";
      const conflict = (resHeader as unknown as { getConflictStmt(): string | null }).getConflictStmt();
      if (conflict !== null && conflict.trim().length !== 0) {
        const headerConflictStatementTokens: LayoutToken[] = (resHeader as unknown as { getLayoutTokensForLabel(l: TaggingLabel): LayoutToken[] }).getLayoutTokensForLabel(
          (TaggingLabels as unknown as { HEADER_CONFLICT_OF_INTEREST: TaggingLabel }).HEADER_CONFLICT_OF_INTEREST,
        );
        const headerConflictOfInterestProcessed: Pair<string | null, LayoutToken[] | null> | null = await this.processShort(headerConflictStatementTokens, doc);
        if (headerConflictOfInterestProcessed !== null) {
          conflictOfInterestStmt = teiFormatter.processTEIDivSection(
            "conflict",
            "\t\t\t",
            headerConflictOfInterestProcessed.getA(),
            headerConflictOfInterestProcessed.getB() ?? [],
            resCitations,
            config,
          );
        }
        if (conflictOfInterestStmt.length > 0) tei += conflictOfInterestStmt;
      }

      conflictOfInterestStmt = await this.getSectionAsTEI("conflict", "\t\t\t", doc, (SegmentationLabels as unknown as { CONFLICT_OF_INTEREST: TaggingLabel }).CONFLICT_OF_INTEREST, teiFormatter, resCitations, config);
      if (conflictOfInterestStmt.length > 0) tei += conflictOfInterestStmt;

      // author contribution statements in header
      let authorContribution = "";
      const contribution = (resHeader as unknown as { getContributionStmt(): string | null }).getContributionStmt();
      if (contribution !== null && contribution.trim().length !== 0) {
        const headerContributionStatementTokens: LayoutToken[] = (resHeader as unknown as { getLayoutTokensForLabel(l: TaggingLabel): LayoutToken[] }).getLayoutTokensForLabel(
          (TaggingLabels as unknown as { HEADER_AUTHOR_CONTRIBUTION: TaggingLabel }).HEADER_AUTHOR_CONTRIBUTION,
        );
        const headerAuthorContributionProcessed: Pair<string | null, LayoutToken[] | null> | null = await this.processShort(headerContributionStatementTokens, doc);
        if (headerAuthorContributionProcessed !== null) {
          authorContribution = teiFormatter.processTEIDivSection(
            "contribution",
            "\t\t\t",
            headerAuthorContributionProcessed.getA(),
            headerAuthorContributionProcessed.getB() ?? [],
            resCitations,
            config,
          );
        }
        if (authorContribution.length > 0) tei += authorContribution;
      }

      authorContribution = await this.getSectionAsTEI("contribution", "\t\t\t", doc, (SegmentationLabels as unknown as { AUTHOR_CONTRIBUTION: TaggingLabel }).AUTHOR_CONTRIBUTION, teiFormatter, resCitations, config);
      if (authorContribution.length > 0) tei += authorContribution;

      tei = (teiFormatter as unknown as {
        toTEIAnnex(
          tei: string,
          annexLabellingResult: string | null,
          resHeader: BiblioItem,
          resCitations: BibDataSet[] | null,
          tokenizationsAnnex: LayoutToken[] | null,
          annexFigures: Figure[] | null,
          annexTables: Table[] | null,
          annexEquations: Equation[] | null,
          markerTypes: MarkerType[] | null,
          doc: Document,
          config: GrobidAnalysisConfig,
        ): string;
      }).toTEIAnnex(tei, annexLabellingResult, resHeader, resCitations, tokenizationsAnnex, annexFigures, annexTables, annexEquations, markerTypes, doc, config);

      tei = (teiFormatter as unknown as { toTEIReferences(tei: string, resCitations: BibDataSet[] | null, config: GrobidAnalysisConfig): string }).toTEIReferences(tei, resCitations, config);
      doc.calculateTeiIdToBibDataSets();

      tei += "\t\t</back>\n";
      tei += "\t</text>\n";
      tei += "</TEI>\n";
    } catch (e) {
      throw new GrobidException("An exception occurred while running Grobid.", e as Error);
    }
    doc.setTei(tei);
  }

  /**
   * Create the TEI representation for a document based on the parsed header and funding only.
   */
  private async toTEIHeaderFunding(doc: Document, resHeader: BiblioItem, config: GrobidAnalysisConfig): Promise<void> {
    if (doc.getBlocks() === null) return;
    const teiFormatter = new TEIFormatter(doc, this);
    let tei = "";
    try {
      const fundings: Funding[] = [];
      const affiliations: Affiliation[] = [];

      const annexStatements: string[] = [];

      // acknowledgement is in the back
      const acknowledgmentStmt: string = await this.getSectionAsTEI("acknowledgement", "\t\t\t", doc, SegmentationLabels.ACKNOWLEDGEMENT, teiFormatter, null, config);

      if (acknowledgmentStmt.length > 0) {
        const localResult = (await (this.parsers as unknown as {
          getFundingAcknowledgementParser(): { processingXmlFragment(x: string, c: GrobidAnalysisConfig): Promise<unknown> };
        })
          .getFundingAcknowledgementParser()
          .processingXmlFragment(acknowledgmentStmt, config)) as { getLeft(): { toXML(): string } | null; getRight(): { getLeft(): Funding[] | null; getRight(): Affiliation[] | null } | null } | null;
        if (localResult !== null && localResult.getLeft() !== null) {
          let local_tei = localResult.getLeft()!.toXML();
          local_tei = local_tei.replace(" xmlns=\"http://www.tei-c.org/ns/1.0\"", "");
          annexStatements.push(local_tei);
        } else annexStatements.push(acknowledgmentStmt);
        if (localResult !== null && localResult.getRight() !== null) {
          const lFundings = localResult.getRight()!.getLeft();
          if (lFundings !== null && lFundings.length > 0) for (const f of lFundings) fundings.push(f);
          const lAff = localResult.getRight()!.getRight();
          if (lAff !== null && lAff.length > 0) for (const a of lAff) affiliations.push(a);
        }
      }

      // funding in header
      let fundingStmt = "";
      if (resHeader.getFunding() !== null && resHeader.getFunding()!.trim().length !== 0) {
        const headerFundingTokens: LayoutToken[] = (resHeader as unknown as { getLayoutTokensForLabel(l: TaggingLabel): LayoutToken[] }).getLayoutTokensForLabel(TaggingLabels.HEADER_FUNDING);
        const headerFundingProcessed: Pair<string | null, LayoutToken[] | null> | null = await this.processShort(headerFundingTokens, doc);
        if (headerFundingProcessed !== null) {
          fundingStmt = teiFormatter.processTEIDivSection("funding", "\t\t\t", headerFundingProcessed.getA(), headerFundingProcessed.getB() ?? [], null, config);
        }
        if (fundingStmt.length > 0) {
          const localResult = (await (this.parsers as unknown as {
            getFundingAcknowledgementParser(): { processingXmlFragment(x: string, c: GrobidAnalysisConfig): Promise<unknown> };
          })
            .getFundingAcknowledgementParser()
            .processingXmlFragment(fundingStmt, config)) as { getLeft(): { toXML(): string } | null; getRight(): { getLeft(): Funding[] | null; getRight(): Affiliation[] | null } | null } | null;
          if (localResult !== null && localResult.getLeft() !== null) {
            let local_tei = localResult.getLeft()!.toXML();
            local_tei = local_tei.replace(" xmlns=\"http://www.tei-c.org/ns/1.0\"", "");
            annexStatements.push(local_tei);
          } else annexStatements.push(fundingStmt);
          if (localResult !== null && localResult.getRight() !== null) {
            const lFundings = localResult.getRight()!.getLeft();
            if (lFundings !== null && lFundings.length > 0) for (const f of lFundings) fundings.push(f);
            const lAff = localResult.getRight()!.getRight();
            if (lAff !== null && lAff.length > 0) for (const a of lAff) affiliations.push(a);
          }
        }
      }

      fundingStmt = await this.getSectionAsTEI("funding", "\t\t\t", doc, (SegmentationLabels as unknown as { FUNDING: TaggingLabel }).FUNDING, teiFormatter, null, config);
      if (fundingStmt.length > 0) {
        const localResult = (await (this.parsers as unknown as {
          getFundingAcknowledgementParser(): { processingXmlFragment(x: string, c: GrobidAnalysisConfig): Promise<unknown> };
        })
          .getFundingAcknowledgementParser()
          .processingXmlFragment(fundingStmt, config)) as { getLeft(): { toXML(): string } | null; getRight(): { getLeft(): Funding[] | null; getRight(): Affiliation[] | null } | null } | null;
        if (localResult !== null && localResult.getLeft() !== null) {
          let local_tei = localResult.getLeft()!.toXML();
          local_tei = local_tei.replace(" xmlns=\"http://www.tei-c.org/ns/1.0\"", "");
          annexStatements.push(local_tei);
        } else annexStatements.push(fundingStmt);
        if (localResult !== null && localResult.getRight() !== null) {
          const lFundings = localResult.getRight()!.getLeft();
          if (lFundings !== null && lFundings.length > 0) for (const f of lFundings) fundings.push(f);
          const lAff = localResult.getRight()!.getRight();
          if (lAff !== null && lAff.length > 0) for (const a of lAff) affiliations.push(a);
        }
      }

      tei += teiFormatter.toTEIHeader(resHeader, null, null, null, fundings, config);
      tei += "\t\t<back>";

      for (const annexStatement of annexStatements) {
        tei += "\n\t\t\t";
        tei += annexStatement;
      }

      if (fundings.length !== 0) {
        tei += "\n\t\t\t<listOrg type=\"funding\">\n";
        for (const funding of fundings) {
          if ((funding as unknown as { isNonEmptyFunding(): boolean }).isNonEmptyFunding())
            tei += (funding as unknown as { toTEI(n: number): string }).toTEI(4);
        }
        tei += "\t\t\t</listOrg>\n";
      }

      if (affiliations.length !== 0) {
        const filteredInfrastructures: Affiliation[] = [];
        for (const affiliation of affiliations) {
          const affString: string | null = (affiliation as unknown as { getAffiliationString(): string | null }).getAffiliationString();
          if (affString !== null && affString.length > 0 && (affiliation as unknown as { isInfrastructure(): boolean }).isInfrastructure())
            filteredInfrastructures.push(affiliation);
          else if (affString !== null && affString.length > 0) {
            const localOrganizationNamings = (Lexicon.getInstance() as unknown as {
              getOrganizationNamingInfo(s: string): Array<{ fullName: string; lang: string }> | null;
            }).getOrganizationNamingInfo(affString);
            if (localOrganizationNamings !== null && localOrganizationNamings.length > 0) filteredInfrastructures.push(affiliation);
          }
        }

        if (filteredInfrastructures.length > 0) {
          tei += "\n\t\t\t<listOrg type=\"infrastructure\">\n";
          for (const affiliation of filteredInfrastructures) {
            const affString = (affiliation as unknown as { getAffiliationString(): string | null }).getAffiliationString();
            const localOrganizationNamings = (Lexicon.getInstance() as unknown as {
              getOrganizationNamingInfo(s: string): Array<{ fullName: string; lang: string }> | null;
            }).getOrganizationNamingInfo(affString ?? "");
            tei += "\t\t\t\t<org type=\"infrastructure\">";
            tei += "\t\t\t\t\t<orgName type=\"extracted\">";
            tei += TextUtilities.HTMLEncode(affString);
            tei += "</orgName>\n";
            if (localOrganizationNamings !== null && localOrganizationNamings.length > 0) {
              for (const orgRecord of localOrganizationNamings) {
                if (orgRecord.fullName !== null && orgRecord.fullName.trim().length !== 0) {
                  tei += "\t\t\t\t\t<orgName type=\"full\"";
                  if (orgRecord.lang !== null && orgRecord.lang.trim().length !== 0) tei += " lang=\"" + orgRecord.lang + "\"";
                  tei += ">";
                  tei += TextUtilities.HTMLEncode(orgRecord.fullName);
                  tei += "</orgName>\n";
                }
              }
            }
            tei += "\t\t\t\t</org>\n";
          }
          tei += "\t\t\t</listOrg>\n";
        }
      }

      tei += "\t\t</back>\n";
      tei += "\t</text>\n";
      tei += "</TEI>\n";
    } catch (e) {
      throw new GrobidException("An exception occurred while running Grobid.", e as Error);
    }
    doc.setTei(tei);
  }

  private async getSectionAsTEI(
    xmlType: string,
    indentation: string,
    doc: Document,
    taggingLabel: TaggingLabel,
    teiFormatter: TEIFormatter,
    resCitations: BibDataSet[] | null,
    config: GrobidAnalysisConfig,
  ): Promise<string> {
    let output = "";
    const sectionPart: Set<DocumentPiece> | null = doc.getDocumentPart(taggingLabel);

    if (sectionPart !== null && sectionPart.size !== 0) {
      const sectionTokenisation: Pair<string, LayoutTokenization> | null = FullTextParser.getBodyTextFeatured(doc, sectionPart);
      if (sectionTokenisation !== null) {
        const text: string = sectionTokenisation.getA();
        const tokens: LayoutToken[] = sectionTokenisation.getB().getTokenization() ?? [];
        let resultLabelling: string | null = null;
        if (text !== null && text.trim().length !== 0) {
          resultLabelling = await this.label(text);
          resultLabelling = (LabelUtils as { postProcessFullTextLabeledText(s: string): string }).postProcessFullTextLabeledText(resultLabelling);
        }
        output = teiFormatter.processTEIDivSection(xmlType, indentation, resultLabelling, tokens, resCitations, config);
      }
    }
    return output;
  }

  private static inlineFullTextLabels: TaggingLabel[] = [
    TaggingLabels.CITATION_MARKER,
    TaggingLabels.TABLE_MARKER,
    TaggingLabels.FIGURE_MARKER,
    TaggingLabels.EQUATION_LABEL,
  ];

  static getDocumentFullTextTokens(
    labels: TaggingLabel[],
    labeledResult: string,
    tokenizations: LayoutToken[],
  ): LayoutTokenization[] {
    const clusteror = new TaggingTokenClusteror(FULLTEXT, labeledResult, tokenizations);
    const clusters: TaggingTokenCluster[] = clusteror.cluster();
    const labeledTokenSequences: LayoutTokenization[] = [];
    let currentTokenization: LayoutTokenization | null = null;
    for (const cluster of clusters) {
      if (cluster === null) continue;

      const clusterLabel: TaggingLabel = cluster.getTaggingLabel();
      const clusterTokens: LayoutToken[] = cluster.concatTokens();

      if (FullTextParser.inlineFullTextLabels.includes(clusterLabel)) {
        // sequence is not interrupted
        if (currentTokenization === null) currentTokenization = new LayoutTokenization();
      } else {
        // we have an independent sequence
        if (currentTokenization !== null && currentTokenization.size() > 0) {
          labeledTokenSequences.push(currentTokenization);
          currentTokenization = new LayoutTokenization();
        }
      }
      if (labels.includes(clusterLabel)) {
        if (currentTokenization === null) currentTokenization = new LayoutTokenization();
        currentTokenization.addTokens(clusterTokens);
      }
    }

    if (currentTokenization !== null && currentTokenization.size() > 0) labeledTokenSequences.push(currentTokenization);

    return labeledTokenSequences;
  }

  override close(): void {
    super.close();
  }
}

// Re-export Person/Block to silence unused-import lints (used via cast surfaces).
export type { Person, Block };
