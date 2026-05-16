// Port of org.grobid.core.engines.patent.ReferenceExtractor.
// Upstream: grobid-core/src/main/java/org/grobid/core/engines/patent/ReferenceExtractor.java
//
// Extraction of patent and NPL references from the content body of patent
// documents with sequence labeling.
//
// Notes on the port:
// - Upstream Java performs file I/O via FileInputStream/InputSource/SAX. The
//   TS port reads the file synchronously through `node:fs` and feeds the
//   resulting XML string into the `parseSax`-based `TextSaxParser` /
//   `PatentAnnotationSaxParser`. Behaviour matches upstream because both
//   approaches process the same byte stream.
// - `OPSService.descriptionRetrieval` is async in TS (upstream is sync HTTP).
//   `getDocOPS` and `extractAllReferencesOPS` therefore become async on the
//   JS side. All other entry points stay sync.
// - The `consolidator` field is preserved verbatim though never read in
//   upstream (it is declared but never assigned).
// - Java's `StringBuilder` from `CitationParser.trainingExtraction` returned
//   `string[]` in the TS port; the upstream concatenation is mirrored by
//   `bufferReference.join("")`.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { gunzipSync } from "node:zlib";

import { GrobidModels } from "../../grobid-models.js";
import { GrobidAnalyzer } from "../../analyzers/grobid-analyzer.js";
import { GrobidDefaultAnalyzer } from "../../analyzers/grobid-default-analyzer.js";
import { BibDataSet } from "../../data/bib-data-set.js";
import { BiblioItem } from "../../data/biblio-item.js";
import { PatentItem } from "../../data/patent-item.js";
import { Document } from "../../document/document.js";
import { DocumentSource } from "../../document/document-source.js";
import { OPSService } from "../../document/ops-service.js";
import { PatentDocument } from "../../document/patent-document.js";
import { GrobidAnalysisConfig } from "../config/grobid-analysis-config.js";
import { CitationParser } from "../citation-parser.js";
import { EngineParsers } from "../engine-parsers.js";
import { GenericTagger } from "../tagging/generic-tagger.js";
import { TaggerFactory } from "../tagging/tagger-factory.js";
import { GrobidException } from "../../exceptions/grobid-exception.js";
import { GrobidResourceException } from "../../exceptions/grobid-resource-exception.js";
import { FeaturesVectorReference } from "../../features/features-vector-reference.js";
import { Language } from "../../lang/language.js";
import { Lexicon } from "../../lexicon/lexicon.js";
import { LayoutToken } from "../../layout/layout-token.js";
import { Page } from "../../layout/page.js";
import { PatentAnnotationSaxParser, type Writer } from "../../sax/patent-annotation-sax-parser.js";
import { TextSaxParser } from "../../sax/text-sax-parser.js";
import { BoundingBoxCalculator } from "../../utilities/bounding-box-calculator.js";
import { Consolidation } from "../../utilities/consolidation.js";
import { GrobidProperties } from "../../utilities/grobid-properties.js";
import { KeyGen } from "../../utilities/key-gen.js";
import { LanguageUtilities } from "../../utilities/language-utilities.js";
import { LayoutTokensUtil } from "../../utilities/layout-tokens-util.js";
import { getLogger } from "../../utilities/logger.js";
import { OffsetPosition } from "../../utilities/offset-position.js";
import { TextUtilities } from "../../utilities/text-utilities.js";

import { PatentRefParser } from "./patent-ref-parser.js";

const LOGGER = getLogger("ReferenceExtractor");

/**
 * Upstream ReferenceExtractor.java line 64-1861.
 */
export class ReferenceExtractor {
  // Upstream line 71-73.
  private taggerAll: GenericTagger | null = null;
  private patentParser: PatentRefParser | null = null;
  // NOTE: upstream line 73 — `private Consolidation consolidator = null;` declared
  // but never assigned anywhere in the class. Preserved verbatim.
  private consolidator: Consolidation | null = null;

  // Upstream line 75.
  private tmpPath: string | null = null;

  // Upstream line 77.
  public debug: boolean = false;

  // Upstream line 79-82.
  public lexicon: Lexicon = Lexicon.getInstance();
  public currentPatentNumber: string | null = null;
  public ops: OPSService | null = null;
  private descriptionSegments: string[] | null = null;

  // Upstream line 84-85.
  // ArrayList<BibDataSet> identified current parsed bibliographical items and related information.
  public resBib: BibDataSet[] | null = null;

  // Upstream line 87.
  private path: string | null = null;
  // Upstream line 88.
  private parsers: EngineParsers;

  // Upstream line 90-91.
  private analyzer: GrobidAnalyzer | null = null;
  private languageUtilities: LanguageUtilities = LanguageUtilities.getInstance();

  // Upstream line 93-95.
  setDocumentPath(dirName: string): void {
    this.path = dirName;
  }

  // Upstream line 97-99 / 102-106. Constructor overloads collapsed.
  constructor(parsers?: EngineParsers) {
    this.parsers = parsers ?? new EngineParsers();
    this.taggerAll = TaggerFactory.getTagger(GrobidModels.PATENT_CITATION);
    this.analyzer = GrobidAnalyzer.getInstance();
    // Silence the unused-field warning for `consolidator` — read it back once.
    void this.consolidator;
    void this.tmpPath;
  }

  /**
   * Extract all reference from the full text retrieved via OPS.
   *
   * Upstream line 108-129. `OPSService.descriptionRetrieval` is async in TS, so
   * `getDocOPS` is async too. This entry point keeps the same overall shape.
   */
  async extractAllReferencesOPS(
    filterDuplicate: boolean,
    consolidate: number,
    includeRawCitations: boolean,
    patents: PatentItem[] | null,
    articles: BibDataSet[] | null,
  ): Promise<string | null> {
    try {
      if (this.descriptionSegments !== null && this.descriptionSegments.length > 0) {
        return await this.extractAllReferencesString(
          this.descriptionSegments,
          filterDuplicate,
          consolidate,
          includeRawCitations,
          patents,
          articles,
        );
      }
    } catch (e) {
      throw new GrobidException(undefined, e);
    }
    return null;
  }

  /**
   * Extract all reference from a patent in XML ST.36 like.
   *
   * Upstream line 131-145.
   */
  async extractPatentReferencesXMLFile(
    pathXML: string,
    filterDuplicate: boolean,
    consolidate: number,
    includeRawCitations: boolean,
    patents: PatentItem[] | null,
  ): Promise<string | null> {
    return await this.extractAllReferencesXMLFile(
      pathXML,
      filterDuplicate,
      consolidate,
      includeRawCitations,
      patents,
      null,
    );
  }

