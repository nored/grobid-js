// Port of org.grobid.core.engines.HeaderParser.
// Upstream: grobid-core/src/main/java/org/grobid/core/engines/HeaderParser.java
//
// Audit-relevant preserved-verbatim quirks (see also UPSTREAM-BUGS.md):
// - "Take only first <title> cluster" (lines 853-855 upstream): the
//   resultExtraction body guards `if (biblio.getTitle() == null)` and silently
//   drops any subsequent title cluster.
// - "Take only first <abstract> cluster" (lines 951-961 upstream): the second
//   and subsequent abstract clusters are dropped on the floor (the
//   "// TODO: avoid dumping text on the floor" comment from upstream is
//   preserved verbatim).
// - HEADER_PUBNUM block (994-1003): when an additional pubnum cluster is
//   "different and not included" upstream temporarily swaps the pubnum field,
//   calls checkIdentifier() on the new content, then RESTORES the original
//   pubnum — so the new content's identifier classification is captured but
//   the visible field stays as the first pubnum. Preserved verbatim.
// - fragmentedAuthors positional attachment (lines 244-264): if the author
//   region was split by "\t" AND there are no markers AND the # of affiliation
//   blocks equals the # of author segments, affiliations are attached
//   positionally and the global fullAffiliations / affiliation are nulled out.
// - Person.sanityCheck / Person.deduplicate calls (lines 234, 270).
//
// Adaptations:
// - Apache `Pair.of` → constructed via local Pair wrapper.
// - Apache `Optional<Date>` → `GrobidDate | null`.
// - `cntManager` on AbstractParser is a port-stub field; accessed via cast.

import { GrobidModels } from "../grobid-models.js";
import { BiblioItem } from "../data/biblio-item.js";
import { Date as GrobidDate } from "../data/date.js";
import { Keyword } from "../data/keyword.js";
import { Person } from "../data/person.js";
import type { CopyrightsLicense } from "../data/copyrights-license.js";
import { Document } from "../document/document.js";
import { DocumentPiece } from "../document/document-piece.js";
import { DocumentSource } from "../document/document-source.js";
import { TEIFormatter } from "../document/tei-formatter.js";
import { GrobidAnalysisConfig } from "./config/grobid-analysis-config.js";
import { SegmentationLabels } from "./label/segmentation-labels.js";
import type { TaggingLabel } from "./label/tagging-label.js";
import { TaggingLabels } from "./label/tagging-labels.js";
import { GrobidException } from "../exceptions/grobid-exception.js";
import { FeatureFactory } from "../features/feature-factory.js";
import { FeaturesVectorHeader } from "../features/features-vector-header.js";
import { Language } from "../lang/language.js";
import { detectScript, NON_LATIN_SCRIPTS } from "../utilities/script-detector.js";
import { Block } from "../layout/block.js";
import { LayoutToken } from "../layout/layout-token.js";
import { Lexicon } from "../lexicon/lexicon.js";
import type { TaggingTokenCluster } from "../tokenization/tagging-token-cluster.js";
import { TaggingTokenClusteror } from "../tokenization/tagging-token-clusteror.js";
import { LanguageUtilities } from "../utilities/language-utilities.js";
import { LayoutTokensUtil } from "../utilities/layout-tokens-util.js";
import type { OffsetPosition } from "../utilities/offset-position.js";
import { TextUtilities } from "../utilities/text-utilities.js";
import { Consolidation } from "../utilities/consolidation.js";
import { GrobidProperties } from "../utilities/grobid-properties.js";
import { Pair } from "../utilities/pair.js";
import { LicenseClassifier } from "./license-classifier.js";
import type { CntManager } from "../utilities/counters/cnt-manager.js";
import type { Flavor } from "../grobid-models.js";
import { getLogger } from "../utilities/logger.js";
// AbstractParser/EngineParsers are still port stubs (sibling subagents);
// Engine is ported.
import { AbstractParser } from "./abstract-parser.js";
import { EngineParsers } from "./engine-parsers.js";
import { Engine } from "./engine.js";

const LOGGER = getLogger("HeaderParser");

export class HeaderParser extends AbstractParser {
  private languageUtilities: LanguageUtilities = LanguageUtilities.getInstance();

  private parsers: EngineParsers;

  // default bins for relative position
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private static readonly NBBINS_POSITION: number = 12;

  // default bins for inter-block spacing
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private static readonly NBBINS_SPACE: number = 5;

  // default bins for block character density
  private static readonly NBBINS_DENSITY: number = 5;

  // projection scale for line length
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private static readonly LINESCALE: number = 10;

  private lexicon: Lexicon = Lexicon.getInstance();

  constructor(parsers: EngineParsers);
  constructor(parsers: EngineParsers, cntManager: CntManager);
  constructor(parsers: EngineParsers, flavor: Flavor | null);
  constructor(parsers: EngineParsers, cntManager: CntManager, flavor: Flavor | null);
  constructor(parsers: EngineParsers, b?: CntManager | Flavor | null, c?: Flavor | null) {
    // Determine which overload was called by detecting the runtime shape of `b`.
    // A CntManager is a plain object with `i`/`cnt`/... methods; a Flavor is a
    // string-keyed singleton with `name`/`ext`. We discriminate on the presence
    // of `i` (counter interface).
    const isCntManager = (x: unknown): x is CntManager =>
      typeof x === "object" && x !== null && typeof (x as CntManager).i === "function";

    let cntManager: CntManager | undefined;
    let flavor: Flavor | null | undefined;

    if (b === undefined) {
      // 1-arg
    } else if (isCntManager(b)) {
      cntManager = b;
      flavor = c ?? undefined;
    } else {
      flavor = b as Flavor | null;
    }

    const model =
      flavor === undefined || flavor === null
        ? GrobidModels.HEADER
        : GrobidModels.getModelFlavor(GrobidModels.HEADER, flavor);

    if (cntManager !== undefined) {
      super(model, cntManager);
    } else {
      super(model);
    }
    this.parsers = parsers;
    GrobidProperties.getInstance();
  }

  /**
   * Processing with application of the segmentation model
   */
  async processing(
    input: string /* file path */,
    md5Str: string,
    resHeader: BiblioItem,
    config: GrobidAnalysisConfig,
  ): Promise<Pair<string, Document>> {
    let documentSource: DocumentSource | null = null;
    try {
      documentSource = (DocumentSource as { fromPdf(p: string, start: number, end: number): DocumentSource }).fromPdf(
        input,
        config.getStartPage(),
        config.getEndPage(),
      );
      documentSource.setMD5(md5Str);
      const doc: Document = await (this.parsers as unknown as {
        getSegmentationParser(): { processing(d: DocumentSource, cfg: GrobidAnalysisConfig): Promise<Document> };
      })
        .getSegmentationParser()
        .processing(documentSource, config);

      const tei: string = (await this.processingHeaderSection(config, doc, resHeader, true)) as string;
      return new Pair<string, Document>(tei, doc);
    } finally {
      if (documentSource !== null) {
        (documentSource as unknown as { close(a: boolean, b: boolean, c: boolean): void }).close(true, true, true);
      }
    }
  }

