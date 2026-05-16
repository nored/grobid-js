// Port of org.grobid.core.data.Figure.
// Upstream: grobid-core/src/main/java/org/grobid/core/data/Figure.java

import type { BoundingBox } from "../layout/bounding-box.js";
import type { GraphicObject } from "../layout/graphic-object.js";
import { GraphicObjectType } from "../layout/graphic-object-type.js";
import type { LayoutToken } from "../layout/layout-token.js";
import * as VectorBoxCalcNs from "../layout/vector-graphic-box-calculator.js";
import { BoundingBoxCalculator } from "../utilities/bounding-box-calculator.js";
import { KeyGen } from "../utilities/key-gen.js";
import { LayoutTokensUtil } from "../utilities/layout-tokens-util.js";
import { TextUtilities } from "../utilities/text-utilities.js";
import { getLogger } from "../utilities/logger.js";

// Cross-package dependencies that are still stubs at this point in the
// port. Imported as `* as Ns` and accessed via an `any` cast so they
// wire up automatically once the underlying modules are filled in.
import * as DocumentNs from "../document/document.js";
import * as TEIFormatterNs from "../document/tei-formatter.js";
import * as XBUNs from "../document/xml/xml-builder-utils.js";
import * as CalloutAnalyzerNs from "../engines/citations/callout-analyzer.js";
import * as GrobidAnalysisConfigNs from "../engines/config/grobid-analysis-config.js";
import * as TaggingTokenClusterorNs from "../tokenization/tagging-token-clusteror.js";
import * as TaggingLabelsNs from "../engines/label/tagging-labels.js";
import * as GrobidModelsNs from "../grobid-models.js";

// Open types via `any`. Each `*Ns` is a stub today; concrete typing will
// come automatically once the corresponding port is filled in.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Document = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TEIFormatter = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MarkerType = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GrobidAnalysisConfig = any;
// Quiet TS6133 for the unused-but-required imports above.
void DocumentNs;
void TEIFormatterNs;
void CalloutAnalyzerNs;
void GrobidAnalysisConfigNs;

const XmlBuilderUtils: Any = (XBUNs as Any).XmlBuilderUtils ?? XBUNs;
const textNode: (s: string) => Any = (s: string): Any =>
  ((XBUNs as Any).textNode ?? XmlBuilderUtils?.textNode)?.(s);

/**
 * Class for representing a figure.
 */
export class Figure {
  protected static readonly LOGGER = getLogger("Figure");

  // Java Predicate<GraphicObject> — kept as static arrow lambdas with the
  // same name so consumers can reference them verbatim.
  static readonly GRAPHIC_OBJECT_PREDICATE = (graphicObject: GraphicObject): boolean => {
    return graphicObject.getType() === GraphicObjectType.BITMAP;
  };

  static readonly VECTOR_BOX_GRAPHIC_OBJECT_PREDICATE = (graphicObject: GraphicObject): boolean => {
    return graphicObject.getType() === GraphicObjectType.VECTOR_BOX;
  };

  static readonly BOXED_GRAPHIC_OBJECT_PREDICATE = (graphicObject: GraphicObject): boolean => {
    return graphicObject.getType() === GraphicObjectType.BITMAP
      || graphicObject.getType() === GraphicObjectType.VECTOR_BOX;
  };

  // Upstream uses StringBuilder. We accumulate into an array of strings
  // and `.join("")` on read, the idiomatic JS equivalent.
  protected caption: string[] = [];
  protected captionLayoutTokens: LayoutToken[] = [];
  protected labeledCaption: string | null = null;
  protected header: string[] = [];
  protected content: string[] = [];
  protected label: string[] = [];

  protected id: string | null = null;
  protected uri: string | null = null; // upstream uses java.net.URI; we keep the string form
  protected start = -1; // start position in the full text tokenization
  protected end = -1; // end position in the full text tokenization
  protected startToken: LayoutToken | null = null; // start layout token
  protected endToken: LayoutToken | null = null; // end layout token
  private textArea: BoundingBox[] | null = null;
  private layoutTokens: LayoutToken[] | null = null;

  private discardedPiecesTokens: LayoutToken[][] = [];

  // coordinates
  private page = -1;
  private y = 0.0;
  private x = 0.0;
  private width = 0.0;
  private height = 0.0;

  // list of graphic objects corresponding to the figure
  protected graphicObjects: GraphicObject[] | null = null;
  // Upstream uses SortedSet<Integer>. We use a Set<number>; consumers
  // that need ordering should sort on read.
  private blockPtrs: Set<number> | null = null;