  /**
   * Extract all reference from an XML file in ST.36 or MAREC format.
   *
   * Upstream line 147-220.
   */
  async extractAllReferencesXMLFile(
    pathXML: string,
    filterDuplicate: boolean,
    consolidate: number,
    includeRawCitations: boolean,
    patents: PatentItem[] | null,
    articles: BibDataSet[] | null,
  ): Promise<string | null> {
    try {
      if (patents === null) {
        // NOTE: upstream prints to System.out directly. Preserved as a console warning.
        // eslint-disable-next-line no-console
        console.log("Warning patents List is null!");
      }

      const sax = new TextSaxParser();
      sax.addFilter("description");
      sax.addFilter("p");
      sax.addFilter("heading");
      sax.addFilter("head");

      // Upstream uses SAXParserFactory + XMLReader. The TS port reads the file
      // bytes (un-gzipped when needed) and parses the resulting XML string via
      // `parseSax`. Upstream's SAXParserFactory feature toggles (`namespaces`,
      // `validation`) and the dummy EntityResolver are a no-op against the
      // documents we process, since `fast-xml-parser` doesn't fetch DTDs.
      const xml = ReferenceExtractor._readMaybeGzipUtf8(pathXML);
      sax.parse(xml);

      const descriptionSegments: string[] = sax.getTexts();

      // NOTE: upstream lines 199-201 — commented-out `System.out.println` over `descriptionSegments`.

      this.currentPatentNumber = sax.currentPatentNumber;
      // Upstream forcibly resets these flags before delegating.
      consolidate = 0;
      filterDuplicate = true;

      if (descriptionSegments !== null && descriptionSegments.length > 0) {
        return await this.extractAllReferencesString(
          descriptionSegments,
          filterDuplicate,
          consolidate,
          includeRawCitations,
          patents,
          articles,
        );
      } else {
        return null;
      }
    } catch (e) {
      // NOTE: upstream line 217 — `e.printStackTrace();` (no rethrow).
      // eslint-disable-next-line no-console
      console.error(e);
    }
    return null;
  }

  /**
   * Extract all reference from the PDF file of a patent publication.
   *
   * Upstream line 222-259.
   */
  async extractAllReferencesPDFFile(
    inputFile: string,
    filterDuplicate: boolean,
    consolidate: number,
    includeRawCitations: boolean,
    patents: PatentItem[] | null,
    articles: BibDataSet[] | null,
  ): Promise<string | null> {
    let documentSource: DocumentSource | null = null;
    let result: string | null = null;
    try {
      documentSource = DocumentSource.fromPdf(inputFile);
      const doc = new PatentDocument(documentSource);
      doc.addTokenizedDocument(GrobidAnalysisConfig.defaultInstance());

      if (doc.getBlocks() === null) {
        return result;
      }
      const description = doc.getAllBlocksClean(25, -1);
      if (description !== null) {
        const descriptions: string[] = [];
        descriptions.push(description);
        result = await this.extractAllReferencesString(
          descriptions,
          filterDuplicate,
          consolidate,
          includeRawCitations,
          patents,
          articles,
        );
      }

      return result;
    } finally {
      DocumentSource.close(documentSource, true, true, true);
    }
  }

  /**
   * JSON annotations for all reference from the PDF file of a patent publication.
   *
   * Upstream line 261-296.
   */
  async annotateAllReferencesPDFFile(
    inputFile: string,
    filterDuplicate: boolean,
    consolidate: number,
    includeRawCitations: boolean,
    patents: PatentItem[] | null,
    articles: BibDataSet[] | null,
  ): Promise<string | null> {
    let documentSource: DocumentSource | null = null;
    try {
      documentSource = DocumentSource.fromPdf(inputFile);
      const doc = new PatentDocument(documentSource);

      const tokenizations: LayoutToken[] | null = doc.addTokenizedDocument(
        GrobidAnalysisConfig.defaultInstance(),
      );

      if (doc.getBlocks() === null) {
        throw new GrobidException("PDF parsing resulted in empty content");
      }
      if (tokenizations !== null && tokenizations.length > 0) {
        return await this.annotateAllReferences(
          doc,
          tokenizations,
          filterDuplicate,
          consolidate,
          includeRawCitations,
          patents,
          articles,
        );
      } else {
        return null;
      }
    } catch (e) {
      LOGGER.error("Error in extractAllReferencesPDFFile", e);
    } finally {
      DocumentSource.close(documentSource, true, true, true);
    }
    return null;
  }

  // NOTE: upstream lines 301-310 — commented-out single-text overload
  // of `extractAllReferencesString`. Not ported.

