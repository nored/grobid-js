// Port of org.grobid.core.engines.ReferenceSegmenterParser.
// Upstream: grobid-core/src/main/java/org/grobid/core/engines/ReferenceSegmenterParser.java
//
// Adaptations:
// - Guava `Function`/`Sets.newTreeSet` are inlined: the inline `function` is
//   ported as a closure; the SortedSet seed becomes a JS `Set` with one entry
//   (TS port of `Document.getDocumentPart` already returns a plain Set).
// - Apache `Pair.of(...)` → our `Pair` class with `getA()/getB()`. To preserve
//   the upstream-facing API of `getLeft()/getRight()` we return a small
//   wrapper object exposing both pairs of accessors.
// - `AbstractParser` is a port stub; see CONVENTIONS.md.

import { GrobidModels } from "../grobid-models.js";
import { Document } from "../document/document.js";
import { DocumentPiece } from "../document/document-piece.js";
import { DocumentPointer } from "../document/document-pointer.js";
import { LabeledReferenceResult } from "./citations/labeled-reference-result.js";
import type { ReferenceSegmenter } from "./citations/reference-segmenter.js";
import { SegmentationLabels } from "./label/segmentation-labels.js";
import { TaggingLabels } from "./label/tagging-labels.js";
import { GenericTaggerUtils } from "./tagging/generic-tagger-utils.js";
import { GrobidCRFEngine } from "./tagging/grobid-crf-engine.js";
import { GrobidException } from "../exceptions/grobid-exception.js";
import { FeatureFactory } from "../features/feature-factory.js";
import { FeaturesVectorReferenceSegmenter } from "../features/features-vector-reference-segmenter.js";
import { Block } from "../layout/block.js";
import type { LayoutToken } from "../layout/layout-token.js";
import { LabeledTokensContainer } from "../tokenization/labeled-tokens-container.js";
import { TaggingTokenSynchronizer } from "../tokenization/tagging-token-synchronizer.js";
import { BoundingBoxCalculator } from "../utilities/bounding-box-calculator.js";
import { GrobidProperties } from "../utilities/grobid-properties.js";
import { TextUtilities } from "../utilities/text-utilities.js";
import { Triple } from "../utilities/triple.js";
import { Pair } from "../utilities/pair.js";
import { getLogger } from "../utilities/logger.js";
// AbstractParser is still a port stub (sibling subagent owns it).
import { AbstractParser } from "./abstract-parser.js";

const LOGGER = getLogger("ReferenceSegmenterParser");

export class ReferenceSegmenterParser extends AbstractParser implements ReferenceSegmenter {
  // projection scale for line length
  private static readonly LINESCALE: number = 10;

  constructor() {
    super(GrobidModels.REFERENCE_SEGMENTER);
  }

  extract(referenceBlock: string): Promise<LabeledReferenceResult[] | null>;
  extract(document: Document): Promise<LabeledReferenceResult[] | null>;
  extract(document: Document, training: boolean): Promise<LabeledReferenceResult[] | null>;
  extract(
    document: Document,
    referencesParts: Set<DocumentPiece> | null,
    training: boolean,
  ): Promise<LabeledReferenceResult[] | null>;
  async extract(
    a: string | Document,
    b?: boolean | Set<DocumentPiece> | null,
    c?: boolean,
  ): Promise<LabeledReferenceResult[] | null> {
    if (typeof a === "string") {
      const res: Document = Document.createFromText(a);
      const piece = new DocumentPiece(
        new DocumentPointer(0, 0, 0),
        new DocumentPointer(0, res.getTokenizations()!.length - 1, res.getTokenizations()!.length - 1),
      );
      return await this.extractInternal(res, new Set<DocumentPiece>([piece]), false);
    }
    // Document overloads
    if (b === undefined) {
      return await this.extract(a, false);
    }
    if (typeof b === "boolean") {
      const doc = a;
      const referencesParts: Set<DocumentPiece> | null = doc.getDocumentPart(SegmentationLabels.REFERENCES);
      return await this.extractInternal(doc, referencesParts, b);
    }
    return await this.extractInternal(a, b as Set<DocumentPiece> | null, c as boolean);
  }

