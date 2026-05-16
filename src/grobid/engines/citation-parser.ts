// Port of org.grobid.core.engines.CitationParser.
// Upstream: grobid-core/src/main/java/org/grobid/core/engines/CitationParser.java
//
// Adaptations:
// - `AbstractParser` is still a port stub (sibling subagent), so the `super`
//   call site is annotated with `// @ts-expect-error` per CONVENTIONS.md.
//   Same for `EngineParsers`, `Engine`, and `DocumentSource`.
// - Apache Commons `StringUtils.isBlank` / `CollectionUtils.isEmpty` are
//   inlined as simple null/length checks.
// - `protected GrobidAnalyzer analyzer` lives on AbstractParser; since that
//   sibling stub doesn't yet expose the field via TS types, we access the
//   singleton directly via `GrobidAnalyzer.getInstance()` (matches upstream
//   semantics — `analyzer` is just `GrobidAnalyzer.getInstance()`).
// - The protected `label(...)` method is invoked through a small cast.

import { GrobidModels } from "../grobid-models.js";
import { BibDataSet } from "../data/bib-data-set.js";
import { BiblioItem } from "../data/biblio-item.js";
import { Date as GrobidDate } from "../data/date.js";
import { Document } from "../document/document.js";
import { DocumentSource } from "../document/document-source.js";
import { LabeledReferenceResult } from "./citations/labeled-reference-result.js";
import type { ReferenceSegmenter } from "./citations/reference-segmenter.js";
import { GrobidAnalysisConfig } from "./config/grobid-analysis-config.js";
import { CitationParserCounters } from "./counters/citation-parser-counters.js";
import { SegmentationLabels } from "./label/segmentation-labels.js";
import { GrobidException } from "../exceptions/grobid-exception.js";
import { FeaturesVectorCitation } from "../features/features-vector-citation.js";
import { Lexicon } from "../lexicon/lexicon.js";
import { Consolidation } from "../utilities/consolidation.js";
import type { LayoutToken } from "../layout/layout-token.js";
import { PDFAnnotation, PDFAnnotationType } from "../layout/pdf-annotation.js";
import { LayoutTokensUtil } from "../utilities/layout-tokens-util.js";
import type { OffsetPosition } from "../utilities/offset-position.js";
import { TextUtilities } from "../utilities/text-utilities.js";
import { UnicodeUtil } from "../utilities/unicode-util.js";
import type { CntManager } from "../utilities/counters/cnt-manager.js";
import { TaggingTokenClusteror } from "../tokenization/tagging-token-clusteror.js";
import type { TaggingTokenCluster } from "../tokenization/tagging-token-cluster.js";
import type { TaggingLabel } from "./label/tagging-label.js";
import { TaggingLabels } from "./label/tagging-labels.js";
import { GrobidAnalyzer } from "../analyzers/grobid-analyzer.js";
// AbstractParser is still a port stub (sibling subagent owns it). Imports
// resolve at TS level via the `export {}` re-export — runtime is a no-op
// until the stub is replaced.
import { AbstractParser } from "./abstract-parser.js";
// EngineParsers is a port stub (sibling subagent owns it); Engine is ported.
import { EngineParsers } from "./engine-parsers.js";
import { Engine } from "./engine.js";
import { getLogger } from "../utilities/logger.js";

const LOGGER = getLogger("CitationParser");

export class CitationParser extends AbstractParser {
  public lexicon: Lexicon = Lexicon.getInstance();
  private parsers: EngineParsers;

  constructor(parsers: EngineParsers, cntManager?: CntManager) {
    if (cntManager !== undefined) {
      super(GrobidModels.CITATION, cntManager);
    } else {
      super(GrobidModels.CITATION);
    }
    this.parsers = parsers;
  }

  /**
   * Process one single raw reference string
   */
  async processingString(input: string, consolidate: number): Promise<BiblioItem | null> {
    const inputs: string[] = [];
    input = TextUtilities.removeLeadingAndTrailingChars(input, "[({.,])}: \n", " \n");
    inputs.push(input);
    const result: (BiblioItem | null)[] | null = await this.processingStringMultiple(inputs, consolidate);
    if (result !== null && result.length > 0) return result[0]!;
    else return null;
  }

  /**
   * Process a list of raw reference strings by taking advantage of batch processing
   * when a DeLFT deep learning model is used
   */
  async processingStringMultiple(inputs: string[] | null, consolidate: number): Promise<(BiblioItem | null)[] | null> {
    if (inputs === null || inputs.length === 0) return null;
    const tokenList: LayoutToken[][] = [];
    const analyzer = GrobidAnalyzer.getInstance();
    for (let input of inputs) {
      if (input === null || input.trim().length === 0) {
        tokenList.push([]);
      } else {
        // some cleaning
        input = UnicodeUtil.normaliseText(input) as string;
        input = TextUtilities.removeLeadingAndTrailingChars(input, "[({.,])}: \n", " \n");
        let tokens: LayoutToken[] = analyzer.tokenizeWithLayoutToken(input);
        tokens = analyzer.retokenizeSubdigitsFromLayoutToken(tokens);
        tokenList.push(tokens);
      }
    }

    const results: (BiblioItem | null)[] | null = await this.processingLayoutTokenMultiple(tokenList, consolidate);
    if (results !== null && results.length === inputs.length) {
      // store original references to enable optional raw output
      let i = 0;
      for (const result of results) {
        if (result !== null) {
          let localInput = inputs[i]!;
          localInput = TextUtilities.removeLeadingAndTrailingChars(localInput, "[({.,])}: \n", " \n");
          result.setReference(localInput);
        }
        i++;
      }
    }
    return results;
  }

