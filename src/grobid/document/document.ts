// Port of org.grobid.core.document.Document.
// Upstream: grobid-core/src/main/java/org/grobid/core/document/Document.java
//
// Class for representing, processing and exchanging a document item.
//
// Upstream uses Guava `SortedSetMultimap` / `Multimap` / `LinkedListMultimap`.
// We implement equivalents on top of TS `Map<K, Set<V>>` or `Map<K, V[]>`.

import { readFileSync, existsSync } from "node:fs";
import type { Analyzer } from "../analyzers/analyzer.js";
import { GrobidAnalyzer } from "../analyzers/grobid-analyzer.js";
import { BibDataSet } from "../data/bib-data-set.js";
import { BiblioItem } from "../data/biblio-item.js";
import { Equation } from "../data/equation.js";
import { Figure } from "../data/figure.js";
import { Metadata } from "../data/metadata.js";
import { Table } from "../data/table.js";
import { Engine } from "../engines/engine.js";
import type { GrobidAnalysisConfig } from "../engines/config/grobid-analysis-config.js";
import { FigureCounters } from "../engines/counters/figure-counters.js";
import { TableRejectionCounters } from "../engines/counters/table-rejection-counters.js";
import type { TaggingLabel } from "../engines/label/tagging-label.js";
import { GrobidException } from "../exceptions/grobid-exception.js";
import { GrobidExceptionStatus } from "../exceptions/grobid-exception-status.js";
import { FeatureFactory } from "../features/feature-factory.js";
import { Block } from "../layout/block.js";
import { BoundingBox } from "../layout/bounding-box.js";
import { Cluster } from "../layout/cluster.js";
import { GraphicObject } from "../layout/graphic-object.js";
import { GraphicObjectType } from "../layout/graphic-object-type.js";
import { LayoutToken } from "../layout/layout-token.js";
import { PDFAnnotation } from "../layout/pdf-annotation.js";
import { Page } from "../layout/page.js";
import { VectorGraphicBoxCalculator } from "../layout/vector-graphic-box-calculator.js";
import { PDFALTOAnnotationSaxHandler } from "../sax/pdfalto-annotation-sax-handler.js";
import { PDFALTOOutlineSaxHandler } from "../sax/pdfalto-outline-sax-handler.js";
import { PDFALTOSaxHandler } from "../sax/pdfalto-sax-handler.js";
import { PDFMetadataSaxHandler } from "../sax/pdf-metadata-sax-handler.js";
import { BoundingBoxCalculator } from "../utilities/bounding-box-calculator.js";
import { ElementCounter } from "../utilities/element-counter.js";
import { LayoutTokensUtil } from "../utilities/layout-tokens-util.js";
import { Pair } from "../utilities/pair.js";
import { TextUtilities } from "../utilities/text-utilities.js";
import { Utilities } from "../utilities/utilities.js";
import type { ReferenceMarkerMatcher } from "../utilities/matching/reference-marker-matcher.js";
import { ReferenceMarkerMatcher as ReferenceMarkerMatcherImpl } from "../utilities/matching/reference-marker-matcher.js";
import { getLogger } from "../utilities/logger.js";
import { DocumentNode } from "./document-node.js";
import { DocumentPiece } from "./document-piece.js";
import { DocumentPointer } from "./document-pointer.js";
import type { DocumentSource } from "./document-source.js";

const LOGGER = getLogger("Document");

// Minimal Guava `SortedSetMultimap` substitute — keys map to sorted-by-piece
// sets of `DocumentPiece`. We use a Map<string, DocumentPiece[]> kept sorted.
export class SortedSetMultimapDocumentPiece {
  private map: Map<string, DocumentPiece[]> = new Map();

  put(key: string, value: DocumentPiece): void {
    let arr = this.map.get(key);
    if (arr === undefined) {
      arr = [];
      this.map.set(key, arr);
    }
    // Maintain unique + sorted invariant.
    for (const p of arr) {
      if (p.compareTo(value) === 0) return;
    }
    arr.push(value);
    arr.sort((a, b) => a.compareTo(b));
  }

  get(key: string): Set<DocumentPiece> | null {
    const arr = this.map.get(key);
    if (arr === undefined || arr.length === 0) return null;
    return new Set(arr);
  }

  keys(): IterableIterator<string> {
    return this.map.keys();
  }
}

// Minimal Guava `Multimap<K, V>` substitute (LinkedListMultimap-like — order
// preserving).
class ListMultimap<K, V> {
  private map: Map<K, V[]> = new Map();

  put(key: K, value: V): void {
    let arr = this.map.get(key);
    if (arr === undefined) {
      arr = [];
      this.map.set(key, arr);
    }
    arr.push(value);
  }

  putAll(key: K, values: Iterable<V>): void {
    let arr = this.map.get(key);
    if (arr === undefined) {
      arr = [];
      this.map.set(key, arr);
    }
    for (const v of values) arr.push(v);
  }

  get(key: K): V[] {
    return this.map.get(key) ?? [];
  }

  removeAll(key: K): V[] {
    const arr = this.map.get(key) ?? [];
    this.map.delete(key);
    return arr;
  }

  keySet(): Set<K> {
    return new Set(this.map.keys());
  }

  containsKey(key: K): boolean {
    return this.map.has(key);
  }
}

/** Upstream Triple equivalent (Apache Commons Lang). */
export class Triple<A, B, C> {
  constructor(public readonly left: A, public readonly middle: B, public readonly right: C) {}
  static of<A, B, C>(left: A, middle: B, right: C): Triple<A, B, C> {
    return new Triple(left, middle, right);
  }
  getLeft(): A {
    return this.left;
  }
  getMiddle(): B {
    return this.middle;
  }
  getRight(): C {
    return this.right;
  }
}

/**
 * Upstream Document.java line 78-1706.
 */
export class Document {
  // Upstream line 80.
  static readonly serialVersionUID: number = 1;

  // Upstream line 82-83.
  protected static readonly LOGGER = LOGGER;
  static readonly MAX_FIG_BOX_DISTANCE = 70;

  // Upstream line 84.
  protected readonly documentSource: DocumentSource | null;

  // Upstream line 86-88.
  protected pathXML: string | null = null;
  protected lang: string | null = null;
  // grobid-js extension: dominant Unicode script of the body text. Computed
  // by `script-detector.ts` over a small sample of tokens. `null` means
  // "not yet computed" (the default; matches Latin-script behavior).
  protected dominantScript: string | null = null;

  // Upstream line 91-93.
  protected pages: Page[] | null = null;
  protected clusters: Cluster[] | null = null;
  protected blocks: Block[] | null = null;

  // Upstream line 95.
  protected blockDocumentHeaders: number[] | null = null;