  private async extractInternal(
    doc: Document,
    referencesParts: Set<DocumentPiece> | null,
    training: boolean,
  ): Promise<LabeledReferenceResult[] | null> {
    const featSeg: { getLeft(): string; getRight(): LayoutToken[]; getA(): string; getB(): LayoutToken[] } | null =
      ReferenceSegmenterParser.getReferencesSectionFeatured(doc, referencesParts);
    let res: string | null;
    let tokenizationsReferences: LayoutToken[];
    if (featSeg === null) {
      return null;
    }
    // if featSeg is null, it usually means that no reference segment is found in the
    // document segmentation
    const featureVector: string = featSeg.getLeft();
    tokenizationsReferences = featSeg.getRight();
    try {
      res = await this.labelWithLongSequenceSupport(featureVector);
    } catch (e) {
      throw new GrobidException("Labeling in ReferenceSegmenter fails.", e as Error);
    }
    if (res === null) {
      return null;
    }

    // if we extract for generating training data, we also give back the used features
    const labeled = GenericTaggerUtils.getTokensWithLabelsAndFeatures(res, training);

    return this.getExtractionResult(tokenizationsReferences, labeled);
  }

  /**
   * Label a feature vector, handling long-sequence splitting for DeLFT models.
   * For CRF or short sequences, delegates directly to label().
   * For long DeLFT sequences, splits into overlapping chunks, labels in batch,
   * and reassembles with transition-point detection to avoid breaking labeled fields.
   */
  private async labelWithLongSequenceSupport(featureVector: string): Promise<string> {
    // to support long sequence in case of RNN usage we segment in pieces of less than the
    // max_sequence_length and quite significantly overlapping
    // this does not apply to CRF which can process "infinite" input sequence
    // this is relevant to the reference segmenter RNN model, which is position-free in its
    // application, but could not be generalized to other RNN or transformer model long inputs
    if (GrobidProperties.getGrobidEngine(GrobidModels.REFERENCE_SEGMENTER) === GrobidCRFEngine.DELFT) {
      const featureVectorLines: string[] = featureVector.split("\n");

      let originalMaxSequence = 2000;
      if (
        GrobidProperties.getDelftRuntimeMaxSequenceLength(GrobidModels.REFERENCE_SEGMENTER.getModelName()) !== -1
      ) {
        originalMaxSequence = GrobidProperties.getDelftRuntimeMaxSequenceLength(
          GrobidModels.REFERENCE_SEGMENTER.getModelName(),
        );
      }

      if (featureVectorLines.length < originalMaxSequence || originalMaxSequence < 600) {
        // if the input is lower than max sequence length, no need to segment
        // if the max sequence length is too small, e.g. transformer, we won't be able to manage
        // overlaps adapted to references
        return await this.label(featureVector);
      } else {
        // we adjust max sequence value to take into account 500 token lines overlap
        const maxSequence = Math.max(500, originalMaxSequence - 1000);

        const featureVectorPieces: string[][] = [];
        // segment the input vectors in overlapping sequences, according to the model max_sequence_length parameter
        for (let i = 0; i * maxSequence < featureVectorLines.length; i++) {
          const lowerBound = i * maxSequence;
          // overlapping: this localRes has 500 extra lines after the normal end
          let upperBound = Math.min((i + 1) * maxSequence + 500, featureVectorLines.length);
          if (featureVectorLines.length - lowerBound < originalMaxSequence) upperBound = featureVectorLines.length;

          const featureVectorPiece: string[] = [];
          for (let j = lowerBound; j < upperBound; j++) featureVectorPiece.push(featureVectorLines[j]!);
          featureVectorPieces.push(featureVectorPiece);

          if (upperBound === featureVectorLines.length) break;
        }

        // label every pieces in batch
        const allRes: string[] = [];
        const allVectors: string[] = [];
        for (const featureVectorPiece of featureVectorPieces) {
          const localFeatureVector: string[] = [];
          for (let j = 0; j < featureVectorPiece.length; j++) {
            localFeatureVector.push(featureVectorPiece[j]!, "\n");
          }
          allVectors.push(localFeatureVector.join(""));
        }

        // parallel labeling of the input segments
        const fullRes = await this.label(allVectors);

        // segment this result to get back the input chunk alignment (with extra 500 overlapping lines)
        const fullResLines: string[] = fullRes.split("\n");
        let pos = 0;
        for (const featureVectorPiece of featureVectorPieces) {
          const localRes: string[] = [];
          const localSize = featureVectorPiece.length;
          for (let i = pos; i < pos + localSize; i++) {
            localRes.push(fullResLines[i]!, "\n");
          }
          allRes.push(localRes.join(""));
          pos += localSize;
        }

        // combine results and reconnect smoothly overlaps
        const resBuilder: string[] = [];
        let previousTransitionPos = 0;
        for (let i = 0; i < allRes.length; i++) {
          const localRes = allRes[i]!;
          const localResLines: string[] = localRes.split("\n");
          let transitionPos = localResLines.length;
          if (i !== allRes.length - 1) {
            // in the trailing redundant part (500 last lines), we identify the line index
            // of the last "closing" label, this is the point where we will reconnect the
            // labeled segments to avoid breaking a labeled field

            for (let k = localResLines.length - 1; k >= 0; k--) {
              if (localResLines.length - k === 500) {
                // this is the max overlap, we don't go beyond!
                transitionPos = k;
                break;
              }

              const line = localResLines[k]!;
              if (
                line.endsWith(TaggingLabels.GROBID_START_ENTITY_LABEL_PREFIX + "<label>") ||
                line.endsWith(TaggingLabels.GROBID_START_ENTITY_LABEL_PREFIX + "<reference>")
              ) {
                // we can stop the line before this one
                transitionPos = k;
                break;
              }
            }
          }
          // else: we are at the last chunk, so we take the content until the very end

          const selectedlocalResLines: string[] = [];
          for (let j = previousTransitionPos; j < transitionPos; j++) {
            if (j === previousTransitionPos && previousTransitionPos !== 0) {
              // we want to be sure to have a starting label
              let localLine = localResLines[j]!;
              if (localLine.indexOf(TaggingLabels.GROBID_START_ENTITY_LABEL_PREFIX) === -1) {
                localLine = localLine.replace("<label>", TaggingLabels.GROBID_START_ENTITY_LABEL_PREFIX + "<label>");
                localLine = localLine.replace(
                  "<reference>",
                  TaggingLabels.GROBID_START_ENTITY_LABEL_PREFIX + "<reference>",
                );
              }
              selectedlocalResLines.push(localLine);
            } else if (j === previousTransitionPos && previousTransitionPos === 0 && i !== 0) {
              // previousTransitionPos is 0 and we are not at the first segment: we had a non overlapping
              // transition, we might want to avoid a starting label at this point
              let localLine = localResLines[j]!;
              if (localLine.indexOf(TaggingLabels.GROBID_START_ENTITY_LABEL_PREFIX) !== -1) {
                localLine = localLine.replace(
                  TaggingLabels.GROBID_START_ENTITY_LABEL_PREFIX + "<label>",
                  "<label>",
                );
                localLine = localLine.replace(
                  TaggingLabels.GROBID_START_ENTITY_LABEL_PREFIX + "<reference>",
                  "<reference>",
                );
              }
              selectedlocalResLines.push(localLine);
            } else {
              selectedlocalResLines.push(localResLines[j]!);
            }
          }
          for (const localResLine of selectedlocalResLines) resBuilder.push(localResLine, "\n");

          previousTransitionPos = transitionPos - maxSequence;
        }
        return resBuilder.join("");
      }
    } else {
      return await this.label(featureVector);
    }
  }

