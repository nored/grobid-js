// Port of org.grobid.core.document.BasicStructureBuilder.
// Upstream: grobid-core/src/main/java/org/grobid/core/document/BasicStructureBuilder.java
//
// Class for building basic structures in a document item.

import { BibDataSet } from "../data/bib-data-set.js";
import { GenericTaggerUtils } from "../engines/tagging/generic-tagger-utils.js";
import { Block } from "../layout/block.js";
import { Cluster } from "../layout/cluster.js";
import type { LayoutToken } from "../layout/layout-token.js";
import type { Pair } from "../utilities/pair.js";
import { TextUtilities } from "../utilities/text-utilities.js";
import { getLogger } from "../utilities/logger.js";
import { Document, SortedSetMultimapDocumentPiece } from "./document.js";
import { DocumentPiece } from "./document-piece.js";
import { DocumentPointer } from "./document-pointer.js";

const LOGGER = getLogger("BasicStructureBuilder");

/**
 * Upstream BasicStructureBuilder.java line 31-537.
 */
export class BasicStructureBuilder {
  // Upstream line 32.
  private static readonly LOGGER = LOGGER;

  // NOTE: upstream lines 36-43 — commented-out `introduction`, `introductionStrict`, `abstract_` patterns.
  // Upstream lines 44-47.
  static headerNumbering1 = /^(\d+)\.?\s/;
  static headerNumbering2 = /^((\d+)\.)+(\d+)\s/;
  static headerNumbering3 = /^((\d+)\.)+\s/;
  static headerNumbering4 = /^([A-Z](I|V|X)*(\.(\d)*)*\s)/;

  // Upstream line 49-50.
  private static startNum = /^(\d)+\s/;
  private static endNum = /\s(\d)+$/;

  /**
   * Cluster the blocks following the font, style and size aspects.
   *
   * Upstream line 60-101 — `private static` and unused; kept for fidelity.
   */
  private static addBlockToCluster(b: number, doc: Document): void {
    const block: Block = doc.getBlocks()[b]!;
    let font = block.getFont();
    const bold = (block as unknown as { getBold(): boolean }).getBold();
    const italic = (block as unknown as { getItalic(): boolean }).getItalic();
    const fontSize = block.getFontSize();
    let found = false;

    if (font === null) font = "unknown";
    // NOTE: upstream line 72 — `//System.out.println(font + " " + bold + " " + italic + " " + fontSize );` (commented-out).

    if (doc.getClusters() === null) {
      doc.setClusters([]);
    } else {
      for (const cluster of doc.getClusters()!) {
        let font2 = cluster.getFont();
        if (font2 === null) font2 = "unknown";
        // NOTE: upstream uses bitwise `&` for the subsequent terms (lines 82-84).
        // Preserved verbatim — `&` over booleans behaves like `&&` here.
        if (
          font === font2 &&
          (bold === cluster.getBold()) &&
          (italic === cluster.getItalic()) &&
          (fontSize === cluster.getFontSize())
        ) {
          cluster.addBlock2(b);
          found = true;
        }
      }
    }

    if (!found) {
      const cluster = new Cluster();
      cluster.setFont(font);
      cluster.setBold(bold);
      cluster.setItalic(italic);
      cluster.setFontSize(fontSize);
      cluster.addBlock2(b);
      doc.getClusters()!.push(cluster);
    }
  }