  // Upstream line 97.
  protected featureFactory: FeatureFactory | null = null;

  // Upstream line 100.
  protected labeledBlocks: SortedSetMultimapDocumentPiece | null = null;

  // Upstream line 104.
  protected tokenizations: LayoutToken[] | null = null;

  // Upstream line 107-108.
  protected teiIdToBibDataSets: Map<string, BibDataSet> | null = null;
  protected bibDataSets: BibDataSet[] | null = null;

  // Upstream line 111.
  protected resHeader: BiblioItem | null = null;

  // Upstream line 114.
  protected tei: string | null = null;

  // Upstream line 116.
  protected referenceMarkerMatcher: ReferenceMarkerMatcher | null = null;

  // Upstream line 123.
  protected images: GraphicObject[] | null = null;

  // Upstream line 126.
  protected pdfAnnotations: PDFAnnotation[] | null = null;

  // Upstream line 129.
  protected outlineRoot: DocumentNode | null = null;

  // Upstream line 131.
  protected metadata: Metadata | null = null;

  // Upstream line 133.
  protected imagesPerPage: ListMultimap<number, GraphicObject> = new ListMultimap<number, GraphicObject>();

  // Upstream line 136-140.
  protected maxCharacterDensity: number = 0.0;
  protected minCharacterDensity: number = 0.0;
  protected maxBlockSpacing: number = 0.0;
  protected minBlockSpacing: number = 0.0;
  protected documentLenghtChar: number = -1;

  // Upstream line 143-144 — "not used".
  protected beginBody: number = -1;
  protected beginReferences: number = -1;

  // Upstream line 146.
  protected titleMatchNum: boolean = false;

  // Upstream line 148-150.
  protected figures: Figure[] | null = null;
  protected annexFigures: Figure[] | null = null;
  protected validGraphicObjectPredicate: ((g: GraphicObject) => boolean) | null = null;
  protected m: number = 0;

  // Upstream line 153-157.
  protected tables: Table[] | null = null;
  protected annexTables: Table[] | null = null;
  protected equations: Equation[] | null = null;
  protected annexEquations: Equation[] | null = null;

  // Upstream line 160.
  protected analyzer: Analyzer = GrobidAnalyzer.getInstance();

  // Upstream line 165.
  protected byteSize: number = 0;

  // Upstream line 118-120 — also setImages declared near the top of the class.
  setImages(images: GraphicObject[]): void {
    this.images = images;
  }

  // Upstream line 167-171 / 173-175.
  constructor();
  constructor(documentSource: DocumentSource);
  constructor(documentSource?: DocumentSource) {
    if (documentSource === undefined) {
      this.documentSource = null;
      return;
    }
    this.documentSource = documentSource;
    this.setPathXML(documentSource.getXmlFile());
    this.byteSize = documentSource.getByteSize();
  }

  // Upstream line 177-189.
  static createFromText(text: string): Document {
    const doc = new Document();
    doc.fromText(text);
    if (text !== null && text !== undefined) {
      try {
        const utf8Bytes = Buffer.from(text, "utf8");
        doc.byteSize = utf8Bytes.length;
      } catch {
        LOGGER.warn("Could not set the original text document size in bytes for UTF-8 encoding");
      }
    }
    return doc;
  }

  // Upstream line 191-193.
  setLanguage(l: string | null): void {
    this.lang = l;
  }

  // Upstream line 195-197.
  getLanguage(): string | null {
    return this.lang;
  }

  // grobid-js extension: read/write the dominant Unicode script. No upstream
  // equivalent — see `script-detector.ts` for rationale.
  setDominantScript(s: string | null): void {
    this.dominantScript = s;
  }

  getDominantScript(): string | null {
    return this.dominantScript;
  }

  // Upstream line 199-201.
  getResHeader(): BiblioItem | null {
    return this.resHeader;
  }

  // Upstream line 203-205.
  getBlocks(): Block[] {
    return this.blocks as Block[];
  }

  // Upstream line 207-209.
  getBibDataSets(): BibDataSet[] | null {
    return this.bibDataSets;
  }

  // Upstream line 211-215.
  addBlock(b: Block): void {
    if (this.blocks === null) this.blocks = [];
    this.blocks.push(b);
  }

  // Upstream line 217-219.
  getImages(): GraphicObject[] {
    return this.images as GraphicObject[];
  }

  // Upstream line 221-223.
  getPDFAnnotations(): PDFAnnotation[] | null {
    return this.pdfAnnotations;
  }

  // Upstream line 225-227.
  getMetadata(): Metadata | null {
    return this.metadata;
  }

  // Upstream line 232-234.
  protected setPathXML(pathXML: string | null): void {
    this.pathXML = pathXML;
  }

  // Upstream line 236-238.
  getTokenizations(): LayoutToken[] | null {
    return this.tokenizations;
  }

  // Upstream line 240-242.
  getDocumentLenghtChar(): number {
    return this.documentLenghtChar;
  }

  // Upstream line 244-246 / 248-250 / 252-254 / 256-258.
  getMaxCharacterDensity(): number {
    return this.maxCharacterDensity;
  }
  getMinCharacterDensity(): number {
    return this.minCharacterDensity;
  }
  getMaxBlockSpacing(): number {
    return this.maxBlockSpacing;
  }
  getMinBlockSpacing(): number {
    return this.minBlockSpacing;
  }

  // Upstream line 260-262 / 264-266.
  setAnalyzer(analyzer: Analyzer): void {
    this.analyzer = analyzer;
  }
  getAnalyzer(): Analyzer {
    return this.analyzer;
  }

  // Upstream line 268-296.
  fromText(text: string): LayoutToken[] {
    let toks: string[] = [];
    try {
      toks = GrobidAnalyzer.getInstance().tokenize(text);
    } catch (e) {
      LOGGER.error("Fail tokenization for " + text + ": " + String(e));
    }

    this.tokenizations = toks.map((t) => new LayoutToken(t));
    this.blocks = [];
    const b = new Block();
    for (const lt of this.tokenizations) {
      b.addToken(lt);
    }
    const p = new Page(1);
    b.setPage(p);
    // NOTE: upstream line 286 — `//b.setText(text);` (commented-out).
    this.pages = [];
    this.pages.push(p);
    this.blocks.push(b);
    p.addBlock(b);
    b.setStartToken(0);
    b.setEndToken(toks.length - 1);
    this.images = [];
    return this.tokenizations;
  }