  /**
   * Process one single raw reference string tokenized as layout objects
   */
  async processingLayoutToken(tokens: LayoutToken[], consolidate: number): Promise<BiblioItem | null> {
    const tokenList: LayoutToken[][] = [];
    tokenList.push(tokens);
    const result: (BiblioItem | null)[] | null = await this.processingLayoutTokenMultiple(tokenList, consolidate);
    if (result !== null && result.length > 0) return result[0]!;
    else return null;
  }

  /**
   * Process a list of raw reference string, each one tokenized as layout objects, and taking advantage
   * of batch processing when a DeLFT deep learning model is used
   */
  async processingLayoutTokenMultiple(
    tokenList: LayoutToken[][] | null,
    consolidate: number,
  ): Promise<(BiblioItem | null)[] | null> {
    if (tokenList === null || tokenList.length === 0) return null;
    const results: (BiblioItem | null)[] = [];
    const featuredInput: string[] = [];
    const analyzer = GrobidAnalyzer.getInstance();

    let p = 0;
    for (const tokens of tokenList) {
      tokenList[p] = analyzer.retokenizeSubdigitsFromLayoutToken(tokens);
      p++;
    }

    for (const tokens of tokenList) {
      if (tokens === null || tokens.length === 0) continue;

      const journalsPositions: OffsetPosition[] = this.lexicon.tokenPositionsJournalNames(tokens);
      const abbrevJournalsPositions: OffsetPosition[] = this.lexicon.tokenPositionsAbbrevJournalNames(tokens);
      const conferencesPositions: OffsetPosition[] = this.lexicon.tokenPositionsConferenceNames(tokens);
      const publishersPositions: OffsetPosition[] = this.lexicon.tokenPositionsPublisherNames(tokens);
      const locationsPositions: OffsetPosition[] = this.lexicon.tokenPositionsLocationNames(tokens);
      const collaborationsPositions: OffsetPosition[] = this.lexicon.tokenPositionsCollaborationNames(tokens);
      const identifiersPositions: OffsetPosition[] = this.lexicon.tokenPositionsIdentifierPattern(tokens);
      const urlPositions: OffsetPosition[] = Lexicon.tokenPositionsUrlPattern(tokens);

      try {
        const featuredBlock = FeaturesVectorCitation.addFeaturesCitation(
          tokens,
          null,
          journalsPositions,
          abbrevJournalsPositions,
          conferencesPositions,
          publishersPositions,
          locationsPositions,
          collaborationsPositions,
          identifiersPositions,
          urlPositions,
        );

        featuredInput.push(featuredBlock);
        featuredInput.push("\n\n");
      } catch (e) {
        LOGGER.error("An exception occured while adding features for processing a citation.", e);
      }
    }

    const featuredInputStr = featuredInput.join("");
    if (featuredInputStr.length === 0) return null;

    let allRes: string | null = null;
    try {
      allRes = await this.label(featuredInputStr);
    } catch (e) {
      LOGGER.error("An exception occured while labeling a citation.", e);
      throw new GrobidException("An exception occured while labeling a citation.", e as Error);
    }

    if (allRes === null || allRes.length === 0) return null;
    const resBlocks = allRes.split("\n\n");
    let i = 0;
    for (const tokens of tokenList) {
      if (tokens === null || tokens.length === 0) {
        results.push(null);
      } else {
        const res = resBlocks[i]!;
        i++;
        let resCitation: BiblioItem | null = this.resultExtractionLayoutTokens(res, true, tokens);

        // post-processing (additional field parsing and cleaning)
        if (resCitation !== null) {
          BiblioItem.cleanTitles(resCitation);

          resCitation.setOriginalAuthors(resCitation.getAuthors());
          try {
            resCitation.setFullAuthors(
              await (this.parsers as unknown as {
                getAuthorParser(): { processingCitation(s: string | null): Promise<import("../data/person.js").Person[] | null> };
              })
                .getAuthorParser()
                .processingCitation(resCitation.getAuthors()),
            );
          } catch (e) {
            LOGGER.error("An exception occured when processing author names of a citation.", e);
          }
          if (resCitation.getPublicationDate() !== null) {
            const dates: GrobidDate[] | null = await (this.parsers as unknown as {
              getDateParser(): { process(s: string): Promise<GrobidDate[] | null> };
            })
              .getDateParser()
              .process(resCitation.getPublicationDate() as string);
            if (dates !== null) {
              let bestDate: GrobidDate | null = null;
              if (dates.length > 0) {
                // we take the earliest most specified date
                for (const theDate of dates) {
                  if (bestDate === null) {
                    bestDate = theDate;
                  } else {
                    if (bestDate.compareTo(theDate) === 1) {
                      bestDate = theDate;
                    }
                  }
                }
                if (bestDate !== null) {
                  resCitation.setNormalizedPublicationDate(bestDate);
                }
              }
            }
          }

          resCitation.setPageRange(TextUtilities.cleanField(resCitation.getPageRange(), true));
          resCitation.setPublisher(TextUtilities.cleanField(resCitation.getPublisher(), true));
          resCitation.setJournal(TextUtilities.cleanField(resCitation.getJournal(), true));
          resCitation.postProcessPages();

          // editors (they are human persons in theory)
          resCitation.setOriginalEditors(resCitation.getEditors());
          try {
            resCitation.setFullEditors(
              await (this.parsers as unknown as {
                getAuthorParser(): { processingCitation(s: string | null): Promise<import("../data/person.js").Person[] | null> };
              })
                .getAuthorParser()
                .processingCitation(resCitation.getEditors()),
            );
          } catch (e) {
            LOGGER.error("An exception occured when processing editor names of a citation.", e);
          }
        }

        resCitation = this.consolidateCitation(resCitation, LayoutTokensUtil.toText(tokens), consolidate);
        results.push(resCitation);
      }
    }

    return results;
  }