  /**
   * Extract all reference from a list of text segments, and return results in an XML document.
   *
   * Upstream line 312-906.
   */
  async extractAllReferencesString(
    textsIn: string[],
    filterDuplicate: boolean,
    consolidate: number,
    includeRawCitations: boolean,
    patents: PatentItem[] | null,
    articles: BibDataSet[] | null,
  ): Promise<string | null> {
    void filterDuplicate;
    let texts: string[] = textsIn;
    const allTokenizations: LayoutToken[][] = [];

    // list of references by index of tokenized text segments
    const patentsBySegment: Map<number, PatentItem[]> = new Map();
    const articlesBySegment: Map<number, BibDataSet[]> = new Map();

    // sub-segment texts if a DL model will be applied. Use the max sequence length for size limit
    if (GrobidProperties.getGrobidEngineName("patent-citation") === "delft") {
      const newTexts: string[] = [];
      const maxSequence = GrobidProperties.getDelftTrainingMaxSequenceLength("patent-citation");
      for (const text of texts) {
        const tokenizations = GrobidDefaultAnalyzer.getInstance().tokenize(text);
        if (tokenizations.length > maxSequence) {
          // NOTE: upstream line 331 — `//System.out.println(maxSequence + " vs " + tokenizations.size());`
          const subtexts: string[] = text.split("\n\n");
          for (let i = 0; i < subtexts.length; i++) {
            const subtokenizations = GrobidDefaultAnalyzer.getInstance().tokenize(subtexts[i]!);
            if (subtokenizations.length > maxSequence) {
              const subsubtexts: string[] = subtexts[i]!.split(".\n");
              for (let j = 0; j < subsubtexts.length; j++) {
                // NOTE: upstream computes `subsubtokenizations` here but never uses it.
                // Preserved verbatim.
                const subsubtokenizations =
                  GrobidDefaultAnalyzer.getInstance().tokenize(subsubtexts[j]!);
                void subsubtokenizations;
                newTexts.push(subsubtexts[j]!);
              }
            } else {
              newTexts.push(subtexts[i]!);
            }
          }
        } else {
          newTexts.push(text);
        }
      }
      texts = newTexts;
    }

    try {
      // if parameters are null, these lists will only be valid in the method
      if (patents === null) {
        patents = [];
      }

      if (articles === null) {
        articles = [];
      }

      // parser for patent and non patent references
      if (this.patentParser === null) {
        this.patentParser = new PatentRefParser();
      }

      // identify the language of the patent document, we use only the first 500 characters
      // which is enough normally for a very safe language prediction
      // the text here is the patent description, so normally strictly monolingual

      // create text buffer
      const localText: string[] = [];
      let localTextLen = 0;
      for (const text of texts) {
        localText.push(text);
        localTextLen += text.length;
        if (localTextLen > 500) break;
      }
      if (localTextLen === 0) return null;
      const lang = this.languageUtilities.runLanguageId(localText.join(""), 500);
      const allPatentBlocks: string[] = [];

      for (const text of texts) {
        // NOTE: upstream line 384 — `//text = TextUtilities.dehyphenize(text); // to be reviewed!` (commented-out).

        // tokenisation according to the language (except for Korean, which will require retraining)
        let tokenizations: LayoutToken[];
        if (lang !== null && lang.getLang() === Language.KO) {
          tokenizations = GrobidDefaultAnalyzer.getInstance().tokenizeWithLayoutToken(text);
        } else {
          tokenizations = this.analyzer!.tokenizeWithLayoutToken(text, lang);
          // to be sure to sub-tokenize based on standard punctuations:
          tokenizations = GrobidDefaultAnalyzer.getInstance().retokenizeFromLayoutToken(tokenizations);
        }

        if (tokenizations.length === 0) {
          continue;
        }
        allTokenizations.push(tokenizations);

        const patentBlocks: string[] = [];

        let journalPositions: OffsetPosition[] | null = null;
        let abbrevJournalPositions: OffsetPosition[] | null = null;
        let conferencePositions: OffsetPosition[] | null = null;
        let publisherPositions: OffsetPosition[] | null = null;

        journalPositions = this.lexicon.tokenPositionsJournalNames(tokenizations);
        abbrevJournalPositions = this.lexicon.tokenPositionsAbbrevJournalNames(tokenizations);
        conferencePositions = this.lexicon.tokenPositionsConferenceNames(tokenizations);
        publisherPositions = this.lexicon.tokenPositionsPublisherNames(tokenizations);

        let isJournalToken = false;
        let isAbbrevJournalToken = false;
        let isConferenceToken = false;
        let isPublisherToken = false;
        let currentJournalPositions = 0;
        let currentAbbrevJournalPositions = 0;
        let currentConferencePositions = 0;
        let currentPublisherPositions = 0;
        let skipTest = false;
        let posit = 0;
        for (const token of tokenizations) {
          const tok = token.getText() ?? "";
          isJournalToken = false;
          isAbbrevJournalToken = false;
          isConferenceToken = false;
          isPublisherToken = false;
          skipTest = false;
          if (
            tok.trim().length === 0 ||
            tok === " " ||
            tok === "\t" ||
            tok === "\n" ||
            tok === "\r"
          ) {
            posit++;
            continue;
          }

          // check the position of matches for journals
          if (journalPositions !== null) {
            if (currentJournalPositions === journalPositions.length - 1) {
              if (journalPositions[currentJournalPositions]!.end < posit) {
                skipTest = true;
              }
            }
            if (!skipTest) {
              for (let i = currentJournalPositions; i < journalPositions.length; i++) {
                if (
                  journalPositions[i]!.start <= posit &&
                  journalPositions[i]!.end >= posit
                ) {
                  isJournalToken = true;
                  currentJournalPositions = i;
                  break;
                } else if (journalPositions[i]!.start > posit) {
                  isJournalToken = false;
                  currentJournalPositions = i;
                  break;
                }
              }
            }
          }

          // check the position of matches for abbreviated journals
          skipTest = false;
          if (abbrevJournalPositions !== null) {
            if (currentAbbrevJournalPositions === abbrevJournalPositions.length - 1) {
              if (abbrevJournalPositions[currentAbbrevJournalPositions]!.end < posit) {
                skipTest = true;
              }
            }
            if (!skipTest) {
              for (let i = currentAbbrevJournalPositions; i < abbrevJournalPositions.length; i++) {
                if (
                  abbrevJournalPositions[i]!.start <= posit &&
                  abbrevJournalPositions[i]!.end >= posit
                ) {
                  isAbbrevJournalToken = true;
                  currentAbbrevJournalPositions = i;
                  break;
                } else if (abbrevJournalPositions[i]!.start > posit) {
                  isAbbrevJournalToken = false;
                  currentAbbrevJournalPositions = i;
                  break;
                }
              }
            }
          }

          // check the position of matches for conference names
          skipTest = false;
          if (conferencePositions !== null) {
            if (currentConferencePositions === conferencePositions.length - 1) {
              if (conferencePositions[currentConferencePositions]!.end < posit) {
                skipTest = true;
              }
            }
            if (!skipTest) {
              for (let i = currentConferencePositions; i < conferencePositions.length; i++) {
                if (
                  conferencePositions[i]!.start <= posit &&
                  conferencePositions[i]!.end >= posit
                ) {
                  isConferenceToken = true;
                  currentConferencePositions = i;
                  break;
                } else if (conferencePositions[i]!.start > posit) {
                  isConferenceToken = false;
                  currentConferencePositions = i;
                  break;
                }
              }
            }
          }

          // check the position of matches for publisher names
          skipTest = false;
          if (publisherPositions !== null) {
            if (currentPublisherPositions === publisherPositions.length - 1) {
              if (publisherPositions[currentPublisherPositions]!.end < posit) {
                skipTest = true;
              }
            }
            if (!skipTest) {
              for (let i = currentPublisherPositions; i < publisherPositions.length; i++) {
                if (
                  publisherPositions[i]!.start <= posit &&
                  publisherPositions[i]!.end >= posit
                ) {
                  isPublisherToken = true;
                  currentPublisherPositions = i;
                  break;
                } else if (publisherPositions[i]!.start > posit) {
                  isPublisherToken = false;
                  currentPublisherPositions = i;
                  break;
                }
              }
            }
          }

          const featureVector = FeaturesVectorReference.addFeaturesPatentReferences(
            new LayoutToken(tok),
            null,
            tokenizations.length,
            posit,
            isJournalToken,
            isAbbrevJournalToken,
            isConferenceToken,
            isPublisherToken,
          );
          patentBlocks.push(featureVector.printVector() ?? "");
          patentBlocks.push("\n");
          posit++;
        }

        patentBlocks.push("\n\n");
        allPatentBlocks.push(patentBlocks.join(""));
      }

      const theResults: string = await this.taggerAll!.label(allPatentBlocks);
      // NOTE: upstream line 553 — `//System.out.println(theResults);` (commented-out).
      const theSegmentedResults: string[] = theResults.split("\n\n");

      const allReferencesNPL: string[] = [];
      const allOffsetsNPL: number[] = [];
      const allProbNPL: number[] = [];
      const localIndexSegmentNPL: number[] = [];

      // NOTE: upstream line 562 — `//int offset = 0;` (commented-out).
      for (let index = 0; index < theSegmentedResults.length; index++) {
        const theResult: string = theSegmentedResults[index] as string;
        const stt: string[] = theResult.split("\n");
        const tokenizations: LayoutToken[] = allTokenizations[index] as LayoutToken[];

        const referencesPatent: string[] = [];
        const referencesNPL: string[] = [];

        const offsetsPatent: number[] = [];
        const offsetsNPL: number[] = [];

        const probPatent: number[] = [];
        const probNPL: number[] = [];

        let currentPatent: boolean = true; // type of current reference
        let reference: string | null = null;
        let currentProb: number = 0.0;
        let offset: number = 0;
        let currentOffset: number = 0;
        let addedOffset: number = 0;
        let label: string | null = null; // label
        let actual: string | null = null; // token
        let p: number = 0; // iterator for the tokenizations for restauring the original tokenization with
        // respect to spaces

        for (const lineRaw of stt) {
          const line = lineRaw;
          if (line.trim().length === 0) {
            continue;
          }

          // Java `StringTokenizer(line, "\t ")` — splits on tab OR space, drops empties.
          const st2: string[] = line.split(/[\t ]+/).filter((s) => s.length > 0);
          let start: boolean = true;
          let separator: string = "";
          label = null;
          actual = null;
          let st2Idx = 0;
          while (st2Idx < st2.length) {
            if (start) {
              actual = st2[st2Idx++]!.trim();
              start = false;

              let strop: boolean = false;
              while (!strop && p < tokenizations.length) {
                const tokOriginal: string = tokenizations[p]!.getText() ?? "";
                addedOffset += tokOriginal.length;
                if (tokOriginal === " ") {
                  separator += tokOriginal;
                } else if (tokOriginal === actual) {
                  strop = true;
                }
                p++;
              }
            } else {
              label = st2[st2Idx++]!.trim();
            }
          }

          if (label === null) {
            offset += addedOffset;
            addedOffset = 0;
            continue;
          }

          let prob: number = 0.0;
          const segProb: number = label.lastIndexOf("/");
          if (segProb !== -1) {
            const probString: string = label.substring(segProb + 1, label.length);
            // NOTE: upstream line 630 — `//System.out.println("given prob: " + probString);` (commented-out).
            try {
              prob = parseFloat(probString);
              if (Number.isNaN(prob)) throw new Error("NaN");
              // NOTE: upstream line 633 — `//System.out.println("given prob: " + probString + ", parsed: " + prob);`
            } catch (_e) {
              LOGGER.debug(probString + " cannot be parsed.");
              prob = 0.0;
            }
            label = label.substring(0, segProb);
          }

          // TBD: use TaggingTokenClusteror and TaggingLabel as for the other parsers
          if (actual !== null) {
            if (label.endsWith("<refPatent>")) {
              if (reference === null) {
                reference = separator + actual;
                currentOffset = offset;
                currentPatent = true;
                currentProb = prob;
              } else {
                if (currentPatent) {
                  if (label === "I-<refPatent>") {
                    referencesPatent.push(reference);
                    offsetsPatent.push(currentOffset);

                    probPatent.push(currentProb);

                    currentPatent = true;
                    reference = separator + actual;
                    currentOffset = offset;
                    currentProb = prob;
                  } else {
                    reference += separator + actual;
                    if (prob > currentProb) {
                      currentProb = prob;
                    }
                  }
                } else {
                  referencesNPL.push(reference);
                  offsetsNPL.push(currentOffset);
                  probNPL.push(currentProb);

                  currentPatent = true;
                  reference = separator + actual;
                  currentOffset = offset;
                  currentProb = prob;
                }
              }
            } else if (label.endsWith("<refNPL>")) {
              if (reference === null) {
                reference = separator + actual;
                currentOffset = offset;
                currentPatent = false;
                currentProb = prob;
              } else {
                if (currentPatent) {
                  referencesPatent.push(reference);
                  offsetsPatent.push(currentOffset);
                  probPatent.push(currentProb);

                  currentPatent = false;
                  reference = separator + actual;
                  currentOffset = offset;
                  currentProb = prob;
                } else {
                  if (label === "I-<refNPL>") {
                    referencesNPL.push(reference);
                    offsetsNPL.push(currentOffset);
                    probNPL.push(currentProb);

                    currentPatent = false;
                    reference = separator + actual;
                    currentOffset = offset;
                    currentProb = prob;
                  } else {
                    reference += separator + actual;
                    if (prob > currentProb) {
                      currentProb = prob;
                    }
                  }
                }
              }
            } else if (label === "<other>") {
              if (reference !== null) {
                if (currentPatent) {
                  referencesPatent.push(reference);
                  offsetsPatent.push(currentOffset);
                  probPatent.push(currentProb);
                } else {
                  referencesNPL.push(reference);
                  offsetsNPL.push(currentOffset);
                  probNPL.push(currentProb);
                }
                currentPatent = false;
              }
              reference = null;
              currentProb = 0.0;
            }
          }
          offset += addedOffset;
          addedOffset = 0;
        }

        // run reference patent parser in isolation, and produce some traces
        let j: number = 0;
        for (const ref of referencesPatent) {
          this.patentParser!.setRawRefText(ref);
          this.patentParser!.setRawRefTextOffset(offsetsPatent[j] as number);
          const patents0: PatentItem[] = this.patentParser!.processRawRefText();
          for (const pat of patents0) {
            pat.setContext(ref);
            pat.setConf(probPatent[j] as number);
            patents.push(pat);
            // NOTE: upstream line 743 — `//allIndexSegmentPatent.add(index);` (commented-out).

            let localList = patentsBySegment.get(index);
            if (localList === undefined || localList === null) {
              localList = [];
            }
            localList.push(pat);
            patentsBySegment.set(index, localList);

            // NOTE: upstream lines 752-791 — large commented-out debug block enumerating
            // pat.getApplication()/getReissued()/getPlant()/getKindCode() and printing offsets.
          }
          j++;
        }

        if (referencesNPL.length > 0) {
          allReferencesNPL.push(...referencesNPL);
          allOffsetsNPL.push(...offsetsNPL);
          allProbNPL.push(...probNPL);
          for (const _ref of referencesNPL) {
            void _ref;
            localIndexSegmentNPL.push(index);
          }
        }
      }

      // NOTE: upstream lines 807-822 — commented-out duplicate-number filtering block.

      if (articles !== null && allReferencesNPL.length > 0) {
        let k: number = 0;
        const bibResults: (BiblioItem | null)[] | null = await this.parsers
          .getCitationParser()
          .processingStringMultiple(allReferencesNPL, consolidate);
        for (const ref of allReferencesNPL) {
          const result: BiblioItem | null = bibResults !== null ? bibResults[k] ?? null : null;
          if (result === null) {
            k++;
            continue;
          }
          const bds = new BibDataSet();
          result.setReference(ref);
          bds.setResBib(result);
          bds.setRawBib(ref);
          bds.addOffset(allOffsetsNPL[k] as number);
          bds.setConfidence(allProbNPL[k] as number);
          articles.push(bds);
          // NOTE: upstream line 840 — `//allIndexSegmentNPL.add(localIndexSegmentNPL.get(k));` (commented-out).

          let localList = articlesBySegment.get(localIndexSegmentNPL[k] as number);
          if (localList === undefined || localList === null) {
            localList = [];
          }
          localList.push(bds);
          articlesBySegment.set(localIndexSegmentNPL[k] as number, localList);

          k++;
        }
      }
    } catch (e) {
      throw new GrobidException("An exception occured while running Grobid.", e);
    }

    const resultTEI: string[] = [];
    resultTEI.push(
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<TEI xml:space="preserve" xmlns="http://www.tei-c.org/ns/1.0" ' +
        'xmlns:xlink="http://www.w3.org/1999/xlink">\n',
    );

    resultTEI.push("\t<teiHeader/>\n");
    resultTEI.push("\t<text>\n");

    let index: number = 0; // index in tokenized text segment list
    // NOTE: upstream lines 865-866 — `int positionInIndexPatent = 0; int positionInIndexNPL = 0;`
    // declared but never read. Preserved verbatim.
    let positionInIndexPatent = 0;
    let positionInIndexNPL = 0;
    void positionInIndexPatent;
    void positionInIndexNPL;

    for (const tokens of allTokenizations) {
      // do we have a reference in this text segment ?
      const localPatentsBySegment = patentsBySegment.get(index) ?? null;
      const localArticlesBySegment = articlesBySegment.get(index) ?? null;

      if (
        (localPatentsBySegment !== null && localPatentsBySegment.length > 0) ||
        (localArticlesBySegment !== null && localArticlesBySegment.length > 0)
      ) {
        // output text
        const divID = KeyGen.getKey().substring(0, 7);
        resultTEI.push("\t\t<div>\n");
        resultTEI.push('\t\t\t<p id="_' + divID + '">');
        let text = LayoutTokensUtil.toText(tokens);
        // not affecting offsets:
        text = text.replace(/\n/g, " ").replace(/\t/g, " ");
        resultTEI.push(TextUtilities.HTMLEncode(text) ?? "");
        resultTEI.push("</p>\n");
        resultTEI.push('\t\t\t<div type="references">\n');
        if (localPatentsBySegment !== null && localPatentsBySegment.length > 0) {
          for (const patentCitation of localPatentsBySegment) {
            // upstream: patentCitation.toTEI(true, divID) — `true` here means with offsets
            resultTEI.push(patentCitation.toTEI(true, divID) + "\n");
          }
        }
        if (localArticlesBySegment !== null && localArticlesBySegment.length > 0) {
          for (const articleCitation of localArticlesBySegment) {
            resultTEI.push(articleCitation.toTEI(includeRawCitations) + "\n");
          }
        }
        resultTEI.push("\t\t\t</div>\n");
        resultTEI.push("\t\t</div>\n");
      }

      index++;
    }

    resultTEI.push("\t</text>\n");
    resultTEI.push("</TEI>");

    return resultTEI.join("");
  }