  private getExtractionResult(
    tokenizations: LayoutToken[],
    labeled: (Triple<string, string, string | null> | null)[],
  ): LabeledReferenceResult[] {
    const resultList: LabeledReferenceResult[] = [];
    const reference: string[] = [];
    const referenceTokens: LayoutToken[] = [];
    const features: string[] = [];
    const referenceLabel: string[] = [];

    const synchronizer = new TaggingTokenSynchronizer(GrobidModels.REFERENCE_SEGMENTER, labeled, tokenizations);

    // The Java upstream uses a Guava `Function<LabeledTokensContainer, Void>` to
    // encapsulate the "flush current accumulators into a new result and reset"
    // logic at the start of each new labeled span.
    const apply = (container: LabeledTokensContainer): void => {
      void container;
      features.push(container.getFeatureString() ?? "");
      features.push("\n");
      if (container.isBeginning()) {
        if (reference.join("").length !== 0) {
          const labelStr = referenceLabel.join("").trim();
          resultList.push(
            new LabeledReferenceResult(
              labelStr.length === 0 ? (null as unknown as string) : labelStr,
              reference.join("").trim(),
              [...referenceTokens],
              features.join(""),
              BoundingBoxCalculator.calculate(referenceTokens),
            ),
          );
          reference.length = 0;
          referenceLabel.length = 0;
          features.length = 0;
          referenceTokens.length = 0;
        }
      }
    };

    const iterator = synchronizer;
    while (iterator.hasNext()) {
      const next = iterator.next();
      const container: LabeledTokensContainer | null = next.value;
      if (container === null) continue;
      const tok: string = container.getToken();
      const plainLabel: string = container.getPlainLabel();
      if ("<label>" === plainLabel) {
        apply(container);
        referenceLabel.push(tok);

        if (container.isTrailingSpace() || container.isTrailingNewLine()) {
          referenceLabel.push(" ");
        }
      } else if (plainLabel === "<reference>") {
        apply(container);
        reference.push(tok);

        if (container.isTrailingSpace()) {
          reference.push(" ");
        }
        if (container.isTrailingNewLine()) {
          reference.push("\n");
        }

        for (const t of container.getLayoutTokens()) referenceTokens.push(t);
      } else if (plainLabel === "<other>") {
        // NOP
      }

      // Handle last one.
      if (!iterator.hasNext()) {
        const labelStr2 = referenceLabel.join("").trim();
        resultList.push(
          new LabeledReferenceResult(
            labelStr2.length === 0 ? (null as unknown as string) : labelStr2,
            reference.join("").trim(),
            referenceTokens,
            features.join(""),
            BoundingBoxCalculator.calculate(referenceTokens),
          ),
        );
        reference.length = 0;
        referenceLabel.length = 0;
      }
    }

    return resultList;
  }