  // Upstream line 103-287.
  static generalResultSegmentation(doc: Document, labeledResult: string, documentTokens: LayoutToken[]): Document {
    const labeledTokens: (Pair<string, string> | null)[] = GenericTaggerUtils.getTokensAndLabels(labeledResult);

    const labeledBlocks = new SortedSetMultimapDocumentPiece();
    doc.setLabeledBlocks(labeledBlocks);

    const docBlocks: Block[] = doc.getBlocks();
    let indexLine = 0;
    let blockIndex = 0;
    let p = 0; // position in the labeled result
    let currentLineEndPos = 0;
    let currentLineStartPos = 0;
    let line: string | null = null;

    // NOTE: upstream line 119 — `//DocumentPointer pointerA = DocumentPointer.START_DOCUMENT_POINTER;` (commented-out).
    // the default first block might not contain tokens but only bitmap - in this case we move
    // to the first block containing some LayoutToken objects
    while (
      docBlocks[blockIndex]!.getTokens() === null ||
      docBlocks[blockIndex]!.getNbTokens() === 0
      // NOTE: upstream line 125 — `// || docBlocks.get(blockIndex).getStartToken() == -1` (commented-out TODO).
    ) {
      blockIndex++;
    }
    let pointerA = new DocumentPointer(doc, blockIndex, docBlocks[blockIndex]!.getStartToken());

    let currentPointer: DocumentPointer | null = null;
    let lastPointer: DocumentPointer | null = null;

    let curLabel: string;
    let curPlainLabel: string | null = null;
    let lastPlainLabel: string | null = null;

    let lastTokenInd = -1;
    for (let i = docBlocks.length - 1; i >= 0; i--) {
      const endToken = docBlocks[i]!.getEndToken();
      if (endToken !== -1) {
        lastTokenInd = endToken;
        break;
      }
    }

    // we do this concatenation trick so that we don't have to process stuff after the main loop
    // no copying of lists happens because of this, so it's ok to concatenate
    const ignoredLabel = "@IGNORED_LABEL@";
    const allTokens: (Pair<string, string> | null)[] = [
      ...labeledTokens,
      // The Pair class is type-compatible.
      { a: "IgnoredToken", b: ignoredLabel, getA: () => "IgnoredToken", getB: () => ignoredLabel, toString: () => "" } as unknown as Pair<string, string>,
    ];
    for (const labeledTokenPair of allTokens) {
      if (labeledTokenPair === null) {
        p++;
        continue;
      }

      // as we process the document segmentation line by line, we don't use the usual
      // tokenization to rebuild the text flow, but we get each line again from the
      // text stored in the document blocks (similarly as when generating the features)
      line = null;
      while (line === null && blockIndex < docBlocks.length) {
        let block: Block = docBlocks[blockIndex]!;
        const tokens = block.getTokens();
        const localText = block.getText();
        // StringUtils.isBlank
        if (tokens === null || localText === null || localText.trim().length === 0) {
          blockIndex++;
          indexLine = 0;
          if (blockIndex < docBlocks.length) {
            block = docBlocks[blockIndex]!;
            currentLineStartPos = block.getStartToken();
          }
          continue;
        }
        const lines = localText.split(/[\n\r]/);
        if (lines.length === 0 || indexLine >= lines.length || indexLine > 10000) {
          blockIndex++;
          indexLine = 0;
          if (blockIndex < docBlocks.length) {
            block = docBlocks[blockIndex]!;
            currentLineStartPos = block.getStartToken();
          }
          continue;
        } else {
          line = lines[indexLine] ?? "";
          indexLine++;
          if (line.trim().length === 0 || TextUtilities.filterLine(line)) {
            line = null;
            continue;
          }

          if (currentLineStartPos > lastTokenInd) {
            break;
          }

          // adjust the start token position in documentTokens to this non trivial line
          // first skip possible space characters and tabs at the beginning of the line
          while (
            (documentTokens[currentLineStartPos]!.t() === " " ||
              documentTokens[currentLineStartPos]!.t() === "\t") &&
            currentLineStartPos !== lastTokenInd
          ) {
            currentLineStartPos++;
          }
          if (!labeledTokenPair.getA().startsWith(documentTokens[currentLineStartPos]!.getText() ?? "")) {
            while (currentLineStartPos < block.getEndToken()) {
              if (
                documentTokens[currentLineStartPos]!.t() === "\n" ||
                documentTokens[currentLineStartPos]!.t() === "\r"
              ) {
                // move to the start of the next line, but ignore space characters and tabs
                currentLineStartPos++;
                while (
                  (documentTokens[currentLineStartPos]!.t() === " " ||
                    documentTokens[currentLineStartPos]!.t() === "\t") &&
                  currentLineStartPos !== lastTokenInd
                ) {
                  currentLineStartPos++;
                }
                if (
                  currentLineStartPos !== lastTokenInd &&
                  labeledTokenPair.getA().startsWith(documentTokens[currentLineStartPos]!.getText() ?? "")
                ) {
                  break;
                }
              }
              currentLineStartPos++;
            }
          }

          // what is then the position of the last token of this line?
          currentLineEndPos = currentLineStartPos;
          while (currentLineEndPos < block.getEndToken()) {
            if (
              documentTokens[currentLineEndPos]!.t() === "\n" ||
              documentTokens[currentLineEndPos]!.t() === "\r"
            ) {
              currentLineEndPos--;
              break;
            }
            currentLineEndPos++;
          }
        }
      }
      curLabel = labeledTokenPair.getB();
      curPlainLabel = GenericTaggerUtils.getPlainLabel(curLabel) ?? null;
      // NOTE: upstream lines 239-250 — commented-out debug `System.out.println` block.

      if (blockIndex === docBlocks.length) {
        break;
      }

      currentPointer = new DocumentPointer(doc, blockIndex, currentLineEndPos);

      // either a new entity starts or a new beginning of the same type of entity
      if (curPlainLabel !== lastPlainLabel && lastPlainLabel !== null) {
        if (
          pointerA.getTokenDocPos() <= lastPointer!.getTokenDocPos() &&
          pointerA.getTokenDocPos() !== -1
        ) {
          labeledBlocks.put(lastPlainLabel, new DocumentPiece(pointerA, lastPointer!));
        }
        pointerA = new DocumentPointer(doc, blockIndex, currentLineStartPos);
        // NOTE: upstream line 265 — `//System.out.println(...)` (commented-out).
      }

      // updating stuff for next iteration
      lastPlainLabel = curPlainLabel;
      lastPointer = currentPointer;
      currentLineStartPos = currentLineEndPos + 2; // one shift for the EOL, one for the next line
      p++;
    }

    if (blockIndex === docBlocks.length) {
      // the last labelled piece has still to be added
      if (curPlainLabel !== lastPlainLabel && lastPlainLabel !== null) {
        if (
          pointerA.getTokenDocPos() <= lastPointer!.getTokenDocPos() &&
          pointerA.getTokenDocPos() !== -1
        ) {
          labeledBlocks.put(lastPlainLabel, new DocumentPiece(pointerA, lastPointer!));
          // NOTE: upstream line 281 — `//System.out.println(...)` (commented-out).
        }
      }
    }
    return doc;
  }