  /**
   * Annotate all reference from a list of layout tokens and return annotation results in a JSON document.
   *
   * Upstream line 908-1441.
   */
  async annotateAllReferences(
    doc: Document,
    tokenizations: LayoutToken[],
    filterDuplicate: boolean,
    consolidate: number,
    includeRawCitations: boolean,
    patents: PatentItem[] | null,
    articles: BibDataSet[] | null,
  ): Promise<string | null> {
    void includeRawCitations;
    try {
      if (tokenizations.length === 0) {
        return null;
      }

      // if parameters are null, these lists will only be valid in the method
      if (patents === null) {
        patents = [];
      }

      if (articles === null) {
        articles = [];
      }

      // parser for patent references
      if (this.patentParser === null) {
        this.patentParser = new PatentRefParser();
      }
      // parser for non patent references

      // tokenisation for the CRF parser (with punctuation as tokens)
      const patentBlocks: string[] = [];

      // identify the language of the patent document, we use only the last 500 characters
      // which is enough normally for a very safe language prediction
      // the text here is the patent description, so strictly monolingual
      const textBuffer: string[] = [];
      let accumulated: number = 0;
      for (let n: number = tokenizations.length - 1; n > 0; n--) {
        const token = tokenizations[n] as LayoutToken;
        if (token !== null && token.getText() !== null) {
          textBuffer.unshift(token.getText() as string);
          accumulated += (token.getText() as string).length;
        }
        if (accumulated > 500) break;
      }
      let text: string = textBuffer.join("");
      text = text.replace(/\n/g, " ").replace(/\t/g, " ");
      const lang = this.languageUtilities.runLanguageId(text);
      // NOTE: upstream line 958 — `//List<String> tokenizations = analyzer.tokenize(lang, text);` (commented-out).
      void lang;
      let offset: number = 0;

      let journalPositions: OffsetPosition[] | null = null;
      let abbrevJournalPositions: OffsetPosition[] | null = null;
      let conferencePositions: OffsetPosition[] | null = null;
      let publisherPositions: OffsetPosition[] | null = null;

      // NOTE: upstream line 966 — `//if (articles != null)` (commented-out).
      {
        journalPositions = this.lexicon.tokenPositionsJournalNames(text);
        abbrevJournalPositions = this.lexicon.tokenPositionsAbbrevJournalNames(text);
        conferencePositions = this.lexicon.tokenPositionsConferenceNames(text);
        publisherPositions = this.lexicon.tokenPositionsPublisherNames(text);
      }

      let isJournalToken = false;
      let isAbbrevJournalToken = false;
      let isConferenceToken = false;
      let isPublisherToken = false;
      let currentJournalPositions = 0;
      let currentAbbrevJournalPositions = 0;
      let currentConferencePositions = 0;
      let currentPublisherPositions = 0;
      let skipTest = false;
      // NOTE: upstream lines 983-984 — commented-out `StringTokenizer` setup.
      let posit: number = 0;
      // NOTE: upstream line 986 — `//while (st.hasMoreTokens()) {` (commented-out).
      for (const token of tokenizations) {
        const tok: string = token.getText() ?? "";
        isJournalToken = false;
        isAbbrevJournalToken = false;
        isConferenceToken = false;
        isPublisherToken = false;
        skipTest = false;
        // NOTE: upstream line 994 — `//String tok = st.nextToken();` (commented-out).
        if (
          tok.trim().length === 0 ||
          tok === " " ||
          tok === "\t" ||
          tok === "\n" ||
          tok === "\r"
        ) {
          posit++;
          continue;
        }

        // check the position of matches for journals
        if (journalPositions !== null) {
          if (currentJournalPositions === journalPositions.length - 1) {
            if (journalPositions[currentJournalPositions]!.end < posit) {
              skipTest = true;
            }
          }
          if (!skipTest) {
            for (let i = currentJournalPositions; i < journalPositions.length; i++) {
              if (
                journalPositions[i]!.start <= posit &&
                journalPositions[i]!.end >= posit
              ) {
                isJournalToken = true;
                currentJournalPositions = i;
                break;
              } else if (journalPositions[i]!.start > posit) {
                isJournalToken = false;
                currentJournalPositions = i;
                break;
              }
            }
          }
        }

        // check the position of matches for abbreviated journals
        skipTest = false;
        if (abbrevJournalPositions !== null) {
          if (currentAbbrevJournalPositions === abbrevJournalPositions.length - 1) {
            if (abbrevJournalPositions[currentAbbrevJournalPositions]!.end < posit) {
              skipTest = true;
            }
          }
          if (!skipTest) {
            for (let i = currentAbbrevJournalPositions; i < abbrevJournalPositions.length; i++) {
              if (
                abbrevJournalPositions[i]!.start <= posit &&
                abbrevJournalPositions[i]!.end >= posit
              ) {
                isAbbrevJournalToken = true;
                currentAbbrevJournalPositions = i;
                break;
              } else if (abbrevJournalPositions[i]!.start > posit) {
                isAbbrevJournalToken = false;
                currentAbbrevJournalPositions = i;
                break;
              }
            }
          }
        }

        // check the position of matches for conference names
        skipTest = false;
        if (conferencePositions !== null) {
          if (currentConferencePositions === conferencePositions.length - 1) {
            if (conferencePositions[currentConferencePositions]!.end < posit) {
              skipTest = true;
            }
          }
          if (!skipTest) {
            for (let i = currentConferencePositions; i < conferencePositions.length; i++) {
              if (
                conferencePositions[i]!.start <= posit &&
                conferencePositions[i]!.end >= posit
              ) {
                isConferenceToken = true;
                currentConferencePositions = i;
                break;
              } else if (conferencePositions[i]!.start > posit) {
                isConferenceToken = false;
                currentConferencePositions = i;
                break;
              }
            }
          }
        }

        // check the position of matches for publisher names
        skipTest = false;
        if (publisherPositions !== null) {
          if (currentPublisherPositions === publisherPositions.length - 1) {
            if (publisherPositions[currentPublisherPositions]!.end < posit) {
              skipTest = true;
            }
          }
          if (!skipTest) {
            for (let i = currentPublisherPositions; i < publisherPositions.length; i++) {
              if (
                publisherPositions[i]!.start <= posit &&
                publisherPositions[i]!.end >= posit
              ) {
                isPublisherToken = true;
                currentPublisherPositions = i;
                break;
              } else if (publisherPositions[i]!.start > posit) {
                isPublisherToken = false;
                currentPublisherPositions = i;
                break;
              }
            }
          }
        }

        const featureVector = FeaturesVectorReference.addFeaturesPatentReferences(
          new LayoutToken(tok),
          null,
          tokenizations.length,
          posit,
          isJournalToken,
          isAbbrevJournalToken,
          isConferenceToken,
          isPublisherToken,
        );
        patentBlocks.push(featureVector.printVector() ?? "");
        posit++;
      }

      patentBlocks.push("\n");

      let theResult: string | null = null;
      theResult = await this.taggerAll!.label(patentBlocks);
      // NOTE: upstream line 1116 — `//System.out.println(theResult);` (commented-out).

      const stt: string[] = theResult!.split("\n");

      const referencesPatent: string[] = [];
      const referencesNPL: string[] = [];
      const offsets_patent: number[] = [];
      const offsets_NPL: number[] = [];
      const probPatent: number[] = [];
      const probNPL: number[] = [];

      let currentPatent: boolean = true; // type of current reference
      let reference: string | null = null;
      let currentProb: number = 0.0;
      offset = 0;
      let currentOffset: number = 0;
      let addedOffset: number = 0;
      let label: string | null = null; // label
      let actual: string | null = null; // token
      let p: number = 0; // iterator for the tokenizations for restauring the original tokenization with
      // respect to spaces

      for (const lineRaw of stt) {
        const line = lineRaw;
        if (line.trim().length === 0) {
          continue;
        }

        const st2: string[] = line.split(/[\t ]+/).filter((s) => s.length > 0);
        let start: boolean = true;
        let separator: string = "";
        label = null;
        actual = null;
        let st2Idx = 0;
        while (st2Idx < st2.length) {
          if (start) {
            actual = st2[st2Idx++]!.trim();
            start = false;

            let strop: boolean = false;
            while (!strop && p < tokenizations.length) {
              const tokenOriginal = tokenizations[p] as LayoutToken;
              if (tokenOriginal === null || tokenOriginal.getText() === null) {
                // NOTE: upstream line 1157-1158 — `continue` without advancing `p`,
                // which would loop forever in Java. Preserved verbatim — relies on
                // tokens not being null in practice.
                continue;
              }
              const tokOriginal: string = tokenOriginal.getText() as string;

              addedOffset += tokOriginal.length;
              if (tokOriginal === " ") {
                separator += tokOriginal;
              } else if (tokOriginal === actual) {
                strop = true;
              }
              p++;
            }
          } else {
            label = st2[st2Idx++]!.trim();
          }
        }

        if (label === null) {
          offset += addedOffset;
          addedOffset = 0;
          continue;
        }

        let prob: number = 0.0;
        const segProb: number = label.lastIndexOf("/");
        if (segProb !== -1) {
          const probString: string = label.substring(segProb + 1, label.length);
          // NOTE: upstream line 1184 — `//System.out.println("given prob: " + probString);` (commented-out).
          try {
            prob = parseFloat(probString);
            if (Number.isNaN(prob)) throw new Error("NaN");
            // NOTE: upstream line 1187 — `//System.out.println("given prob: " + probString + ", parsed: " + prob);`
          } catch (_e) {
            LOGGER.debug(probString + " cannot be parsed.");
            prob = 0.0;
          }
          label = label.substring(0, segProb);
        }

        if (actual !== null) {
          if (label.endsWith("<refPatent>")) {
            if (reference === null) {
              reference = separator + actual;
              currentOffset = offset;
              currentPatent = true;
              currentProb = prob;
            } else {
              if (currentPatent) {
                if (label === "I-<refPatent>") {
                  referencesPatent.push(reference);
                  offsets_patent.push(currentOffset);

                  probPatent.push(currentProb);

                  currentPatent = true;
                  reference = separator + actual;
                  currentOffset = offset;
                  currentProb = prob;
                } else {
                  reference += separator + actual;
                  if (prob > currentProb) {
                    currentProb = prob;
                  }
                }
              } else {
                referencesNPL.push(reference);
                offsets_NPL.push(currentOffset);
                probNPL.push(currentProb);

                currentPatent = true;
                reference = separator + actual;
                currentOffset = offset;
                currentProb = prob;
              }
            }
          } else if (label.endsWith("<refNPL>")) {
            if (reference === null) {
              reference = separator + actual;
              currentOffset = offset;
              currentPatent = false;
              currentProb = prob;
            } else {
              if (currentPatent) {
                referencesPatent.push(reference);
                offsets_patent.push(currentOffset);
                probPatent.push(currentProb);

                currentPatent = false;
                reference = separator + actual;
                currentOffset = offset;
                currentProb = prob;
              } else {
                if (label === "I-<refNPL>") {
                  referencesNPL.push(reference);
                  offsets_NPL.push(currentOffset);
                  probNPL.push(currentProb);

                  currentPatent = false;
                  reference = separator + actual;
                  currentOffset = offset;
                  currentProb = prob;
                } else {
                  reference += separator + actual;
                  if (prob > currentProb) {
                    currentProb = prob;
                  }
                }
              }
            }
          } else if (label === "<other>") {
            if (reference !== null) {
              if (currentPatent) {
                referencesPatent.push(reference);
                offsets_patent.push(currentOffset);
                probPatent.push(currentProb);
              } else {
                referencesNPL.push(reference);
                offsets_NPL.push(currentOffset);
                probNPL.push(currentProb);
              }
              currentPatent = false;
            }
            reference = null;
            currentProb = 0.0;
          }
        }
        offset += addedOffset;
        addedOffset = 0;
      }

      // run reference patent parser in isolation, and produce some traces
      let j: number = 0;
      for (const ref of referencesPatent) {
        this.patentParser!.setRawRefText(ref);
        this.patentParser!.setRawRefTextOffset(offsets_patent[j] as number);
        const patents0: PatentItem[] = this.patentParser!.processRawRefText();
        for (const pat of patents0) {
          pat.setContext(ref);
          pat.setConf(probPatent[j] as number);
          patents.push(pat);

          // get the list of LayoutToken corresponding to the offset positions
          const localTokens: LayoutToken[] | null = Document.getTokens(
            tokenizations,
            pat.getOffsetBegin(),
            pat.getOffsetEnd(),
          );
          // associate the corresponding bounding box
          if (localTokens !== null && localTokens.length > 0) {
            pat.setCoordinates(BoundingBoxCalculator.calculate(localTokens));
          }

          // NOTE: upstream lines 1305-1344 — large commented-out debug block.
        }
        j++;
      }

      // list for filtering duplicates, if we want to ignore the duplicate numbers
      const numberListe: string[] = [];
      if (filterDuplicate) {
        // list for filtering duplicates, if we want to ignore the duplicate numbers
        const toRemove: PatentItem[] = [];
        for (const pat of patents) {
          if (!numberListe.includes(pat.getNumberEpoDoc() ?? "")) {
            numberListe.push(pat.getNumberEpoDoc() ?? "");
          } else {
            toRemove.push(pat);
          }
        }

        for (const pat of toRemove) {
          const idx = patents.indexOf(pat);
          if (idx !== -1) patents.splice(idx, 1);
        }
      }

      if (articles !== null) {
        let k: number = 0;
        const bibResults: (BiblioItem | null)[] | null = await this.parsers
          .getCitationParser()
          .processingStringMultiple(referencesNPL, consolidate);
        for (const ref of referencesNPL) {
          const result: BiblioItem | null = bibResults !== null ? bibResults[k] ?? null : null;
          if (result === null) {
            k++;
            continue;
          }
          const bds = new BibDataSet();
          result.setReference(ref);
          bds.setResBib(result);
          bds.setRawBib(ref);
          bds.addOffset(offsets_NPL[k] as number);
          // NOTE: upstream line 1381 — `//bds.setConfidence(probNPL.get(k).doubleValue());` (commented-out).
          void probNPL;
          articles.push(bds);
          k++;
        }
      }
    } catch (e) {
      throw new GrobidException("An exception occured while running Grobid.", e);
    }
    let nbs: number = 0;
    if (patents !== null) {
      nbs = patents.length;
    }
    if (articles !== null) nbs += articles.length;
    // NOTE: upstream computes `nbs` but never reads it. Preserved verbatim.
    void nbs;

    const resultJson: string[] = [];
    resultJson.push("{");

    // page height and width
    const pages: Page[] | null = doc.getPages();
    let pageNumber: number = 1;
    resultJson.push('"pages": [');
    if (pages !== null) {
      for (const page of pages) {
        if (pageNumber > 1) resultJson.push(", ");

        resultJson.push('{"page_height":' + page.getHeight());
        resultJson.push(', "page_width":' + page.getWidth() + "}");
        pageNumber++;
      }
    }
    resultJson.push("]");

    if (patents !== null) {
      resultJson.push(', "patents": [');
      let first: boolean = true;
      for (const patentCitation of patents) {
        if (first) first = false;
        else resultJson.push(", ");
        resultJson.push(patentCitation.toJson(null, true)); // with coordinates
      }
      resultJson.push("]");
    }

    if (articles !== null) {
      resultJson.push(', "articles": [');
      // NOTE: upstream lines 1428-1437 — `first` flag is declared and the loop
      // body is fully commented out. The articles array is therefore always
      // emitted as `[]`. Preserved verbatim.
      let first: boolean = true;
      void first;
      for (const articleCitation of articles) {
        void articleCitation;
        /* NOTE: upstream lines 1430-1434 — commented-out body:
              if (first) first = false;
              else resultJson.append(", ");
              resultJSON.append(articleCitation.toJson(); */
      }
      resultJson.push("]");
    }
    resultJson.push("}");

    return resultJson.join("");
  }