  constructor() {
    // Buffers are initialised to empty arrays (joined on read).
  }

  appendHeader(head: string): void {
    this.header.push(head);
  }

  getHeader(): string {
    return this.header.join("");
  }

  appendCaption(cap: string): void {
    this.caption.push(cap);
  }

  appendCaptionLayoutTokens(layoutTokens: LayoutToken[]): void {
    for (const t of layoutTokens) this.captionLayoutTokens.push(t);
  }

  getCaption(): string {
    return this.caption.join("");
  }

  getCaptionLayoutTokens(): LayoutToken[] {
    return this.captionLayoutTokens;
  }

  setCaptionLayoutTokens(tokens: LayoutToken[]): void {
    this.captionLayoutTokens = tokens;
  }

  setLabeledCaption(labeledCaption: string | null): void {
    this.labeledCaption = labeledCaption;
  }

  getLabeledCaption(): string | null {
    return this.labeledCaption;
  }

  appendLabel(lab: string): void {
    this.label.push(lab);
  }

  getLabel(): string {
    return this.label.join("");
  }

  appendContent(trash: string): void {
    this.content.push(trash);
  }

  getContent(): string {
    return this.content.join("");
  }

  setURI(theURI: string | null): void {
    this.uri = theURI;
  }

  setStart(start: number): void {
    this.start = start;
  }

  getStart(): number {
    return this.start;
  }

  setEnd(end: number): void {
    this.end = end;
  }

  getEnd(): number {
    return this.end;
  }

  setStartToken(start: LayoutToken | null): void {
    this.startToken = start;
  }

  getStartToken(): LayoutToken | null {
    return this.startToken;
  }

  setEndToken(end: LayoutToken | null): void {
    this.endToken = end;
  }

  getEndToken(): LayoutToken | null {
    return this.endToken;
  }

  /** Java overloads: setId() / setId(String theId). */
  setId(theId?: string): void {
    if (theId === undefined) {
      this.id = TextUtilities.cleanField(this.getLabel(), false);
    } else {
      this.id = theId;
    }
  }

  getId(): string | null {
    return this.id;
  }

  getGraphicObjects(): GraphicObject[] | null {
    return this.graphicObjects;
  }

  getBitmapGraphicObjects(): GraphicObject[] | null {
    if (this.graphicObjects == null) {
      return null;
    }
    const graphicObjects = this.graphicObjects.filter(Figure.GRAPHIC_OBJECT_PREDICATE);
    if (graphicObjects.length === 0) {
      return null;
    }
    return graphicObjects;
  }

  getBoxedGraphicObjects(): GraphicObject[] | null {
    if (this.graphicObjects == null) {
      return null;
    }
    const graphicObjects = this.graphicObjects.filter(Figure.BOXED_GRAPHIC_OBJECT_PREDICATE);
    if (graphicObjects.length === 0) {
      return null;
    }
    return graphicObjects;
  }

  getVectorBoxGraphicObjects(): GraphicObject[] | null {
    if (this.graphicObjects == null) {
      return null;
    }
    const graphicObjects = this.graphicObjects.filter(Figure.VECTOR_BOX_GRAPHIC_OBJECT_PREDICATE);
    if (graphicObjects.length === 0) {
      return null;
    }
    return graphicObjects;
  }

  addGraphicObject(obj: GraphicObject): void {
    if (this.graphicObjects == null) {
      this.graphicObjects = [];
    }
    this.graphicObjects.push(obj);
  }

  setGraphicObjects(objs: GraphicObject[] | null): void {
    this.graphicObjects = objs;
  }

  /** Simple block coordinates */
  getCoordinatesString(): string {
    // Java: String.format("%d,%.2f,%.2f,%.2f,%.2f", page, x, y, width, height)
    return `${this.page},${this.x.toFixed(2)},${this.y.toFixed(2)},${this.width.toFixed(2)},${this.height.toFixed(2)}`;
  }

