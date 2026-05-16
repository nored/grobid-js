// Port of org.grobid.core.engines.MonographParser.
// Upstream: grobid-core/src/main/java/org/grobid/core/engines/MonographParser.java
//
// Adaptations:
// - `java.io.File inputFile` → `string` (file path), matching DocumentSource.fromPdf.
// - `TreeMap<String, Integer>` and `TreeMap<String, Boolean>` → JS `Map`
//   (we don't rely on the natural-ordering behaviour here; insertion order
//   is enough since the loop iterates inputs, not the map directly).
// - `Integer.valueOf("1")` → `1`.
// - `StringTokenizer st2 = new StringTokenizer(line, " \t")` → split on
//   tab-or-space with empty-token filtering (mirrors Java's `StringTokenizer`).
// - File I/O for training data uses `node:fs` directly (upstream uses
//   `Writer writer = new OutputStreamWriter(new FileOutputStream(..., false), "UTF-8")`).
// - LanguageUtilities is only referenced via the field; upstream initialises
//   it but it's not used in any of the ported methods. Preserved.

import * as fs from "node:fs";
import * as path from "node:path";
import { BasicStructureBuilder } from "../document/basic-structure-builder.js";
import { Document } from "../document/document.js";
import { DocumentSource } from "../document/document-source.js";
import { AbstractParser } from "./abstract-parser.js";
import type { GrobidAnalysisConfig } from "./config/grobid-analysis-config.js";
import { GrobidAnalysisConfig as GrobidAnalysisConfigImpl } from "./config/grobid-analysis-config.js";
import { GrobidException } from "../exceptions/grobid-exception.js";
import { GrobidExceptionStatus } from "../exceptions/grobid-exception-status.js";
import { GrobidResourceException } from "../exceptions/grobid-resource-exception.js";
import { GrobidModels } from "../grobid-models.js";
import { FeatureFactory } from "../features/feature-factory.js";
import { FeaturesVectorMonograph } from "../features/features-vector-monograph.js";
import { Block } from "../layout/block.js";
import { BoundingBox } from "../layout/bounding-box.js";
import type { DocumentNode } from "../document/document-node.js";
import { GraphicObject } from "../layout/graphic-object.js";
import { GraphicObjectType } from "../layout/graphic-object-type.js";
import { LayoutToken } from "../layout/layout-token.js";
import { Page } from "../layout/page.js";
import { GrobidProperties } from "../utilities/grobid-properties.js";
import { LanguageUtilities } from "../utilities/language-utilities.js";
import { TextUtilities } from "../utilities/text-utilities.js";
import { getLogger } from "../utilities/logger.js";

const LOGGER = getLogger("MonographParser");

/** Mirrors `org.apache.commons.lang3.StringUtils.isNotEmpty`. */
function isNotEmpty(s: string | null | undefined): boolean {
  return s !== null && s !== undefined && s.length > 0;
}

/** Mirrors Java's `StringTokenizer(line, " \t")`. */
class StringTokenizer {
  private tokens: string[];
  private idx: number = 0;
  constructor(text: string, delim: string) {
    const delims = new Set<string>();
    for (let i = 0; i < delim.length; i++) delims.add(delim.charAt(i));
    const out: string[] = [];
    let buf = "";
    for (let i = 0; i < text.length; i++) {
      const c = text.charAt(i);
      if (delims.has(c)) {
        if (buf.length > 0) {
          out.push(buf);
          buf = "";
        }
      } else {
        buf += c;
      }
    }
    if (buf.length > 0) out.push(buf);
    this.tokens = out;
  }
  hasMoreTokens(): boolean {
    return this.idx < this.tokens.length;
  }
  nextToken(): string {
    return this.tokens[this.idx++]!;
  }
}

/**
 * Realise a high level segmentation of a monograph. Monograph is to be understood here in the context library cataloging,
 * basically as a standalone book. The monograph could be an ebook (novels), a conference proceedings volume, a book
 * collection volume, a phd/msc thesis, a standalone report (with toc, etc.), a manual (with multiple chapters).
 * Monographs, here, are NOT magazine volumes, journal issues, newspapers, standalone chapters, standalone scholar articles,
 * tables of content, reference works, dictionaries, encyclopedia volumes, graphic novels.
 */