  processingReferenceSection(referenceTextBlock: string, referenceSegmenter: ReferenceSegmenter): Promise<BibDataSet[]>;
  processingReferenceSection(doc: Document, referenceSegmenter: ReferenceSegmenter, consolidate: number): Promise<BibDataSet[]>;
  processingReferenceSection(input: string /* file path */, referenceSegmenter: ReferenceSegmenter, consolidate: number): Promise<BibDataSet[]>;
  processingReferenceSection(
    input: string,
    md5Str: string,
    referenceSegmenter: ReferenceSegmenter,
    consolidate: number,
  ): Promise<BibDataSet[]>;
  processingReferenceSection(
    documentSource: DocumentSource,
    referenceSegmenter: ReferenceSegmenter,
    consolidate: number,
  ): Promise<BibDataSet[]>;
  async processingReferenceSection(
    a: string | Document | DocumentSource,
    b: ReferenceSegmenter | string,
    c?: number | ReferenceSegmenter,
    d?: number,
  ): Promise<BibDataSet[]> {
    // Dispatch the 5 upstream overloads:
    if (typeof a === "string" && typeof b === "object" && (b as ReferenceSegmenter).extract && c === undefined) {
      return await this.processingReferenceSectionString(a, b as ReferenceSegmenter);
    }
    if (typeof a === "string" && typeof b === "string") {
      // File path + md5
      const documentSource: DocumentSource = (DocumentSource as { fromPdf(p: string): DocumentSource }).fromPdf(a);
      documentSource.setMD5(b as string);
      return await this.processingReferenceSectionDocumentSource(documentSource, c as ReferenceSegmenter, d as number);
    }
    if (typeof a === "string") {
      // File path (no md5)
      const documentSource: DocumentSource = (DocumentSource as { fromPdf(p: string): DocumentSource }).fromPdf(a);
      return await this.processingReferenceSectionDocumentSource(documentSource, b as ReferenceSegmenter, c as number);
    }
    if (a instanceof Document) {
      return await this.processingReferenceSectionDocument(a as Document, b as ReferenceSegmenter, c as number);
    }
    // DocumentSource
    return await this.processingReferenceSectionDocumentSource(a as DocumentSource, b as ReferenceSegmenter, c as number);
  }

  private async processingReferenceSectionString(referenceTextBlock: string, referenceSegmenter: ReferenceSegmenter): Promise<BibDataSet[]> {
    const segm: LabeledReferenceResult[] | null = await referenceSegmenter.extract(referenceTextBlock);

    const results: BibDataSet[] = [];
    const allRefBlocks: LayoutToken[][] = [];
    if (segm === null || segm.length === 0) return results;
    for (const ref of segm) {
      if (ref.getTokens() === null || ref.getTokens()!.length === 0) continue;
      let localTokens: LayoutToken[] | null = ref.getTokens();
      localTokens = TextUtilities.removeLeadingAndTrailingCharsLayoutTokens(localTokens, "[({.,])}: \n", " \n");
      allRefBlocks.push(localTokens as LayoutToken[]);
    }

    const bibList: (BiblioItem | null)[] | null = await this.processingLayoutTokenMultiple(allRefBlocks, 0);
    let i = 0;
    for (const ref of segm) {
      if (ref.getTokens() === null || ref.getTokens()!.length === 0) continue;
      const bib = bibList![i]!;
      i++;
      if (bib !== null && !bib.rejectAsReference()) {
        const bds = new BibDataSet();
        let localLabel = ref.getLabel();
        if (localLabel !== null && localLabel.length > 0) {
          // cleaning the label for matching
          localLabel = TextUtilities.removeLeadingAndTrailingChars(localLabel, "([{<,. \n", ")}]>,.: \n");
        }

        let localRef = ref.getReferenceText();
        localRef = TextUtilities.removeLeadingAndTrailingChars(localRef, "[({.,])}: \n", " \n");
        bds.setRefSymbol(localLabel);
        bib.setReference(localRef);
        bds.setResBib(bib);
        bds.setRawBib(localRef);
        bds.getResBib()!.setCoordinates(ref.getCoordinates());
        results.push(bds);
      }
    }
    return results;
  }