  /**
   * Parse PDFALTO output representation and get the tokenized form of the
   * document.
   *
   * Upstream line 322-463.
   */
  addTokenizedDocument(config: GrobidAnalysisConfig): LayoutToken[] | null {
    this.images = [];
    const parser = new PDFALTOSaxHandler(this, this.images);

    if (config.getAnalyzer() !== null) parser.setAnalyzer(config.getAnalyzer()!);
    this.pdfAnnotations = [];
    const parserAnnot = new PDFALTOAnnotationSaxHandler(this, this.pdfAnnotations);
    const parserOutline = new PDFALTOOutlineSaxHandler(this);
    const parserMetadata = new PDFMetadataSaxHandler(this);

    this.tokenizations = null;

    const file = this.pathXML!;
    const fileAnnot = this.pathXML + "_annot.xml";
    const fileOutline = this.pathXML + "_outline.xml";
    const fileMetadata = this.pathXML + "_metadata.xml";
    try {
      const xml = readFileSync(file, "utf8");
      parser.parse(xml);
      this.tokenizations = parser.getTokenization();
    } catch (e) {
      if (e instanceof GrobidException) throw e;
      throw new GrobidException(
        "Cannot parse file: " + file,
        e instanceof Error ? e : new Error(String(e)),
        GrobidExceptionStatus.PARSING_ERROR,
      );
    }

    if (existsSync(fileAnnot)) {
      try {
        const xml = readFileSync(fileAnnot, "utf8");
        parserAnnot.parse(xml);
      } catch (e) {
        if (e instanceof GrobidException) throw e;
        LOGGER.warn("Cannot parse file: " + fileAnnot + " : " + String(e));
      }
    }
    if (existsSync(fileOutline)) {
      try {
        const xml = readFileSync(fileOutline, "utf8");
        parserOutline.parse(xml);
        this.outlineRoot = parserOutline.getRootNode();
      } catch (e) {
        if (e instanceof GrobidException) throw e;
        LOGGER.warn("Cannot parse file: " + fileOutline + " : " + String(e));
      }
    }
    if (existsSync(fileMetadata)) {
      try {
        const xml = readFileSync(fileMetadata, "utf8");
        parserMetadata.parse(xml);
        this.metadata = parserMetadata.getMetadata();
      } catch (e) {
        if (e instanceof GrobidException) throw e;
        LOGGER.warn("Cannot parse file: " + fileMetadata + " : " + String(e));
      }
    }

    if (this.getBlocks() === null) {
      throw new GrobidException(
        "PDF parsing resulted in empty content",
        undefined,
        GrobidExceptionStatus.NO_BLOCKS,
      );
    }

    // calculating main area
    this.calculatePageMainAreas();

    // calculating boxes for pages
    if (config.isProcessVectorGraphics()) {
      try {
        const map = VectorGraphicBoxCalculator.calculate(this);
        for (const o of map.values()) {
          this.images.push(o);
        }
      } catch (e) {
        throw new GrobidException(
          "Cannot process vector graphics: " + file,
          e instanceof Error ? e : new Error(String(e)),
          GrobidExceptionStatus.PARSING_ERROR,
        );
      }
    }

    // cache images per page
    for (const go of this.images) {
      // filtering out small figures that are likely to be logos and stuff
      if (go.getType() === GraphicObjectType.BITMAP && !this.isValidBitmapGraphicObject(go)) {
        continue;
      }
      this.imagesPerPage.put(go.getPage(), go);
    }

    const keys = new Set(this.imagesPerPage.keySet());
    for (const pageNum of keys) {
      const elements = this.imagesPerPage.get(pageNum);
      if (elements.length > 100) {
        this.imagesPerPage.removeAll(pageNum);
        Engine.getCntManager().i(FigureCounters.TOO_MANY_FIGURES_PER_PAGE);
      } else {
        const res = this.glueImagesIfNecessary(pageNum, [...elements]);
        if (res !== null) {
          this.imagesPerPage.removeAll(pageNum);
          this.imagesPerPage.putAll(pageNum, res);
        }
      }
    }

    // NOTE: upstream line 461 — `// filterLineNumber();` (commented-out).
    return this.tokenizations;
  }

  // Upstream line 465-524.
  private calculatePageMainAreas(): void {
    const leftEven = new ElementCounter<number>();
    const rightEven = new ElementCounter<number>();
    const leftOdd = new ElementCounter<number>();
    const rightOdd = new ElementCounter<number>();
    const top = new ElementCounter<number>();
    const bottom = new ElementCounter<number>();

    for (const b of this.blocks!) {
      const box = BoundingBoxCalculator.calculateOneBox(b.getTokens());
      if (box !== null) {
        b.setBoundingBox(box);
      }
      // small blocks can indicate that it's page numbers, some journal header info, etc. No need in them
      if (b.getX() === 0 || b.getHeight() < 20 || b.getWidth() < 20 || b.getHeight() * b.getWidth() < 3000) {
        continue;
      }
      if (b.getPageNumber() % 2 === 0) {
        leftEven.i(Math.trunc(b.getX()));
        rightEven.i(Math.trunc(b.getX() + b.getWidth()));
      } else {
        leftOdd.i(Math.trunc(b.getX()));
        rightOdd.i(Math.trunc(b.getX() + b.getWidth()));
      }
      top.i(Math.trunc(b.getY()));
      bottom.i(Math.trunc(b.getY() + b.getHeight()));
    }

    if (leftEven.getCnts().size > 0 && leftOdd.getCnts().size > 0) {
      let pageEvenX = 0;
      let pageEvenWidth = 0;
      if (this.pages!.length > 1) {
        pageEvenX = Document.getCoordItem(leftEven, true);
        pageEvenWidth = Document.getCoordItem(rightEven, false) - pageEvenX + 1;
      }
      const pageOddX = Document.getCoordItem(leftOdd, true);
      const pageOddWidth = Document.getCoordItem(rightOdd, false) - pageOddX + 1;
      const pageY = Document.getCoordItem(top, true);
      const pageHeight = Document.getCoordItem(bottom, false) - pageY + 1;
      for (const page of this.pages!) {
        if (page.isEven()) {
          page.setMainArea(
            BoundingBox.fromPointAndDimensions(page.getNumber(), pageEvenX, pageY, pageEvenWidth, pageHeight),
          );
        } else {
          page.setMainArea(
            BoundingBox.fromPointAndDimensions(page.getNumber(), pageOddX, pageY, pageOddWidth, pageHeight),
          );
        }
      }
    } else {
      for (const page of this.pages!) {
        page.setMainArea(
          BoundingBox.fromPointAndDimensions(page.getNumber(), 0, 0, page.getWidth(), page.getHeight()),
        );
      }
    }
  }