export class MonographParser extends AbstractParser {
  /*
   *   16 labels for this model:
   *       cover page (front of the book)
   *       title page (secondary title page)
   *       publisher page (publication information, including usually the copyrights info)
   *       summary (include executive summary)
   *       biography
   *       advertising (other works by the author/publisher)
   *       table of content
   *       table/list of figures
   *       preface (foreword)
   *       dedication (I dedicate this label to my family and my thesis director ;)
   *       unit (chapter or standalone article)
   *       reference (a full chapter of references, not to be confused with references attached to an article)
   *       annex
   *       index
   *       glossary (also abbreviations and acronyms)
   *       back cover page
   *       other
   */

  // default bins for relative position
  private static readonly NBBINS_POSITION: number = 12;

  // default bins for inter-block spacing
  private static readonly NBBINS_SPACE: number = 5;

  // default bins for block character density
  private static readonly NBBINS_DENSITY: number = 5;

  // projection scale for line length
  private static readonly LINESCALE: number = 10;

  // projection scale for block length
  // NOTE: upstream `BLOCKSCALE` is declared but never used.
  // Preserved verbatim.
  private static readonly BLOCKSCALE: number = 10;

  // NOTE: upstream `languageUtilities` field is initialised but never read.
  // Preserved verbatim.
  private languageUtilities: LanguageUtilities = LanguageUtilities.getInstance();
  private featureFactory: FeatureFactory = FeatureFactory.getInstance();

  private tmpPath: string | null = null;

  /**
   * TODO some documentation...
   */
  constructor() {
    super(GrobidModels.MONOGRAPH);
    this.tmpPath = GrobidProperties.getTempPath();
    // suppress unused-field lints; field is preserved verbatim.
    void this.languageUtilities;
    void MonographParser.BLOCKSCALE;
  }

  /**
   * Segment a PDF document into high level subdocuments.
   *
   * @param documentSource     document source
   * @return Document object with segmentation information
   */
  async processing(documentSource: DocumentSource, config: GrobidAnalysisConfig): Promise<Document> {
    try {
      let doc = new Document(documentSource);
      if (config.getAnalyzer() !== null) doc.setAnalyzer(config.getAnalyzer()!);
      doc.addTokenizedDocument(config);
      doc = await this.prepareDocument(doc);

      // if assets is true, the images are still there under directory pathXML+"_data"
      // we copy them to the assetPath directory

      /*ile assetFile = config.getPdfAssetPath();
            if (assetFile != null) {
                dealWithImages(documentSource, doc, assetFile, config);
            }*/
      return doc;
    } finally {
      // keep it clean when leaving...
      if (config.getPdfAssetPath() === null) {
        // remove the pdfalto tmp file
        DocumentSource.close(documentSource, false, true, true);
      } else {
        // remove the pdfalto tmp files, including the sub-directories
        DocumentSource.close(documentSource, true, true, true);
      }
    }
  }

  async prepareDocument(doc: Document): Promise<Document> {
    const tokenizations: LayoutToken[] = doc.getTokenizations() ?? [];
    if (tokenizations.length > (GrobidProperties.getPdfTokensMax() ?? Number.MAX_SAFE_INTEGER)) {
      throw new GrobidException(
        "The document has " + tokenizations.length + " tokens, but the limit is " + GrobidProperties.getPdfTokensMax(),
        undefined,
        GrobidExceptionStatus.TOO_MANY_TOKENS,
      );
    }

    doc.produceStatistics();
    //String content = getAllLinesFeatured(doc);
    const content = this.getAllBlocksFeatured(doc);
    if (content !== null && isNotEmpty(content.trim())) {
      const labelledResult: string = await this.label(content);
      // set the different sections of the Document object
      doc = BasicStructureBuilder.generalResultSegmentation(doc, labelledResult, tokenizations);
    }
    return doc;
  }