  private async processingReferenceSectionDocument(
    doc: Document,
    referenceSegmenter: ReferenceSegmenter,
    consolidate: number,
  ): Promise<BibDataSet[]> {
    const results: BibDataSet[] = [];

    const referencesStr: string | null = doc.getDocumentPartText(SegmentationLabels.REFERENCES);

    if (referencesStr === null || referencesStr.length === 0) {
      (this as unknown as { cntManager: CntManager }).cntManager.i(CitationParserCounters.EMPTY_REFERENCES_BLOCKS);
      return results;
    }

    (this as unknown as { cntManager: CntManager }).cntManager.i(CitationParserCounters.NOT_EMPTY_REFERENCES_BLOCKS);

    const references: LabeledReferenceResult[] | null = await referenceSegmenter.extract(doc);

    if (references === null) {
      (this as unknown as { cntManager: CntManager }).cntManager.i(CitationParserCounters.NULL_SEGMENTED_REFERENCES_LIST);
      return results;
    } else {
      (this as unknown as { cntManager: CntManager }).cntManager.i(
        CitationParserCounters.SEGMENTED_REFERENCES,
        references.length,
      );
    }

    // consolidation: if selected, it is NOT done individually for each citation but
    // in a second stage for all citations
    if (references !== null) {
      const allRefBlocks: LayoutToken[][] = [];
      for (const ref of references) {
        // paranoiac check
        if (ref === null) continue;

        let localTokens: LayoutToken[] | null = ref.getTokens();
        localTokens = TextUtilities.removeLeadingAndTrailingCharsLayoutTokens(localTokens, "[({.,])}: \n", " \n");
        allRefBlocks.push(localTokens as LayoutToken[]);
      }
      const bibList: (BiblioItem | null)[] | null = await this.processingLayoutTokenMultiple(allRefBlocks, 0);

      if (bibList !== null && bibList.length > 0) {
        let i = 0;
        for (const ref of references) {
          // paranoiac check
          if (ref === null) continue;

          //BiblioItem bib = processingString(ref.getReferenceText(), 0);
          const bib = bibList[i]!;
          i++;
          if (bib === null) continue;

          // check if we have an interesting url annotation over this bib. ref.
          const refTokens: LayoutToken[] | null = ref.getTokens();
          if (refTokens !== null && refTokens.length > 0) {
            const localPages: number[] = [];
            for (const token of refTokens) {
              if (!localPages.includes(token.getPage())) {
                localPages.push(token.getPage());
              }
            }
            const annotations: PDFAnnotation[] | null = doc.getPDFAnnotations();
            if (annotations !== null) {
              for (const annotation of annotations) {
                if (annotation.getType() !== PDFAnnotationType.URI) continue;
                if (!localPages.includes(annotation.getPageNumber())) continue;
                for (const token of refTokens) {
                  if (annotation.cover(token)) {
                    // annotation covers tokens, let's look at the href
                    const uri: string | null = annotation.getDestination();
                    if (uri !== null) {
                      // is it a DOI?
                      const doiMatcher = TextUtilities.DOIPattern.exec(uri);
                      if (doiMatcher !== null) {
                        // the BiblioItem setter will take care of the prefix and doi cleaninng
                        bib.setDOI(uri);
                      }
                      // TBD: is it something else?
                    }
                  }
                }
              }
            }
          }

          if (!bib.rejectAsReference()) {
            const bds = new BibDataSet();
            let localLabel = ref.getLabel();
            if (localLabel !== null && localLabel.length > 0) {
              // cleaning the label for matching
              localLabel = TextUtilities.removeLeadingAndTrailingChars(localLabel, "([{<,. \n", ")}]>,.: \n");
            }

            let localRef = ref.getReferenceText();
            localRef = TextUtilities.removeLeadingAndTrailingChars(localRef, "[({.,])}: \n", " \n");

            bds.setRefSymbol(localLabel);
            bds.setResBib(bib);
            bib.setReference(localRef);
            bds.setRawBib(localRef);
            bds.getResBib()!.setCoordinates(ref.getCoordinates());
            results.push(bds);
          }
        }
      }
    }

    // consolidate the set
    if (consolidate !== 0) {
      const consolidator = Consolidation.getInstance();
      if (consolidator.getCntManager() === null)
        consolidator.setCntManager((this as unknown as { cntManager: CntManager }).cntManager);
      let resConsolidation: Map<number, BiblioItem> | null = null;
      try {
        resConsolidation = (
          consolidator as unknown as { consolidate(b: BibDataSet[]): Map<number, BiblioItem> | null }
        ).consolidate(results);
      } catch (e) {
        // Best-effort: see HeaderParser.consolidateHeader for rationale.
        const msg = e instanceof Error ? e.message : String(e);
        LOGGER.warn(
          `Citation consolidation failed (best-effort, falling back to CRF output): ${msg}`,
        );
        resConsolidation = null;
      }
      if (resConsolidation !== null) {
        for (let i = 0; i < results.length; i++) {
          const resCitation: BiblioItem | null = results[i]!.getResBib();
          const bibo = resConsolidation.get(i);
          if (bibo !== undefined && bibo !== null && resCitation !== null) {
            if (consolidate === 1) BiblioItem.correct(resCitation, bibo);
            else if (consolidate === 2) BiblioItem.injectIdentifiers(resCitation, bibo);
          }
        }
      }
    }

    doc.setBibDataSets(results);

    return results;
  }