  // Upstream line 526-592.
  protected glueImagesIfNecessary(_pageNum: number, graphicObjects: (GraphicObject | null)[]): GraphicObject[] | null {
    const toGlue: Pair<number, number>[] = [];
    let start = 0;
    let end = 0;
    for (let i = 1; i < graphicObjects.length; i++) {
      const prev = graphicObjects[i - 1]!;
      const cur = graphicObjects[i]!;
      if (prev.getType() !== GraphicObjectType.BITMAP || cur.getType() !== GraphicObjectType.BITMAP) {
        if (start !== end) {
          toGlue.push(new Pair(start, end + 1));
        }
        start = i;
        end = start;
        continue;
      }
      if (
        Utilities.doubleEquals(prev.getBoundingBox()!.getWidth(), cur.getBoundingBox()!.getWidth(), 0.0001) &&
        Utilities.doubleEquals(prev.getBoundingBox()!.getY2(), cur.getBoundingBox()!.getY(), 0.0001)
      ) {
        end++;
      } else {
        if (start !== end) {
          toGlue.push(new Pair(start, end + 1));
        }
        start = i;
        end = start;
      }
    }
    if (start !== end) {
      toGlue.push(new Pair(start, end + 1));
    }
    if (toGlue.length === 0) return null;

    for (const p of toGlue) {
      let box = graphicObjects[p.a]!.getBoundingBox()!;
      for (let i = p.a + 1; i < p.b; i++) {
        box = box.boundBox(graphicObjects[i]!.getBoundingBox()!);
      }
      graphicObjects[p.a] = new GraphicObject(box, GraphicObjectType.VECTOR_BOX);
      for (let i = p.a + 1; i < p.b; i++) {
        graphicObjects[i] = null;
      }
    }

    this.validGraphicObjectPredicate = (graphicObject: GraphicObject | null): boolean => {
      return graphicObject !== null && this.isValidBitmapGraphicObject(graphicObject);
    };
    return graphicObjects.filter((g): g is GraphicObject => g !== null && this.validGraphicObjectPredicate!(g));
  }

  // Upstream line 594-615.
  protected static getCoordItem(cnt: ElementCounter<number>, getMin: boolean): number {
    const counts = cnt.getSortedCounts();
    let res = counts[0]![0];
    for (const [key] of counts) {
      // NOTE: upstream lines 600-602 — commented-out `if (e.getValue() < max * 0.7) break;`
      if (getMin) {
        if (key < res) res = key;
      } else {
        if (key > res) res = key;
      }
    }
    return res;
  }

  // Upstream line 622-636.
  getAllBlocksClean(toIgnore1: number, toIgnore2: number): string {
    const accumulated: string[] = [];
    if (toIgnore2 === -1) toIgnore2 = this.blocks!.length + 1;
    let i = 0;
    if (this.blocks !== null) {
      for (const block of this.blocks) {
        if (i >= toIgnore1 && i < toIgnore2) {
          accumulated.push(block.getText() ?? "");
          accumulated.push("\n");
        }
        i++;
      }
    }
    return accumulated.join("");
  }