  /**
   * Addition of the features at line level for the complete document.
   * <p/>
   * This is an alternative to the token level, where the unit for labeling is the line - so allowing faster
   * processing and involving less features.
   * Lexical features becomes line prefix and suffix, the feature text unit is the first 10 characters of the
   * line without space.
   * The dictionary flags are at line level (i.e. the line contains a name mention, a place mention, a year, etc.)
   * Regarding layout features: font, size and style are the one associated to the first token of the line.
   */
  getAllLinesFeatured(doc: Document): string | null {
    const blocks: Block[] | null = doc.getBlocks();
    if (blocks === null || blocks.length === 0) {
      return null;
    }

    //guaranteeing quality of service. Otherwise, there are some PDF that may contain 300k blocks and thousands of extracted "images" that ruins the performance
    if (blocks.length > (GrobidProperties.getPdfBlocksMax() ?? Number.MAX_SAFE_INTEGER)) {
      throw new GrobidException(
        "Postprocessed document is too big, contains: " + blocks.length,
        undefined,
        GrobidExceptionStatus.TOO_MANY_BLOCKS,
      );
    }

    //boolean graphicVector = false;
    //boolean graphicBitmap = false;

    // list of textual patterns at the head and foot of pages which can be re-occur on several pages
    // (typically indicating a publisher foot or head notes)
    const patterns: Map<string, number> = new Map<string, number>();
    const firstTimePattern: Map<string, boolean> = new Map<string, boolean>();

    for (const page of doc.getPages() ?? []) {
      // we just look at the two first and last blocks of the page
      const pageBlocks = page.getBlocks();
      if (pageBlocks !== null && pageBlocks.length > 0) {
        for (let blockIndex = 0; blockIndex < pageBlocks.length; blockIndex++) {
          if (blockIndex < 2 || blockIndex > pageBlocks.length - 2) {
            const block = pageBlocks[blockIndex]!;
            const localText = block.getText();
            if (localText !== null && localText.length > 0) {
              const lines = localText.split(/[\n\r]/);
              if (lines.length > 0) {
                const line = lines[0]!;
                const pattern = this.featureFactory.getPattern(line);
                if (pattern.length > 8) {
                  const nb = patterns.get(pattern);
                  if (nb === undefined) {
                    patterns.set(pattern, 1);
                    firstTimePattern.set(pattern, false);
                  } else {
                    patterns.set(pattern, nb + 1);
                  }
                }
              }
            }
          }
        }
      }
    }

    const featuresAsString = this.getFeatureVectorsAsString(doc, patterns, firstTimePattern);

    return featuresAsString;
  }

  /**
   * Addition of the features at block level for the complete document.
   * <p/>
   * This is an alternative to the token and line level, where the unit for labeling is the block - so allowing even
   * faster processing and involving less features.
   * Lexical features becomes block prefix and suffix, the feature text unit is the first 10 characters of the
   * block without space.
   * The dictionary flags are at block level (i.e. the block contains a name mention, a place mention, a year, etc.)
   * Regarding layout features: font, size and style are the one associated to the first token of the block.
   */
  getAllBlocksFeatured(doc: Document): string | null {
    const blocks: Block[] | null = doc.getBlocks();
    if (blocks === null || blocks.length === 0) {
      return null;
    }

    //guaranteeing quality of service. Otherwise, there are some PDF that may contain 300k blocks and thousands of extracted "images" that ruins the performance
    if (blocks.length > (GrobidProperties.getPdfBlocksMax() ?? Number.MAX_SAFE_INTEGER)) {
      throw new GrobidException(
        "Postprocessed document is too big, contains: " + blocks.length,
        undefined,
        GrobidExceptionStatus.TOO_MANY_BLOCKS,
      );
    }

    //boolean graphicVector = false;
    //boolean graphicBitmap = false;

    // list of textual patterns at the head and foot of pages which can be re-occur on several pages
    // (typically indicating a publisher foot or head notes)
    const patterns: Map<string, number> = new Map<string, number>();
    const firstTimePattern: Map<string, boolean> = new Map<string, boolean>();

    for (const page of doc.getPages() ?? []) {
      // we just look at the two first and last blocks of the page
      const pageBlocks = page.getBlocks();
      if (pageBlocks !== null && pageBlocks.length > 0) {
        for (let blockIndex = 0; blockIndex < pageBlocks.length; blockIndex++) {
          if (blockIndex < 2 || blockIndex > pageBlocks.length - 2) {
            const block = pageBlocks[blockIndex]!;
            const localText = block.getText();
            if (localText !== null && localText.length > 0) {
              const pattern = this.featureFactory.getPattern(localText);
              if (pattern.length > 8) {
                const nb = patterns.get(pattern);
                if (nb === undefined) {
                  patterns.set(pattern, 1);
                  firstTimePattern.set(pattern, false);
                } else {
                  patterns.set(pattern, nb + 1);
                }
              }
            }
          }
        }
      }
    }

    const featuresAsString = this.getFeatureVectorsAsString(doc, patterns, firstTimePattern);

    return featuresAsString;
  }