  private async processingReferenceSectionDocumentSource(
    documentSource: DocumentSource,
    referenceSegmenter: ReferenceSegmenter,
    consolidate: number,
  ): Promise<BibDataSet[]> {
    let results: BibDataSet[];
    try {
      const doc: Document = await (this.parsers as unknown as {
        getSegmentationParser(): { processing(d: DocumentSource, cfg: GrobidAnalysisConfig): Promise<Document> };
      })
        .getSegmentationParser()
        .processing(documentSource, GrobidAnalysisConfig.builder().consolidateCitations(consolidate).build());
      results = await this.processingReferenceSectionDocument(doc, referenceSegmenter, consolidate);
    } catch (e) {
      if (e instanceof GrobidException) {
        LOGGER.error("An exception occured while running Grobid.", e);
        throw e;
      }
      LOGGER.error("An exception occured while running Grobid.", e);
      throw new GrobidException("An exception occurred while running Grobid.", e as Error);
    }

    return results;
  }

  /**
   * Extract results from a labeled sequence.
   *
   * @param result            labeled sequence
   * @param volumePostProcess whether post process volume
   * @param tokenizations     list of tokens
   * @return biblio item
   */
  resultExtractionLayoutTokens(
    result: string,
    volumePostProcess: boolean,
    tokenizations: LayoutToken[],
  ): BiblioItem {
    const biblio = new BiblioItem();

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const lastClusterLabel: TaggingLabel | null = null;
    void lastClusterLabel;
    const clusteror = new TaggingTokenClusteror(GrobidModels.CITATION, result, tokenizations);
    biblio.generalResultMappingReference(result, tokenizations);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const tokenLabel: string | null = null;
    void tokenLabel;
    const clusters: TaggingTokenCluster[] = clusteror.cluster();
    for (const cluster of clusters) {
      if (cluster === null) {
        continue;
      }

      const clusterLabel: TaggingLabel = cluster.getTaggingLabel();
      (Engine as unknown as { getCntManager(): CntManager }).getCntManager().i(clusterLabel as unknown as import("./counters/countable.js").Countable);

      //String clusterContent = LayoutTokensUtil.normalizeText(LayoutTokensUtil.toText(cluster.concatTokens()));
      //String clusterContent = LayoutTokensUtil.toText(cluster.concatTokens());
      const clusterContent: string = LayoutTokensUtil.normalizeDehyphenizeText(cluster.concatTokens());
      //String clusterNonDehypenizedContent = LayoutTokensUtil.toText(cluster.concatTokens());
      if (clusterLabel === TaggingLabels.CITATION_TITLE) {
        if (biblio.getTitle() === null) biblio.setTitle(clusterContent);
        else if (biblio.getTitle()!.length >= clusterContent.length)
          biblio.setNoteOrConcatenateIfNotEmpty(clusterContent);
        else {
          biblio.setNoteOrConcatenateIfNotEmpty(biblio.getTitle());
          biblio.setTitle(clusterContent);
        }
      } else if (clusterLabel === TaggingLabels.CITATION_AUTHOR) {
        if (biblio.getAuthors() === null) biblio.setAuthors(clusterContent);
        else biblio.setAuthors(biblio.getAuthors() + " ; " + clusterContent);
      } else if (clusterLabel === TaggingLabels.CITATION_TECH) {
        biblio.setBookType(clusterContent);
      } else if (clusterLabel === TaggingLabels.CITATION_LOCATION) {
        if (biblio.getLocation() !== null) biblio.setLocation(biblio.getLocation() + "; " + clusterContent);
        else biblio.setLocation(clusterContent);
      } else if (clusterLabel === TaggingLabels.CITATION_DATE) {
        if (biblio.getPublicationDate() !== null)
          biblio.setPublicationDate(biblio.getPublicationDate() + ". " + clusterContent);
        else biblio.setPublicationDate(clusterContent);
      } else if (clusterLabel === TaggingLabels.CITATION_BOOKTITLE) {
        if (biblio.getBookTitle() === null) biblio.setBookTitle(clusterContent);
        else if (biblio.getBookTitle()!.length >= clusterContent.length)
          biblio.setNoteOrConcatenateIfNotEmpty(clusterContent);
        else {
          biblio.setNoteOrConcatenateIfNotEmpty(biblio.getBookTitle());
          biblio.setBookTitle(clusterContent);
        }
      } else if (clusterLabel === TaggingLabels.CITATION_SERIES) {
        if (biblio.getSerieTitle() === null) biblio.setSerieTitle(clusterContent);
        else if (biblio.getSerieTitle()!.length >= clusterContent.length) {
          biblio.setNoteOrConcatenateIfNotEmpty(clusterContent);
        } else {
          biblio.setNoteOrConcatenateIfNotEmpty(biblio.getSerieTitle());
          biblio.setSerieTitle(clusterContent);
        }
      } else if (clusterLabel === TaggingLabels.CITATION_PAGES) {
        const clusterNonDehypenizedContent: string = LayoutTokensUtil.toText(cluster.concatTokens());
        biblio.setPageRange(clusterNonDehypenizedContent);
      } else if (clusterLabel === TaggingLabels.CITATION_PUBLISHER) {
        biblio.setPublisher(clusterContent);
      } else if (clusterLabel === TaggingLabels.CITATION_COLLABORATION) {
        if (biblio.getCollaboration() !== null) biblio.setCollaboration(biblio.getCollaboration() + " ; " + clusterContent);
        else biblio.setCollaboration(clusterContent);
      } else if (clusterLabel === TaggingLabels.CITATION_JOURNAL) {
        if (biblio.getJournal() === null) {
          biblio.setJournal(clusterContent);
        } else if (biblio.getJournal()!.length >= clusterContent.length) {
          biblio.setNoteOrConcatenateIfNotEmpty(clusterContent);
        } else {
          biblio.setNoteOrConcatenateIfNotEmpty(biblio.getJournal());
          biblio.setJournal(clusterContent);
        }
      } else if (clusterLabel === TaggingLabels.CITATION_VOLUME) {
        if (biblio.getVolumeBlock() === null) {
          biblio.setVolumeBlock(clusterContent, volumePostProcess);
        }
      } else if (clusterLabel === TaggingLabels.CITATION_ISSUE) {
        if (biblio.getIssue() === null) {
          biblio.setIssue(clusterContent);
        }
      } else if (clusterLabel === TaggingLabels.CITATION_EDITOR) {
        biblio.setEditors(clusterContent);
      } else if (clusterLabel === TaggingLabels.CITATION_INSTITUTION) {
        if (biblio.getInstitution() !== null) {
          biblio.setInstitution(biblio.getInstitution() + " ; " + clusterContent);
        } else {
          biblio.setInstitution(clusterContent);
        }
      } else if (clusterLabel === TaggingLabels.CITATION_NOTE) {
        biblio.setNoteOrConcatenateIfNotEmpty(clusterContent);
      } else if (clusterLabel === TaggingLabels.CITATION_PUBNUM) {
        // AUDIT-RELEVANT: <pubnum> label dispatch into BiblioItem.checkIdentifier()
        // routes DOI / arXiv / PMID / PMC / ISSN / ISBN. See BiblioItem.java:2140-2211.
        const clusterNonDehypenizedContent: string = LayoutTokensUtil.toText(cluster.concatTokens());
        biblio.setPubnum(clusterNonDehypenizedContent);
        biblio.checkIdentifier();
      } else if (clusterLabel === TaggingLabels.CITATION_WEB) {
        const clusterNonDehypenizedContent: string = LayoutTokensUtil.toText(cluster.concatTokens());
        biblio.setWeb(clusterNonDehypenizedContent);
      }
    }

    return biblio;
  }