  /**
   * Header processing after application of the segmentation model
   */
  async processingHeaderSection(
    config: GrobidAnalysisConfig,
    doc: Document,
    resHeader: BiblioItem,
    serialize: boolean,
  ): Promise<string | null> {
    try {
      const documentHeaderParts: Set<DocumentPiece> | null = doc.getDocumentPart(SegmentationLabels.HEADER);
      const tokenizations: LayoutToken[] | null = doc.getTokenizations();

      if (documentHeaderParts !== null) {
        // List<LayoutToken> tokenizationsHeader = Document.getTokenizationParts(documentHeaderParts, tokenizations);

        //String header = getSectionHeaderFeatured(doc, documentHeaderParts, true);
        const featuredHeader = this.getSectionHeaderFeatured(doc, documentHeaderParts);
        if (featuredHeader === null) {
          // Fall through — no labeling possible.
          return null;
        }
        const header: string = featuredHeader.getA();
        const headerTokenization: LayoutToken[] = featuredHeader.getB();
        let res: string | null = null;
        if (header !== null && header.trim().length !== 0) {
          res = await this.label(header);
          resHeader = this.resultExtraction(res, headerTokenization, resHeader);
        }

        // language identification
        const contentSample: string[] = [];
        if (resHeader.getTitle() !== null) {
          contentSample.push(resHeader.getTitle() as string);
        }
        if (resHeader.getAbstract() !== null) {
          contentSample.push("\n");
          contentSample.push(resHeader.getAbstract() as string);
        }
        if (contentSample.join("").length < 200) {
          // we can exploit more textual content to ensure that the language identification will be
          // correct
          const documentBodyParts: Set<DocumentPiece> | null = doc.getDocumentPart(SegmentationLabels.BODY);
          if (documentBodyParts !== null) {
            const stringSample = (Document.getTokenizationParts(documentBodyParts, tokenizations!) ?? [])
              .map((t: LayoutToken): string => t.toString())
              .join(" ");

            contentSample.push(stringSample);
          }
          //In case we don't have text, it might be that someone is trying to process a document that is not a scientific article,
          // one more attempt with the full header.
          if (contentSample.join("").length < 200) {
            const stringSample = (Document.getTokenizationParts(doc.getDocumentPart(SegmentationLabels.HEADER), tokenizations!) ?? [])
              .map((t: LayoutToken): string => t.toString())
              .join(" ");

            contentSample.push(stringSample);
          }
        }
        // grobid-js extension: detect the dominant Unicode script over the
        // same content sample BEFORE we hand it to the (Latin-trained) LID.
        // Cheap, deterministic, and lets us tag non-Latin papers in the TEI
        // even when the configured LanguageDetector is the "always English"
        // stub. We store the script on the Document and on the Language object
        // returned by the LID (when any) so downstream consumers see both
        // signals in one place. The script field is left null for Latin docs
        // so byte-identical output is preserved on the Latin majority.
        const sampleText = contentSample.join("");
        const detectedScript = detectScript(sampleText);
        if (NON_LATIN_SCRIPTS.has(detectedScript)) {
          doc.setDominantScript(detectedScript);
        }
        const langu: Language | null = this.languageUtilities.runLanguageId(sampleText);
        if (langu !== null) {
          const lang: string | null = langu.getLang();
          doc.setLanguage(lang);
          resHeader.setLanguage(lang);
          if (NON_LATIN_SCRIPTS.has(detectedScript)) {
            langu.setScript(detectedScript);
          }
        }

        if (resHeader.getAbstract() !== null) {
          resHeader.setAbstract(TextUtilities.dehyphenizeHard(resHeader.getAbstract()));
          //resHeader.setAbstract(TextUtilities.dehyphenize(resHeader.getAbstract()));
        }
        BiblioItem.cleanTitles(resHeader);
        if (resHeader.getTitle() !== null) {
          // String temp =
          // utilities.dehyphenizeHard(resHeader.getTitle());
          let temp = TextUtilities.dehyphenize(resHeader.getTitle() as string);
          temp = temp.trim();
          if (temp.length > 1) {
            if (temp.startsWith("1")) temp = temp.substring(1, temp.length);
            temp = temp.trim();
          }
          resHeader.setTitle(temp);
        }
        if (resHeader.getBookTitle() !== null) {
          resHeader.setBookTitle(TextUtilities.dehyphenize(resHeader.getBookTitle() as string));
        }

        resHeader.setOriginalAuthors(resHeader.getAuthors());

        let fragmentedAuthors = false;
        let hasMarker = false;
        const authorsBlocks: number[] = [];
        const authorSegments: LayoutToken[][] = [];
        const authorLayoutTokens: LayoutToken[] = resHeader.getAuthorsTokensWorkingCopy();
        if (authorLayoutTokens !== null && authorLayoutTokens.length !== 0) {
          // split the list of layout tokens when token "\t" is met
          let currentSegment: LayoutToken[] = [];
          for (const theToken of authorLayoutTokens) {
            if (theToken.getText() !== null && theToken.getText() === "\t") {
              if (currentSegment.length > 0) authorSegments.push(currentSegment);
              currentSegment = [];
            } else currentSegment.push(theToken);
          }
          // last segment
          if (currentSegment.length > 0) authorSegments.push(currentSegment);

          if (authorSegments.length > 1) {
            fragmentedAuthors = true;
          }
          for (let k = 0; k < authorSegments.length; k++) {
            if (authorSegments[k]!.length === 0) continue;
            const localAuthors: Person[] | null = await (this.parsers as unknown as {
              getAuthorParser(): { processingHeaderWithLayoutTokens(t: LayoutToken[], a: import("../layout/pdf-annotation.js").PDFAnnotation[] | null): Promise<Person[] | null> };
            })
              .getAuthorParser()
              .processingHeaderWithLayoutTokens(authorSegments[k]!, doc.getPDFAnnotations());
            if (localAuthors !== null) {
              for (const pers of localAuthors) {
                resHeader.addFullAuthor(pers);
                if (pers.getMarkers() !== null) {
                  hasMarker = true;
                }
                authorsBlocks.push(k);
              }
            }
          }
        }

        // remove invalid authors (no last name, noise, etc.)
        // AUDIT-RELEVANT: Person.sanityCheck call (upstream line 234).
        resHeader.setFullAuthors(Person.sanityCheck(resHeader.getFullAuthors()));

        //List<LayoutToken> tokenizationsAffiliation = resHeader.getLayoutTokens(TaggingLabels.HEADER_AFFILIATION);
        const tokenizationsAffiliation: LayoutToken[][] | null = resHeader.getAffiliationAddresslabeledTokens();
        //resHeader.setFullAffiliations(
        //        parsers.getAffiliationAddressParser().processReflow(res, tokenizations));
        resHeader.setFullAffiliations(
          await (this.parsers as unknown as {
            getAffiliationAddressParser(): {
              processingLayoutTokens(t: LayoutToken[][] | null): Promise<import("../data/affiliation.js").Affiliation[] | null>;
            };
          })
            .getAffiliationAddressParser()
            .processingLayoutTokens(tokenizationsAffiliation),
        );
        resHeader.attachEmails();
        let attached = false;
        // AUDIT-RELEVANT: fragmentedAuthors positional attachment (lines 244-264).
        if (fragmentedAuthors && !hasMarker) {
          if (resHeader.getFullAffiliations() !== null && resHeader.getFullAffiliations()!.length === authorSegments.length) {
            let k = 0;
            const persons: Person[] | null = resHeader.getFullAuthors();
            if (persons !== null && persons.length !== 0) {
              for (const pers of persons) {
                if (k < authorsBlocks.length) {
                  const indd = authorsBlocks[k]!;
                  if (indd < resHeader.getFullAffiliations()!.length) {
                    pers.addAffiliation(resHeader.getFullAffiliations()![indd]!);
                  }
                }
                k++;
              }
            }
            attached = true;
            resHeader.setFullAffiliations(null);
            resHeader.setAffiliation(null);
          }
        }
        if (!attached) {
          resHeader.attachAffiliations();
        }

        // remove duplicated authors
        // AUDIT-RELEVANT: Person.deduplicate call (upstream line 270).
        resHeader.setFullAuthors(Person.deduplicate(resHeader.getFullAuthors()));

        // grobid-js-only: post-process each surviving header author to strip
        // honorifics ("Mr.", "Dr.", "Prof.") from forenames and footnote
        // markers (digits, asterisks, daggers, etc.) from surnames. The pass
        // is idempotent, preserves Unicode and compound surnames, and runs
        // *after* sanityCheck/deduplicate so it sees the final author list
        // exactly as it would have been emitted into TEI.
        Person.postProcessNames(resHeader.getFullAuthors());

        if (resHeader.getEditors() !== null) {
          // TBD: consider segments also for editors, like for authors above
          resHeader.setFullEditors(
            await (this.parsers as unknown as {
              getAuthorParser(): { processingHeader(s: string | null): Promise<Person[] | null> };
            })
              .getAuthorParser()
              .processingHeader(resHeader.getEditors()),
          );
        }

        // below using the reference strings to improve the metadata extraction, it will have to
        // be reviewed for something safer as just a straightforward correction
        /*if (resHeader.getReference() != null) {
            BiblioItem refer = parsers.getCitationParser().processingString(resHeader.getReference(), 0);
            BiblioItem.correct(resHeader, refer);
        }*/

        // keyword post-processing
        if (resHeader.getKeyword() !== null) {
          let keywords: string | null = TextUtilities.dehyphenize(resHeader.getKeyword() as string);
          keywords = BiblioItem.cleanKeywords(keywords);
          //resHeader.setKeyword(keywords.replace("\n", " ").replace("  ", " "));
          resHeader.setKeyword(keywords);
          const keywordsSegmented: Keyword[] | null = BiblioItem.segmentKeywords(keywords);
          if (keywordsSegmented !== null && keywordsSegmented.length !== 0)
            resHeader.setKeywords(keywordsSegmented);
        }

        // DOI pass
        const dois: string[] = doc.getDOIMatches();
        if (dois !== null && dois.length !== 0 && dois.length === 1) {
          resHeader.setDOI(dois[0]!);
        }

        // normalization of dates
        if (resHeader !== null) {
          if (resHeader.getNormalizedPublicationDate() === null) {
            const normalisedPublicationDate: GrobidDate | null = await this.getNormalizedDate(resHeader.getPublicationDate());
            if (normalisedPublicationDate !== null) {
              resHeader.setNormalizedPublicationDate(normalisedPublicationDate);
            }
          } else {
            resHeader.setPublicationDate(GrobidDate.toISOString(resHeader.getNormalizedPublicationDate()!));
          }

          if (resHeader.getNormalizedSubmissionDate() === null) {
            const normalizedSubmissionDate: GrobidDate | null = await this.getNormalizedDate(resHeader.getSubmissionDate());
            if (normalizedSubmissionDate !== null) {
              resHeader.setNormalizedSubmissionDate(normalizedSubmissionDate);
            }
          } else {
            resHeader.setSubmissionDate(GrobidDate.toISOString(resHeader.getNormalizedSubmissionDate()!));
          }

          if (resHeader.getNormalizedDownloadDate() === null) {
            const normalizedDownloadDate: GrobidDate | null = await this.getNormalizedDate(resHeader.getDownloadDate());
            if (normalizedDownloadDate !== null) {
              resHeader.setNormalizedDownloadDate(normalizedDownloadDate);
            }
          } else {
            resHeader.setDownloadDate(GrobidDate.toISOString(resHeader.getNormalizedDownloadDate()!));
          }

          if (resHeader.getNormalizedServerDate() === null) {
            const normalizedServerDate: GrobidDate | null = await this.getNormalizedDate(resHeader.getServerDate());
            if (normalizedServerDate !== null) {
              resHeader.setNormalizedServerDate(normalizedServerDate);
            }
          } else {
            resHeader.setServerDate(GrobidDate.toISOString(resHeader.getNormalizedServerDate()!));
          }
        }

        // copyrights/license identification
        const copyrightVal = resHeader.getCopyright();
        if (copyrightVal !== null && copyrightVal.trim().length !== 0) {
          if (GrobidProperties.getGrobidEngineName("copyright") === "delft") {
            const copyrightsLicense: CopyrightsLicense | null =
              LicenseClassifier.getInstance().classify(resHeader.getCopyright() as string) as CopyrightsLicense | null;
            if (copyrightsLicense !== null) resHeader.setCopyrightsLicense(copyrightsLicense);
          }
        }

        resHeader = this.consolidateHeader(resHeader, config.getConsolidateHeader());

        // we don't need to serialize if we process the full text (it would be done 2 times)
        if (serialize) {
          // Upstream passes `null` for fullTextParser when only emitting the header.
          const teiFormatter = new TEIFormatter(doc, null as unknown as ConstructorParameters<typeof TEIFormatter>[1]);
          let tei: string = teiFormatter.toTEIHeader(resHeader, null, null, null, null, config);
          tei += "\t</text>\n";
          tei += "</TEI>\n";
          return tei;
        } else return null;
      }
    } catch (e) {
      throw new GrobidException("An exception occurred while running Grobid.", e as Error);
    }
    return null;
  }