  private getFeatureVectorsAsString(
    doc: Document,
    patterns: Map<string, number>,
    firstTimePattern: Map<string, boolean>,
  ): string {
    const fulltext: string[] = [];
    const documentLength = doc.getDocumentLenghtChar();

    let currentFont: string | null = null;
    let currentFontSize: number = -1;

    let newPage: boolean;
    // NOTE: upstream `start` local is initialised to `true` then never written
    // again (commented-out block at line 304-307). Preserved verbatim.
    let start: boolean = true;
    let mm = 0; // page position
    let nn = 0; // document position
    let pageLength = 0; // length of the current page
    let pageHeight: number = 0.0;

    // vector for features
    let features: FeaturesVectorMonograph;
    let previousFeatures: FeaturesVectorMonograph | null = null;

    for (const page of doc.getPages() ?? []) {
      pageHeight = page.getHeight();
      newPage = true;
      let spacingPreviousBlock: number = 0.0; // discretized
      let lowestPos: number = 0.0;
      pageLength = page.getPageLengthChar();
      const pageBoundingBox = page.getMainArea();
      mm = 0;
      //endPage = true;

      const pageBlocks = page.getBlocks();
      if (pageBlocks === null || pageBlocks.length === 0) continue;

      for (let blockIndex = 0; blockIndex < pageBlocks.length; blockIndex++) {
        const block = pageBlocks[blockIndex]!;
        /*if (start) {
                    newPage = true;
                    start = false;
                }*/
        let graphicVector = false;
        let graphicBitmap = false;

        let lastPageBlock = false;
        let firstPageBlock = false;
        if (blockIndex === pageBlocks.length - 1) {
          lastPageBlock = true;
        }

        if (blockIndex === 0) {
          firstPageBlock = true;
        }

        //endblock = false;

        /*if (endPage) {
                    newPage = true;
                    mm = 0;
                }*/

        // check if we have a graphical object connected to the current block
        const localImages: GraphicObject[] | null = Document.getConnectedGraphics(block, doc);
        if (localImages !== null) {
          for (const localImage of localImages) {
            if (localImage.getType() === GraphicObjectType.BITMAP) graphicBitmap = true;
            if (localImage.getType() === GraphicObjectType.VECTOR) graphicVector = true;
          }
        }

        if (lowestPos > block.getY()) {
          // we have a vertical shift, which can be due to a change of column or other particular layout formatting
          spacingPreviousBlock = doc.getMaxBlockSpacing() / 5.0; // default
        } else {
          spacingPreviousBlock = block.getY() - lowestPos;
        }

        const localText = block.getText();
        if (localText === null) continue;

        // character density of the block
        let density: number = 0.0;
        if (
          block.getHeight() !== 0.0 &&
          block.getWidth() !== 0.0 &&
          block.getText() !== null &&
          !block.getText()!.includes("@PAGE") &&
          !block.getText()!.includes("@IMAGE")
        ) {
          density = block.getText()!.length / (block.getHeight() * block.getWidth());
        }

        // is the current block in the main area of the page or not?
        let inPageMainArea = true;
        const blockBoundingBox = BoundingBox.fromPointAndDimensions(
          page.getNumber(),
          block.getX(),
          block.getY(),
          block.getWidth(),
          block.getHeight(),
        );
        if (
          pageBoundingBox === null ||
          (!pageBoundingBox.contains(blockBoundingBox) && !pageBoundingBox.intersect(blockBoundingBox))
        ) {
          inPageMainArea = false;
        }

        // Java's `String.split(regex)` drops trailing empty strings; JS keeps
        // them. Mirror Java by trimming the tail, otherwise BLOCKEND/li detection
        // would be off-by-one when a block's text ends with a newline.
        const lines = localText.split(/[\n\r]/);
        while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
        // set the max length of the lines in the block, in number of characters
        let maxLineLength = 0;
        for (let p = 0; p < lines.length; p++) {
          if (lines[p]!.length > maxLineLength) maxLineLength = lines[p]!.length;
        }
        const tokens: LayoutToken[] | null = block.getTokens();
        if (tokens === null || tokens.length === 0) {
          continue;
        }
        for (let li = 0; li < lines.length; li++) {
          const line = lines[li]!;
          /*boolean firstPageBlock = false;
                    boolean lastPageBlock = false;

                    if (newPage)
                        firstPageBlock = true;
                    if (endPage)
                        lastPageBlock = true;
                    */

          // for the layout information of the block, we take simply the first layout token
          let token: LayoutToken | null = null;
          if (tokens.length > 0) token = tokens[0]!;

          const coordinateLineY: number = token!.getY();

          features = new FeaturesVectorMonograph();
          features.token = token;
          features.line = line;

          if (blockIndex < 2 || blockIndex > pageBlocks.length - 2) {
            const pattern = this.featureFactory.getPattern(line);
            const nb = patterns.get(pattern);
            if (nb !== undefined && nb > 1) {
              features.repetitivePattern = true;

              const firstTimeDone = firstTimePattern.get(pattern);
              if (firstTimeDone !== undefined && !firstTimeDone) {
                features.firstRepetitivePattern = true;
                firstTimePattern.set(pattern, true);
              }
            }
          }

          // we consider the first token of the line as usual lexical token
          // and the second token of the line as feature
          const st2 = new StringTokenizer(line, " \t");
          // alternatively, use a grobid analyser
          let text: string | null = null;
          let text2: string | null = null;
          if (st2.hasMoreTokens()) text = st2.nextToken();
          if (st2.hasMoreTokens()) text2 = st2.nextToken();

          if (text === null) continue;

          // final sanitisation and filtering
          text = text.replace(/[ \n]/g, "");
          text = text.trim();

          if (
            text.length === 0 ||
            //                            (text.equals("\n")) ||
            //                            (text.equals("\r")) ||
            //                            (text.equals("\n\r")) ||
            TextUtilities.filterLine(line)
          ) {
            continue;
          }

          features.string = text;
          features.secondString = text2;

          features.firstPageBlock = firstPageBlock;
          features.lastPageBlock = lastPageBlock;
          //features.lineLength = line.length() / LINESCALE;
          features.lineLength = this.featureFactory.linearScaling(
            line.length,
            maxLineLength,
            MonographParser.LINESCALE,
          );

          features.punctuationProfile = TextUtilities.punctuationProfile(line);

          if (graphicBitmap) {
            features.bitmapAround = true;
          }
          if (graphicVector) {
            features.vectorAround = true;
          }

          features.lineStatus = null;
          features.punctType = null;

          if (
            li === 0 ||
            (previousFeatures !== null && previousFeatures.blockStatus === "BLOCKEND")
          ) {
            features.blockStatus = "BLOCKSTART";
          } else if (li === lines.length - 1) {
            features.blockStatus = "BLOCKEND";
            //endblock = true;
          } else if (features.blockStatus === null) {
            features.blockStatus = "BLOCKIN";
          }

          if (newPage) {
            features.pageStatus = "PAGESTART";
            newPage = false;
            //endPage = false;
            if (previousFeatures !== null) previousFeatures.pageStatus = "PAGEEND";
          } else {
            features.pageStatus = "PAGEIN";
            newPage = false;
            //endPage = false;
          }

          if (text.length === 1) {
            features.singleChar = true;
          }

          if (text.charAt(0) >= "A" && text.charAt(0) <= "Z") {
            // mirror Java `Character.isUpperCase` for the ASCII range; for
            // non-ASCII upper, fall back to locale-aware check below.
            features.capitalisation = "INITCAP";
          } else if (text.charAt(0).toUpperCase() === text.charAt(0) && text.charAt(0).toLowerCase() !== text.charAt(0)) {
            features.capitalisation = "INITCAP";
          }

          if (this.featureFactory.test_all_capital(text)) {
            features.capitalisation = "ALLCAP";
          }

          if (this.featureFactory.test_digit(text)) {
            features.digit = "CONTAINSDIGITS";
          }

          if (this.featureFactory.test_common(text)) {
            features.commonName = true;
          }

          if (this.featureFactory.test_names(text)) {
            features.properName = true;
          }

          if (this.featureFactory.test_month(text)) {
            features.month = true;
          }

          const m = this.featureFactory.isDigit.exec(text);
          if (m !== null) {
            features.digit = "ALLDIGIT";
          }

          const m2 = this.featureFactory.year.exec(text);
          if (m2 !== null) {
            features.year = true;
          }

          const m3 = this.featureFactory.email.exec(text);
          if (m3 !== null) {
            features.email = true;
          }

          const m4 = this.featureFactory.http.exec(text);
          if (m4 !== null) {
            features.http = true;
          }

          if (currentFont === null) {
            currentFont = token!.getFont();
            features.fontStatus = "NEWFONT";
          } else if (currentFont !== token!.getFont()) {
            currentFont = token!.getFont();
            features.fontStatus = "NEWFONT";
          } else {
            features.fontStatus = "SAMEFONT";
          }

          const newFontSize: number = Math.trunc(token!.getFontSize());
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

          if (token!.isBold()) features.bold = true;

          if (token!.isItalic()) features.italic = true;

          // HERE horizontal information
          // CENTERED
          // LEFTAJUSTED
          // CENTERED

          if (features.capitalisation === null) features.capitalisation = "NOCAPS";

          if (features.digit === null || features.digit === undefined) features.digit = "NODIGIT";

          //if (features.punctType == null)
          //    features.punctType = "NOPUNCT";

          features.relativeDocumentPosition = this.featureFactory.linearScaling(
            nn,
            documentLength,
            MonographParser.NBBINS_POSITION,
          );
          //System.out.println(nn + " " + documentLength + " " + NBBINS_POSITION + " " + features.relativeDocumentPosition);
          features.relativePagePositionChar = this.featureFactory.linearScaling(
            mm,
            pageLength,
            MonographParser.NBBINS_POSITION,
          );
          //System.out.println(mm + " " + pageLength + " " + NBBINS_POSITION + " " + features.relativePagePositionChar);
          let pagePos: number = this.featureFactory.linearScaling(
            coordinateLineY,
            pageHeight,
            MonographParser.NBBINS_POSITION,
          );
          //System.out.println(coordinateLineY + " " + pageHeight + " " + NBBINS_POSITION + " " + pagePos);
          if (pagePos > MonographParser.NBBINS_POSITION) pagePos = MonographParser.NBBINS_POSITION;
          features.relativePagePosition = pagePos;
          //System.out.println(coordinateLineY + "\t" + pageHeight);

          if (spacingPreviousBlock !== 0.0) {
            features.spacingWithPreviousBlock = this.featureFactory.linearScaling(
              spacingPreviousBlock - doc.getMinBlockSpacing(),
              doc.getMaxBlockSpacing() - doc.getMinBlockSpacing(),
              MonographParser.NBBINS_SPACE,
            );
          }

          features.inMainArea = inPageMainArea;

          if (density !== -1.0) {
            features.characterDensity = this.featureFactory.linearScaling(
              density - doc.getMinCharacterDensity(),
              doc.getMaxCharacterDensity() - doc.getMinCharacterDensity(),
              MonographParser.NBBINS_DENSITY,
            );
            //System.out.println((density-doc.getMinCharacterDensity()) + " " + (doc.getMaxCharacterDensity()-doc.getMinCharacterDensity()) + " " + NBBINS_DENSITY + " " + features.characterDensity);
          }

          if (previousFeatures !== null) {
            const vector = previousFeatures.printVector();
            if (vector !== null) fulltext.push(vector);
          }
          previousFeatures = features;
        }

        //System.out.println((spacingPreviousBlock-doc.getMinBlockSpacing()) + " " + (doc.getMaxBlockSpacing()-doc.getMinBlockSpacing()) + " " + NBBINS_SPACE + " "
        //    + featureFactory.linearScaling(spacingPreviousBlock-doc.getMinBlockSpacing(), doc.getMaxBlockSpacing()-doc.getMinBlockSpacing(), NBBINS_SPACE));

        // lowest position of the block
        lowestPos = block.getY() + block.getHeight();

        // update page-level and document-level positions
        if (tokens !== null) {
          mm += tokens.length;
          nn += tokens.length;
        }
      }
    }
    if (previousFeatures !== null) {
      const v = previousFeatures.printVector();
      if (v !== null) fulltext.push(v);
    }

    // suppress unused-locals lints; preserved verbatim.
    void start;
    void Page;

    return fulltext.join("");
  }

