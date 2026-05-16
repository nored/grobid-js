// Port of org.grobid.core.engines.Segmentation.
// Upstream: grobid-core/src/main/java/org/grobid/core/engines/Segmentation.java
//
// Realise a high level segmentation of a document into cover page, document
// header, page footer, page header, document body, bibliographical section,
// each bibliographical references in the biblio section and finally the
// possible annexes.
//
// Notes:
// - Image conversion via `javax.imageio.ImageIO` (jpg/ppm → png) is a JNI
//   operation. The JS port leaves the conversion to the runtime hook
//   registered via `setImageConverter`; default implementation throws if
//   asked to convert.
// - `eugfc.imageio.plugins.PNMRegistry.registerAllServicesProviders()` is a
//   no-op on JS — handled via the runtime hook.

import { existsSync, copyFileSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import * as path from "node:path";

import { BasicStructureBuilder } from "../document/basic-structure-builder.js";
import { Document } from "../document/document.js";
import { DocumentSource } from "../document/document-source.js";
import { applyPage1Cleanup } from "../document/page1-cleanup.js";
import { GrobidAnalysisConfig } from "../engines/config/grobid-analysis-config.js";
import { GrobidException } from "../exceptions/grobid-exception.js";
import { GrobidExceptionStatus } from "../exceptions/grobid-exception-status.js";
import { FeatureFactory } from "../features/feature-factory.js";
import { FeaturesVectorSegmentation } from "../features/features-vector-segmentation.js";
import { Flavor, GrobidModels } from "../grobid-models.js";
import { Block } from "../layout/block.js";
import { BoundingBox } from "../layout/bounding-box.js";
import { GraphicObject } from "../layout/graphic-object.js";
import { GraphicObjectType } from "../layout/graphic-object-type.js";
import { LayoutToken } from "../layout/layout-token.js";
import { Page } from "../layout/page.js";
import { GrobidProperties } from "../utilities/grobid-properties.js";
import { LanguageUtilities } from "../utilities/language-utilities.js";
import { TextUtilities } from "../utilities/text-utilities.js";
import { getLogger } from "../utilities/logger.js";
import { AbstractParser } from "./abstract-parser.js";

const LOGGER = getLogger("Segmentation");

// for image conversion we're using an ImageIO plugin for PPM format support
// see https://github.com/eug/imageio-pnm
// the jar for this plugin is located in the local repository

/**
 * Hook for image conversion (`javax.imageio.ImageIO.read` + write as PNG).
 * Implementations may use sharp / wasm-imagemagick / etc. Default throws
 * if asked to convert.
 */
export interface ImageConverter {
  /** Convert `inputFile` (jpg/ppm/…) into a PNG at `outputFile`. */
  toPng(inputFile: string, outputFile: string): void;
}

let imageConverter: ImageConverter = {
  toPng(inputFile: string, _outputFile: string): void {
    throw new GrobidException(
      "Image converter not registered; cannot convert " + inputFile + ". " +
        "Register a converter via Segmentation.setImageConverter(...).",
    );
  },
};

function isNotEmpty(s: string | null | undefined): boolean {
  return s !== null && s !== undefined && s.length > 0;
}
function isNotBlank(s: string | null | undefined): boolean {
  return s !== null && s !== undefined && s.trim().length > 0;
}

/**
 * Realise a high level segmentation of a document into cover page, document header, page footer,
 * page header, document body, bibliographical section, each bibliographical references in
 * the biblio section and finally the possible annexes.
 */
export class Segmentation extends AbstractParser {
  /*
        13 labels for this model:
		 		cover page <cover>,
				document header <header>,
				page footer <footnote>,
				page header <headnote>,
            note in margin <marginnote>,
				document body <body>,
				bibliographical section <references>,
				page number <page>,
				annexes <annex>,
			    acknowledgement <acknowledgement>,
			   	availability <availability>,
			   	funding <funding>,
			   	conflict of interest / declaration of interest <conflict>,
			   	author contribution <contribution>,
            other <other>,
			    toc <toc> -> not yet used because not yet training data for this
	*/

  // default bins for relative position
  private static readonly NBBINS_POSITION: number = 12;

  // default bins for inter-block spacing
  private static readonly NBBINS_SPACE: number = 5;

  // default bins for block character density
  private static readonly NBBINS_DENSITY: number = 5;

  // projection scale for line length
  private static readonly LINESCALE: number = 10;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private languageUtilities: LanguageUtilities = LanguageUtilities.getInstance();
  private featureFactory: FeatureFactory = FeatureFactory.getInstance();

  /** Register the image-conversion hook used by `dealWithImages`. */
  static setImageConverter(converter: ImageConverter): void {
    imageConverter = converter;
  }

  /**
   * TODO some documentation...
   */
  constructor();
  constructor(flavor: Flavor);
  constructor(flavor?: Flavor) {
    super(
      flavor === undefined
        ? GrobidModels.SEGMENTATION
        : GrobidModels.getModelFlavor(GrobidModels.SEGMENTATION, flavor),
    );
  }

  /**
   * Segment a PDF document into high level zones: cover page, document header,
   * page footer, page header, body, page numbers, biblio section and annexes.
   *
   * @param documentSource     document source
   * @return Document object with segmentation information
   */
  processing(documentSource: DocumentSource, config: GrobidAnalysisConfig): Promise<Document>;
  processing(text: string): Promise<Document>;
  async processing(arg: DocumentSource | string, config?: GrobidAnalysisConfig): Promise<Document> {
    if (typeof arg === "string") {
      const doc = Document.createFromText(arg);
      return await this.prepareDocument(doc);
    }
    const documentSource = arg;
    try {
      let doc = new Document(documentSource);
      if (config!.getAnalyzer() !== null) doc.setAnalyzer(config!.getAnalyzer()!);
      doc.addTokenizedDocument(config!);
      // JS-port addition: page-1 cleanup. Detects archive cover sheets and
      // preprint banners on page 1 and removes them from the segmentation-
      // visible block list. Idempotent + behind a global toggle (default on).
      // See src/grobid/document/page1-cleanup.ts for the heuristic catalogue.
      const cleanup = applyPage1Cleanup(doc);
      if (cleanup.modified) {
        const pdfFile = documentSource.getPdfFile();
        LOGGER.info(
          "page1-cleanup fired on " +
            (pdfFile ?? "(unknown pdf)") +
            " — " +
            cleanup.firedRules.join("; "),
        );
      }
      doc = await this.prepareDocument(doc);

      // if assets is true, the images are still there under directory pathXML+"_data"
      // we copy them to the assetPath directory

      const assetFile: string | null = config!.getPdfAssetPath();
      if (assetFile !== null) {
        this.dealWithImages(documentSource, doc, assetFile, config!);
      }
      return doc;
    } finally {
      // keep it clean when leaving...
      /*if (config.getPdfAssetPath() == null) {
                // remove the pdfalto tmp file
                DocumentSource.close(documentSource, false, true, true);
            } else*/
      {
        // remove the pdfalto tmp files, including the sub-directories
        DocumentSource.close(documentSource, true, true, true);
      }
    }
  }

  async prepareDocument(doc: Document): Promise<Document> {
    const tokenizations: LayoutToken[] = doc.getTokenizations() ?? [];
    if (tokenizations.length > (GrobidProperties.getPdfTokensMax() ?? Number.POSITIVE_INFINITY)) {
      throw new GrobidException(
        "The document has " +
          tokenizations.length +
          " tokens, but the limit is " +
          GrobidProperties.getPdfTokensMax(),
        undefined,
        GrobidExceptionStatus.TOO_MANY_TOKENS,
      );
    }

    doc.produceStatistics();
    const content: string | null = this.getAllLinesFeatured(doc);
    if (isNotEmpty(content?.trim())) {
      const labelledResult: string = await this.label(content!);
      // set the different sections of the Document object
      doc = BasicStructureBuilder.generalResultSegmentation(doc, labelledResult, tokenizations);
    }
    return doc;
  }

  private dealWithImages(
    documentSource: DocumentSource,
    doc: Document,
    assetFile: string | null,
    config: GrobidAnalysisConfig,
  ): void {
    if (assetFile !== null) {
      // copy the files under the directory pathXML+"_data" (the asset files) into the path specified by assetPath

      if (!existsSync(assetFile)) {
        // we create it
        try {
          mkdirSync(assetFile);
          LOGGER.debug("Directory created: " + assetFile);
        } catch (_e) {
          LOGGER.error("Failed to create directory: " + assetFile);
        }
      }
      // PNMRegistry.registerAllServicesProviders(); — no-op (handled by converter hook)

      // filter all .jpg and .png files
      const directoryPath: string = documentSource.getXmlFile() + "_data";
      if (existsSync(directoryPath)) {
        let files: string[] | null = null;
        try {
          files = readdirSync(directoryPath);
        } catch (_e) {
          files = null;
        }
        if (files !== null) {
          let nbFiles = 0;
          for (const currFileName of files) {
            if (nbFiles > DocumentSource.PDFALTO_FILES_AMOUNT_LIMIT) break;

            const currFile = path.join(directoryPath, currFileName);
            const toLowerCaseName = currFileName.toLowerCase();
            if (toLowerCaseName.endsWith(".png") || !config.isPreprocessImages()) {
              try {
                if (toLowerCaseName.endsWith(".svg")) {
                  continue;
                }
                const dest = path.join(assetFile, currFileName);
                copyFileSync(currFile, dest);
                nbFiles++;
              } catch (e) {
                LOGGER.error("Cannot copy file " + currFile + " to " + assetFile, e);
              }
            } else if (
              toLowerCaseName.endsWith(".jpg") ||
              toLowerCaseName.endsWith(".ppm")
              //	|| currFile.getName().toLowerCase().endsWith(".pbm")
            ) {
              let outputFilePath = "";
              try {
                if (toLowerCaseName.endsWith(".jpg")) {
                  outputFilePath = assetFile + path.sep + toLowerCaseName.replace(".jpg", ".png");
                } /*else if (currFile.getName().toLowerCase().endsWith(".pbm")) {
                                    outputFilePath = assetFile.getPath() + File.separator +
                                         currFile.getName().toLowerCase().replace(".pbm",".png");
                                }*/ else {
                  outputFilePath = assetFile + path.sep + toLowerCaseName.replace(".ppm", ".png");
                }
                imageConverter.toPng(currFile, outputFilePath);
                nbFiles++;
              } catch (e) {
                LOGGER.error("Cannot convert file " + currFile + " to " + outputFilePath, e);
              }
            }
          }
        }
      }
      // update the path of the image description stored in Document
      if (config.isPreprocessImages()) {
        const images: GraphicObject[] | null = doc.getImages();
        if (images !== null) {
          let subPath: string = assetFile;
          let ind = subPath.lastIndexOf("/");
          if (ind !== -1) subPath = subPath.substring(ind + 1);
          for (const image of images) {
            let fileImage: string | null = image.getFilePath();
            if (fileImage === null) {
              continue;
            }
            fileImage = fileImage.replace(/\.ppm/g, ".png").replace(/\.jpg/g, ".png");
            ind = fileImage.indexOf("/");
            image.setFilePath(subPath + fileImage.substring(ind));
          }
        }
      }
    }
  }

  /**
   * Addition of the features at line level for the complete document.
   * <p/>
   * This is an alternative to the token level, where the unit for labeling is the line - so allowing faster
   * processing and involving fewer features.
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
    if (blocks.length > (GrobidProperties.getPdfBlocksMax() ?? Number.POSITIVE_INFINITY)) {
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
      if (page.getBlocks() !== null && page.getBlocks()!.length > 0) {
        for (let blockIndex = 0; blockIndex < page.getBlocks()!.length; blockIndex++) {
          if (blockIndex < 2 || blockIndex > page.getBlocks()!.length - 2) {
            const block: Block = page.getBlocks()![blockIndex] as Block;
            const localText: string | null = block.getText();
            if (localText !== null && localText.length > 0) {
              // See note at line ~470: Java's split drops trailing empties.
              const lines: string[] = localText.split(/[\n\r]/);
              while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
              if (lines.length > 0) {
                const line = lines[0] as string;
                const pattern: string = this.featureFactory.getPattern(line);
                if (pattern.length > 8) {
                  const nb = patterns.get(pattern);
                  if (nb === undefined) {
                    patterns.set(pattern, 1);
                    firstTimePattern.set(pattern, false);
                  } else patterns.set(pattern, nb + 1);
                }
              }
            }
          }
        }
      }
    }

    const featuresAsString: string = this.getFeatureVectorsAsString(doc, patterns, firstTimePattern);

    return featuresAsString;
  }

  private getFeatureVectorsAsString(
    doc: Document,
    patterns: Map<string, number>,
    firstTimePattern: Map<string, boolean>,
  ): string {
    const fulltext: string[] = [];
    const documentLength: number = doc.getDocumentLenghtChar();

    let currentFont: string | null = null;
    let currentFontSize: number = -1;

    let newPage: boolean;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    let start = true;
    let mm = 0; // page position
    let nn = 0; // document position
    let pageLength = 0; // length of the current page
    let pageHeight = 0.0;

    // vector for features
    let features: FeaturesVectorSegmentation;
    let previousFeatures: FeaturesVectorSegmentation | null = null;

    for (const page of doc.getPages() ?? []) {
      pageHeight = page.getHeight();
      newPage = true;
      let spacingPreviousBlock = 0.0; // discretized
      let lowestPos = 0.0;
      pageLength = page.getPageLengthChar();
      const pageBoundingBox: BoundingBox | null = page.getMainArea();
      mm = 0;
      //endPage = true;

      if (page.getBlocks() === null || page.getBlocks()!.length === 0) {
        continue;
      }

      for (let blockIndex = 0; blockIndex < page.getBlocks()!.length; blockIndex++) {
        const block: Block = page.getBlocks()![blockIndex] as Block;
        /*if (start) {
                    newPage = true;
                    start = false;
                }*/
        let graphicVector = false;
        let graphicBitmap = false;

        let lastPageBlock = false;
        let firstPageBlock = false;
        if (blockIndex === page.getBlocks()!.length - 1) {
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
            if (
              localImage.getType() === GraphicObjectType.VECTOR ||
              localImage.getType() === GraphicObjectType.VECTOR_BOX
            )
              graphicVector = true;
          }
        }

        if (lowestPos > block.getY()) {
          // we have a vertical shift, which can be due to a change of column or other particular layout formatting
          spacingPreviousBlock = doc.getMaxBlockSpacing() / 5.0; // default
        } else spacingPreviousBlock = block.getY() - lowestPos;

        const localText: string | null = block.getText();
        if (localText === null) continue;

        // character density of the block
        let density = 0.0;
        if (
          block.getHeight() !== 0.0 &&
          block.getWidth() !== 0.0 &&
          block.getText() !== null &&
          !(block.getText() as string).includes("@PAGE") &&
          !(block.getText() as string).includes("@IMAGE")
        )
          density = (block.getText() as string).length / (block.getHeight() * block.getWidth());

        // is the current block in the main area of the page or not?
        let inPageMainArea = true;
        const blockBoundingBox: BoundingBox = BoundingBox.fromPointAndDimensions(
          page.getNumber(),
          block.getX(),
          block.getY(),
          block.getWidth(),
          block.getHeight(),
        );
        if (
          pageBoundingBox === null ||
          (!pageBoundingBox.contains(blockBoundingBox) && !pageBoundingBox.intersect(blockBoundingBox))
        )
          inPageMainArea = false;

        // Java's `String.split(regex)` (no limit) drops trailing empty strings;
        // JS `String.prototype.split` keeps them. Mirror Java by trimming the
        // tail. Without this fix the BLOCKEND detection at the bottom of this
        // loop (`li === lines.length - 1`) was off-by-one whenever the block's
        // text ended with a newline, mislabelling page-1 title/abstract blocks
        // as <body> rather than <header>.
        const lines: string[] = localText.split(/[\n\r]/);
        while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
        // set the max length of the lines in the block, in number of characters
        let maxLineLength = 0;
        for (let p = 0; p < lines.length; p++) {
          if ((lines[p] as string).length > maxLineLength) maxLineLength = (lines[p] as string).length;
        }
        const tokens: LayoutToken[] | null = block.getTokens();
        if (tokens === null || tokens.length === 0) {
          continue;
        }
        for (let li = 0; li < lines.length; li++) {
          const line = lines[li] as string;
          /*boolean firstPageBlock = false;
                    boolean lastPageBlock = false;

                    if (newPage)
                        firstPageBlock = true;
                    if (endPage)
                        lastPageBlock = true;
                    */

          // for the layout information of the block, we take simply the first layout token
          let token: LayoutToken | null = null;
          if (tokens.length > 0) token = tokens[0] as LayoutToken;

          const coordinateLineY: number = (token as LayoutToken).getY();

          features = new FeaturesVectorSegmentation();
          features.token = token;
          features.line = line;

          if (blockIndex < 2 || blockIndex > page.getBlocks()!.length - 2) {
            const pattern: string = this.featureFactory.getPattern(line);
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
          // Java's StringTokenizer skips runs of any of " \t\f ".
          const st2: string[] = line.split(/[ \t\f ]+/).filter((s) => s.length > 0);
          // alternatively, use a grobid analyser
          let text: string | null = null;
          let text2: string | null = null;
          if (st2.length > 0) text = st2[0] as string;
          if (st2.length > 1) text2 = st2[1] as string;

          if (text === null) continue;

          // final sanitization and filtering
          text = text.replace(/[ \n\r]/g, "");
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
            Segmentation.LINESCALE,
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

          const firstChar = text.charAt(0);
          if (firstChar !== firstChar.toLowerCase() && firstChar === firstChar.toUpperCase()) {
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
            currentFont = (token as LayoutToken).getFont();
            features.fontStatus = "NEWFONT";
          } else if (currentFont !== (token as LayoutToken).getFont()) {
            currentFont = (token as LayoutToken).getFont();
            features.fontStatus = "NEWFONT";
          } else features.fontStatus = "SAMEFONT";

          const newFontSize: number = Math.trunc((token as LayoutToken).getFontSize());
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

          if ((token as LayoutToken).isBold()) features.bold = true;

          if ((token as LayoutToken).isItalic()) features.italic = true;

          // HERE horizontal information
          // CENTERED
          // LEFTAJUSTED
          // CENTERED

          if (features.capitalisation === null) features.capitalisation = "NOCAPS";

          if (features.digit === null) features.digit = "NODIGIT";

          //if (features.punctType == null)
          //    features.punctType = "NOPUNCT";

          features.relativeDocumentPosition = this.featureFactory.linearScaling(
            nn,
            documentLength,
            Segmentation.NBBINS_POSITION,
          );
          //System.out.println(nn + " " + documentLength + " " + NBBINS_POSITION + " " + features.relativeDocumentPosition);
          features.relativePagePositionChar = this.featureFactory.linearScaling(
            mm,
            pageLength,
            Segmentation.NBBINS_POSITION,
          );
          //System.out.println(mm + " " + pageLength + " " + NBBINS_POSITION + " " + features.relativePagePositionChar);
          let pagePos: number = this.featureFactory.linearScaling(
            coordinateLineY,
            pageHeight,
            Segmentation.NBBINS_POSITION,
          );
          //System.out.println(coordinateLineY + " " + pageHeight + " " + NBBINS_POSITION + " " + pagePos);
          if (pagePos > Segmentation.NBBINS_POSITION) pagePos = Segmentation.NBBINS_POSITION;
          features.relativePagePosition = pagePos;
          //System.out.println(coordinateLineY + "\t" + pageHeight);

          if (spacingPreviousBlock !== 0.0) {
            features.spacingWithPreviousBlock = this.featureFactory.linearScaling(
              spacingPreviousBlock - doc.getMinBlockSpacing(),
              doc.getMaxBlockSpacing() - doc.getMinBlockSpacing(),
              Segmentation.NBBINS_SPACE,
            );
          }

          features.inMainArea = inPageMainArea;

          if (density !== -1.0) {
            features.characterDensity = this.featureFactory.linearScaling(
              density - doc.getMinCharacterDensity(),
              doc.getMaxCharacterDensity() - doc.getMinCharacterDensity(),
              Segmentation.NBBINS_DENSITY,
            );
            //System.out.println((density-doc.getMinCharacterDensity()) + " " + (doc.getMaxCharacterDensity()-doc.getMinCharacterDensity()) + " " + NBBINS_DENSITY + " " + features.characterDensity);
          }

          if (previousFeatures !== null) {
            const vector: string | null = previousFeatures.printVector();
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
      const vector = previousFeatures.printVector();
      if (vector !== null) fulltext.push(vector);
    }

    return fulltext.join("");
  }

  /**
   * Process the content of the specified pdf and format the result as training data.
   *
   * @param inputFile    input file
   * @param pathFullText path to fulltext
   * @param pathTEI      path to TEI
   * @param id           id
   */
  async createTrainingSegmentation(
    inputFile: string,
    pathFullText: string,
    pathTEI: string,
    id: number,
  ): Promise<void> {
    let documentSource: DocumentSource | null = null;
    try {
      const file: string = inputFile;

      //documentSource = DocumentSource.fromPdf(file);
      documentSource = DocumentSource.fromPdf(file, -1, -1, true, true, true);
      const doc: Document = new Document(documentSource);

      const PDFFileName: string = path.basename(file);
      doc.addTokenizedDocument(GrobidAnalysisConfig.defaultInstance());

      if (doc.getBlocks() === null) {
        throw new Error("PDF parsing resulted in empty content");
      }
      doc.produceStatistics();

      const fulltext: string | null = //getAllTextFeatured(doc, false);
        this.getAllLinesFeatured(doc);
      //List<LayoutToken> tokenizations = doc.getTokenizationsFulltext();
      const tokenizations: LayoutToken[] = doc.getTokenizations() ?? [];

      // we write the full text untagged (but featurized)
      const outPathFulltext: string =
        pathFullText + path.sep + PDFFileName.replace(".pdf", ".training.segmentation");
      writeFileSync(outPathFulltext, (fulltext ?? "") + "\n", { encoding: "utf-8" });

      // also write the raw text as seen before segmentation
      const rawtxt: string[] = [];
      for (const txtline of tokenizations) {
        rawtxt.push(txtline.getText() ?? "");
      }
      const outPathRawtext: string =
        pathFullText + path.sep + PDFFileName.replace(".pdf", ".training.segmentation.rawtxt");
      writeFileSync(outPathRawtext, rawtxt.join(""), { encoding: "utf-8" });

      if (isNotBlank(fulltext)) {
        const rese: string = await this.label(fulltext!);
        const bufferFulltext: string[] = this.trainingExtraction(rese, tokenizations, doc);

        // write the TEI file to reflect the extact layout of the text as extracted from the pdf
        const out: string[] = [];
        out.push(
          '<?xml version="1.0" ?>\n<tei xml:space="preserve">\n\t<teiHeader>\n\t\t<fileDesc xml:id="' +
            id +
            '"/>\n\t</teiHeader>\n\t<text xml:lang="en">\n',
        );
        out.push(bufferFulltext.join(""));
        out.push("\n\t</text>\n</tei>\n");
        writeFileSync(
          pathTEI + path.sep + PDFFileName.replace(".pdf", ".training.segmentation.tei.xml"),
          out.join(""),
          { encoding: "utf-8" },
        );
      }
    } catch (e) {
      throw new GrobidException(
        "An exception occured while running Grobid training" +
          " data generation for segmentation model.",
        e,
      );
    } finally {
      DocumentSource.close(documentSource, true, true, true);
    }
  }

  /**
   * Get the content of the pdf and produce a blank training data TEI file, i.e. a text only TEI file
   * without any tags. This is usefull to start from scratch the creation of training data at the same
   * level as the segmentation parser.
   *
   * @param inputFile    input file
   * @param pathFullText path to fulltext
   * @param pathTEI      path to TEI
   * @param id           id
   */
  createBlankTrainingData(file: string, pathFullText: string, pathTEI: string, id: number): void {
    let documentSource: DocumentSource | null = null;
    try {
      //File file = new File(inputFile);

      //documentSource = DocumentSource.fromPdf(file);
      documentSource = DocumentSource.fromPdf(file, -1, -1, true, true, true);
      const doc: Document = new Document(documentSource);

      const PDFFileName: string = path.basename(file);
      doc.addTokenizedDocument(GrobidAnalysisConfig.defaultInstance());

      if (doc.getBlocks() === null) {
        throw new Error("PDF parsing resulted in empty content");
      }
      doc.produceStatistics();

      let fulltext: string | null = //getAllTextFeatured(doc, false);
        this.getAllLinesFeatured(doc);
      //List<LayoutToken> tokenizations = doc.getTokenizationsFulltext();
      const tokenizations: LayoutToken[] = doc.getTokenizations() ?? [];

      // we write the full text untagged (but featurized)
      const outPathFulltext: string =
        pathFullText + path.sep + PDFFileName.replace(/\.pdf$/i, ".training.blank");
      writeFileSync(outPathFulltext, (fulltext ?? "") + "\n", { encoding: "utf-8" });

      // also write the raw text as seen before segmentation
      const rawtxt: string[] = [];
      for (const txtline of tokenizations) {
        rawtxt.push(TextUtilities.HTMLEncode(txtline.getText()) ?? "");
      }

      fulltext = rawtxt.join("");
      if (isNotBlank(fulltext)) {
        // write the TEI file to reflect the extact layout of the text as extracted from the pdf
        const out: string[] = [];
        out.push(
          '<?xml version="1.0" ?>\n<tei xml:space="preserve">\n\t<teiHeader>\n\t\t<fileDesc xml:id="f' +
            id +
            '"/>\n\t</teiHeader>\n\t<text xml:lang="en">\n',
        );
        out.push(fulltext);
        out.push("\n\t</text>\n</tei>\n");
        writeFileSync(
          pathTEI + path.sep + PDFFileName.replace(/\.pdf$/i, ".training.blank.tei.xml"),
          out.join(""),
          { encoding: "utf-8" },
        );
      }
    } catch (e) {
      throw new GrobidException(
        "An exception occured while running Grobid training" +
          " data generation for segmentation model.",
        e,
      );
    } finally {
      DocumentSource.close(documentSource, true, true, true);
    }
  }

  /**
   * Extract results from a labelled full text in the training format without any string modification.
   */
  trainingExtraction(result: string, tokenizations: LayoutToken[], doc: Document): string[] {
    // this is the main buffer for the whole full text
    const buffer: string[] = [];
    try {
      const blocks: Block[] | null = doc.getBlocks();
      let currentBlockIndex = 0;
      let indexLine = 0;

      const tokenList: string[] = result.split("\n").filter((l) => l.length > 0);
      let s1: string | null = null; // current label/tag
      let s2: string | null = null; // current lexical token
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      let s3: string | null = null; // current second lexical token
      let lastTag: string | null = null;

      // current token position
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      let p = 0;
      let start = true;

      for (let lineIdx = 0; lineIdx < tokenList.length; lineIdx++) {
        const addSpace = false;
        const tok = (tokenList[lineIdx] as string).trim();
        let line: string | null = null; // current line

        if (tok.length === 0) {
          continue;
        }
        const stt: string[] = tok.split(/[ \t]+/).filter((s) => s.length > 0);
        const localFeatures: string[] = [];
        let i = 0;

        const newLine = true;
        const ll = stt.length;
        for (const partRaw of stt) {
          const s = partRaw.trim();
          if (i === 0) {
            s2 = TextUtilities.HTMLEncode(s); // lexical token
          } else if (i === 1) {
            s3 = TextUtilities.HTMLEncode(s); // second lexical token
          } else if (i === ll - 1) {
            s1 = s; // current label
          } else {
            localFeatures.push(s); // we keep the feature values in case they appear useful
          }
          i++;
        }

        // as we process the document segmentation line by line, we don't use the usual
        // tokenization to rebuild the text flow, but we get each line again from the
        // text stored in the document blocks (similarly as when generating the features)
        line = null;
        while (line === null && currentBlockIndex < (blocks ?? []).length) {
          const block: Block = (blocks as Block[])[currentBlockIndex] as Block;
          const tokens: LayoutToken[] | null = block.getTokens();
          if (tokens === null) {
            currentBlockIndex++;
            indexLine = 0;
            continue;
          }
          const localText: string | null = block.getText();
          if (localText === null || localText.trim().length === 0) {
            currentBlockIndex++;
            indexLine = 0;
            continue;
          }
          //String[] lines = localText.split("\n");
          // Java's split(regex) drops trailing empties — mirror that here.
          const lines: string[] = localText.split(/[\n\r]/);
          while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
          if (lines.length === 0 || indexLine >= lines.length) {
            currentBlockIndex++;
            indexLine = 0;
            continue;
          } else {
            line = lines[indexLine] as string;
            indexLine++;
            if (line.trim().length === 0) {
              line = null;
              continue;
            }

            if (TextUtilities.filterLine(line)) {
              line = null;
              continue;
            }
          }
        }

        line = TextUtilities.HTMLEncode(line);

        if (newLine && !start) {
          buffer.push("<lb/>");
        }

        let lastTag0: string | null = null;
        if (lastTag !== null) {
          if (lastTag.startsWith("I-")) {
            lastTag0 = lastTag.substring(2);
          } else {
            lastTag0 = lastTag;
          }
        }
        let currentTag0: string | null = null;
        if (s1 !== null) {
          if (s1.startsWith("I-")) {
            currentTag0 = s1.substring(2);
          } else {
            currentTag0 = s1;
          }
        }

        //boolean closeParagraph = false;
        if (lastTag !== null) {
          //closeParagraph =
          Segmentation.testClosingTag(buffer, currentTag0!, lastTag0!, s1!);
        }

        let output: boolean;

        output = Segmentation.writeField(buffer, line!, s1!, lastTag0, s2!, "<header>", "<front>", addSpace, 3);
        if (!output) {
          output = Segmentation.writeField(buffer, line!, s1!, lastTag0, s2!, "<other>", "", addSpace, 3);
        }
        if (!output) {
          output = Segmentation.writeField(buffer, line!, s1!, lastTag0, s2!, "<headnote>", '<note place="headnote">', addSpace, 3);
        }
        if (!output) {
          output = Segmentation.writeField(buffer, line!, s1!, lastTag0, s2!, "<footnote>", '<note place="footnote">', addSpace, 3);
        }
        if (!output) {
          output = Segmentation.writeField(buffer, line!, s1!, lastTag0, s2!, "<marginnote>", '<note place="margin">', addSpace, 3);
        }
        if (!output) {
          output = Segmentation.writeField(buffer, line!, s1!, lastTag0, s2!, "<page>", "<page>", addSpace, 3);
        }
        if (!output) {
          //output = writeFieldBeginEnd(buffer, s1, lastTag0, s2, "<reference>", "<listBibl>", addSpace, 3);
          output = Segmentation.writeField(buffer, line!, s1!, lastTag0, s2!, "<references>", "<listBibl>", addSpace, 3);
        }
        if (!output) {
          //output = writeFieldBeginEnd(buffer, s1, lastTag0, s2, "<body>", "<body>", addSpace, 3);
          output = Segmentation.writeField(buffer, line!, s1!, lastTag0, s2!, "<body>", "<body>", addSpace, 3);
        }
        if (!output) {
          output = Segmentation.writeField(buffer, line!, s1!, lastTag0, s2!, "<cover>", "<titlePage>", addSpace, 3);
        }
        if (!output) {
          output = Segmentation.writeField(buffer, line!, s1!, lastTag0, s2!, "<toc>", '<div type="toc">', addSpace, 3);
        }
        if (!output) {
          output = Segmentation.writeField(buffer, line!, s1!, lastTag0, s2!, "<annex>", '<div type="annex">', addSpace, 3);
        }
        if (!output) {
          output = Segmentation.writeField(buffer, line!, s1!, lastTag0, s2!, "<acknowledgement>", '<div type="acknowledgement">', addSpace, 3);
        }
        if (!output) {
          output = Segmentation.writeField(buffer, line!, s1!, lastTag0, s2!, "<availability>", '<div type="availability">', addSpace, 3);
        }
        if (!output) {
          output = Segmentation.writeField(buffer, line!, s1!, lastTag0, s2!, "<funding>", '<div type="funding">', addSpace, 3);
        }
        if (!output) {
          output = Segmentation.writeField(buffer, line!, s1!, lastTag0, s2!, "<conflict>", '<div type="conflict">', addSpace, 3);
        }
        if (!output) {
          output = Segmentation.writeField(buffer, line!, s1!, lastTag0, s2!, "<contribution>", '<div type="contribution">', addSpace, 3);
        }
        // The variable `output` is written but never read further; preserved to mirror upstream.
        void output;
        lastTag = s1;

        if (lineIdx === tokenList.length - 1) {
          if (lastTag !== null) {
            Segmentation.testClosingTag(buffer, "", currentTag0!, s1!);
          }
        }
        if (start) {
          start = false;
        }
      }

      return buffer;
    } catch (e) {
      throw new GrobidException("An exception occured while running Grobid.", e);
    }
  }

  /**
   * TODO some documentation...
   */
  private static writeField(
    buffer: string[],
    line: string,
    s1: string,
    lastTag0: string | null,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    s2: string,
    field: string,
    outField: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    addSpace: boolean,
    nbIndent: number,
  ): boolean {
    let result = false;
    // filter the output path
    if (s1 === field || s1 === "I-" + field) {
      result = true;
      line = line.replace(/@BULLET/g, "•");
      // if previous and current tag are the same, we output the token
      if (s1 === lastTag0 || s1 === "I-" + lastTag0) {
        buffer.push(line);
      } else if (lastTag0 === null) {
        // if previous tagname is null, we output the opening xml tag
        for (let i = 0; i < nbIndent; i++) {
          buffer.push("\t");
        }
        buffer.push(outField);
        buffer.push(line);
      } else {
        // new opening tag, we output the opening xml tag
        for (let i = 0; i < nbIndent; i++) {
          buffer.push("\t");
        }
        buffer.push(outField);
        buffer.push(line);
      } /*else {
                // otherwise we continue by ouputting the token
                buffer.append(line);
            }*/
    }
    return result;
  }

  /**
   * This is for writing fields for fields where begin and end of field matter, like paragraph or item
   */
  /*private static writeFieldBeginEnd(buffer: string[],
                                       s1: string,
                                       lastTag0: string | null,
                                       s2: string,
                                       field: string,
                                       outField: string,
                                       addSpace: boolean,
                                       nbIndent: number): boolean {
        let result = false;
        if ((s1.equals(field)) || (s1.equals("I-" + field))) {
            result = true;
            if (lastTag0.equals("I-" + field)) {
                if (addSpace)
                    buffer.append(" " + s2);
                else
                    buffer.append(s2);
            } /*else if (lastTag0.equals(field) && s1.equals(field)) {
                if (addSpace)
                    buffer.append(" " + s2);
                else
                    buffer.append(s2);
            } else if (!lastTag0.equals("<citation_marker>") && !lastTag0.equals("<figure_marker>")
                    && !lastTag0.equals("<figure>") && !lastTag0.equals("<reference_marker>")) {
                for (int i = 0; i < nbIndent; i++) {
                    buffer.append("\t");
                }
                buffer.append(outField + s2);
            }
			else {
                if (addSpace)
                    buffer.append(" " + s2);
                else
                    buffer.append(s2);
            }
        }
        return result;
    }*/

  /**
   * TODO some documentation
   */
  private static testClosingTag(
    buffer: string[],
    currentTag0: string,
    lastTag0: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    currentTag: string,
  ): boolean {
    let res = false;
    // reference_marker and citation_marker are two exceptions because they can be embedded

    if (currentTag0 !== lastTag0) {
      /*if (currentTag0.equals("<citation_marker>") || currentTag0.equals("<figure_marker>")) {
                return res;
            }*/

      res = false;
      // we close the current tag
      if (lastTag0 === "<header>") {
        buffer.push("</front>\n\n");
        res = true;
      } else if (lastTag0 === "<body>") {
        buffer.push("</body>\n\n");
        res = true;
      } else if (lastTag0 === "<headnote>") {
        buffer.push("</note>\n\n");
        res = true;
      } else if (lastTag0 === "<footnote>") {
        buffer.push("</note>\n\n");
        res = true;
      } else if (lastTag0 === "<marginnote>") {
        buffer.push("</note>\n\n");
        res = true;
      } else if (lastTag0 === "<references>") {
        buffer.push("</listBibl>\n\n");
        res = true;
      } else if (lastTag0 === "<page>") {
        buffer.push("</page>\n\n");
        res = true;
      } else if (lastTag0 === "<cover>") {
        buffer.push("</titlePage>\n\n");
        res = true;
      } else if (lastTag0 === "<toc>") {
        buffer.push("</div>\n\n");
        res = true;
      } else if (lastTag0 === "<annex>") {
        buffer.push("</div>\n\n");
        res = true;
      } else if (lastTag0 === "<acknowledgement>") {
        buffer.push("</div>\n\n");
        res = true;
      } else if (lastTag0 === "<availability>") {
        buffer.push("</div>\n\n");
        res = true;
      } else if (lastTag0 === "<conflict>") {
        buffer.push("</div>\n\n");
        res = true;
      } else if (lastTag0 === "<contribution>") {
        buffer.push("</div>\n\n");
        res = true;
      } else if (lastTag0 === "<funding>") {
        buffer.push("</div>\n\n");
        res = true;
      } else if (lastTag0 === "<other>") {
        buffer.push("\n\n");
      } else {
        res = false;
      }
    }
    return res;
  }

  override close(): void {
    super.close();
    // ...
  }
}

// statSync is imported to satisfy type checking of `existsSync` usage parity;
// referenced once below to keep tree-shaking aware.
void statSync;