  /**
   * Get the TEI XML string corresponding to the recognized citation section for
   * a particular citation.
   *
   * Upstream line 1443-1462.
   */
  reference2TEI(i: number): string {
    let result: string = "";

    if (this.resBib !== null) {
      if (i <= this.resBib.length) {
        const bib: BibDataSet = this.resBib[i] as BibDataSet;
        const bit: BiblioItem | null = bib.getResBib();
        if (bit !== null) {
          if (this.path !== null) {
            bit.setPath(this.path);
          }
          result += bit.toTEI(i);
        }
      }
    }

    return result;
  }

  /**
   * Get the BibTeX string corresponding to the recognized citation section.
   *
   * Upstream line 1464-1479.
   */
  references2BibTeX(): string {
    let result: string = "";

    if (this.resBib !== null) {
      for (const bib of this.resBib) {
        const bit: BiblioItem | null = bib.getResBib();
        if (bit !== null) {
          if (this.path !== null) {
            bit.setPath(this.path);
          }
          result += "\n" + bit.toBibTeX();
        }
      }
    }

    return result;
  }

  /**
   * Get the TEI XML string corresponding to the recognized citation section,
   * with pointers and advanced structuring.
   *
   * Upstream line 1481-1499.
   */
  references2TEI(): string {
    let result: string = "<listbibl>\n";

    let p: number = 0;
    if (this.resBib !== null) {
      for (const bib of this.resBib) {
        const bit: BiblioItem | null = bib.getResBib();
        if (bit !== null) {
          // Fixed from upstream: upstream's check is `if (path == null)
          // bit.setPath(path)` — clearly inverted (the sibling
          // `reference2TEI` gets it right). Corrected to `!== null`.
          if (this.path !== null) {
            bit.setPath(this.path);
          }
          result += "\n" + bit.toTEI(p);
        }
        p++;
      }
    }
    result += "\n</listbibl>\n";
    return result;
  }