  /**
   * Process the specified pdf and format the result as training data for the monograph model.
   *
   * @param inputFile input PDF file path
   * @param pathRaw path to raw monograph featured sequence
   * @param pathTEI path to TEI
   * @param id id
   */
  createTrainingFromPDF(
    inputFile: string,
    pathRaw: string,
    pathTEI: string,
    id: number,
  ): Document | null {
    if (this.tmpPath === null) throw new GrobidResourceException("Cannot process pdf file, because temp path is null.");
    if (!fs.existsSync(this.tmpPath)) {
      throw new GrobidResourceException(
        "Cannot process pdf file, because temp path '" + this.tmpPath + "' does not exists.",
      );
    }
    let documentSource: DocumentSource | null = null;
    let doc: Document | null = null;
    try {
      if (!fs.existsSync(inputFile)) {
        throw new GrobidResourceException(
          "Cannot train for monograph, because file '" + inputFile + "' does not exists.",
        );
      }
      const pdfFileName = path.basename(inputFile);

      const outputTEIFile = path.join(pathTEI, pdfFileName.replace(".pdf", "training.monograph.tei.xml"));
      /* // commented out because it was making a test of the existence of a file before it was even created
               if (!outputTEIFile.exists()) {
                throw new GrobidResourceException("Cannot train for monograph, because directory '" +
                       pathTEI + "' is not valid.");
            }*/
      // NOTE: upstream `outputRawFile` is declared but never used.
      // Preserved verbatim.
      const outputRawFile = path.join(pathRaw, pdfFileName.replace(".pdf", ".monograph.raw"));
      void outputRawFile;
      /*if (!outputRawFile.exists()) {
                throw new GrobidResourceException("Cannot train for monograph, because directory '" +
                       pathRaw + "' is not valid.");
            }*/

      documentSource = DocumentSource.fromPdf(inputFile, -1, -1, true, true, true);
      doc = new Document(documentSource);
      doc.addTokenizedDocument(GrobidAnalysisConfigImpl.defaultInstance());

      if (doc.getBlocks() === null) {
        throw new Error("PDF parsing resulted in empty content");
      }

      // TBD: language identifier here on content text sample
      const lang = "en";

      doc.produceStatistics();
      const builder: string[] = [];
      builder.push(
        '<?xml version="1.0" ?>\n<tei xml:space="preserve">\n\t<teiHeader>\n\t\t<fileDesc xml:id="' +
          id +
          '"/>\n\t</teiHeader>\n\t<text xml:lang="' +
          lang +
          '">\n',
      );

      // get the document outline
      const outlineRoot: DocumentNode | null = doc.getOutlineRoot();

      // output an XML document based on the provided outline and the tokenization
      const tokens: LayoutToken[] = doc.getTokenizations() ?? [];

      // NOTE: upstream sets `currentNode` from `outlineRoot` then walks
      // first-child until a leaf, but never reads the resulting `currentNode`.
      // Preserved verbatim.
      let currentNode: DocumentNode | null = outlineRoot;
      // get the first node
      while (currentNode !== null && currentNode.getChildren() !== null) {
        const children: DocumentNode[] = currentNode.getChildren()!;
        if (children.length === 0) break;
        currentNode = children[0]!;
      }
      void currentNode;

      for (const token of tokens) {
        builder.push(token.getText() ?? "");
      }

      builder.push("\t</text>\n</tei>");

      // write the TEI file
      fs.writeFileSync(outputTEIFile, builder.join(""), { encoding: "utf8" });
    } catch (e) {
      // upstream calls e.printStackTrace() then throws — preserve that.
      LOGGER.error("Exception in createTrainingFromPDF", e);
      throw new GrobidException(
        "An exception occured while running Grobid training" + " data generation for monograph.",
        e,
      );
    } finally {
      DocumentSource.close(documentSource, true, true, true);
    }

    return doc;
  }
}
