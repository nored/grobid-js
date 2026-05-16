// Port of org.grobid.core.data.Table.
// Upstream: grobid-core/src/main/java/org/grobid/core/data/Table.java

import type { BoundingBox } from "../layout/bounding-box.js";
import type { LayoutToken } from "../layout/layout-token.js";
import { BoundingBoxCalculator } from "../utilities/bounding-box-calculator.js";
import { KeyGen } from "../utilities/key-gen.js";
import { LayoutTokensUtil } from "../utilities/layout-tokens-util.js";
import { Figure } from "./figure.js";
import { Cell } from "./table/cell.js";
import { Line } from "./table/line.js";
import { Row } from "./table/row.js";

// Cross-package stubs imported by their final TS paths.
import * as DocumentNs from "../document/document.js";
import * as TEIFormatterNs from "../document/tei-formatter.js";
import * as XBUNs from "../document/xml/xml-builder-utils.js";
import * as CalloutAnalyzerNs from "../engines/citations/callout-analyzer.js";
import * as GrobidAnalysisConfigNs from "../engines/config/grobid-analysis-config.js";
import * as TaggingTokenClusterorNs from "../tokenization/tagging-token-clusteror.js";
import * as TaggingLabelsNs from "../engines/label/tagging-labels.js";
import * as EngineNs from "../engines/engine.js";
import * as GrobidModelsNs from "../grobid-models.js";
import * as CntManagerNs from "../utilities/counters/cnt-manager.js";
import * as TableRejectionCountersNs from "../engines/counters/table-rejection-counters.js";

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
void DocumentNs;
void TEIFormatterNs;
void CalloutAnalyzerNs;
void GrobidAnalysisConfigNs;

const XmlBuilderUtils: Any = (XBUNs as Any).XmlBuilderUtils ?? XBUNs;
const teiElement: (name: string, content?: string) => Any = (n: string, c?: string): Any =>
  XmlBuilderUtils.teiElement(n, c);
const textNode: (s: string) => Any = (s: string): Any =>
  ((XBUNs as Any).textNode ?? XmlBuilderUtils?.textNode)?.(s);
const addXmlId: (el: Any, id: string) => void = (el: Any, id: string): void =>
  XmlBuilderUtils.addXmlId(el, id);

/**
 * Class for representing a table.
 */
export class Table extends Figure {
  private contentTokens: LayoutToken[] = [];
  private fullDescriptionTokens: LayoutToken[] = [];

  private goodTable = true;

  private note: string[] = []; // upstream uses StringBuilder
  private noteLayoutTokens: LayoutToken[] | null = null;
  private labeledNote: string | null = null;

  // Upstream redeclares `discardedPiecesTokens` even though the parent
  // class has one of the same name. Preserved verbatim (shadows the
  // parent's private field — Java allowed because parent's field is
  // private and Table accesses its own field name).
  private tableDiscardedPiecesTokens: LayoutToken[][] = [];

  setGoodTable(goodTable: boolean): void {
    this.goodTable = goodTable;
  }

  constructor() {
    super();
    // Upstream re-initialises caption/header/content/label/note here.
    // Our Figure already initialises the buffers; nothing more needed.
  }

  override isCompleteForTEI(): boolean {
    return Figure.isNotEmpty(this.getHeader()) && Figure.isNotEmpty(this.getCaption());
  }