  async createTrainingData(doc: Document, id: number): Promise<Pair<string, string> | null> {
    const referencesParts: Set<DocumentPiece> | null = doc.getDocumentPart(SegmentationLabels.REFERENCES);
    const featSeg = ReferenceSegmenterParser.getReferencesSectionFeatured(doc, referencesParts);
    let res: string | null;
    let tokenizations: LayoutToken[];
    if (featSeg === null) {
      return null;
    }
    // if featSeg is null, it usually means that no reference segment is found in the
    // document segmentation
    const featureVector: string = featSeg.getLeft();
    tokenizations = featSeg.getRight();
    try {
      res = await this.labelWithLongSequenceSupport(featureVector);
    } catch (e) {
      throw new GrobidException("Sequence labeling in ReferenceSegmenter fails.", e as Error);
    }
    if (res === null) {
      return null;
    }
    const labeled = GenericTaggerUtils.getTokensAndLabels(res);
    const sb: string[] = [];

    //noinspection StringConcatenationInsideStringBufferAppend
    sb.push(
      "<tei xml:space=\"preserve\">\n" +
        "    <teiHeader>\n" +
        "        <fileDesc xml:id=\"_" +
        id +
        "\"/>\n" +
        "    </teiHeader>\n" +
        "    <text xml:lang=\"en\">\n" +
        "        <listBibl>\n",
    );

    let tokPtr = 0;
    let addSpace = false;
    let addEOL = false;
    let lastTag: string | null = null;
    let refOpen = false;
    for (const l of labeled) {
      if (l === null) continue;
      const tok: string = l.getA();
      const label: string = l.getB();

      let tokPtr2 = tokPtr;
      for (; tokPtr2 < tokenizations.length; tokPtr2++) {
        if (tokenizations[tokPtr2]!.t() === " ") {
          addSpace = true;
        } else if (tokenizations[tokPtr2]!.t() === "\n" || tokenizations[tokPtr]!.t() === "\r") {
          addEOL = true;
        } else {
          break;
        }
      }
      tokPtr = tokPtr2;

      if (tokPtr >= tokenizations.length) {
        LOGGER.error(
          "Implementation error: Reached the end of tokenizations, but current token is " + tok,
        );
        // we add a space to avoid concatenated text
        addSpace = true;
      } else {
        let tokenizationToken: string | null = tokenizations[tokPtr]!.getText();

        if (tokPtr !== tokenizations.length && tokenizationToken !== tok) {
          // and we add a space by default to avoid concatenated text
          addSpace = true;
          if (tokenizationToken !== null && !tok.startsWith(tokenizationToken)) {
            // this is a very exceptional case due to a sequence of accent/diacresis, in this case we skip
            // a shift in the tokenizations list and continue on the basis of the labeled token
            // we check one ahead
            tokPtr++;
            tokenizationToken = tokenizations[tokPtr]!.getText();
            if (tok !== tokenizationToken) {
              // we try another position forward (second hope!)
              tokPtr++;
              tokenizationToken = tokenizations[tokPtr]!.getText();
              if (tok !== tokenizationToken) {
                // we try another position forward (last hope!)
                tokPtr++;
                tokenizationToken = tokenizations[tokPtr]!.getText();
                if (tok !== tokenizationToken) {
                  // we return to the initial position
                  tokPtr = tokPtr - 3;
                  tokenizationToken = tokenizations[tokPtr]!.getText();
                  LOGGER.error(
                    "Implementation error, tokens out of sync: " +
                      tokenizationToken +
                      " != " +
                      tok +
                      ", at position " +
                      tokPtr,
                  );
                }
              }
            }
          }
          // note: if the above condition is true, this is an exceptional case due to a
          // sequence of accent/diacresis and we can go on as a full string match
        }
      }

      const plainLabel = GenericTaggerUtils.getPlainLabel(label);

      const tagClosed = lastTag !== null && this.testClosingTag(sb, label, lastTag, addSpace, addEOL);

      if (tagClosed) {
        addSpace = false;
        addEOL = false;
      }
      if (tagClosed && lastTag === "<reference>") {
        refOpen = false;
      }
      let output: string | null;
      let field: string;
      if (refOpen) {
        field = "<label>";
      } else {
        field = "<bibl><label>";
      }
      output = this.writeField(label, lastTag, tok, "<label>", field, addSpace, addEOL, 2);
      if (output !== null) {
        sb.push(output);
        refOpen = true;
      } else {
        if (refOpen) {
          field = "";
        } else {
          field = "<bibl>";
        }
        output = this.writeField(label, lastTag, tok, "<reference>", field, addSpace, addEOL, 2);
        if (output !== null) {
          sb.push(output);
          refOpen = true;
        } else {
          output = this.writeField(label, lastTag, tok, "<other>", "", addSpace, addEOL, 2);
          if (output !== null) {
            sb.push(output);
            refOpen = false;
          }
        }
      }

      lastTag = plainLabel ?? null;
      addSpace = false;
      addEOL = false;
      tokPtr++;
    }

    if (refOpen) {
      sb.push("</bibl>");
    }

    sb.push("\n        </listBibl>\n" + "    </text>\n" + "</tei>\n");

    return new Pair<string, string>(sb.join(""), featureVector);
  }