  /** Proper bounding boxes */
  getCoordinates(): BoundingBox[] {
    /*if (layoutTokens == null || layoutTokens.size() == 0)
        return null;
    else {
        BoundingBox oneBox = BoundingBoxCalculator.calculateOneBox(layoutTokens, true);
        List<BoundingBox> result = new ArrayList<BoundingBox>();
        result.add(oneBox);
        return result;
    }*/

    let theBoxes: BoundingBox[] | null = null;
    // non graphic elements
    if (this.getLayoutTokens() != null && this.getLayoutTokens()!.length > 0) {
      // theBoxes = BoundingBoxCalculator.calculate(getLayoutTokens());
      const oneBox = BoundingBoxCalculator.calculateOneBox(this.layoutTokens, true);
      // Upstream dead-write preserved verbatim: declares `result` here but
      // never reads it, then reassigns `theBoxes` to a fresh list and
      // appends `oneBox`.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _result: BoundingBox[] = [];
      theBoxes = [];
      if (oneBox != null) theBoxes.push(oneBox);
    }

    // if (getBitmapGraphicObjects() != null && !getBitmapGraphicObjects().isEmpty()) {
    // -> note: this was restricted to the bitmap objects only... the bounding box calculation
    // with vector graphics might need some double check

    // here we bound all figure graphics in one single box (given that we can have hundred graphics
    // in a single figure)
    let theGraphicsBox: BoundingBox | null = null;
    if (this.graphicObjects != null && this.graphicObjects.length > 0) {
      for (const graphicObject of this.graphicObjects) {
        if (theGraphicsBox == null) {
          theGraphicsBox = graphicObject.getBoundingBox();
        } else {
          const bb = graphicObject.getBoundingBox();
          if (bb != null) {
            theGraphicsBox = theGraphicsBox.boundBoxExcludingAnotherPage(bb);
          }
        }
      }
    }

    if (theGraphicsBox != null) {
      if (theBoxes == null) theBoxes = [];
      theBoxes.push(theGraphicsBox);
    }

    const result: BoundingBox[] = [];
    if (theBoxes != null && theBoxes.length > 0) {
      // Upstream calls `BoundingBoxCalculator.calculateOneBox(layoutTokens, true);`
      // but the result is overwritten by the merged boxes below — preserved verbatim.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _oneBox = BoundingBoxCalculator.calculateOneBox(this.layoutTokens, true);
      const VectorGraphicBoxCalculator: Any = (VectorBoxCalcNs as Any).VectorGraphicBoxCalculator;
      const mergedBox: BoundingBox[] = VectorGraphicBoxCalculator.mergeBoxes(theBoxes);
      for (const b of mergedBox) result.push(b);
    }

    // Collections.sort(result) — BoundingBox is Comparable.
    result.sort((a, b) => (a as unknown as { compareTo(o: BoundingBox): number }).compareTo(b));

    return result;
  }

  getTeiId(): string {
    return "fig_" + this.id;
  }

  /**
   * Returns true when this figure has enough content to be serialised to TEI.
   * Mirrors upstream: header is not blank OR caption is not blank OR there
   * is at least one graphic object.
   *
   * This is the gate that filters figures that only carry a label / loose
   * tokens (no head, no caption, no graphic) — those are dropped before TEI
   * output.
   */
  isCompleteForTEI(): boolean {
    return (Figure.isNotBlank(this.getHeader()) || Figure.isNotBlank(this.getCaption()) ||
      (this.graphicObjects != null && this.graphicObjects.length > 0));
  }