  /**
   * Consolidate an existing list of recognized citations based on access to
   * external internet bibliographic databases.
   *
   * @param resCitation citation
   * @return consolidated biblio item
   */
  consolidateCitation(
    resCitation: BiblioItem | null,
    rawCitation: string,
    consolidate: number,
  ): BiblioItem | null {
    void rawCitation; // upstream parameter retained though unused below
    if (consolidate === 0) {
      // no consolidation
      return resCitation;
    }
    let consolidator: Consolidation | null = null;
    try {
      consolidator = Consolidation.getInstance();
      if (consolidator.getCntManager() === null)
        consolidator.setCntManager((this as unknown as { cntManager: CntManager }).cntManager);
      const biblios: BibDataSet[] = [];
      const theBib = new BibDataSet();
      theBib.setResBib(resCitation);
      biblios.push(theBib);
      const bibis: Map<number, BiblioItem> | null = (
        consolidator as unknown as { consolidate(b: BibDataSet[]): Map<number, BiblioItem> | null }
      ).consolidate(biblios);

      //BiblioItem bibo = consolidator.consolidate(resCitation, rawCitation);
      const bibo: BiblioItem | undefined = bibis === null ? undefined : bibis.get(0);
      if (bibo !== undefined && bibo !== null && resCitation !== null) {
        if (consolidate === 1) BiblioItem.correct(resCitation, bibo);
        else if (consolidate === 2) BiblioItem.injectIdentifiers(resCitation, bibo);
      }
    } catch (e) {
      // Best-effort: see HeaderParser.consolidateHeader for rationale.
      const msg = e instanceof Error ? e.message : String(e);
      LOGGER.warn(
        `Citation consolidation failed (best-effort, falling back to CRF output): ${msg}`,
      );
    }
    return resCitation;
  }