  /**
   * Get the BibTeX string corresponding to the recognized citation section
   * for a given citation.
   *
   * Upstream line 1502-1520.
   */
  reference2BibTeX(i: number): string {
    let result: string = "";

    if (this.resBib !== null) {
      if (i <= this.resBib.length) {
        const bib: BibDataSet = this.resBib[i] as BibDataSet;
        const bit: BiblioItem | null = bib.getResBib();
        if (bit !== null) {
          // Fixed from upstream: same inverted null-check as `references2TEI`.
          // Corrected to `!== null`.
          if (this.path !== null) {
            bit.setPath(this.path);
          }
          result += bit.toBibTeX();
        }
      }
    }
    return result;
  }

  /**
   * Annotate XML files with extracted reference results. Not used.
   *
   * Upstream line 1522-1578.
   */
  private annotate(file: string, patents: PatentItem[], articles: BibDataSet[]): void {
    try {
      // we simply rewrite lines based on identified reference strings without parsing
      // special care for line breaks in the middle of a reference
      const sources: string[] = [];
      const targets: string[] = [];
      for (const pi of patents) {
        const context = pi.getContext();
        const source = context ?? "";
        sources.push(source);

        const target: string = " <patcit>" + (context ?? "") + "</patcit> ";
        targets.push(target);
        // eslint-disable-next-line no-console
        console.log(source + " -> " + target);
      }

      for (const bi of articles) {
        const context = bi.getRawBib();
        // we compile the corresponding regular expression
        const source = context ?? ""; // NOTE: upstream line 1546 — `//.replace(" ", "( |\\n)");` (commented-out).
        sources.push(source);

        const target: string = " <nplcit>" + (context ?? "") + "</nplcit> ";
        targets.push(target);
        // eslint-disable-next-line no-console
        console.log(source + " -> " + target);
      }

      // Upstream reads the file as UTF-8 line by line, joining with "\n".
      const raw: string = readFileSync(file, "utf-8");
      // Java BufferedReader.readLine() strips line terminators and the loop
      // appends "\n" after each line. Match that exactly.
      const content: string[] = [];
      // Split keeping line endings out — Java's readLine matches \n, \r, \r\n.
      const lines: string[] = raw.split(/\r\n|\r|\n/);
      // The last element of `lines` represents the unterminated trailing
      // content; only treat it as a "line" if it is non-empty, mirroring
      // BufferedReader semantics that yield `null` at EOF without an extra
      // empty line.
      for (let li = 0; li < lines.length; li++) {
        if (li === lines.length - 1 && lines[li] === "") break;
        content.push(lines[li] as string);
        content.push("\n");
      }
      let i: number = 0;
      let contentString: string = content.join("");
      for (const source of sources) {
        const target: string = targets[i] as string;
        contentString = contentString.split(source).join(target);
        i++;
      }
      // eslint-disable-next-line no-console
      console.log(contentString);
    } catch (e) {
      throw new GrobidException("An exception occured while running Grobid.", e);
    }
  }