  /**
   * Set the main segments of the document based on the full text parsing results.
   *
   * Upstream line 297-535.
   */
  static resultSegmentation(doc: Document | null, labeledResult: string, tokenizations: string[]): Document {
    if (doc === null) {
      throw new Error("NullPointerException: Document is null");
    }
    if (doc.getBlocks() === null) {
      throw new Error("NullPointerException: Blocks of the documents are null");
    }
    // NOTE: upstream line 304 — `//System.out.println(tokenizations.toString());` (commented-out).
    // NOTE: upstream lines 305-306 — `// int i = 0;` and `// boolean first = true;` (commented-out).
    const blockHeaders: number[] = [];
    const blockFooters: number[] = [];
    const blockDocumentHeaders: number[] = [];
    const blockSectionTitles: number[] = [];

    // SortedSet<DocumentPiece> — preserved as a sorted array; insertions kept sorted.
    const blockReferences: DocumentPiece[] = [];

    doc.setBibDataSets([]);

    // NOTE: upstream line 316 — `//StringTokenizer st = new StringTokenizer(labeledResult, "\n");` (commented-out).
    const lines = labeledResult.split("\n");

    let currentTag: string | null = null;
    let s2: string | null = null;
    let lastTag: string | null = null;
    let lastPlainTag: string | null = null;

    let p = 0; // index in the results' tokenization (st)
    let blockIndex = 0;

    let bib: BibDataSet | null = null;

    let pointerA: DocumentPointer | null = null;
    // NOTE: upstream line 331 — `// DocumentPointer pointerB = null;` (commented-out).
    let currentPointer: DocumentPointer;
    let lastPointer: DocumentPointer | null = null;

    for (let line of lines) {
      // NOTE: upstream line 337 — `// while (st.hasMoreTokens()) {` (commented-out).

      for (; blockIndex < doc.getBlocks().length - 1; blockIndex++) {
        // NOTE: upstream line 340 — `// int startTok = doc.getBlocks().get(blockIndex).getStartToken();` (commented-out).
        const endTok = doc.getBlocks()[blockIndex]!.getEndToken();
        if (endTok >= p) break;
      }

      const localFeatures: string[] = [];
      let addSpace = false;
      // NOTE: upstream line 351 — `// String tok = st.nextToken().trim();` (commented-out).
      line = line.trim();

      // Manual StringTokenizer-equivalent — split on tab, preserving the
      // upstream `countTokens` semantics for `ll - 1` referencing the last
      // token as the current label.
      const tokens = line.split("\t");
      const ll = tokens.length;
      let j = 0;
      let newLine = false;
      for (const sRaw of tokens) {
        const s = sRaw.trim();
        if (j === 0) {
          s2 = s;
          let strop = false;
          while (!strop && p < tokenizations.length) {
            const tokOriginal = tokenizations[p]!;
            // NOTE: upstream uses bitwise `|` for the boolean OR (line 366-369).
            // Preserved verbatim.
            if (tokOriginal === " " || tokOriginal === "\n" || tokOriginal === "\r" || tokOriginal === "\t") {
              addSpace = true;
              p++;
            } else if (tokOriginal === "") {
              p++;
            } /* NOTE: upstream line 374 — `//if (tokOriginal.equals(s))` (commented-out). */ else {
              strop = true;
            }
          }
        } else if (j === ll - 1) {
          currentTag = s; // current tag
        } else {
          if (s === "LINESTART") {
            newLine = true;
          }
          localFeatures.push(s);
        }
        j++;
      }
      void newLine;

      if (lastTag !== null) {
        if (lastTag.startsWith("I-")) {
          lastPlainTag = lastTag.substring(2, lastTag.length);
        } else {
          lastPlainTag = lastTag;
        }
      }

      let currentPlainTag: string | null = null;
      if (currentTag !== null) {
        if (currentTag.startsWith("I-")) {
          currentPlainTag = currentTag.substring(2, currentTag.length);
        } else {
          currentPlainTag = currentTag;
        }
      }

      currentPointer = new DocumentPointer(doc, blockIndex, p);

      if (lastPlainTag !== null && currentPlainTag !== lastPlainTag && lastPlainTag === "<references>") {
        blockReferences.push(new DocumentPiece(pointerA!, lastPointer!));
        blockReferences.sort((a, b) => a.compareTo(b));
        pointerA = currentPointer;
      }

      if (currentPlainTag === "<header>") {
        if (!blockDocumentHeaders.includes(blockIndex)) {
          blockDocumentHeaders.push(blockIndex);
          // NOTE: upstream line 421 — `//System.out.println(...)` (commented-out).
        }
      } else if (currentPlainTag === "<references>") {
        // NOTE: upstream lines 424-427 — commented-out blockReferences-index-based branch.
        if (currentTag === "I-<references>") {
          pointerA = new DocumentPointer(doc, blockIndex, p);
          if (bib !== null) {
            if (bib.getRawBib() !== null) {
              doc.getBibDataSets()!.push(bib);
              bib = new BibDataSet();
            }
          } else {
            bib = new BibDataSet();
          }
          bib.setRawBib(s2);
        } else {
          if (addSpace) {
            if (bib === null) {
              bib = new BibDataSet();
              bib.setRawBib(" " + s2);
            } else {
              bib.setRawBib((bib.getRawBib() ?? "") + " " + (s2 ?? ""));
            }
          } else {
            if (bib === null) {
              bib = new BibDataSet();
              bib.setRawBib(s2);
            } else {
              bib.setRawBib((bib.getRawBib() ?? "") + (s2 ?? ""));
            }
          }
        }
        // NOTE: upstream lines 458-491 — entire commented-out `<reference_marker>` switch case.
      } else if (currentPlainTag === "<page_footnote>") {
        if (!blockFooters.includes(blockIndex)) {
          blockFooters.push(blockIndex);
          // NOTE: upstream line 495 — `//System.out.println(...)` (commented-out).
        }
      } else if (currentPlainTag === "<page_header>") {
        if (!blockHeaders.includes(blockIndex)) {
          blockHeaders.push(blockIndex);
          // NOTE: upstream line 501 — `//System.out.println(...)` (commented-out).
        }
      } else if (currentPlainTag === "<section>") {
        if (!blockSectionTitles.includes(blockIndex)) {
          blockSectionTitles.push(blockIndex);
          // NOTE: upstream line 507 — `//System.out.println(...)` (commented-out).
        }
      }

      lastTag = currentTag;
      p++;
      lastPointer = currentPointer;
    }

    if (bib !== null) {
      doc.getBibDataSets()!.push(bib);
    }

    if (lastPointer !== null && !lastPointer.equals(pointerA)) {
      if (lastPlainTag === "<references>") {
        blockReferences.push(new DocumentPiece(pointerA!, lastPointer));
        blockReferences.sort((a, b) => a.compareTo(b));
      }
    }

    // NOTE: upstream lines 528-532 — commented-out doc.setBlockHeaders / setBlockFooters /
    // setBlockDocumentHeaders / setBlockReferences / setBlockSectionTitles calls.
    void blockHeaders;
    void blockFooters;
    void blockDocumentHeaders;
    void blockReferences;
    void blockSectionTitles;
    return doc;
  }
}