  override toTEI(
    config: GrobidAnalysisConfig,
    doc: Document,
    formatter: TEIFormatter,
    markerTypes: MarkerType[] | null,
  ): string | null {
    if (!this.isCompleteForTEI()) {
      Figure.LOGGER.warn("Found a table that is badly formatted but it should have been spotted before. We ignore it now.");
      return null;
    }

    const tableElement: Any = teiElement("figure");
    const Attribute: Any = (XBUNs as Any).Attribute;
    tableElement.addAttribute(new Attribute("type", "table"));
    if (this.id != null) {
      addXmlId(tableElement, "tab_" + this.id);
    }

    // this is non TEI, to be reviewed
    // tableElement.addAttribute(new Attribute("validated", String.valueOf(isGoodTable())));

    const coords = config.getGenerateTeiCoordinates?.();
    if (coords != null && coords.includes("figure")) {
      XmlBuilderUtils.addCoords(tableElement, LayoutTokensUtil.getCoordsStringForOneBox(this.getLayoutTokens() ?? []));
    }

    const headEl: Any = teiElement("head", LayoutTokensUtil.normalizeText(this.getHeader()));

    const labelEl: Any = teiElement("label", LayoutTokensUtil.normalizeText(this.getLabel()));

    /*Element descEl = XmlBuilderUtils.teiElement("figDesc");
    descEl.appendChild(LayoutTokensUtil.normalizeText(caption.toString()).trim());
    if ((config.getGenerateTeiCoordinates() != null) && (config.getGenerateTeiCoordinates().contains("figure"))) {
        XmlBuilderUtils.addCoords(descEl, LayoutTokensUtil.getCoordsString(getFullDescriptionTokens()));
    }*/

    let desc: Any = null;
    if (Figure.isNotBlank(this.getCaption())) {
      // if the segment has been parsed with the full text model we further extract the clusters
      // to get the bibliographical references
      desc = teiElement("figDesc");
      if (config.isGenerateTeiIds?.()) {
        const divID = KeyGen.getKey().substring(0, 7);
        addXmlId(desc, "_" + divID);
      }

      if (Figure.isNotBlank(this.labeledCaption)) {
        const TaggingTokenClusteror: Any = (TaggingTokenClusterorNs as Any).TaggingTokenClusteror;
        const TaggingLabels: Any = (TaggingLabelsNs as Any).TaggingLabels;
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
              Figure.LOGGER.warn("Problem when serializing TEI fragment for table caption", e);
            }
          } else {
            desc.appendChild(textNode(clusterContent));
          }

          // NOTE: Upstream nests this sentence-segmentation block INSIDE the
          // per-cluster loop, which means it runs once per cluster (a likely
          // bug). Preserved verbatim.
          if (Figure.isNotBlank(desc.getValue()) && config.isWithSentenceSegmentation?.()) {
            formatter.segmentIntoSentences(
              desc, this.captionLayoutTokens, config,
              doc.getLanguage(), doc.getPDFAnnotations(),
            );

            // we need a sentence segmentation of the table caption, for that we need to introduce
            // a <div>, then a <p>
            desc.setLocalName("p");

            const div = teiElement("div");
            div.appendChild(desc);

            const figDesc = teiElement("figDesc");
            figDesc.appendChild(div);

            desc = figDesc;
          }
        }
      } else {
        desc.appendChild(LayoutTokensUtil.normalizeText(this.getCaption()).trim());
      }
    }

    const contentEl: Any = teiElement("table");
    this.processTableContent(contentEl, this.getContentTokens());
    if (coords != null && coords.includes("figure")) {
      XmlBuilderUtils.addCoords(contentEl, LayoutTokensUtil.getCoordsStringForOneBox(this.getContentTokens()));
    }

    let noteNode: Any = null;
    if (Figure.isNotBlank(this.getNote())) {
      noteNode = teiElement("note");
      if (config.isGenerateTeiIds?.()) {
        const divID = KeyGen.getKey().substring(0, 7);
        addXmlId(noteNode, "_" + divID);
      }

      if (Figure.isNotBlank(this.labeledNote)) {
        let p: Any = teiElement("p");
        const TaggingTokenClusteror: Any = (TaggingTokenClusterorNs as Any).TaggingTokenClusteror;
        const TaggingLabels: Any = (TaggingLabelsNs as Any).TaggingLabels;
        const GrobidModels: Any = (GrobidModelsNs as Any).GrobidModels;
        const clusteror = new TaggingTokenClusteror(GrobidModels.FULLTEXT, this.labeledNote, this.noteLayoutTokens);
        const clusters = clusteror.cluster();
        for (const cluster of clusters) {
          if (cluster == null) {
            continue;
          }

          let citationMarkerType: MarkerType | null = null;
          if (markerTypes != null && markerTypes.length > 0) {
            citationMarkerType = markerTypes[0]!;
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
                  p.appendChild(n);
                }
              }
            } catch (e) {
              Figure.LOGGER.warn("Problem when serializing TEI fragment for table note", e);
            }
          } else {
            const isNewParagraph: Any = (TEIFormatterNs as Any).isNewParagraph;
            if (p.getChildCount() > 0 && isNewParagraph(clusterLabel, p)) {
              noteNode.appendChild(p);
              p = teiElement("p");
            }
            p.appendChild(textNode(clusterContent));
          }
        }
        if (p.getChildCount() > 0) {
          noteNode.appendChild(p);
        }
        if (config.isWithSentenceSegmentation?.()) {
          // we need a sentence segmentation of the figure caption
          formatter.segmentIntoSentences(
            p, this.noteLayoutTokens, config,
            doc.getLanguage(), doc.getPDFAnnotations(),
          );
        }
      } else {
        const p: Any = teiElement("p");
        p.appendChild(LayoutTokensUtil.normalizeText(this.getNote()).trim());

        if (config.isWithSentenceSegmentation?.()) {
          // we need a sentence segmentation of the figure caption
          formatter.segmentIntoSentences(
            p, this.noteLayoutTokens, config,
            doc.getLanguage(), doc.getPDFAnnotations(),
          );
        }

        noteNode = teiElement("note");
        noteNode.appendChild(p);
      }

      let noteCoords: string | null = null;
      if (config.isGenerateTeiCoordinates?.("note")) {
        noteCoords = LayoutTokensUtil.getCoordsString(this.noteLayoutTokens ?? []);
      }

      if (noteCoords != null) {
        noteNode.addAttribute(new Attribute("coords", noteCoords));
      }
    }

    tableElement.appendChild(headEl);
    tableElement.appendChild(labelEl);
    if (desc != null) {
      tableElement.appendChild(desc);
    }
    tableElement.appendChild(contentEl);

    if (noteNode != null) {
      tableElement.appendChild(noteNode);
    }

    if (config.isIncludeDiscardedText?.() && this.tableDiscardedPiecesTokens != null && this.tableDiscardedPiecesTokens.length > 0) {
      const generateDiscardedTextNote: Any = (TEIFormatterNs as Any).generateDiscardedTextNote;
      for (const discardedPieceTokens of this.tableDiscardedPiecesTokens) {
        tableElement.appendChild(
          generateDiscardedTextNote(discardedPieceTokens, doc, formatter, config),
        );
      }
    }

    return tableElement.toXML();
  }

  /**
   * @param contentEl table element to append parsed rows and cells.
   * @param contentTokens tokens that are used to build cells
   * Line-based algorithm for parsing tables, uses tokens' coordinates to identify lines
   */
  processTableContent(contentEl: Any, contentTokens: LayoutToken[]): void {
    // Join Layout Tokens into cell lines originally created by PDFAlto
    const lineParts = Line.extractLineParts(contentTokens);

    // Build lines by comparing borders
    const lines = Line.extractLines(lineParts);

    // Build rows and cells
    const rows = Row.extractRows(lines);

    const columnCount = Row.columnCount(rows);

    Row.insertEmptyCells(rows, columnCount);

    Row.mergeMulticolumnCells(rows);

    const Attribute: Any = (XBUNs as Any).Attribute;

    for (const row of rows) {
      const tr: Any = teiElement("row");
      contentEl.appendChild(tr);
      const cells = row.getContent();
      for (const cell of cells) {
        const td: Any = teiElement("cell");
        tr.appendChild(td);
        if (cell.getColspan() > 1) {
          td.addAttribute(new Attribute("cols", String(cell.getColspan())));
        }
        td.appendChild(cell.getText().trim());
      }
    }
  }

  // Preserved from upstream — never called outside. Renamed to
  // `cleanStringTable` to avoid colliding with Figure's same-named private
  // method (TS forbids overlapping private declarations).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private cleanStringTable(input: string): string {
    return input.replace(/\n/g, " ").replace(/  /g, " ").trim();
  }

  getNote(): string {
    return this.note.join("");
  }

  setNote(note: string | string[]): void {
    this.note = Array.isArray(note) ? note : [note];
  }

  appendNote(noteChunk: string): void {
    this.note.push(noteChunk);
  }

  /** if an extracted table passes some validations rules */
  firstCheck(): boolean {
    this.goodTable = this.goodTable && this.validateTable();
    return this.goodTable;
  }

  secondCheck(): boolean {
    this.goodTable = this.goodTable && !this.badTableAdvancedCheck();
    return this.goodTable;
  }

  getNoteLayoutTokens(): LayoutToken[] | null {
    return this.noteLayoutTokens;
  }

  setNoteLayoutTokens(tokens: LayoutToken[] | null): void {
    this.noteLayoutTokens = tokens;
  }

  addNoteLayoutToken(token: LayoutToken): void {
    if (this.noteLayoutTokens == null) {
      this.noteLayoutTokens = [];
    }
    this.noteLayoutTokens.push(token);
  }

  addAllNoteLayoutTokens(tokens: LayoutToken[]): void {
    if (this.noteLayoutTokens == null) {
      this.noteLayoutTokens = [];
    }
    for (const t of tokens) this.noteLayoutTokens.push(t);
  }

  setLabeledNote(labeledNote: string | null): void {
    this.labeledNote = labeledNote;
  }

  getLabeledNote(): string | null {
    return this.labeledNote;
  }

  /**
   * Check if the table:
   * - has label, header and content
   * - header starts with "tab"
   * - label can be parsed
   */
  validateTable(): boolean {
    const Engine: Any = (EngineNs as Any).Engine;
    const cnt: Any = Engine?.getCntManager?.();
    const TableRejectionCounters: Any = (TableRejectionCountersNs as Any).TableRejectionCounters;
    void CntManagerNs;

    // StringUtils.isAnyBlank(label, header, content)
    if (!Figure.isNotBlank(this.getLabel()) || !Figure.isNotBlank(this.getHeader()) || !Figure.isNotBlank(this.getContent())) {
      cnt?.i?.(TableRejectionCounters?.EMPTY_LABEL_OR_HEADER_OR_CONTENT);
      return false;
    }

    // Integer.valueOf(getLabel().trim(), 10) — throws NumberFormatException
    const trimmed = this.getLabel().trim();
    if (!/^[+-]?\d+$/.test(trimmed)) {
      cnt?.i?.(TableRejectionCounters?.CANNOT_PARSE_LABEL_TO_INT);
      return false;
    }
    // also validate range like Java's Integer.parseInt: out-of-range is caught
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < -2147483648 || parsed > 2147483647) {
      cnt?.i?.(TableRejectionCounters?.CANNOT_PARSE_LABEL_TO_INT);
      return false;
    }

    // tab covers: table, tabelle, tableu, tabella, etc.
    if (!this.getHeader().toLowerCase().startsWith("tab")) {
      cnt?.i?.(TableRejectionCounters?.HEADER_NOT_STARTS_WITH_TABLE_WORD);
      return false;
    }
    return true;
  }

  private badTableAdvancedCheck(): boolean {
    const Engine: Any = (EngineNs as Any).Engine;
    const cnt: Any = Engine?.getCntManager?.();
    const TableRejectionCounters: Any = (TableRejectionCountersNs as Any).TableRejectionCounters;

    const contentBox: BoundingBox | null = BoundingBoxCalculator.calculateOneBox(this.contentTokens, true);
    const descBox: BoundingBox | null = BoundingBoxCalculator.calculateOneBox(this.fullDescriptionTokens, true);

    // Java would NPE if either box is null and we'd then call .getPage();
    // preserve that contract (return true ⇒ bad table on null).
    if (contentBox == null || descBox == null) {
      return true;
    }

    if (contentBox.getPage() !== descBox.getPage()) {
      cnt?.i?.(TableRejectionCounters?.HEADER_AND_CONTENT_DIFFERENT_PAGES);
      return true;
    }

    if (contentBox.intersect(descBox)) {
      cnt?.i?.(TableRejectionCounters?.HEADER_AND_CONTENT_INTERSECT);
      return true;
    }

    if (descBox.area() > contentBox.area()) {
      cnt?.i?.(TableRejectionCounters?.HEADER_AREA_BIGGER_THAN_CONTENT);
      return true;
    }

    if (contentBox.getHeight() < 40) {
      cnt?.i?.(TableRejectionCounters?.CONTENT_SIZE_TOO_SMALL);
      return true;
    }

    if (contentBox.getWidth() < 100) {
      cnt?.i?.(TableRejectionCounters?.CONTENT_WIDTH_TOO_SMALL);
      return true;
    }

    if (this.contentTokens.length < 10) {
      cnt?.i?.(TableRejectionCounters?.FEW_TOKENS_IN_CONTENT);
      return true;
    }

    if (this.fullDescriptionTokens.length < 5) {
      cnt?.i?.(TableRejectionCounters?.FEW_TOKENS_IN_HEADER);
      return true;
    }
    return false;
  }

  getContentTokens(): LayoutToken[] {
    return this.contentTokens;
  }

  getFullDescriptionTokens(): LayoutToken[] {
    return this.fullDescriptionTokens;
  }

  isGoodTable(): boolean {
    return this.goodTable;
  }

  override getTeiId(): string {
    return "tab_" + this.id;
  }

  override getDiscardedPiecesTokens(): LayoutToken[][] {
    return this.tableDiscardedPiecesTokens;
  }

  override setDiscardedPiecesTokens(discardedPiecesTokens: LayoutToken[][]): void {
    this.tableDiscardedPiecesTokens = discardedPiecesTokens;
  }

  override addDiscardedPieceTokens(pieceToken: LayoutToken[]): void {
    this.tableDiscardedPiecesTokens.push(pieceToken);
  }
}

// Cell, Line, Row are re-exported through `data/table/*.ts`.
void Cell;
void Line;
void Row;