  /**
   * Extract results from a list of citation strings in the training format
   * without any string modification.
   *
   * @param inputs list of input data
   * @return result
   */
  async trainingExtraction(inputs: string[] | null): Promise<string[] | null> {
    const buffer: string[] = [];
    try {
      if (inputs === null) return null;

      if (inputs.length === 0) return null;

      let journalsPositions: OffsetPosition[] | null = null;
      let abbrevJournalsPositions: OffsetPosition[] | null = null;
      let conferencesPositions: OffsetPosition[] | null = null;
      let publishersPositions: OffsetPosition[] | null = null;
      let locationsPositions: OffsetPosition[] | null = null;
      let collaborationsPositions: OffsetPosition[] | null = null;
      let identifiersPositions: OffsetPosition[] | null = null;
      let urlPositions: OffsetPosition[] | null = null;
      const analyzer = GrobidAnalyzer.getInstance();
      for (const input of inputs) {
        if (input === null) continue;

        let tokenizations: LayoutToken[] = analyzer.tokenizeWithLayoutToken(input);
        tokenizations = analyzer.retokenizeSubdigitsFromLayoutToken(tokenizations);

        if (tokenizations.length === 0) return null;

        journalsPositions = this.lexicon.tokenPositionsJournalNames(tokenizations);
        abbrevJournalsPositions = this.lexicon.tokenPositionsAbbrevJournalNames(tokenizations);
        conferencesPositions = this.lexicon.tokenPositionsConferenceNames(tokenizations);
        publishersPositions = this.lexicon.tokenPositionsPublisherNames(tokenizations);
        locationsPositions = this.lexicon.tokenPositionsLocationNames(tokenizations);
        collaborationsPositions = this.lexicon.tokenPositionsCollaborationNames(tokenizations);
        identifiersPositions = this.lexicon.tokenPositionsIdentifierPattern(tokenizations);
        urlPositions = Lexicon.tokenPositionsUrlPattern(tokenizations);

        const ress = FeaturesVectorCitation.addFeaturesCitation(
          tokenizations,
          null,
          journalsPositions,
          abbrevJournalsPositions,
          conferencesPositions,
          publishersPositions,
          locationsPositions,
          collaborationsPositions,
          identifiersPositions,
          urlPositions,
        );
        const res = await this.label(ress);

        let lastTag: string | null = null;
        let lastTag0: string | null;
        let currentTag0: string | null = null;
        let start = true;
        let s1: string | null = null;
        let s2: string | null = null;
        let p = 0;

        // extract results from the processed file
        const lines = res.split("\n");
        for (const rawLine of lines) {
          let addSpace = false;
          const tok = rawLine.trim();

          if (tok.length === 0) {
            // new citation
            //buffer.append("/t<bibl>\n");
            start = true;
            continue;
          }
          const stt = tok.split("\t");
          let i = 0;

          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const newLine = false;
          void newLine;
          const ll = stt.length;
          for (const sRaw of stt) {
            const s = sRaw.trim();
            if (i === 0) {
              s2 = TextUtilities.HTMLEncode(s);
              //s2 = s;

              let strop = false;
              while (!strop && p < tokenizations.length) {
                const tokOriginal = tokenizations[p]!.t();
                if (tokOriginal === " " || tokOriginal === " ") {
                  addSpace = true;
                } else if (tokOriginal === s) {
                  strop = true;
                }
                p++;
              }
            } else if (i === ll - 1) {
              s1 = s;
            }
            i++;
          }

          if (start && s1 !== null) {
            buffer.push("\t<bibl>");
            start = false;
          }

          lastTag0 = null;
          if (lastTag !== null) {
            if (lastTag.startsWith("I-")) {
              lastTag0 = lastTag.substring(2, lastTag.length);
            } else {
              lastTag0 = lastTag;
            }
          }
          if (s1 !== null) {
            if (s1.startsWith("I-")) {
              currentTag0 = s1.substring(2, s1.length);
            } else {
              currentTag0 = s1;
            }
          }

          //tagClosed = lastTag0 != null &&
          if (lastTag0 !== null && currentTag0 !== null) this.testClosingTag(buffer, currentTag0, lastTag0);

          let output: string | null = this.writeField(s1, lastTag0, s2, "<title>", "<title level=\"a\">", addSpace, 0);
          if (output === null) {
            output = this.writeField(s1, lastTag0, s2, "<other>", "", addSpace, 0);
          }
          if (output === null) {
            output = this.writeField(s1, lastTag0, s2, "<author>", "<author>", addSpace, 0);
          }
          if (output === null) {
            output = this.writeField(s1, lastTag0, s2, "<journal>", "<title level=\"j\">", addSpace, 0);
          }
          if (output === null) {
            output = this.writeField(s1, lastTag0, s2, "<series>", "<title level=\"s\">", addSpace, 0);
          }
          if (output === null) {
            output = this.writeField(s1, lastTag0, s2, "<booktitle>", "<title level=\"m\">", addSpace, 0);
          }
          if (output === null) {
            output = this.writeField(s1, lastTag0, s2, "<date>", "<date>", addSpace, 0);
          }
          if (output === null) {
            output = this.writeField(s1, lastTag0, s2, "<volume>", "<biblScope unit=\"volume\">", addSpace, 0);
          }
          if (output === null) {
            output = this.writeField(s1, lastTag0, s2, "<publisher>", "<publisher>", addSpace, 0);
          }
          if (output === null) {
            output = this.writeField(s1, lastTag0, s2, "<location>", "<pubPlace>", addSpace, 0);
          }
          if (output === null) {
            output = this.writeField(s1, lastTag0, s2, "<editor>", "<editor>", addSpace, 0);
          }
          if (output === null) {
            output = this.writeField(s1, lastTag0, s2, "<pages>", "<biblScope unit=\"page\">", addSpace, 0);
          }
          if (output === null) {
            output = this.writeField(s1, lastTag0, s2, "<tech>", "<note type=\"report\">", addSpace, 0);
          }
          if (output === null) {
            output = this.writeField(s1, lastTag0, s2, "<issue>", "<biblScope unit=\"issue\">", addSpace, 0);
          }
          if (output === null) {
            output = this.writeField(s1, lastTag0, s2, "<web>", "<ptr type=\"web\">", addSpace, 0);
          }
          if (output === null) {
            output = this.writeField(s1, lastTag0, s2, "<note>", "<note>", addSpace, 0);
          }
          if (output === null) {
            output = this.writeField(s1, lastTag0, s2, "<institution>", "<orgName>", addSpace, 0);
          }
          if (output === null) {
            output = this.writeField(s1, lastTag0, s2, "<collaboration>", "<orgName type=\"collaboration\">", addSpace, 0);
          }
          if (output === null) {
            let localTag: string | null = null;
            let cleanS2: string = (s2 ?? "").replace(/\s+/g, " ").trim();
            cleanS2 = cleanS2.replace(/ /g, "");

            const doiMatcher = TextUtilities.DOIPattern.exec(cleanS2);
            if (doiMatcher !== null) localTag = "<idno type=\"DOI\">";

            if (localTag === null) {
              const arxivMatcher = TextUtilities.arXivPattern.exec(cleanS2);
              if (arxivMatcher !== null) localTag = "<idno type=\"arXiv\">";
            }

            if (localTag === null) {
              const pmidMatcher = TextUtilities.pmidPattern.exec(cleanS2);
              if (pmidMatcher !== null) localTag = "<idno type=\"PMID\">";
            }

            if (localTag === null) {
              const pmcidMatcher = TextUtilities.pmcidPattern.exec(cleanS2);
              if (pmcidMatcher !== null) localTag = "<idno type=\"PMC\">";
            }

            if (localTag === null) {
              if (cleanS2.toLowerCase().indexOf("issn") !== -1) {
                localTag = "<idno type=\"ISSN\">";
              }
            }

            if (localTag === null) {
              if (cleanS2.toLowerCase().indexOf("isbn") !== -1) {
                localTag = "<idno type=\"ISBN\">";
              }
            }

            // TODO: PII

            if (localTag === null) localTag = "<idno>";

            output = this.writeField(s1, lastTag0, s2, "<pubnum>", localTag, addSpace, 0);
          }
          if (output !== null) {
            buffer.push(output);
            lastTag = s1;
            continue;
          }
          lastTag = s1;
        }

        if (lastTag !== null) {
          if (lastTag.startsWith("I-")) {
            lastTag0 = lastTag.substring(2, lastTag.length);
          } else {
            lastTag0 = lastTag;
          }
          currentTag0 = "";
          this.testClosingTag(buffer, currentTag0, lastTag0);
          buffer.push("</bibl>\n");
        }
      }
    } catch (e) {
      throw new GrobidException("An exception occured while running Grobid.", e as Error);
    }
    return buffer;
  }