  /**
   * Annotate a new XML patent document based on training data format with the current model.
   *
   * @param documentPath    is the path to the file to be processed
   * @param newTrainingPath new training path
   *
   * Upstream line 1580-1744.
   */
  async generateTrainingData(documentPath: string | null, newTrainingPath: string | null): Promise<void> {
    if (documentPath === null) {
      throw new GrobidResourceException(
        "Cannot process the patent file, because the document path is null.",
      );
    }
    if (!documentPath.endsWith(".xml") && !documentPath.endsWith(".xml.gz")) {
      throw new GrobidResourceException(
        "Only patent XML files (ST.36 or Marec) can be processed to " +
          "generate traning data.",
      );
    }

    const documentFile: string = documentPath;
    if (!existsSync(documentFile)) {
      throw new GrobidResourceException(
        "Cannot process the patent file, because path '" +
          path.resolve(documentFile) +
          "' does not exists.",
      );
    }

    if (newTrainingPath === null) {
      GrobidProperties.getInstance();
      newTrainingPath = GrobidProperties.getTempPath();
    }

    const newTrainingFile: string = newTrainingPath;
    if (!existsSync(newTrainingFile)) {
      throw new GrobidResourceException(
        "Cannot process the patent file, because path '" +
          path.resolve(newTrainingFile) +
          "' does not exists.",
      );
    }

    try {
      // first pass: we get the text to be processed
      const sax = new TextSaxParser();
      sax.addFilter("description");
      sax.addFilter("p");
      sax.addFilter("heading");
      sax.addFilter("head");

      const xml = ReferenceExtractor._readMaybeGzipUtf8(documentPath);
      sax.parse(xml);

      const descriptionSegments: string[] = sax.getTexts();
      const currentPatentNumber: string | null = sax.currentPatentNumber;

      const patents: PatentItem[] = [];
      const articles: BibDataSet[] = [];

      // we process the patent description
      if (descriptionSegments !== null && descriptionSegments.length > 0) {
        await this.extractAllReferencesString(descriptionSegments, false, 0, false, patents, articles);
        // second pass: we add annotations corresponding to identified citation chunks based on
        // stored offsets
        const outputBuffer: string[] = [];
        const writer: Writer = {
          write: (s: string): void => {
            outputBuffer.push(s);
          },
        };

        const saxx = new PatentAnnotationSaxParser();
        saxx.setWriter(writer);
        saxx.setPatents(patents);
        saxx.setArticles(articles);

        saxx.parse(xml);

        writeFileSync(
          path.join(newTrainingPath, (currentPatentNumber ?? "") + ".training.xml"),
          outputBuffer.join(""),
          { encoding: "utf-8" },
        );

        // last, we generate the training data corresponding to the parsing of the identified NPL citations

        // buffer for the reference block
        const allBufferReference: string[] = [];
        const inputs: string[] = [];
        for (const article of articles) {
          const refString: string | null = article.getRawBib();

          if (refString !== null && refString.trim().length > 1) {
            inputs.push(refString.trim());
          }
        }

        if (inputs.length > 0) {
          for (const inpu of inputs) {
            const inpus: string[] = [];
            inpus.push(inpu);
            // NOTE: upstream returns StringBuilder; the TS port returns string[]
            // representing the same accumulated content. Joining mirrors
            // `bufferReference.toString()`.
            const bufferReference: string[] | null = await this.parsers
              .getCitationParser()
              .trainingExtraction(inpus);
            if (bufferReference !== null) {
              allBufferReference.push(bufferReference.join("") + "\n");
            }
          }
        }

        // NOTE: upstream line 1725 — `if (allBufferReference != null)` is always
        // true (StringBuilder is local and just constructed). Preserved verbatim.
        if (allBufferReference !== null) {
          if (allBufferReference.length > 0) {
            const out: string[] = [];
            out.push('<?xml version="1.0" encoding="UTF-8"?>\n');
            out.push("<citations>\n");
            out.push(allBufferReference.join(""));
            out.push("</citations>\n");
            writeFileSync(
              path.join(
                newTrainingPath,
                (currentPatentNumber ?? "") + ".training.references.xml",
              ),
              out.join(""),
              { encoding: "utf-8" },
            );
          }
        }
      }
    } catch (e) {
      throw new GrobidException("An exception occured while running Grobid.", e);
    }
  }