  /**
   * Return the date, normalised using the DateParser
   */
  private async getNormalizedDate(rawDate: string | null): Promise<GrobidDate | null> {
    if (rawDate !== null) {
      const dates: GrobidDate[] | null = await (this.parsers as unknown as {
        getDateParser(): { process(s: string): Promise<GrobidDate[] | null> };
      })
        .getDateParser()
        .process(rawDate);
      // TODO: most basic heuristic, we take the first date
      // LF: perhaps we could validate that the dates have are formatted decently
      if (dates !== null && dates.length !== 0) {
        return dates[0]!;
      } else {
        return null;
      }
    } else {
      return null;
    }
  }

  /**
   * Return the header section with features to be processed by the sequence labelling model
   */
  getSectionHeaderFeatured(
    doc: Document,
    documentHeaderParts: Set<DocumentPiece>,
  ): Pair<string, LayoutToken[]> | null {
    const featureFactory = FeatureFactory.getInstance();
    const header: string[] = [];
    let currentFont: string | null = null;
    let currentFontSize = -1;

    // vector for features
    let features: FeaturesVectorHeader;
    // eslint-disable-next-line prefer-const
    let previousFeatures: FeaturesVectorHeader | null = null as FeaturesVectorHeader | null;

    let lineStartX: number = Number.NaN;
    let indented = false;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const centered = false;
    void centered;

    let endblock: boolean;
    //for (Integer blocknum : blockDocumentHeaders) {
    const blocks: Block[] | null = doc.getBlocks();
    if (blocks === null || blocks.length === 0) {
      return null;
    }

    const headerTokenizations: LayoutToken[] = [];

    // find the largest, smallest and average size font on the header section
    // note: only  largest font size information is used currently
    let largestFontSize = 0.0;
    let smallestFontSize = 100000.0;
    let averageFontSize: number;
    let accumulatedFontSize = 0.0;
    let nbTokens = 0;
    for (const docPiece of documentHeaderParts) {
      const dp1 = docPiece.getLeft();
      const dp2 = docPiece.getRight();

      for (let blockIndex = dp1.getBlockPtr(); blockIndex <= dp2.getBlockPtr(); blockIndex++) {
        const block: Block = blocks[blockIndex]!;

        const tokens: LayoutToken[] | null = block.getTokens();
        if (tokens === null || tokens.length === 0) {
          continue;
        }

        for (const token of tokens) {
          /*if (" ".equals(token.getText()) || "\n".equals(token.getText())) {
              // blank separators has font size 0.0,
              // unicode normalization reduce to these 2 characters all the variants
              continue;
          }*/
          if ((token as unknown as { getFontSize(): number }).getFontSize() > largestFontSize) {
            largestFontSize = (token as unknown as { getFontSize(): number }).getFontSize();
          }

          if ((token as unknown as { getFontSize(): number }).getFontSize() < smallestFontSize) {
            smallestFontSize = (token as unknown as { getFontSize(): number }).getFontSize();
          }

          accumulatedFontSize += (token as unknown as { getFontSize(): number }).getFontSize();
          nbTokens++;
        }
      }
    }
    averageFontSize = accumulatedFontSize / nbTokens;

    // TBD: this would need to be made more efficient, by applying the regex only to a limited
    // part of the tokens
    /*List<LayoutToken> tokenizations = doc.getTokenizations();
    List<OffsetPosition> locationPositions = lexicon.tokenPositionsLocationNames(tokenizations);
    List<OffsetPosition> urlPositions = lexicon.tokenPositionsUrlPattern(tokenizations);
    List<OffsetPosition> emailPositions = lexicon.tokenPositionsEmailPattern(tokenizations);*/

    for (const docPiece of documentHeaderParts) {
      const dp1 = docPiece.getLeft();
      const dp2 = docPiece.getRight();

      for (let blockIndex = dp1.getBlockPtr(); blockIndex <= dp2.getBlockPtr(); blockIndex++) {
        const block: Block = blocks[blockIndex]!;
        let newline = false;
        let previousNewline = true;
        endblock = false;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const spacingPreviousBlock = 0.0; // discretized
        void spacingPreviousBlock;

        if (previousFeatures !== null) previousFeatures.blockStatus = "BLOCKEND";

        const tokens: LayoutToken[] | null = block.getTokens();
        if (tokens === null || tokens.length === 0) {
          continue;
        }

        const localText: string | null = (block as unknown as { getText(): string | null }).getText();
        if (localText === null) continue;
        let startIndex = 0;
        let n = 0;
        if (blockIndex === dp1.getBlockPtr()) {
          //n = block.getStartToken();
          n = dp1.getTokenDocPos() - block.getStartToken();
          startIndex = dp1.getTokenDocPos() - block.getStartToken();
        }

        // character density of the block
        let density = 0.0;
        if (
          (block as unknown as { getHeight(): number }).getHeight() !== 0.0 &&
          (block as unknown as { getWidth(): number }).getWidth() !== 0.0 &&
          (block as unknown as { getText(): string | null }).getText() !== null &&
          !(block as unknown as { getText(): string }).getText().includes("@PAGE") &&
          !(block as unknown as { getText(): string }).getText().includes("@IMAGE")
        )
          density =
            (block as unknown as { getText(): string }).getText().length /
            ((block as unknown as { getHeight(): number }).getHeight() *
              (block as unknown as { getWidth(): number }).getWidth());

        const lines: string[] = localText.split(/[\n\r]/);
        // set the max length of the lines in the block, in number of characters
        let maxLineLength = 0;
        for (let p = 0; p < lines.length; p++) {
          if (lines[p]!.length > maxLineLength) maxLineLength = lines[p]!.length;
        }
        void maxLineLength;

        /*for (int li = 0; li < lines.length; li++) {
            String line = lines[li];

            features.lineLength = featureFactory
                    .linearScaling(line.length(), maxLineLength, LINESCALE);

            features.punctuationProfile = TextUtilities.punctuationProfile(line);
        }*/

        const locationPositions: OffsetPosition[] = this.lexicon.tokenPositionsLocationNames(tokens);
        const emailPositions: OffsetPosition[] = (this.lexicon as unknown as {
          tokenPositionsEmailPattern(t: LayoutToken[]): OffsetPosition[];
        }).tokenPositionsEmailPattern(tokens);
        const urlPositions: OffsetPosition[] = Lexicon.tokenPositionsUrlPattern(tokens);

        /*for (OffsetPosition position : emailPositions) {
            System.out.println(position.start + " " + position.end + " / " + tokens.get(position.start) + " ... " + tokens.get(position.end));
        }*/

        while (n < tokens.length) {
          if (blockIndex === dp2.getBlockPtr()) {
            if (n > dp2.getTokenDocPos() - block.getStartToken()) {
              break;
            }
          }

          const token: LayoutToken = tokens[n]!;
          headerTokenizations.push(token);

          let text: string | null = token.getText();
          if (text === null) {
            n++;
            continue;
          }

          text = text.replace(/ /g, "");
          if (text.length === 0) {
            n++;
            continue;
          }

          if (text === "\n" || text === "\r") {
            previousNewline = true;
            newline = false;
            n++;
            continue;
          }

          if (previousNewline) {
            newline = true;
            previousNewline = false;
            if (previousFeatures !== null) {
              const previousLineStartX = lineStartX;
              lineStartX = token.getX();
              const characterWidth = (token as unknown as { width: number }).width / token.getText()!.length;
              if (!Number.isNaN(previousLineStartX)) {
                // Indentation if line start is > 1 character width to the right of previous line start
                if (lineStartX - previousLineStartX > characterWidth) indented = true;
                // Indentation ends if line start is > 1 character width to the left of previous line start
                else if (previousLineStartX - lineStartX > characterWidth) indented = false;
                // Otherwise indentation is unchanged
              }
            }
          } else {
            newline = false;
          }
          // centered ?

          // final sanitisation and filtering for the token
          text = text.replace(/[ \n]/g, "");
          if (TextUtilities.filterLine(text)) {
            n++;
            continue;
          }

          features = new FeaturesVectorHeader();
          features.token = token;
          features.string = text;

          if (newline) features.lineStatus = "LINESTART";

          const m0 = featureFactory.isPunct.exec(text);
          if (m0 !== null) {
            features.punctType = "PUNCT";
          }
          if (text === "(" || text === "[") {
            features.punctType = "OPENBRACKET";
          } else if (text === ")" || text === "]") {
            features.punctType = "ENDBRACKET";
          } else if (text === ".") {
            features.punctType = "DOT";
          } else if (text === ",") {
            features.punctType = "COMMA";
          } else if (text === "-") {
            features.punctType = "HYPHEN";
          } else if (text === "\"" || text === "'" || text === "`") {
            features.punctType = "QUOTE";
          }

          if (n === startIndex) {
            // beginning of block
            features.lineStatus = "LINESTART";
            features.blockStatus = "BLOCKSTART";
          } else if (n === tokens.length - 1 || n + 1 > dp2.getTokenDocPos() - block.getStartToken()) {
            // end of block
            features.lineStatus = "LINEEND";
            previousNewline = true;
            features.blockStatus = "BLOCKEND";
            endblock = true;
          } else {
            // look ahead to see if we are at the end of a line within the block
            let endline = false;

            let ii = 1;
            let endloop = false;
            while (n + ii < tokens.length && !endloop) {
              const tok: LayoutToken | null = tokens[n + ii]!;
              if (tok !== null) {
                const toto: string | null = tok.getText();
                if (toto !== null) {
                  if (toto === "\n" || text === "\r") {
                    endline = true;
                    endloop = true;
                  } else {
                    if (
                      toto.trim().length !== 0 &&
                      text !== " " &&
                      !toto.includes("@IMAGE") &&
                      !toto.includes("@PAGE") &&
                      !text.includes(".pbm") &&
                      !text.includes(".ppm") &&
                      !text.includes(".png") &&
                      !text.includes(".svg") &&
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

            if (!endline && !newline) {
              features.lineStatus = "LINEIN";
            } else if (!newline) {
              features.lineStatus = "LINEEND";
              previousNewline = true;
            }

            if (!endblock && features.blockStatus === null) features.blockStatus = "BLOCKIN";
            else if (features.blockStatus === null) features.blockStatus = "BLOCKEND";
          }

          if (indented) {
            features.alignmentStatus = "LINEINDENT";
          } else {
            features.alignmentStatus = "ALIGNEDLEFT";
          }

          if (text.length === 1) {
            features.singleChar = true;
          }

          if (text.charAt(0) === text.charAt(0).toUpperCase() && text.charAt(0) !== text.charAt(0).toLowerCase()) {
            features.capitalisation = "INITCAP";
          }

          if (featureFactory.test_all_capital(text)) {
            features.capitalisation = "ALLCAP";
          }

          if (featureFactory.test_digit(text)) {
            features.digit = "CONTAINSDIGITS";
          }

          const m = featureFactory.isDigit.exec(text);
          if (m !== null) {
            features.digit = "ALLDIGIT";
          }

          if (featureFactory.test_common(text)) {
            features.commonName = true;
          }

          if (featureFactory.test_names(text)) {
            features.properName = true;
          }

          if (featureFactory.test_month(text)) {
            features.month = true;
          }

          const m2 = featureFactory.year.exec(text);
          if (m2 !== null) {
            features.year = true;
          }

          // check token offsets for email and http address, or known location
          if (locationPositions !== null) {
            for (const thePosition of locationPositions) {
              if (n >= thePosition.start && n <= thePosition.end) {
                features.locationName = true;
                break;
              }
            }
          }
          if (emailPositions !== null) {
            for (const thePosition of emailPositions) {
              if (n >= thePosition.start && n <= thePosition.end) {
                features.email = true;
                break;
              }
            }
          }
          if (urlPositions !== null) {
            for (const thePosition of urlPositions) {
              if (n >= thePosition.start && n <= thePosition.end) {
                features.http = true;
                break;
              }
            }
          }

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
          } else if (currentFontSize === newFontSize) {
            features.fontSize = "SAMEFONTSIZE";
          } else if (currentFontSize < newFontSize) {
            features.fontSize = "HIGHERFONT";
            currentFontSize = newFontSize;
          } else if (currentFontSize > newFontSize) {
            features.fontSize = "LOWERFONT";
            currentFontSize = newFontSize;
          }

          if ((token as unknown as { getFontSize(): number }).getFontSize() === largestFontSize)
            features.largestFont = true;
          if ((token as unknown as { getFontSize(): number }).getFontSize() === smallestFontSize)
            features.smallestFont = true;
          if ((token as unknown as { getFontSize(): number }).getFontSize() > averageFontSize)
            features.largerThanAverageFont = true;

          // not used
          /*if (token.isSuperscript())
              features.superscript = true;*/

          if (token.isBold()) features.bold = true;

          if (token.isItalic()) features.italic = true;

          if (features.capitalisation === null) features.capitalisation = "NOCAPS";

          if (features.digit === null) features.digit = "NODIGIT";

          if (features.punctType === null) features.punctType = "NOPUNCT";

          /*if (spacingPreviousBlock != 0.0) {
              features.spacingWithPreviousBlock = featureFactory
                  .linearScaling(spacingPreviousBlock-doc.getMinBlockSpacing(), doc.getMaxBlockSpacing()-doc.getMinBlockSpacing(), NBBINS_SPACE);
          }*/

          if (density !== -1.0) {
            features.characterDensity = featureFactory.linearScaling(
              density - (doc as unknown as { getMinCharacterDensity(): number }).getMinCharacterDensity(),
              (doc as unknown as { getMaxCharacterDensity(): number }).getMaxCharacterDensity() -
                (doc as unknown as { getMinCharacterDensity(): number }).getMinCharacterDensity(),
              HeaderParser.NBBINS_DENSITY,
            );
            //System.out.println((density-doc.getMinCharacterDensity()) + " " + (doc.getMaxCharacterDensity()-doc.getMinCharacterDensity()) + " " + NBBINS_DENSITY + " " + features.characterDensity);
          }

          if (previousFeatures !== null) header.push(previousFeatures.printVector() ?? "");
          previousFeatures = features;

          n++;
        }

        if (previousFeatures !== null) {
          previousFeatures.blockStatus = "BLOCKEND";
          previousFeatures.lineStatus = "LINEEND";
          header.push(previousFeatures.printVector() ?? "");
          previousFeatures = null;
        }
      }
    }

    return new Pair<string, LayoutToken[]>(header.join(""), headerTokenizations);
  }

  /**
   * Extract results from a labelled header.
   *
   * @param result        result
   * @param tokenizations list of tokens
   * @param biblio        biblio item
   * @return a biblio item
   */
  resultExtraction(result: string, tokenizations: LayoutToken[], biblio: BiblioItem): BiblioItem {
    const clusteror = new TaggingTokenClusteror(GrobidModels.HEADER, result, tokenizations);

    const clusters: TaggingTokenCluster[] = clusteror.cluster();

    biblio.generalResultMappingHeader(result, tokenizations);
    for (const cluster of clusters) {
      if (cluster === null) {
        continue;
      }
      const clusterLabel: TaggingLabel = cluster.getTaggingLabel();
      (Engine as unknown as { getCntManager(): CntManager }).getCntManager().i(clusterLabel as unknown as import("./counters/countable.js").Countable);

      const clusterContent: string = LayoutTokensUtil.normalizeDehyphenizeText(cluster.concatTokens());
      const clusterNonDehypenizedContent: string = LayoutTokensUtil.toText(cluster.concatTokens());
      if (clusterLabel === TaggingLabels.HEADER_TITLE) {
        /*if (biblio.getTitle() != null && isDifferentContent(biblio.getTitle(), clusterContent))
            biblio.setTitle(biblio.getTitle() + clusterContent);
        else*/
        // NOTE: upstream bug — "take only first <title> cluster"; subsequent
        // clusters silently dropped (no else branch).
        if (biblio.getTitle() === null) {
          biblio.setTitle(clusterContent);
        }
      } else if (clusterLabel === TaggingLabels.HEADER_AUTHOR) {
        //if (biblio.getAuthors() != null && isDifferentandNotIncludedContent(biblio.getAuthors(), clusterContent)) {
        if (biblio.getAuthors() !== null) {
          biblio.setAuthors(biblio.getAuthors() + "\t" + clusterNonDehypenizedContent);
          //biblio.addAuthorsToken(new LayoutToken("\n", TaggingLabels.HEADER_AUTHOR));
          biblio.collectAuthorsToken(new LayoutToken("\t", TaggingLabels.HEADER_AUTHOR));

          const tokens: LayoutToken[] = cluster.concatTokens();
          biblio.collectAuthorsTokens(tokens);
        } else {
          biblio.setAuthors(clusterNonDehypenizedContent);

          const tokens: LayoutToken[] = cluster.concatTokens();
          biblio.collectAuthorsTokens(tokens);
        }
      } /*else if (clusterLabel.equals(TaggingLabels.HEADER_TECH)) {
            biblio.setItem(BiblioItem.TechReport);
            ... commented-out upstream */ else if (clusterLabel === TaggingLabels.HEADER_MEETING) {
        if (biblio.getMeeting() !== null) {
          biblio.setMeeting(biblio.getMeeting() + ", " + clusterContent);
        } else biblio.setMeeting(clusterContent);
      } else if (clusterLabel === TaggingLabels.HEADER_DATE) {
        // it appears that the same date is quite often repeated,
        // we should check, before adding a new date segment, if it is
        // not already present

        // alternatively we can only keep the first continuous date

        /*if (biblio.getPublicationDate() != null && isDifferentandNotIncludedContent(biblio.getPublicationDate(), clusterContent))
            biblio.setPublicationDate(biblio.getPublicationDate() + " " + clusterContent);
        else*/
        // for checking if the date is a server date, we simply look at the string
        /*if (biblio.getServerDate() == null) {
            if (clusterContent.toLowerCase().indexOf("server") != -1) {
                biblio.setServerDate(clusterNonDehypenizedContent);
                continue;
            }
        }*/
        if (
          biblio.getPublicationDate() !== null &&
          biblio.getPublicationDate()!.length < clusterNonDehypenizedContent.length
        )
          biblio.setPublicationDate(clusterNonDehypenizedContent);
        else if (biblio.getPublicationDate() === null) biblio.setPublicationDate(clusterNonDehypenizedContent);
      } /*else if (clusterLabel.equals(TaggingLabels.HEADER_DATESUB)) {
            ... commented out upstream */ else if (clusterLabel === TaggingLabels.HEADER_PAGE) {
        /*if (biblio.getPageRange() != null) {
            biblio.setPageRange(biblio.getPageRange() + clusterContent);
        }*/
        if (biblio.getPageRange() === null) biblio.setPageRange(clusterContent);
      } else if (clusterLabel === TaggingLabels.HEADER_EDITOR) {
        if (biblio.getEditors() !== null) {
          biblio.setEditors(biblio.getEditors() + "\n" + clusterNonDehypenizedContent);
        } else biblio.setEditors(clusterNonDehypenizedContent);
      } /*else if (clusterLabel.equals(TaggingLabels.HEADER_INSTITUTION)) {
            ... commented out upstream */ else if (clusterLabel === TaggingLabels.HEADER_NOTE) {
        biblio.setNoteOrConcatenateIfNotEmpty(clusterContent);
      } else if (clusterLabel === TaggingLabels.HEADER_ABSTRACT) {
        if (biblio.getAbstract() !== null) {
          // this will need to be reviewed with more training data, for the moment
          // avoid concatenation for abstracts as it brings more noise than correct pieces
          //biblio.setAbstract(biblio.getAbstract() + " " + clusterContent);
          //TODO: avoid dumping text on the floor
          // NOTE: upstream bug — second and subsequent abstract clusters are
          // dropped on the floor.
        } else {
          biblio.setAbstract(clusterContent);
          const tokens: LayoutToken[] = cluster.concatTokens();
          biblio.collectAbstractTokens(tokens);
        }
      } else if (clusterLabel === TaggingLabels.HEADER_REFERENCE) {
        //if (biblio.getReference() != null) {
        // NOTE: upstream bug — both branches assign the same value, so the
        // length-comparison guard is effectively dead code.
        if (
          biblio.getReference() !== null &&
          biblio.getReference()!.length < clusterNonDehypenizedContent.length
        ) {
          biblio.setReference(clusterNonDehypenizedContent);
        } else biblio.setReference(clusterNonDehypenizedContent);
      } else if (clusterLabel === TaggingLabels.HEADER_FUNDING) {
        if (biblio.getFunding() !== null) {
          biblio.setFunding(biblio.getFunding() + " \n " + clusterContent);
        } else biblio.setFunding(clusterContent);
      } else if (clusterLabel === TaggingLabels.HEADER_COPYRIGHT) {
        if (biblio.getCopyright() !== null) {
          biblio.setCopyright(biblio.getCopyright() + " " + clusterContent);
        } else biblio.setCopyright(clusterContent);
      } else if (clusterLabel === TaggingLabels.HEADER_AFFILIATION) {
        // affiliation **makers** should be marked SINGLECHAR LINESTART
        if (biblio.getAffiliation() !== null) {
          biblio.setAffiliation(biblio.getAffiliation() + " ; " + clusterContent);
        } else biblio.setAffiliation(clusterContent);
      } else if (clusterLabel === TaggingLabels.HEADER_ADDRESS) {
        if (biblio.getAddress() !== null) {
          biblio.setAddress(biblio.getAddress() + " " + clusterContent);
        } else biblio.setAddress(clusterContent);
      } else if (clusterLabel === TaggingLabels.HEADER_EMAIL) {
        if (biblio.getEmail() !== null) {
          biblio.setEmail(biblio.getEmail() + "\t" + clusterNonDehypenizedContent);
        } else biblio.setEmail(clusterNonDehypenizedContent);
      } else if (clusterLabel === TaggingLabels.HEADER_PUBNUM) {
        // NOTE: upstream quirk — when an additional pubnum cluster differs from
        // the existing one (per isDifferentandNotIncludedContent), the field
        // is temporarily set to the new content, checkIdentifier() runs against
        // it (so the new content's identifier classification IS recorded on
        // the BiblioItem), but the pubnum string itself is restored to the
        // original first cluster. Preserved verbatim.
        if (
          biblio.getPubnum() !== null &&
          this.isDifferentandNotIncludedContent(biblio.getPubnum(), clusterContent)
        ) {
          const currentPubnum: string = biblio.getPubnum() as string;
          biblio.setPubnum(clusterContent);
          biblio.checkIdentifier();
          biblio.setPubnum(currentPubnum);
        } else {
          biblio.setPubnum(clusterContent);
          biblio.checkIdentifier();
        }
      } else if (clusterLabel === TaggingLabels.HEADER_KEYWORD) {
        if (biblio.getKeyword() !== null) {
          biblio.setKeyword(biblio.getKeyword() + " \n " + clusterContent);
        } else biblio.setKeyword(clusterContent);
      } else if (clusterLabel === (TaggingLabels as unknown as { HEADER_AVAILABILITY: TaggingLabel }).HEADER_AVAILABILITY) {
        const stmt = (biblio as unknown as { getAvailabilityStmt(): string | null }).getAvailabilityStmt();
        if (stmt !== null && stmt.trim().length !== 0) {
          (biblio as unknown as { setAvailabilityStmt(s: string): void }).setAvailabilityStmt(stmt + " \n " + clusterContent);
        } else {
          (biblio as unknown as { setAvailabilityStmt(s: string): void }).setAvailabilityStmt(clusterContent);
        }
      } else if (clusterLabel === (TaggingLabels as unknown as { HEADER_CONFLICT_OF_INTEREST: TaggingLabel }).HEADER_CONFLICT_OF_INTEREST) {
        const stmt = (biblio as unknown as { getConflictStmt(): string | null }).getConflictStmt();
        if (stmt !== null && stmt.trim().length !== 0) {
          (biblio as unknown as { setConflictStmt(s: string): void }).setConflictStmt(stmt + " \n " + clusterContent);
        } else {
          (biblio as unknown as { setConflictStmt(s: string): void }).setConflictStmt(clusterContent);
        }
      } else if (clusterLabel === (TaggingLabels as unknown as { HEADER_AUTHOR_CONTRIBUTION: TaggingLabel }).HEADER_AUTHOR_CONTRIBUTION) {
        const stmt = (biblio as unknown as { getContributionStmt(): string | null }).getContributionStmt();
        if (stmt !== null && stmt.trim().length !== 0) {
          (biblio as unknown as { setContributionStmt(s: string): void }).setContributionStmt(stmt + " \n " + clusterContent);
        } else {
          (biblio as unknown as { setContributionStmt(s: string): void }).setContributionStmt(clusterContent);
        }
      } else if (clusterLabel === TaggingLabels.HEADER_PHONE) {
        if (biblio.getPhone() !== null) {
          biblio.setPhone(biblio.getPhone() + clusterNonDehypenizedContent);
        } else biblio.setPhone(clusterNonDehypenizedContent);
      } /*else if (clusterLabel.equals(TaggingLabels.HEADER_DEGREE)) {
            ... commented out upstream */ else if (clusterLabel === TaggingLabels.HEADER_WEB) {
        if (biblio.getWeb() !== null) {
          biblio.setWeb(biblio.getWeb() + clusterNonDehypenizedContent);
        } else biblio.setWeb(clusterNonDehypenizedContent);
      } /*else if (clusterLabel.equals(TaggingLabels.HEADER_DEDICATION)) {
            ... commented out upstream */ else if (clusterLabel === (TaggingLabels as unknown as { HEADER_SUBMISSION: TaggingLabel }).HEADER_SUBMISSION) {
        const sub = (biblio as unknown as { getSubmission(): string | null }).getSubmission();
        if (sub !== null) {
          (biblio as unknown as { setSubmission(s: string): void }).setSubmission(sub + " " + clusterContent);
        } else (biblio as unknown as { setSubmission(s: string): void }).setSubmission(clusterContent);
      } /*else if (clusterLabel.equals(TaggingLabels.HEADER_ENTITLE)) { ... commented out upstream
        } else if (clusterLabel.equals(TaggingLabels.HEADER_VERSION)) {
            ... commented out upstream */ else if (clusterLabel === (TaggingLabels as unknown as { HEADER_DOCTYPE: TaggingLabel }).HEADER_DOCTYPE) {
        if (biblio.getDocumentType() !== null && this.isDifferentContent(biblio.getDocumentType(), clusterContent)) {
          biblio.setDocumentType(biblio.getDocumentType() + " \n " + clusterContent);
        } else biblio.setDocumentType(clusterContent);
      } else if (clusterLabel === (TaggingLabels as unknown as { HEADER_WORKINGGROUP: TaggingLabel }).HEADER_WORKINGGROUP) {
        /*if (biblio.getWorkingGroup() != null && isDifferentandNotIncludedContent(biblio.getWorkingGroup(), clusterContent)) {
            biblio.setWorkingGroup(biblio.getWorkingGroup() + " " + clusterContent);
        }*/
        if (biblio.getWorkingGroup() === null) biblio.setWorkingGroup(clusterContent);
      } else if (clusterLabel === TaggingLabels.HEADER_PUBLISHER) {
        /*if (biblio.getPublisher() != null && isDifferentandNotIncludedContent(biblio.getPublisher(), clusterContent)) {
            biblio.setPublisher(biblio.getPublisher() + " " + clusterContent);
        }*/
        if (biblio.getPublisher() === null) biblio.setPublisher(clusterContent);
      } else if (clusterLabel === (TaggingLabels as unknown as { HEADER_JOURNAL: TaggingLabel }).HEADER_JOURNAL) {
        /*if (biblio.getJournal() != null && isDifferentandNotIncludedContent(biblio.getJournal(), clusterContent)) {
            biblio.setJournal(biblio.getJournal() + " " + clusterContent);
        }*/
        if (biblio.getJournal() === null) biblio.setJournal(clusterContent);
      } else if (clusterLabel === TaggingLabels.HEADER_OTHER) {
        biblio.addDiscardedPieceTokens(cluster.concatTokens());
      }
      /*else if (clusterLabel.equals(TaggingLabels.HEADER_INTRO)) {
          return biblio;
      }*/
    }
    return biblio;
  }

  /**
   * In the context of field extraction, check if a newly extracted content is not redundant
   * with the already extracted content
   */
  private isDifferentContent(existingContent: string | null, newContent: string | null): boolean {
    if (existingContent === null) {
      return true;
    }
    if (newContent === null) {
      return false;
    }
    let newContentSimplified = newContent.toLowerCase();
    newContentSimplified = newContentSimplified.replace(/ /g, "").trim();
    let existinContentSimplified = existingContent.toLowerCase();
    existinContentSimplified = existinContentSimplified.replace(/ /g, "").trim();
    if (newContentSimplified === existinContentSimplified) return false;
    else return true;
  }

  /**
   * In the context of field extraction, this variant of the previous method check if a newly
   * extracted content is not redundant globally and as any substring combination with the already
   * extracted content
   */
  private isDifferentandNotIncludedContent(existingContent: string | null, newContent: string | null): boolean {
    if (existingContent === null) {
      return true;
    }
    if (newContent === null) {
      return false;
    }
    let newContentSimplified = newContent.toLowerCase();
    newContentSimplified = newContentSimplified.replace(/ /g, "").trim();
    newContentSimplified = newContentSimplified.replace(/-/g, "").trim();
    let existingContentSimplified = existingContent.toLowerCase();
    existingContentSimplified = existingContentSimplified.replace(/ /g, "").trim();
    existingContentSimplified = existingContentSimplified.replace(/-/g, "").trim();
    if (
      newContentSimplified === existingContentSimplified ||
      existingContentSimplified.includes(newContentSimplified)
    )
      return false;
    else return true;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private getLayoutTokens(cluster: TaggingTokenCluster): LayoutToken[] {
    const tokens: LayoutToken[] = [];

    for (const container of cluster.getLabeledTokensContainers()) {
      for (const t of container.getLayoutTokens()) tokens.push(t);
    }

    return tokens;
  }

  /**
   * Extract results from a labelled header in the training format without any
   * string modification.
   *
   * @param result        result
   * @param tokenizations list of tokens
   * @return a result
   */
  trainingExtraction(result: string, tokenizations: LayoutToken[]): string[] {
    // this is the main buffer for the whole header
    const buffer: string[] = [];

    const lines: string[] = result.split("\n");
    let s1: string | null = null;
    let s2: string | null = null;
    let lastTag: string | null = null;

    let p = 0;

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      let addSpace = false;
      const tok = lines[lineIdx]!.trim();

      if (tok.length === 0) {
        continue;
      }
      const stt = tok.split("\t");
      // List<String> localFeatures = new ArrayList<String>();
      let i = 0;

      let newLine = false;
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
        } else {
          if (s === "LINESTART") newLine = true;
          // localFeatures.add(s);
        }
        i++;
      }

      if (newLine) {
        buffer.push("<lb/>");
      }

      let lastTag0: string | null = null;
      if (lastTag !== null) {
        if (lastTag.startsWith("I-")) {
          lastTag0 = lastTag.substring(2, lastTag.length);
        } else {
          lastTag0 = lastTag;
        }
      }
      let currentTag0: string | null = null;
      if (s1 !== null) {
        if (s1.startsWith("I-")) {
          currentTag0 = s1.substring(2, s1.length);
        } else {
          currentTag0 = s1;
        }
      }

      if (lastTag !== null) {
        this.testClosingTag(buffer, currentTag0 ?? "", lastTag0 ?? "");
      }

      let output: boolean;

      output = this.writeField(buffer, s1, lastTag0, s2, "<title>", "<docTitle>\n\t<titlePart>", addSpace);
      if (!output) {
        output = this.writeField(buffer, s1, lastTag0, s2, "<author>", "<byline>\n\t<docAuthor>", addSpace);
      }
      if (!output) {
        output = this.writeField(buffer, s1, lastTag0, s2, "<location>", "<address>", addSpace);
      }
      if (!output) {
        output = this.writeField(buffer, s1, lastTag0, s2, "<address>", "<address>", addSpace);
      }
      if (!output) {
        output = this.writeField(buffer, s1, lastTag0, s2, "<date>", "<date>", addSpace);
      }
      /*if (!output) {
          output = writeField(buffer, s1, lastTag0, s2, "<date-submission>", "<date type=\"submission\">", addSpace);
      }
      if (!output) {
          output = writeField(buffer, s1, lastTag0, s2, "<booktitle>", "<booktitle>", addSpace);
      }*/
      if (!output) {
        output = this.writeField(buffer, s1, lastTag0, s2, "<page>", "<page>", addSpace);
      }
      if (!output) {
        output = this.writeField(buffer, s1, lastTag0, s2, "<publisher>", "<publisher>", addSpace);
      }
      if (!output) {
        output = this.writeField(buffer, s1, lastTag0, s2, "<journal>", "<journal>", addSpace);
      }
      if (!output) {
        output = this.writeField(buffer, s1, lastTag0, s2, "<institution>", "<byline>\n\t<affiliation>", addSpace);
      }
      if (!output) {
        output = this.writeField(buffer, s1, lastTag0, s2, "<affiliation>", "<byline>\n\t<affiliation>", addSpace);
      }
      /*if (!output) {
          output = writeField(buffer, s1, lastTag0, s2, "<volume>", "<volume>", addSpace);
      }*/
      if (!output) {
        output = this.writeField(buffer, s1, lastTag0, s2, "<editor>", "<editor>", addSpace);
      }
      if (!output) {
        output = this.writeField(buffer, s1, lastTag0, s2, "<note>", "", addSpace);
      }
      if (!output) {
        output = this.writeField(buffer, s1, lastTag0, s2, "<abstract>", "<div type=\"abstract\">", addSpace);
      }
      if (!output) {
        output = this.writeField(buffer, s1, lastTag0, s2, "<email>", "<email>", addSpace);
      }
      if (!output) {
        output = this.writeField(buffer, s1, lastTag0, s2, "<pubnum>", "<idno>", addSpace);
      }
      if (!output) {
        output = this.writeField(buffer, s1, lastTag0, s2, "<keyword>", "<keyword>", addSpace);
      }
      if (!output) {
        output = this.writeField(buffer, s1, lastTag0, s2, "<phone>", "<phone>", addSpace);
      }
      /*if (!output) {
          output = writeField(buffer, s1, lastTag0, s2, "<degree>", "<note type=\"degree\">", addSpace);
      }*/
      if (!output) {
        output = this.writeField(buffer, s1, lastTag0, s2, "<web>", "<ptr type=\"web\">", addSpace);
      }
      /*if (!output) {
          output = writeField(buffer, s1, lastTag0, s2, "<dedication>", "<dedication>", addSpace);
      }*/
      if (!output) {
        output = this.writeField(buffer, s1, lastTag0, s2, "<meeting>", "<meeting>", addSpace);
      }
      if (!output) {
        output = this.writeField(buffer, s1, lastTag0, s2, "<submission>", "<note type=\"submission\">", addSpace);
      }
      /*if (!output) {
          output = writeField(buffer, s1, lastTag0, s2, "<entitle>", "<note type=\"title\">", addSpace);
      }*/
      if (!output) {
        output = this.writeField(buffer, s1, lastTag0, s2, "<reference>", "<reference>", addSpace);
      }
      if (!output) {
        output = this.writeField(buffer, s1, lastTag0, s2, "<copyright>", "<note type=\"copyright\">", addSpace);
      }
      if (!output) {
        output = this.writeField(buffer, s1, lastTag0, s2, "<funding>", "<note type=\"funding\">", addSpace);
      }
      /*if (!output) {
          output = writeField(buffer, s1, lastTag0, s2, "<intro>", "<p type=\"introduction\">", addSpace);
      }*/
      if (!output) {
        output = this.writeField(buffer, s1, lastTag0, s2, "<doctype>", "<note type=\"doctype\">", addSpace);
      }
      /*if (!output) {
          output = writeField(buffer, s1, lastTag0, s2, "<version>", "<note type=\"version\">", addSpace);
      }*/
      /*if (!output) {
          output = writeField(buffer, s1, lastTag0, s2, "<date-download>", "<date type=\"download\">", addSpace);
      }*/
      if (!output) {
        output = this.writeField(buffer, s1, lastTag0, s2, "<group>", "<note type=\"group\">", addSpace);
      }
      if (!output) {
        output = this.writeField(buffer, s1, lastTag0, s2, "<availability>", "<note type=\"availability\">", addSpace);
      }
      if (!output) {
        output = this.writeField(buffer, s1, lastTag0, s2, "<conflict>", "<note type=\"conflict\">", addSpace);
      }
      if (!output) {
        output = this.writeField(buffer, s1, lastTag0, s2, "<contribution>", "<note type=\"contribution\">", addSpace);
      }
      if (!output) {
        output = this.writeField(buffer, s1, lastTag0, s2, "<other>", "", addSpace);
      }

      /*if (((s1.equals("<intro>")) || (s1.equals("I-<intro>"))) && intro) {
          break;
      }*/
      lastTag = s1;

      // Mirror upstream's `!st.hasMoreTokens()` check, which fires when no
      // non-empty token remains.
      let hasMoreTokens = false;
      for (let q = lineIdx + 1; q < lines.length; q++) {
        if (lines[q]!.trim().length !== 0) {
          hasMoreTokens = true;
          break;
        }
      }
      if (!hasMoreTokens) {
        if (lastTag !== null) {
          this.testClosingTag(buffer, "", currentTag0 ?? "");
        }
      }
    }

    return buffer;
  }

  private testClosingTag(buffer: string[], currentTag0: string, lastTag0: string): void {
    if (currentTag0 !== lastTag0) {
      // we close the current tag
      if (lastTag0 === "<title>") {
        buffer.push("</titlePart>\n\t</docTitle>\n");
      } else if (lastTag0 === "<author>") {
        buffer.push("</docAuthor>\n\t</byline>\n");
      } else if (lastTag0 === "<location>") {
        buffer.push("</address>\n");
      } else if (lastTag0 === "<meeting>") {
        buffer.push("</meeting>\n");
      } else if (lastTag0 === "<date>") {
        buffer.push("</date>\n");
      } else if (lastTag0 === "<abstract>") {
        buffer.push("</div>\n");
      } else if (lastTag0 === "<address>") {
        buffer.push("</address>\n");
      } else if (lastTag0 === "<date-submission>") {
        buffer.push("</date>\n");
      } else if (lastTag0 === "<booktitle>") {
        buffer.push("</booktitle>\n");
      } else if (lastTag0 === "<pages>") {
        buffer.push("</pages>\n");
      } else if (lastTag0 === "<email>") {
        buffer.push("</email>\n");
      } else if (lastTag0 === "<publisher>") {
        buffer.push("</publisher>\n");
      } else if (lastTag0 === "<institution>") {
        buffer.push("</affiliation>\n\t</byline>\n");
      } else if (lastTag0 === "<keyword>") {
        buffer.push("</keyword>\n");
      } else if (lastTag0 === "<affiliation>") {
        buffer.push("</affiliation>\n\t</byline>\n");
      } else if (lastTag0 === "<note>") {
        buffer.push("</note>\n");
      } else if (lastTag0 === "<reference>") {
        buffer.push("</reference>\n");
      } else if (lastTag0 === "<copyright>") {
        buffer.push("</note>\n");
      } else if (lastTag0 === "<funding>") {
        buffer.push("</note>\n");
      } else if (lastTag0 === "<entitle>") {
        buffer.push("</note>\n");
      } else if (lastTag0 === "<submission>") {
        buffer.push("</note>\n");
      } else if (lastTag0 === "<dedication>") {
        buffer.push("</dedication>\n");
      } else if (lastTag0 === "<web>") {
        buffer.push("</ptr>\n");
      } else if (lastTag0 === "<phone>") {
        buffer.push("</phone>\n");
      } else if (lastTag0 === "<pubnum>") {
        buffer.push("</idno>\n");
      } else if (lastTag0 === "<degree>") {
        buffer.push("</note>\n");
      } /*else if (lastTag0.equals("<intro>")) {
          buffer.append("</p>\n");
      }*/ else if (lastTag0 === "<editor>") {
        buffer.push("</editor>\n");
      } else if (lastTag0 === "<version>") {
        buffer.push("</note>\n");
      } else if (lastTag0 === "<doctype>") {
        buffer.push("</note>\n");
      } else if (lastTag0 === "<date-download>") {
        buffer.push("</date>\n");
      } else if (lastTag0 === "<group>") {
        buffer.push("</note>\n");
      } else if (lastTag0 === "<availability>") {
        buffer.push("</note>\n");
      } else if (lastTag0 === "<conflict>") {
        buffer.push("</note>\n");
      } else if (lastTag0 === "<contribution>") {
        buffer.push("</note>\n");
      }
    }
  }

  private writeField(
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
      } else buffer.push("\n\t", outField, s2 ?? "");
    }
    return result;
  }