  private writeField(
    s1: string | null,
    lastTag0: string | null,
    s2: string | null,
    field: string,
    outField: string,
    addSpace: boolean,
    nbIndent: number,
  ): string | null {
    void nbIndent;
    let result: string | null = null;
    if (s1 !== null && (s1 === field || s1 === "I-" + field)) {
      if (s1 === lastTag0 || s1 === "I-" + lastTag0) {
        if (addSpace) result = " " + s2;
        else result = s2;
      } else {
        result = "";
        /*for (int i = 0; i < nbIndent; i++) {
            result += "\t";
        }*/
        if (addSpace) {
          result += " " + outField + s2;
        } else {
          result += outField + s2;
        }
      }
    }
    return result;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private writeField2(
    buffer: string[],
    s1: string | null,
    lastTag0: string | null,
    s2: string | null,
    field: string,
    outField: string,
    addSpace: boolean,
  ): boolean {
    let result = false;
    if (s1 !== null && (s1 === field || s1 === "I-" + field)) {
      result = true;
      if (s1 === lastTag0 || s1 === "I-" + lastTag0) {
        if (addSpace) buffer.push(" ", s2 ?? "");
        else buffer.push(s2 ?? "");
      } else {
        if (addSpace) buffer.push(" ", outField, s2 ?? "");
        else buffer.push(outField, s2 ?? "");
      }
    }
    return result;
  }

  private testClosingTag(buffer: string[], currentTag0: string, lastTag0: string): boolean {
    let res = false;
    if (currentTag0 !== lastTag0) {
      res = true;
      // we close the current tag
      if (lastTag0 === "<other>") {
        buffer.push("");
      } else if (lastTag0 === "<title>") {
        buffer.push("</title>");
      } else if (lastTag0 === "<series>") {
        buffer.push("</title>");
      } else if (lastTag0 === "<author>") {
        buffer.push("</author>");
      } else if (lastTag0 === "<tech>") {
        buffer.push("</note>");
      } else if (lastTag0 === "<location>") {
        buffer.push("</pubPlace>");
      } else if (lastTag0 === "<date>") {
        buffer.push("</date>");
      } else if (lastTag0 === "<booktitle>") {
        buffer.push("</title>");
      } else if (lastTag0 === "<pages>") {
        buffer.push("</biblScope>");
      } else if (lastTag0 === "<publisher>") {
        buffer.push("</publisher>");
      } else if (lastTag0 === "<journal>") {
        buffer.push("</title>");
      } else if (lastTag0 === "<volume>") {
        buffer.push("</biblScope>");
      } else if (lastTag0 === "<issue>") {
        buffer.push("</biblScope>");
      } else if (lastTag0 === "<editor>") {
        buffer.push("</editor>");
      } else if (lastTag0 === "<pubnum>") {
        buffer.push("</idno>");
      } else if (lastTag0 === "<web>") {
        buffer.push("</ptr>");
      } else if (lastTag0 === "<note>") {
        buffer.push("</note>");
      } else if (lastTag0 === "<institution>") {
        buffer.push("</orgName>");
      } else if (lastTag0 === "<collaboration>") {
        buffer.push("</orgName>");
      } else {
        res = false;
      }
    }
    return res;
  }

  override close(): void {
    super.close();
  }
}