  /**
   * Get a patent description by its number and OPS.
   *
   * Upstream line 1746-1766. `OPSService.descriptionRetrieval` is async in TS;
   * therefore `getDocOPS` is async too.
   */
  async getDocOPS(num: string): Promise<boolean> {
    try {
      if (this.ops === null) this.ops = new OPSService();
      const description: string | null = await this.ops.descriptionRetrieval(num);
      if (description === null) return false;
      else if (description.length < 600) return false;
      else {
        this.descriptionSegments = [];
        this.descriptionSegments.push(description);
        return true;
      }
    } catch (e) {
      throw new GrobidException("An exception occured while running Grobid.", e);
    }
  }

  /**
   * Write the list of extracted references in an XML file.
   *
   * Upstream line 1768-1825. Upstream uses OutputStreamWriter on a file path;
   * TS uses `writeFileSync` with utf-8 encoding.
   */
  generateXMLReport(file: string, patents: PatentItem[], articles: BibDataSet[]): void {
    try {
      const content: string[] = [];
      // header
      content.push('<?xml version="1.0" encoding="UTF-8"?>\n');

      if (patents.length > 0 || articles.length > 0) content.push("<citations>\n");
      if (patents.length > 0) content.push("<patent-citations>\n");

      let i: number = 0;
      for (const pi of patents) {
        let dnum: string = (pi.getAuthority() ?? "") + (pi.getNumberEpoDoc() ?? "");
        if (pi.getKindCode() !== null) dnum += pi.getKindCode();
        // NOTE: upstream line 1791 — `"<patcit if=\"pcit" + i + " dnum=\"" + dnum + "\">..."`
        // is missing a closing `"` on the `if` attribute (the literal contains
        // `pcit0 dnum=`). The resulting XML is malformed. Preserved verbatim.
        content.push(
          '<patcit if="pcit' +
            i +
            ' dnum="' +
            dnum +
            '">' +
            "<text>" +
            (pi.getContext() ?? "") +
            "</text></patcit>",
        );
        content.push("\n");
        i++;
      }

      if (patents.length > 0) content.push("</patent-citations>\n");

      if (articles.length > 0) content.push("<npl-citations>\n");

      i = 0;
      for (const bds of articles) {
        content.push('<nplcit if="ncit' + i + '">');
        const res: BiblioItem | null = bds.getResBib();
        if (res !== null) content.push(res.toTEI(i));
        content.push("<text>" + (bds.getRawBib() ?? "") + "</text></nplcit>");
        content.push("\n");
        i++;
      }

      if (articles.length > 0) content.push("</npl-citations>\n");

      if (patents.length > 0 || articles.length > 0) content.push("</citations>\n");

      writeFileSync(file, content.join(""), { encoding: "utf-8" });
    } catch (e) {
      throw new GrobidException("An exception occured while running Grobid.", e);
    }
  }

  /**
   * Not used. Upstream line 1827-1855.
   */
  private static checkPositionRange(
    currentPosition: number,
    posit: number,
    positions: OffsetPosition[],
  ): boolean {
    let isInRange: boolean = false;
    let skipTest: boolean = false;
    if (currentPosition === positions.length - 1) {
      if (positions[currentPosition]!.end < posit) {
        skipTest = true;
      }
    }
    if (!skipTest) {
      for (let i = currentPosition; i < positions.length; i++) {
        if (positions[i]!.start <= posit && positions[i]!.end >= posit) {
          isInRange = true;
          // NOTE: upstream lines 1845, 1849 — assigns to local parameter
          // `currentPosition`; never propagates out. Preserved verbatim.
          currentPosition = i;
          break;
        } else if (positions[i]!.start > posit) {
          isInRange = false;
          currentPosition = i;
          break;
        }
      }
    }
    return isInRange;
  }

  /**
   * Upstream line 1857-1861. `Closeable.close()` — TS doesn't have `Closeable`;
   * keeping the method shape so callers can release the tagger.
   */
  close(): void {
    if (this.taggerAll !== null) {
      this.taggerAll.close();
    }
    this.taggerAll = null;
  }

  /**
   * Helper for XML-file entry points. Reads a possibly gzipped XML file from
   * disk and returns its UTF-8 decoded contents.
   */
  private static _readMaybeGzipUtf8(filePath: string): string {
    if (filePath.endsWith(".gz")) {
      const raw = readFileSync(filePath);
      const unzipped = gunzipSync(raw);
      return unzipped.toString("utf-8");
    }
    return readFileSync(filePath, "utf-8");
  }
}