  private testClosingTag(
    buffer: string[],
    currentTag: string,
    lastTag: string,
    addSpace: boolean,
    addEOL: boolean,
  ): boolean {
    let res = false;
    if (currentTag !== lastTag) {
      res = true;
      // we close the current tag
      if (lastTag === "<other>") {
        if (addEOL) buffer.push("<lb/>");
        if (addSpace) buffer.push(" ");
        buffer.push("\n");
      } else if (lastTag === "<label>") {
        buffer.push("</label>");
        if (addEOL) buffer.push("<lb/>");
        if (addSpace) buffer.push(" ");
      } else if (lastTag === "<reference>") {
        if (addEOL) buffer.push("<lb/>");
        if (addSpace) buffer.push(" ");
        buffer.push("</bibl>\n");
      } else {
        res = false;
      }
    }
    return res;
  }

  private writeField(
    currentTag: string,
    lastTag: string | null,
    token: string,
    field: string,
    outField: string,
    addSpace: boolean,
    addEOL: boolean,
    nbIndent: number,
  ): string | null {
    let result: string | null = null;
    if (currentTag.endsWith(field)) {
      if (currentTag.endsWith("<other>")) {
        result = "";
        if (currentTag === "I-<other>") {
          result += "\n";
          for (let i = 0; i < nbIndent; i++) {
            result += "    ";
          }
        }
        if (addEOL) result += "<lb/>";
        if (addSpace) result += " ";
        result += TextUtilities.HTMLEncode(token);
      } else if (lastTag !== null && currentTag.endsWith(lastTag)) {
        result = "";
        if (addEOL) result += "<lb/>";
        if (addSpace) result += " ";
        if (currentTag.startsWith("I-")) result += outField;
        result += TextUtilities.HTMLEncode(token);
      } else {
        result = "";
        if (outField.length > 0) {
          for (let i = 0; i < nbIndent; i++) {
            result += "    ";
          }
        }
        if (addEOL) result += "<lb/>";
        if (addSpace) result += " ";
        result += outField + TextUtilities.HTMLEncode(token);
      }
    }
    return result;
  }