  /**
   * Consolidate an existing list of recognized citations based on access to
   * external internet bibliographic databases.
   *
   * @param resHeader original biblio item
   * @return consolidated biblio item
   */
  consolidateHeader(resHeader: BiblioItem, consolidate: number): BiblioItem {
    if (consolidate === 0) {
      // no consolidation
      return resHeader;
    }
    let consolidator: Consolidation | null = null;
    try {
      consolidator = Consolidation.getInstance();
      if (consolidator.getCntManager() === null)
        consolidator.setCntManager((this as unknown as { cntManager: CntManager }).cntManager);
      const bib: BiblioItem | null = consolidator.consolidate(resHeader, null, consolidate);
      if (bib !== null) {
        if (consolidate === 1 || consolidate === 3) BiblioItem.correct(resHeader, bib);
        else if (consolidate === 2) BiblioItem.injectIdentifiers(resHeader, bib);
      }
    } catch (e) {
      // Best-effort consolidation: a network error / rate-limit / malformed
      // CrossRef response must NOT prevent us from emitting the TEI we
      // already extracted via CRF. Log a warning and fall through to the
      // un-consolidated `resHeader`. This deviates from upstream (which
      // wraps the throw in a GrobidException and aborts) but matches the
      // contract documented in grobid-js's SDK options
      // (`consolidateHeader` is "boost if reachable, no-op otherwise").
      const msg = e instanceof Error ? e.message : String(e);
      LOGGER.warn(
        `Header consolidation failed (best-effort, falling back to CRF output): ${msg}`,
      );
    }
    void consolidator;
    return resHeader;
  }

  override close(): void {
    super.close();
  }
}