  /** Local helper mirroring `org.apache.commons.lang3.StringUtils.isNotBlank`. */
  protected static isNotBlank(s: string | null | undefined): boolean {
    if (s == null) return false;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      // Match Character.isWhitespace for ASCII whitespace.
      if (!(c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0b || c === 0x0c || c === 0x0d)) {
        return true;
      }
    }
    return false;
  }

  /** Local helper mirroring `org.apache.commons.lang3.StringUtils.isNotEmpty`. */
  protected static isNotEmpty(s: string | null | undefined): boolean {
    return s != null && s.length > 0;
  }

  toTEI(
    config: GrobidAnalysisConfig,
    doc: Document,
    formatter: TEIFormatter,
    markerTypes: MarkerType[] | null,
  ): string | null {
    if (!this.isCompleteForTEI()) {
      Figure.LOGGER.warn("Found a figure that is badly formatted but it should have been spotted before. We ignore it now.");
      return null;
    }

    const figureElement: Any = XmlBuilderUtils.teiElement("figure");
    if (this.id != null) {
      XmlBuilderUtils.addXmlId(figureElement, "fig_" + this.id);
    }

    if (config.isGenerateTeiCoordinates("figure")) {
      let theBoxes: BoundingBox[] | null = null;
      // non graphic elements
      if (this.getLayoutTokens() != null && this.getLayoutTokens()!.length > 0) {
        theBoxes = BoundingBoxCalculator.calculate(this.getLayoutTokens());
      }

      // here we bound all figure graphics in one single box (given that we can have a hundred graphics
      // in a single figure)
      let theGraphicsBox: BoundingBox | null = null;
      if (this.graphicObjects != null && this.graphicObjects.length > 0) {
        for (const graphicObject of this.graphicObjects) {
          if (theGraphicsBox == null) {
            theGraphicsBox = graphicObject.getBoundingBox();
          } else {
            const bb = graphicObject.getBoundingBox();
            if (bb != null) {
              theGraphicsBox = theGraphicsBox.boundBoxExcludingAnotherPage(bb);
            }
          }
        }
      }

      if (theGraphicsBox != null) {
        if (theBoxes == null) theBoxes = [];
        theBoxes.push(theGraphicsBox);
      }

      if (theBoxes != null && theBoxes.length > 0) {
        // Joiner.on(";").join(theBoxes) — BoundingBox.toString() supplies each part.
        const coords = theBoxes.map((b) => (b as unknown as { toString(): string }).toString()).join(";");
        XmlBuilderUtils.addCoords(figureElement, coords);
      }
    }

    if (Figure.isNotBlank(this.getHeader())) {
      const head = XmlBuilderUtils.teiElement("head", LayoutTokensUtil.normalizeText(this.getHeader()));
      figureElement.appendChild(head);
    }

    if (Figure.isNotBlank(this.getLabel())) {
      const labelEl = XmlBuilderUtils.teiElement("label", LayoutTokensUtil.normalizeText(this.getLabel()));
      figureElement.appendChild(labelEl);
    }
    if (Figure.isNotBlank(this.getCaption())) {
      let desc: Any = XmlBuilderUtils.teiElement("figDesc");
      if (config.isGenerateTeiIds()) {
        const divID = KeyGen.getKey().substring(0, 7);
        XmlBuilderUtils.addXmlId(desc, "_" + divID);
      }

      // if the segment has been parsed with the full text model we further extract the clusters
      // to get the bibliographical references
      if (Figure.isNotBlank(this.labeledCaption)) {
        const TaggingTokenClusteror: Any = (TaggingTokenClusterorNs as Any).TaggingTokenClusteror;
        const TaggingLabels: Any = (TaggingLabelsNs as Any).TaggingLabels;
        // GrobidModels is referenced via a namespace import to avoid the
        // module-load-time circular dependency between data/figure ↔
        // document/tei-formatter ↔ engines/full-text-parser.
        const GrobidModels: Any = (GrobidModelsNs as Any).GrobidModels;

        const clusteror = new TaggingTokenClusteror(GrobidModels.FULLTEXT, this.labeledCaption, this.captionLayoutTokens);
        const clusters = clusteror.cluster();

        let citationMarkerType: MarkerType | null = null;
        if (markerTypes != null && markerTypes.length > 0) {
          citationMarkerType = markerTypes[0]!;
        }

        for (const cluster of clusters) {
          if (cluster == null) {
            continue;
          }

          const clusterLabel = cluster.getTaggingLabel();
          // String clusterContent = LayoutTokensUtil.normalizeText(cluster.concatTokens());
          const clusterContent = LayoutTokensUtil.normalizeDehyphenizeText(cluster.concatTokens());
          if (clusterLabel?.equals?.(TaggingLabels.CITATION_MARKER) || clusterLabel === TaggingLabels.CITATION_MARKER) {
            try {
              const refNodes = formatter.markReferencesTEILuceneBased(
                cluster.concatTokens(),
                doc.getReferenceMarkerMatcher(),
                config.isGenerateTeiCoordinates("ref"),
                false,
                citationMarkerType,
              );
              if (refNodes != null) {
                for (const n of refNodes) {
                  desc.appendChild(n);
                }
              }
            } catch (e) {
              Figure.LOGGER.warn("Problem when serializing TEI fragment for figure caption", e);
            }
          } else {
            desc.appendChild(textNode(clusterContent));
          }
        }
      } else {
        desc.appendChild(LayoutTokensUtil.normalizeText(this.getCaption()).trim());
        // Element desc = XmlBuilderUtils.teiElement("figDesc",
        //    LayoutTokensUtil.normalizeText(caption.toString()));
      }

      if (Figure.isNotBlank(desc.getValue()) && config.isWithSentenceSegmentation()) {
        formatter.segmentIntoSentences(
          desc, this.captionLayoutTokens, config,
          doc.getLanguage(),
          doc.getPDFAnnotations(),
        );

        // we need a sentence segmentation of the figure caption, for that we need to introduce
        // a <div>, then a <p>
        desc.setLocalName("p");

        const div = XmlBuilderUtils.teiElement("div");
        div.appendChild(desc);

        const figDesc = XmlBuilderUtils.teiElement("figDesc");
        figDesc.appendChild(div);

        desc = figDesc;
      }

      figureElement.appendChild(desc);
    }

    if (config.isIncludeDiscardedText() && this.discardedPiecesTokens != null && this.discardedPiecesTokens.length > 0) {
      const generateDiscardedTextNote: Any = (TEIFormatterNs as Any).generateDiscardedTextNote;
      for (const discardedPieceTokens of this.discardedPiecesTokens) {
        figureElement.appendChild(
          generateDiscardedTextNote(discardedPieceTokens, doc, formatter, config),
        );
      }
    }

    if (this.graphicObjects != null && this.graphicObjects.length > 0) {
      const Attribute: Any = (XBUNs as Any).Attribute;
      for (const graphicObject of this.graphicObjects) {
        const go: Any = XmlBuilderUtils.teiElement("graphic");
        const uri = graphicObject.getURI();
        if (uri != null) {
          go.addAttribute(new Attribute("url", uri));
        }

        const bb = graphicObject.getBoundingBox();
        if (bb != null) {
          go.addAttribute(new Attribute("coords", bb.toString()));
        }

        go.addAttribute(new Attribute("type", String(graphicObject.getType()).toLowerCase()));
        if (graphicObject.isMask()) {
          go.addAttribute(new Attribute("mask", "true"));
        }
        figureElement.appendChild(go);
      }
    }
    return figureElement.toXML();
  }

  // Preserved from upstream — never called outside this file but kept for parity.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private cleanString(input: string): string {
    return input.replace(/\n/g, " ").replace(/  /g, " ").trim();
  }

  getPage(): number {
    return this.page;
  }

  getHeight(): number {
    return this.height;
  }

  getWidth(): number {
    return this.width;
  }

  getX(): number {
    return this.x;
  }

  getY(): number {
    return this.y;
  }

  getUri(): string | null {
    return this.uri;
  }

  setPage(page: number): void {
    this.page = page;
  }

  setY(y: number): void {
    this.y = y;
  }

  setX(x: number): void {
    this.x = x;
  }

  setWidth(width: number): void {
    this.width = width;
  }

  setHeight(height: number): void {
    this.height = height;
  }

  getTextArea(): BoundingBox[] | null {
    return this.textArea;
  }

  setTextArea(textArea: BoundingBox[] | null): void {
    this.textArea = textArea;
  }

  getLayoutTokens(): LayoutToken[] | null {
    return this.layoutTokens;
  }

  setLayoutTokens(layoutTokens: LayoutToken[] | null): void {
    this.layoutTokens = layoutTokens;
  }

  addLayoutTokens(layoutTokens: LayoutToken[]): void {
    if (this.layoutTokens == null) {
      this.layoutTokens = [];
    }
    for (const t of layoutTokens) this.layoutTokens.push(t);
  }

  setBlockPtrs(blockPtrs: Set<number> | null): void {
    this.blockPtrs = blockPtrs;
  }

  getBlockPtrs(): Set<number> | null {
    return this.blockPtrs;
  }

  /** Upstream signature is `setCaption(StringBuilder)`. We accept either a
   *  string or an array (matching our internal buffer shape). */
  setCaption(caption: string | string[]): void {
    this.caption = Array.isArray(caption) ? caption : [caption];
  }

  setHeader(header: string | string[]): void {
    this.header = Array.isArray(header) ? header : [header];
  }

  setContent(content: string | string[]): void {
    this.content = Array.isArray(content) ? content : [content];
  }

  setLabel(label: string | string[]): void {
    this.label = Array.isArray(label) ? label : [label];
  }

  setUri(uri: string | null): void {
    this.uri = uri;
  }

  getDiscardedPiecesTokens(): LayoutToken[][] {
    return this.discardedPiecesTokens;
  }

  setDiscardedPiecesTokens(discardedPiecesTokens: LayoutToken[][]): void {
    this.discardedPiecesTokens = discardedPiecesTokens;
  }

  addDiscardedPieceTokens(pieceToken: LayoutToken[]): void {
    this.discardedPiecesTokens.push(pieceToken);
  }
}