  // Upstream line 643-669.
  getDOIMatches(): string[] {
    const results: string[] = [];
    const pages = this.getPages();
    if (pages === null) return results;
    let p = 0;
    for (const page of pages) {
      const blocks = page.getBlocks();
      if (blocks !== null && blocks.length > 0) {
        for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
          const block = blocks[blockIndex]!;
          let localText = block.getText();
          if (localText !== null && localText.length > 0) {
            localText = localText.trim();
            const pattern = new RegExp(TextUtilities.DOIPattern.source, "g");
            let m: RegExpExecArray | null;
            while ((m = pattern.exec(localText)) !== null) {
              const theDOI = m[0];
              if (!results.includes(theDOI)) results.push(theDOI);
            }
          }
        }
      }
      if (p > 1) break;
      p++;
    }
    return results;
  }

  // Upstream line 671-677.
  getTei(): string | null {
    return this.tei;
  }
  setTei(tei: string): void {
    this.tei = tei;
  }

  // Upstream line 679-681 / 683-689.
  getBlockDocumentHeaders(): number[] | null {
    return this.blockDocumentHeaders;
  }
  getOutlineRoot(): DocumentNode | null {
    return this.outlineRoot;
  }
  setOutlineRoot(outlineRoot: DocumentNode | null): void {
    this.outlineRoot = outlineRoot;
  }

  // Upstream line 691-697.
  isTitleMatchNum(): boolean {
    return this.titleMatchNum;
  }
  setTitleMatchNum(titleMatchNum: boolean): void {
    this.titleMatchNum = titleMatchNum;
  }

  // Upstream line 699-706.
  getPages(): Page[] | null {
    return this.pages;
  }
  getPage(num: number): Page {
    return this.pages![num - 1]!;
  }

  // Upstream line 708-710.
  getClusters(): Cluster[] | null {
    return this.clusters;
  }

  // Upstream line 712-722.
  setBlockDocumentHeaders(blockDocumentHeaders: number[] | null): void {
    this.blockDocumentHeaders = blockDocumentHeaders;
  }
  setClusters(clusters: Cluster[] | null): void {
    this.clusters = clusters;
  }
  setPages(pages: Page[] | null): void {
    this.pages = pages;
  }

  // Upstream line 724-728.
  addPage(page: Page): void {
    if (this.pages === null) this.pages = [];
    this.pages.push(page);
  }

  // Upstream line 730-748.
  setBibDataSets(bibDataSets: BibDataSet[] | null): void {
    this.bibDataSets = bibDataSets;
    if (this.bibDataSets !== null) {
      for (const bds of this.bibDataSets) {
        let marker = bds.getRefSymbol();
        if (marker !== null) {
          // NOTE: upstream lines 737-738 — `//marker = marker.replace(".", ""); //marker = marker.replace(" ", "");` (commented-out).
          marker = marker.replace(/[\.\[\]()\-\s]/g, "");
          bds.setRefSymbol(marker);
        }
      }
    }
    let cnt = 0;
    if (bibDataSets !== null) {
      for (const bds of bibDataSets) {
        bds.getResBib()!.setOrdinal(cnt++);
      }
    }
  }

  // Upstream line 750-756.
  getReferenceMarkerMatcher(): ReferenceMarkerMatcher {
    if (this.referenceMarkerMatcher === null) {
      if (this.bibDataSets !== null) {
        this.referenceMarkerMatcher = new ReferenceMarkerMatcherImpl(this.bibDataSets, Engine.getCntManager());
      }
    }
    return this.referenceMarkerMatcher!;
  }

  // Upstream line 759-770.
  calculateTeiIdToBibDataSets(): void {
    if (this.bibDataSets === null) return;
    this.teiIdToBibDataSets = new Map<string, BibDataSet>();
    for (const bds of this.bibDataSets) {
      if (bds.getResBib() !== null && bds.getResBib()!.getTeiId() !== null) {
        this.teiIdToBibDataSets.set(bds.getResBib()!.getTeiId()!, bds);
      }
    }
  }

  // Upstream line 772-778.
  getLabeledBlocks(): SortedSetMultimapDocumentPiece | null {
    return this.labeledBlocks;
  }
  setLabeledBlocks(labeledBlocks: SortedSetMultimapDocumentPiece): void {
    this.labeledBlocks = labeledBlocks;
  }

  // Upstream line 781-783.
  getDocumentPieceTokenization(dp: DocumentPiece): LayoutToken[] {
    return this.tokenizations!.slice(dp.getLeft().getTokenDocPos(), dp.getRight().getTokenDocPos() + 1);
  }

  // Upstream line 785-787.
  getDocumentPieceText(dp: DocumentPiece): string;
  // Upstream line 789-796.
  getDocumentPieceText(dps: Set<DocumentPiece>): string;
  getDocumentPieceText(arg: DocumentPiece | Set<DocumentPiece>): string {
    if (arg instanceof Set) {
      return [...arg].map((dp) => this.getDocumentPieceText(dp)).join("\n");
    }
    return this.getDocumentPieceTokenization(arg)
      .map((t) => t.getText() ?? "")
      .join("");
  }

  // Upstream line 801-810.
  getDocumentPart(segmentationLabel: TaggingLabel): Set<DocumentPiece> | null {
    if (this.labeledBlocks === null) {
      LOGGER.debug("labeledBlocks is null");
      return null;
    }
    if (segmentationLabel.getLabel() === null) {
      // eslint-disable-next-line no-console
      console.log("segmentationLabel.getLabel()  is null");
    }
    return this.labeledBlocks.get(segmentationLabel.getLabel());
  }

  // Upstream line 812-819.
  getDocumentPartText(segmentationLabel: TaggingLabel): string | null {
    const pieces = this.getDocumentPart(segmentationLabel);
    if (pieces === null) return null;
    return this.getDocumentPieceText(this.getDocumentPart(segmentationLabel)!);
  }

  // Upstream line 825-842.
  static getTokenizationParts(
    documentParts: Set<DocumentPiece> | null,
    tokenizations: LayoutToken[],
  ): LayoutToken[] | null {
    if (documentParts === null) return null;
    const tokenizationParts: LayoutToken[] = [];
    for (const docPiece of documentParts) {
      const dp1 = docPiece.getLeft();
      const dp2 = docPiece.getRight();
      const tokens = dp1.getTokenDocPos();
      const tokene = dp2.getTokenDocPos();
      for (let i = tokens; i < tokene; i++) {
        tokenizationParts.push(tokenizations[i]!);
      }
    }
    return tokenizationParts;
  }

  // Upstream line 844-846.
  getBibDataSetByTeiId(teiId: string): BibDataSet | undefined {
    return this.teiIdToBibDataSets!.get(teiId);
  }

  // Upstream line 848.
  protected static MIN_DISTANCE = 100.0;

  /**
   * Return the list of graphical object touching the given block.
   *
   * Upstream line 853-872.
   */
  static getConnectedGraphics(block: Block, doc: Document): GraphicObject[] | null {
    let images: GraphicObject[] | null = null;
    for (const image of doc.getImages()) {
      if (block.getPageNumber() !== image.getPage()) continue;
      if (
        Math.abs(image.getY() + image.getHeight() - block.getY()) < Document.MIN_DISTANCE ||
        Math.abs(image.getY() - (block.getY() + block.getHeight())) < Document.MIN_DISTANCE
        // NOTE: upstream lines 860-861 — commented-out additional x-axis distance check.
      ) {
        if (images === null) images = [];
        images.push(image);
      }
    }
    return images;
  }

  // Upstream line 875-926.
  postProcessTables(): void {
    for (const table of this.tables!) {
      if (!table.firstCheck()) {
        table.setGoodTable(false);
        continue;
      }
      // cleaning up tokens
      const fullDescResult: LayoutToken[] = [];
      let curBox = BoundingBox.fromLayoutToken(table.getFullDescriptionTokens()[0]!);
      const distanceThreshold = 200;
      for (const fdt of table.getFullDescriptionTokens()) {
        const b = BoundingBox.fromLayoutToken(fdt);
        if (b.getX() < 0) {
          fullDescResult.push(fdt);
          continue;
        }
        if (b.distanceTo(curBox) > distanceThreshold) {
          Engine.getCntManager().i(TableRejectionCounters.HEADER_NOT_CONSECUTIVE);
          table.setGoodTable(false);
          break;
        } else {
          curBox = curBox.boundBox(b);
          fullDescResult.push(fdt);
        }
      }
      table.getFullDescriptionTokens().length = 0;
      table.getFullDescriptionTokens().push(...fullDescResult);

      const contentResult: LayoutToken[] = [];
      curBox = BoundingBox.fromLayoutToken(table.getContentTokens()[0]!);
      for (const fdt of table.getContentTokens()) {
        const b = BoundingBox.fromLayoutToken(fdt);
        if (b.getX() < 0) {
          contentResult.push(fdt);
          continue;
        }
        if (b.distanceTo(curBox) > distanceThreshold) {
          break;
        } else {
          curBox = curBox.boundBox(b);
          contentResult.push(fdt);
        }
      }
      table.getContentTokens().length = 0;
      table.getContentTokens().push(...contentResult);
      table.setGoodTable(table.secondCheck());
    }
  }

  /**
   * Upstream line 933-1155.
   */
  assignGraphicObjectsToFigures(): Triple<Figure, Figure, LayoutToken[][]>[] {
    // Build figureMap : page -> figures (Guava HashMultimap).
    const figureMap = new ListMultimap<number, Figure>();
    for (const f of this.figures!) {
      figureMap.put(f.getPage(), f);
    }
    const differences: Triple<Figure, Figure, LayoutToken[][]>[] = [];

    for (const pageNum of figureMap.keySet()) {
      const pageFigures: Figure[] = [];
      for (const f of figureMap.get(pageNum)) {
        const figureLayoutTokens = this.getFigureLayoutTokens(f);
        const realCaptionTokens = figureLayoutTokens.getA();
        if (realCaptionTokens.length > 0) {
          const oldFigure = new Figure();
          oldFigure.setLayoutTokens(f.getLayoutTokens());
          f.setLayoutTokens(realCaptionTokens);
          oldFigure.setTextArea(f.getTextArea());
          f.setTextArea(BoundingBoxCalculator.calculate(realCaptionTokens));
          oldFigure.setCaption(f.getCaption().toString());
          f.setCaption(LayoutTokensUtil.toText(LayoutTokensUtil.dehyphenize(realCaptionTokens)));
          oldFigure.setCaptionLayoutTokens(f.getCaptionLayoutTokens());
          f.setCaptionLayoutTokens(realCaptionTokens);
          pageFigures.push(f);
          differences.push(Triple.of(oldFigure, f, figureLayoutTokens.getB()));
        }
      }
      if (pageFigures.length === 0) continue;

      let it = this.imagesPerPage.get(pageNum).filter(Figure.GRAPHIC_OBJECT_PREDICATE);
      it = it.filter((go) => {
        const mainArea = this.getPage(go.getBoundingBox()!.getPage()).getMainArea();
        return mainArea !== null && mainArea.intersect(go.getBoundingBox()!);
      });
      let vectorBoxGraphicObjects = this.imagesPerPage.get(pageNum).filter(Figure.VECTOR_BOX_GRAPHIC_OBJECT_PREDICATE);
      vectorBoxGraphicObjects = vectorBoxGraphicObjects.filter((go) => {
        for (const f of pageFigures) {
          const intersection = BoundingBoxCalculator.calculateOneBox(f.getLayoutTokens(), true)?.boundingBoxIntersection(
            go.getBoundingBox()!,
          );
          if (intersection !== null && intersection !== undefined && intersection.area() / go.getBoundingBox()!.area() > 0.5) {
            return false;
          }
        }
        return true;
      });
      const graphicObjects: GraphicObject[] = [];
      lLoop: for (const bgo of it) {
        for (const vgo of vectorBoxGraphicObjects) {
          if (bgo.getBoundingBox()!.intersect(vgo.getBoundingBox()!)) {
            continue lLoop;
          }
        }
        graphicObjects.push(bgo);
      }
      graphicObjects.push(...vectorBoxGraphicObjects);

      if (vectorBoxGraphicObjects.length === 0) {
        for (const figure of pageFigures) {
          const tokens = figure.getLayoutTokens();
          const figureBox = BoundingBoxCalculator.calculateOneBox(tokens, true);
          let minDist = Document.MAX_FIG_BOX_DISTANCE * 100;
          let bestGo: GraphicObject | null = null;
          if (figureBox !== null) {
            for (const go of graphicObjects) {
              if (go.isUsed() || go.getBoundingBox()!.contains(figureBox)) continue;
              if (!this.isValidBitmapGraphicObject(go)) continue;
              const dist = figureBox.distanceTo(go.getBoundingBox()!);
              if (dist > Document.MAX_FIG_BOX_DISTANCE) continue;
              if (dist < minDist) {
                minDist = dist;
                bestGo = go;
              }
            }
          }
          if (bestGo !== null) {
            bestGo.setUsed(true);
            figure.setGraphicObjects([bestGo]);
            Engine.getCntManager().i("FigureCounters", "ASSIGNED_GRAPHICS_TO_FIGURES");
          }
        }
      } else {
        if (pageFigures.length !== graphicObjects.length) {
          Engine.getCntManager().i(FigureCounters.SKIPPED_DUE_TO_MISMATCH_OF_CAPTIONS_AND_VECTOR_AND_BITMAP_GRAPHICS);
          continue;
        }
        for (const figure of pageFigures) {
          const tokens = figure.getLayoutTokens();
          const figureBox = BoundingBoxCalculator.calculateOneBox(tokens, true);
          let minDist = Document.MAX_FIG_BOX_DISTANCE * 100;
          let bestGo: GraphicObject | null = null;
          if (figureBox !== null) {
            for (const go of graphicObjects) {
              if (go.isUsed()) continue;
              const goBox = go.getBoundingBox()!;
              if (!this.getPage(goBox.getPage()).getMainArea()!.contains(goBox) && go.getWidth() * go.getHeight() < 10000) {
                continue;
              }
              if (go.getType() === GraphicObjectType.BITMAP && !this.isValidBitmapGraphicObject(go)) continue;
              const dist = figureBox.distanceTo(goBox);
              if (dist > Document.MAX_FIG_BOX_DISTANCE) continue;
              if (dist < minDist) {
                minDist = dist;
                bestGo = go;
              }
            }
          }
          if (bestGo !== null) {
            bestGo.setUsed(true);
            if (bestGo.getType() === GraphicObjectType.VECTOR_BOX) {
              this.recalculateVectorBoxCoords(figure, bestGo);
            }
            figure.setGraphicObjects([bestGo]);
            Engine.getCntManager().i("FigureCounters", "ASSIGNED_GRAPHICS_TO_FIGURES");
          }
        }
      }
    }

    // special case, when we didn't detect figures, but there is a nice figure on this page
    const maxPage = this.pages!.length;
    for (let pageNum = 1; pageNum <= maxPage; pageNum++) {
      if (!figureMap.containsKey(pageNum)) {
        const it = this.imagesPerPage.get(pageNum).filter(Figure.GRAPHIC_OBJECT_PREDICATE);
        const vectorBoxGraphicObjects = this.imagesPerPage
          .get(pageNum)
          .filter(Figure.VECTOR_BOX_GRAPHIC_OBJECT_PREDICATE);
        const graphicObjects: GraphicObject[] = [];
        lLoop2: for (const bgo of it) {
          for (const vgo of vectorBoxGraphicObjects) {
            if (bgo.getBoundingBox()!.intersect(vgo.getBoundingBox()!)) continue lLoop2;
          }
          for (const bgo2 of it) {
            if (bgo2 !== bgo && bgo.getBoundingBox()!.intersect(bgo2.getBoundingBox()!)) continue lLoop2;
          }
          graphicObjects.push(bgo);
        }
        graphicObjects.push(...vectorBoxGraphicObjects);

        if (graphicObjects.length === it.length) {
          for (const o of graphicObjects) {
            if (this.badStandaloneFigure(o)) {
              Engine.getCntManager().i(FigureCounters.SKIPPED_BAD_STANDALONE_FIGURES);
              continue;
            }
            const f = new Figure();
            f.setPage(pageNum);
            f.setGraphicObjects([o]);
            this.figures!.push(f);
            Engine.getCntManager().i("FigureCounters", "STANDALONE_FIGURES");
            LOGGER.debug("Standalone figure on page: " + pageNum);
          }
        }
      }
    }
    return differences;
  }

  // Upstream line 1157-1169.
  private badStandaloneFigure(o: GraphicObject): boolean {
    if (o.getBoundingBox()!.area() < 50000) {
      Engine.getCntManager().i(FigureCounters.SKIPPED_SMALL_STANDALONE_FIGURES);
      return true;
    }
    if (o.getBoundingBox()!.area() / this.pages![o.getPage() - 1]!.getMainArea()!.area() > 0.6) {
      Engine.getCntManager().i(FigureCounters.SKIPPED_BIG_STANDALONE_FIGURES);
      return true;
    }
    return false;
  }

  // Upstream line 1171-1191.
  protected isValidBitmapGraphicObject(go: GraphicObject): boolean {
    if (go.getWidth() * go.getHeight() < 1000) return false;
    if (go.getWidth() < 50) return false;
    if (go.getHeight() < 50) return false;
    const mainArea = this.getPage(go.getBoundingBox()!.getPage()).getMainArea();
    if (mainArea !== null && !mainArea.contains(go.getBoundingBox()!) && go.getWidth() * go.getHeight() < 10000) {
      return false;
    }
    return true;
  }

  // Upstream line 1194-1263.
  protected recalculateVectorBoxCoords(f: Figure, g: GraphicObject): void {
    // TODO: make it robust - now super simplistic
    const captionBox = BoundingBoxCalculator.calculateOneBox(f.getLayoutTokens(), true);
    const originalGoBox = g.getBoundingBox()!;
    if (captionBox !== null && captionBox.intersect(originalGoBox)) {
      const p = originalGoBox.getPage();
      const cx1 = captionBox.getX();
      const cx2 = captionBox.getX2();
      const cy1 = captionBox.getY();
      const cy2 = captionBox.getY2();
      const fx1 = originalGoBox.getX();
      const fx2 = originalGoBox.getX2();
      const fy1 = originalGoBox.getY();
      const fy2 = originalGoBox.getY2();

      this.m = 5;
      let bestBox: BoundingBox | null = null;
      try {
        const bottomArea = BoundingBox.fromTwoPoints(p, fx1, fy1, fx2, cy1 - this.m);
        bestBox = bottomArea;
      } catch {
        // no op
      }
      try {
        const rightArea = BoundingBox.fromTwoPoints(p, fx1, fy1, cx1 - this.m, fy2);
        if (bestBox === null || rightArea.area() > bestBox.area()) bestBox = rightArea;
      } catch {
        // no op
      }
      try {
        const topArea = BoundingBox.fromTwoPoints(p, fx1, cy2 + this.m, fx2, fy2);
        if (bestBox === null || topArea.area() > bestBox.area()) bestBox = topArea;
      } catch {
        // no op
      }
      try {
        const leftArea = BoundingBox.fromTwoPoints(p, cx2 + this.m, fy1, fx2, fy2);
        if (bestBox === null || leftArea.area() > bestBox.area()) bestBox = leftArea;
      } catch {
        // no op
      }
      if (bestBox !== null && bestBox.area() > 600) {
        g.setBoundingBox(bestBox);
      }
    }
    // NOTE: upstream lines 1257-1261 — commented-out fallback block preserved.
  }

  /**
   * Upstream line 1272-1391.
   */
  protected getFigureLayoutTokens(f: Figure): Pair<LayoutToken[], LayoutToken[][]> {
    const result: LayoutToken[] = [];
    const discardedPieces: LayoutToken[][] = [];
    const blockPtrs = [...(f.getBlockPtrs() ?? [])];
    let idx = 0;
    while (idx < blockPtrs.length) {
      let newBlockPtr = blockPtrs[idx++]!;
      let previousBlock = this.getBlocks()[newBlockPtr]!;
      const norm = LayoutTokensUtil.toText(previousBlock.getTokens() ?? []).trim().toLowerCase();
      if (
        norm.startsWith("fig") ||
        norm.startsWith("abb") ||
        norm.startsWith("scheme") ||
        norm.startsWith("photo") ||
        norm.startsWith("gambar") ||
        norm.startsWith("quadro") ||
        norm.startsWith("wykres") ||
        norm.startsWith("fuente") ||
        norm.startsWith("video")
      ) {
        result.push(...(previousBlock.getTokens() ?? []));
        while (idx < blockPtrs.length) {
          const prevBlockCoords = BoundingBox.fromPointAndDimensions(
            previousBlock.getPageNumber(),
            previousBlock.getX(),
            previousBlock.getY(),
            previousBlock.getWidth(),
            previousBlock.getHeight(),
          );
          newBlockPtr = blockPtrs[idx++]!;
          let newBlock = this.getBlocks()[newBlockPtr]!;
          const newBlockCoords = BoundingBox.fromPointAndDimensions(
            newBlock.getPageNumber(),
            newBlock.getX(),
            newBlock.getY(),
            newBlock.getWidth(),
            newBlock.getHeight(),
          );
          if (newBlockCoords.distanceTo(prevBlockCoords) < 15) {
            result.push(...(newBlock.getTokens() ?? []));
            previousBlock = newBlock;
          } else {
            // NOTE: upstream line 1306 — `// f.addDiscardedPieceTokens(b.getTokens());` (commented-out).
            let newBlockTrimmed = newBlock.getTokens() ?? [];
            const figureLayoutTokens = LayoutTokensUtil.toText(f.getLayoutTokens() ?? []);
            if (!figureLayoutTokens.includes(newBlock.getText() ?? "")) {
              let subListSize = (newBlock.getTokens() ?? []).length;
              while (
                !figureLayoutTokens.endsWith(LayoutTokensUtil.toText((newBlock.getTokens() ?? []).slice(0, subListSize))) &&
                subListSize > 0
              ) {
                subListSize -= 1;
              }
              if (subListSize > 0) {
                newBlockTrimmed = [...(newBlock.getTokens() ?? []).slice(0, subListSize)];
              } else {
                f.addDiscardedPieceTokens(newBlock.getTokens() ?? []);
                while (idx < blockPtrs.length) {
                  newBlockPtr = blockPtrs[idx++]!;
                  newBlock = this.getBlocks()[newBlockPtr]!;
                  const last = f.getDiscardedPiecesTokens()![f.getDiscardedPiecesTokens()!.length - 1]!;
                  last.push(...(newBlock.getTokens() ?? []));
                }
                break;
              }
            }
            discardedPieces.push(newBlockTrimmed);

            while (idx < blockPtrs.length) {
              newBlockPtr = blockPtrs[idx++]!;
              newBlock = this.getBlocks()[newBlockPtr]!;
              // NOTE: upstream line 1339 — commented-out `Iterables.getLast(f.getDiscardedPiecesTokens()).addAll(figBlock.getTokens());`
              newBlockTrimmed = newBlock.getTokens() ?? [];
              if (!figureLayoutTokens.includes(newBlock.getText() ?? "")) {
                let subListSize = (newBlock.getTokens() ?? []).length;
                while (
                  !figureLayoutTokens.endsWith(
                    LayoutTokensUtil.toText((newBlock.getTokens() ?? []).slice(0, subListSize)),
                  ) &&
                  subListSize > 0
                ) {
                  subListSize -= 1;
                }
                if (subListSize > 0) {
                  newBlockTrimmed = [...(newBlock.getTokens() ?? []).slice(0, subListSize)];
                } else {
                  f.addDiscardedPieceTokens(previousBlock.getTokens() ?? []);
                  while (idx < blockPtrs.length) {
                    newBlockPtr = blockPtrs[idx++]!;
                    newBlock = this.getBlocks()[newBlockPtr]!;
                    const last = f.getDiscardedPiecesTokens()![f.getDiscardedPiecesTokens()!.length - 1]!;
                    last.push(...(newBlock.getTokens() ?? []));
                  }
                  break;
                }
              }
              discardedPieces[discardedPieces.length - 1]!.push(...newBlockTrimmed);
            }
            break;
          }
        }
        break;
      } else {
        if (
          !LayoutTokensUtil.toText(previousBlock.getTokens() ?? [])
            .trim()
            .toLowerCase()
            .includes(LayoutTokensUtil.toText(f.getLayoutTokens() ?? []).trim().toLowerCase())
        ) {
          f.addDiscardedPieceTokens(previousBlock.getTokens() ?? []);
        }
      }
    }
    if (result.length > 0) {
      for (const piece of discardedPieces) {
        f.addDiscardedPieceTokens(piece);
      }
    }
    return new Pair(result, discardedPieces);
  }

  // Upstream line 1393-1442.
  setConnectedGraphics2(figure: Figure): void {
    const tokens = figure.getLayoutTokens();
    figure.setTextArea(BoundingBoxCalculator.calculate(tokens));
    // NOTE: upstream lines 1400-1402 — commented-out far-away guard.
    const figureBox = BoundingBoxCalculator.calculateOneBox(tokens, true);
    let minDist = Document.MAX_FIG_BOX_DISTANCE * 100;
    let bestGo: GraphicObject | null = null;
    if (figureBox !== null) {
      for (const go of this.imagesPerPage.get(figure.getPage())) {
        if (go.getType() !== GraphicObjectType.BITMAP || go.isUsed()) continue;
        const goBox = BoundingBox.fromPointAndDimensions(go.getPage(), go.getX(), go.getY(), go.getWidth(), go.getHeight());
        if (!this.getPage(goBox.getPage()).getMainArea()!.contains(goBox)) continue;
        const dist = figureBox.distanceTo(goBox);
        if (dist > Document.MAX_FIG_BOX_DISTANCE) continue;
        if (dist < minDist) {
          minDist = dist;
          bestGo = go;
        }
      }
    }
    if (bestGo !== null) {
      bestGo.setUsed(true);
      figure.setGraphicObjects([bestGo]);
    }
  }

  // NOTE: upstream lines 1444-1516 — commented-out `setConnectedGraphics` overload preserved.

  // Upstream line 1518-1583.
  produceStatistics(): void {
    for (const block of this.blocks!) {
      const tokens = block.getTokens();
      if (tokens === null) continue;
      this.documentLenghtChar += tokens.length;
    }

    this.maxBlockSpacing = 0.0;
    this.minBlockSpacing = 10000.0;
    let previousBlockBottom = 0.0;
    for (const page of this.pages!) {
      let pageLength = 0;
      if (page.getBlocks() !== null && page.getBlocks()!.length > 0) {
        for (let blockIndex = 0; blockIndex < page.getBlocks()!.length; blockIndex++) {
          const block = page.getBlocks()![blockIndex]!;
          if (blockIndex !== 0 && previousBlockBottom > 0.0) {
            const spacing = block.getY() - previousBlockBottom;
            if (spacing > 0.0 && spacing < page.getHeight()) {
              if (spacing > this.maxBlockSpacing) this.maxBlockSpacing = spacing;
              else if (spacing < this.minBlockSpacing) this.minBlockSpacing = spacing;
            }
          }
          previousBlockBottom = block.getY() + block.getHeight();
          if (block.getTokens() !== null) pageLength += block.getTokens()!.length;
        }
      }
      page.setPageLengthChar(pageLength);
    }

    this.maxCharacterDensity = 0.0;
    this.minCharacterDensity = 1000000.0;
    for (const block of this.blocks!) {
      if (block.getHeight() === 0.0 || block.getWidth() === 0.0) continue;
      const text = block.getText();
      if (text !== null && !text.includes("@PAGE") && !text.includes("@IMAGE")) {
        const surface = block.getWidth() * block.getHeight();
        const density = text.length / surface;
        if (density < this.minCharacterDensity) this.minCharacterDensity = density;
        if (density > this.maxCharacterDensity) this.maxCharacterDensity = density;
      }
    }
  }

  // Upstream line 1585-1587.
  getDocumentSource(): DocumentSource | null {
    return this.documentSource;
  }

  // Upstream line 1589-1612.
  setFigures(figures: Figure[] | null): void {
    this.figures = figures;
  }
  getFigures(): Figure[] | null {
    return this.figures;
  }
  setTables(tables: Table[] | null): void {
    this.tables = tables;
  }
  getTables(): Table[] | null {
    return this.tables;
  }
  setEquations(equations: Equation[] | null): void {
    this.equations = equations;
  }
  getEquations(): Equation[] | null {
    return this.equations;
  }
  setResHeader(resHeader: BiblioItem | null): void {
    this.resHeader = resHeader;
  }

  // Upstream line 1618-1620.
  static getTokens(tokenizations: LayoutToken[], offsetBegin: number, offsetEnd: number): LayoutToken[] {
    return Document.getTokensFrom(tokenizations, offsetBegin, offsetEnd, 0);
  }

  // Upstream line 1622-1638.
  static getTokensFrom(
    tokenizations: LayoutToken[],
    offsetBegin: number,
    offsetEnd: number,
    startTokenIndex: number,
  ): LayoutToken[] {
    const result: LayoutToken[] = [];
    for (let p = startTokenIndex; p < tokenizations.length; p++) {
      const currentToken = tokenizations[p]!;
      if (currentToken === null || currentToken.getText() === null) continue;
      if (currentToken.getOffset() + currentToken.getText()!.length < offsetBegin) continue;
      if (currentToken.getOffset() > offsetEnd) return result;
      result.push(currentToken);
    }
    return result;
  }

  // Upstream line 1668-1697.
  getByteSize(): number {
    return this.byteSize;
  }
  setByteSize(size: number): void {
    this.byteSize = size;
  }
  getMD5(): string | null {
    if (this.documentSource !== null) return this.documentSource.getMD5();
    return null;
  }

  getAnnexTables(): Table[] | null {
    return this.annexTables;
  }
  setAnnexTables(annexTables: Table[] | null): void {
    this.annexTables = annexTables;
  }
  getAnnexEquations(): Equation[] | null {
    return this.annexEquations;
  }
  setAnnexEquations(annexEquations: Equation[] | null): void {
    this.annexEquations = annexEquations;
  }
  getAnnexFigures(): Figure[] | null {
    return this.annexFigures;
  }
  setAnnexFigures(annexFigures: Figure[] | null): void {
    this.annexFigures = annexFigures;
  }
}