  public static getReferencesSectionFeatured(
    doc: Document,
    referencesParts: Set<DocumentPiece> | null,
  ): { getLeft(): string; getRight(): LayoutToken[]; getA(): string; getB(): LayoutToken[] } | null {
    if (referencesParts === null || referencesParts.size === 0) {
      return null;
    }
    const featureFactory = FeatureFactory.getInstance();
    const blocks: Block[] | null = doc.getBlocks();
    if (blocks === null || blocks.length === 0) {
      return null;
    }

    const citations: string[] = [];
    let newline: boolean;
    let n: number; // overall token number

    let features: FeaturesVectorReferenceSegmenter;
    let previousFeatures: FeaturesVectorReferenceSegmenter | null = null;
    let endblock: boolean;
    let startblock: boolean;
    //int mm = 0; // token position in the sentence
    let nn: number; // token position in the line
    let lineStartX = Number.NaN;
    let indented = false;

    const tokenizationsReferences: LayoutToken[] = [];
    const tokenizations: LayoutToken[] | null = doc.getTokenizations();

    let maxLineLength = 1;
    //List<Integer> lineLengths = new ArrayList<Integer>();
    let currentLineLength = 0;
    //int lineIndex = 0;

    // we calculate current max line length and intialize the body tokenization structure
    for (const docPiece of referencesParts) {
      const dp1 = docPiece.getLeft();
      const dp2 = docPiece.getRight();

      const tokens0 = dp1.getTokenDocPos();
      const tokene = dp2.getTokenDocPos();
      for (let i = tokens0; i <= tokene; i++) {
        tokenizationsReferences.push(tokenizations![i]!);
        currentLineLength += tokenizations![i]!.getText()!.length;
        if (tokenizations![i]!.t() === "\n" || tokenizations![i]!.t() === "\r") {
          //lineLengths.add(currentLineLength);
          if (currentLineLength > maxLineLength) maxLineLength = currentLineLength;
          currentLineLength = 0;
        }
      }
    }

    for (const docPiece of referencesParts) {
      const dp1 = docPiece.getLeft();
      const dp2 = docPiece.getRight();

      /*for(int i=dp1.getTokenDocPos(); i<dp2.getTokenDocPos(); i++) {
      System.out.print(tokenizations.get(i));
    }
  System.out.println("");
  */
      //currentLineLength = lineLengths.get(lineIndex);
      nn = 0;
      let tokenIndex = 0;
      let blockIndex = dp1.getBlockPtr();
      let block: Block | null = null;
      let tokens: LayoutToken[] | null;
      let previousNewline = true;
      currentLineLength = 0;
      let currentLineProfile: string | null = null;
      for (n = dp1.getTokenDocPos(); n <= dp2.getTokenDocPos(); n++) {
        const text: string | null = tokenizations![n]!.getText();

        if (text === null) {
          continue;
        }

        // set corresponding block
        if (block !== null && n > block.getEndToken()) {
          blockIndex++;
          tokenIndex = 0;
          currentLineLength = 0;
          currentLineProfile = null;
        }

        if (blockIndex < blocks.length) {
          block = blocks[blockIndex]!;
          if (n === block.getStartToken()) {
            startblock = true;
            endblock = false;
          } else if (n === block.getEndToken()) {
            startblock = false;
            endblock = true;
          } else {
            startblock = false;
            endblock = false;
          }
        } else {
          block = null;
          startblock = false;
          endblock = false;
        }
        // set corresponding token
        if (block !== null) tokens = block.getTokens();
        else tokens = null;

        if (text === "\n" || text === "\r") {
          previousNewline = true;
          nn = 0;
          currentLineLength = 0;
          currentLineProfile = null;
          //lineIndex++;
          //currentLineLength = lineLengths.get(lineIndex);
          continue;
        } else {
          newline = false;
          nn += text.length; // +1 for segmentation symbol
        }

        if (text === " " || text === "\t") {
          nn++;
          continue;
        }

        if (text.trim().length === 0) {
          continue;
        }

        let token: LayoutToken | null = null;
        if (tokens !== null) {
          let i = tokenIndex;
          while (i < tokens.length) {
            token = tokens[i]!;
            if (text === token.getText()) {
              tokenIndex = i;
              break;
            }
            i++;
          }
        }

        if (previousNewline) {
          newline = true;
          previousNewline = false;
          if (token !== null && previousFeatures !== null) {
            const previousLineStartX = lineStartX;
            lineStartX = token.getX();
            const characterWidth = token.width / token.getText()!.length;
            if (!Number.isNaN(previousLineStartX)) {
              // Indentation if line start is > 1 character width to the right of previous line start
              if (lineStartX - previousLineStartX > characterWidth) indented = true;
              // Indentation ends if line start is > 1 character width to the left of previous line start
              else if (previousLineStartX - lineStartX > characterWidth) indented = false;
              // Otherwise indentation is unchanged
            }
          }
        }

        if (TextUtilities.filterLine(text)) {
          continue;
        }

        features = new FeaturesVectorReferenceSegmenter();
        features.token = token;
        features.string = text;

        if (newline) {
          features.lineStatus = "LINESTART";
        }
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

        if (n === 0 || previousNewline) {
          features.lineStatus = "LINESTART";
          if (n === 0) features.blockStatus = "BLOCKSTART";
          nn = 0;
        }

        if (indented) {
          features.alignmentStatus = "LINEINDENT";
        } else {
          features.alignmentStatus = "ALIGNEDLEFT";
        }

        {
          // look ahead...
          let endline = true;

          let ii = 1;
          let endloop = false;
          let accumulated = text;
          while (n + ii < tokenizations!.length && !endloop) {
            const tok: string | null = tokenizations![n + ii]!.getText();
            if (tok !== null) {
              if (currentLineProfile === null) accumulated += tok;
              if (tok === "\n" || tok === "\r") {
                endloop = true;
                if (currentLineLength === 0) {
                  currentLineLength = accumulated.length;
                }
                if (currentLineProfile === null) {
                  currentLineProfile = TextUtilities.punctuationProfile(accumulated);
                }
              } else if (tok !== " " && tok !== "\t") {
                endline = false;
              } else {
                if (TextUtilities.filterLine(tok)) {
                  endloop = true;
                  if (currentLineLength === 0) {
                    currentLineLength = accumulated.length;
                  }
                  if (currentLineProfile === null) {
                    currentLineProfile = TextUtilities.punctuationProfile(accumulated);
                  }
                }
              }
            }

            if (n + ii >= tokenizations!.length - 1) {
              endblock = true;
              endline = true;
            }

            if (endline && block !== null && n + ii === block.getEndToken()) {
              endblock = true;
            }
            ii++;
          }

          if (!endline && !newline) {
            features.lineStatus = "LINEIN";
          } else if (!newline) {
            features.lineStatus = "LINEEND";
            previousNewline = true;
          }

          if (startblock) {
            features.blockStatus = "BLOCKSTART";
          }
          if (!endblock && features.blockStatus === null) features.blockStatus = "BLOCKIN";
          else if (features.blockStatus === null) {
            features.blockStatus = "BLOCKEND";
          }
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

        if (featureFactory.test_common(text)) {
          features.commonName = true;
        }

        if (featureFactory.test_names(text)) {
          features.properName = true;
        }

        if (featureFactory.test_month(text)) {
          features.month = true;
        }

        const m = featureFactory.isDigit.exec(text);
        if (m !== null) {
          features.digit = "ALLDIGIT";
        }

        const m2 = featureFactory.year.exec(text);
        if (m2 !== null) {
          features.year = true;
        }

        const m3 = featureFactory.email.exec(text);
        if (m3 !== null) {
          features.email = true;
        }

        const m4 = featureFactory.http.exec(text);
        if (m4 !== null) {
          features.http = true;
        }

        if (token !== null && token.isBold()) features.bold = true;

        if (token !== null && token.isItalic()) features.italic = true;

        if (features.capitalisation === null) features.capitalisation = "NOCAPS";

        if (features.digit === null) features.digit = "NODIGIT";

        if (features.punctType === null) features.punctType = "NOPUNCT";
        //System.out.println(nn + "\t" + currentLineLength + "\t" + maxLineLength);
        features.lineLength = featureFactory.linearScaling(
          currentLineLength,
          maxLineLength,
          ReferenceSegmenterParser.LINESCALE,
        );

        features.relativePosition = featureFactory.linearScaling(
          nn,
          currentLineLength,
          ReferenceSegmenterParser.LINESCALE,
        );

        features.punctuationProfile = currentLineProfile;

        if (previousFeatures !== null) citations.push(previousFeatures.printVector() ?? "");
        //mm++;
        previousFeatures = features;
      }
    }
    if (previousFeatures !== null) citations.push(previousFeatures.printVector() ?? "");

    const left = citations.join("");
    const right = tokenizationsReferences;
    return {
      getLeft(): string {
        return left;
      },
      getRight(): LayoutToken[] {
        return right;
      },
      getA(): string {
        return left;
      },
      getB(): LayoutToken[] {
        return right;
      },
    };
  }
}
