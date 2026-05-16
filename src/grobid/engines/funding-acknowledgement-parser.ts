// Port of org.grobid.core.engines.FundingAcknowledgementParser.
// Upstream: grobid-core/src/main/java/org/grobid/core/engines/FundingAcknowledgementParser.java
//
// Adaptations:
// - Apache Commons `MutablePair<L,R>` is a 2-field record with mutable
//   left/right; ported as a small local helper class with `setLeft`/`setRight`.
//   For external imports we use the ported `Pair<A, B>` from `utilities/pair.ts`
//   when immutable semantics suffice; `MutablePair`/`MutableTriple` are
//   declared here.
// - Apache `Pair.of(a, b)` → `new Pair(a, b)` (the local Pair has no `of`).
// - Apache `CollectionUtils.isEmpty(list)` → `list == null || list.length === 0`.
// - Apache `StringUtils.isNotBlank` / `isNotEmpty` → inline null/empty checks.
// - Apache `StringUtils.isBlank` → inline `s === null || s.trim().length === 0`.
// - `Iterables.getLast(tokens)` → `tokens[tokens.length-1]` (mirror Guava).
// - `nu.xom` operations not provided by the local XmlBuilderUtils (XPath
//   `query()`, `removeAttribute`, `replaceChild`) are emulated by local
//   helpers that walk the children directly.
// - `nu.xom.Builder.build(string, null)` → `XmlBuilderUtils.fromString(string)`.

import { Affiliation } from "../data/affiliation.js";
import { Funder } from "../data/funder.js";
import { Funding } from "../data/funding.js";
import { Person } from "../data/person.js";
import { AnnotatedXMLElement } from "../data/annotated-xml-element.js";
import { FundingAcknowledgmentParse } from "../data/funding-acknowledgment-parse.js";
import { AbstractParser } from "./abstract-parser.js";
import { Engine } from "./engine.js";
import { GrobidAnalyzer } from "../analyzers/grobid-analyzer.js";
import {
  Attribute,
  Element,
  Node,
  Text,
  XmlBuilderUtils,
} from "../document/xml/xml-builder-utils.js";
import type { GrobidAnalysisConfig } from "./config/grobid-analysis-config.js";
import { GrobidException } from "../exceptions/grobid-exception.js";
import { FeaturesVectorFunding } from "../features/features-vector-funding.js";
import type { GrobidModel } from "../grobid-model.js";
import { GrobidModels } from "../grobid-models.js";
import { BoundingBox } from "../layout/bounding-box.js";
import type { LayoutToken } from "../layout/layout-token.js";
import { VectorGraphicBoxCalculator } from "../layout/vector-graphic-box-calculator.js";
import { TaggingTokenCluster } from "../tokenization/tagging-token-cluster.js";
import { TaggingTokenClusteror } from "../tokenization/tagging-token-clusteror.js";
import { GenericTaggerUtils } from "./tagging/generic-tagger-utils.js";
import type { TaggingLabel } from "./label/tagging-label.js";
import { TaggingLabels } from "./label/tagging-labels.js";
import { LayoutTokensUtil } from "../utilities/layout-tokens-util.js";
import { OffsetPosition } from "../utilities/offset-position.js";
import { Pair } from "../utilities/pair.js";
import { SentenceUtilities } from "../utilities/sentence-utilities.js";
import { TextUtilities } from "../utilities/text-utilities.js";
import { UnicodeUtil } from "../utilities/unicode-util.js";
import { getLogger } from "../utilities/logger.js";

const LOGGER = getLogger("FundingAcknowledgementParser");

// Local aliases for `import static TaggingLabels.*` in upstream.
const FUNDING_OTHER = TaggingLabels.FUNDING_OTHER;
const FUNDING_FUNDER_NAME = TaggingLabels.FUNDING_FUNDER_NAME;
const FUNDING_GRANT_NAME = TaggingLabels.FUNDING_GRANT_NAME;
const FUNDING_PERSON = TaggingLabels.FUNDING_PERSON;
const FUNDING_AFFILIATION = TaggingLabels.FUNDING_AFFILIATION;
const FUNDING_INSTITUTION = TaggingLabels.FUNDING_INSTITUTION;
const FUNDING_INFRASTRUCTURE = TaggingLabels.FUNDING_INFRASTRUCTURE;
const FUNDING_GRANT_NUMBER = TaggingLabels.FUNDING_GRANT_NUMBER;
const FUNDING_PROGRAM_NAME = TaggingLabels.FUNDING_PROGRAM_NAME;
const FUNDING_PROJECT_NAME = TaggingLabels.FUNDING_PROJECT_NAME;

// Shortcut for the `teiElement` static.
function teiElement(name: string): Element {
  return XmlBuilderUtils.teiElement(name);
}

/**
 * Mirrors Apache Commons `MutablePair<L,R>`.
 */
export class MutablePair<L, R> {
  left: L;
  right: R;
  constructor(left: L, right: R) {
    this.left = left;
    this.right = right;
  }
  static of<L, R>(left: L, right: R): MutablePair<L, R> {
    return new MutablePair<L, R>(left, right);
  }
  getLeft(): L {
    return this.left;
  }
  getRight(): R {
    return this.right;
  }
  setLeft(left: L): void {
    this.left = left;
  }
  setRight(right: R): void {
    this.right = right;
  }
}

/**
 * Mirrors Apache Commons `MutableTriple<L,M,R>`.
 */
export class MutableTriple<L, M, R> {
  left: L;
  middle: M;
  right: R;
  constructor(left: L, middle: M, right: R) {
    this.left = left;
    this.middle = middle;
    this.right = right;
  }
  static of<L, M, R>(left: L, middle: M, right: R): MutableTriple<L, M, R> {
    return new MutableTriple<L, M, R>(left, middle, right);
  }
  getLeft(): L {
    return this.left;
  }
  getMiddle(): M {
    return this.middle;
  }
  getRight(): R {
    return this.right;
  }
  setLeft(v: L): void {
    this.left = v;
  }
  setMiddle(v: M): void {
    this.middle = v;
  }
  setRight(v: R): void {
    this.right = v;
  }
}

/** XOM `Element.query("//local")` — descendant-or-self elements with a given local name. */
function queryDescendantElements(root: Node, localName: string): Element[] {
  const out: Element[] = [];
  const stack: Node[] = [root];
  while (stack.length > 0) {
    const n = stack.shift()!;
    if (n instanceof Element) {
      if (n.getLocalName() === localName) out.push(n);
      for (let i = 0; i < n.getChildCount(); i++) {
        stack.push(n.getChild(i));
      }
    }
  }
  return out;
}

/** XOM `Element.removeAttribute(attr)`. */
function removeAttribute(el: Element, attr: Attribute): void {
  // The local Element has no removeAttribute, but the internal attributes
  // list is mutated only via addAttribute. We work around by re-building
  // the attribute list excluding the target attribute via reflection on
  // the internal field.
  const internal = el as unknown as { attributes: Attribute[] };
  const idx = internal.attributes.indexOf(attr);
  if (idx >= 0) {
    internal.attributes.splice(idx, 1);
  } else {
    // Fall back to matching by qualified name.
    const qname = attr.getQualifiedName();
    for (let i = 0; i < internal.attributes.length; i++) {
      if (internal.attributes[i]!.getQualifiedName() === qname) {
        internal.attributes.splice(i, 1);
        return;
      }
    }
  }
}

/** XOM `Element.replaceChild(oldChild, newChild)`. */
function replaceChild(parent: Element, oldChild: Node, newChild: Node): void {
  const internal = parent as unknown as { children: Node[] };
  const idx = internal.children.indexOf(oldChild);
  if (idx < 0) {
    throw new Error("NoSuchChildException");
  }
  // Detach the new child from any previous parent.
  if (newChild.parent !== null) newChild.detach();
  internal.children[idx] = newChild;
  newChild.parent = parent as unknown as Element;
  oldChild.parent = null;
}

/** Mirrors `StringUtils.isNotBlank`. */
function isNotBlank(s: string | null | undefined): boolean {
  return s !== null && s !== undefined && s.trim().length > 0;
}

/** Mirrors `StringUtils.isNotEmpty`. */
function isNotEmpty<T>(list: T[] | null | undefined): boolean {
  return list !== null && list !== undefined && list.length > 0;
}

/** Mirrors `StringUtils.isBlank`. */
// kept for symmetry, unused below.
// function isBlank(s: string | null | undefined): boolean {
//   return s === null || s === undefined || s.trim().length === 0;
// }

export class FundingAcknowledgementParser extends AbstractParser {
  // package-private (default) constructor in upstream.
  constructor();
  constructor(model: GrobidModel);
  constructor(model?: GrobidModel) {
    super(model ?? GrobidModels.FUNDING_ACKNOWLEDGEMENT);
  }

  private async processing(
    tokenizationFunding: LayoutToken[],
    _config: GrobidAnalysisConfig,
  ): Promise<MutablePair<AnnotatedXMLElement[], FundingAcknowledgmentParse> | null> {
    if (!isNotEmpty(tokenizationFunding)) {
      return null;
    }
    let res: string | null;
    try {
      const featureVector = FeaturesVectorFunding.addFeatures(tokenizationFunding, null);
      res = await this.label(featureVector);
    } catch (e) {
      throw new GrobidException("CRF labeling with table model fails.", e);
    }

    if (res === null) {
      return null;
    }
    return this.getExtractionResult(tokenizationFunding, res);
  }

  /**
   * For convenience, a processing method taking a raw string as input.
   * Tokenization is done with the default Grobid analyzer triggered by the identified language.
   */
  async processingText(
    text: string,
    config: GrobidAnalysisConfig,
  ): Promise<MutablePair<Element, MutableTriple<Funding[], Person[], Affiliation[]>> | null> {
    text = UnicodeUtil.normaliseText(text) ?? "";
    //        List<LayoutToken> tokenizationFunding = GrobidAnalyzer.getInstance().tokenizeWithLayoutToken(text);
    //        MutablePair<List<AnnotatedXMLElement>, FundingAcknowledgmentParse> results = processing(tokenizationFunding, config);
    //        MutableTriple<List<Funding>, List<Person>, List<Affiliation>> entities = MutableTriple.of(results.getRight().getFundings(), results.getRight().getPersons(), results.getRight().getAffiliations());
    //        List<AnnotatedXMLElement> annotations = results.getLeft();

    const outputParagraph: Element = teiElement("p");
    outputParagraph.appendChild(text);

    if (config.isWithSentenceSegmentation()) {
      const theSentences: OffsetPosition[] =
        SentenceUtilities.getInstance().runSentenceDetection(text) ?? [];

      // update the xml paragraph element
      let pos = 0;
      let posInSentence = 0;
      for (let i = 0; i < theSentences.length; i++) {
        pos = theSentences[i]!.start;
        posInSentence = 0;
        const sentenceElement = teiElement("s");

        if (pos + posInSentence <= theSentences[i]!.end) {
          let localTextChunk = text.substring(pos + posInSentence, theSentences[i]!.end);
          localTextChunk = XmlBuilderUtils.stripNonValidXMLCharacters(localTextChunk);
          sentenceElement.appendChild(localTextChunk);
          outputParagraph.appendChild(sentenceElement);
        }
      }

      for (let i = outputParagraph.getChildCount() - 1; i >= 0; i--) {
        const theNode = outputParagraph.getChild(i);
        if (theNode instanceof Text) {
          outputParagraph.removeChild(theNode);
        } else if (theNode instanceof Element) {
          if (theNode.getLocalName() !== "s") {
            outputParagraph.removeChild(theNode);
          }
        }
      }
    }

    return await this.processingXmlFragment(outputParagraph.toXML(), config);
  }

  /**
   * This method takes in input a tokenized text, a set of annotations and a root element and attach a list of nodes
   * under the root where the text is combined with the annotations
   */
  protected static injectedAnnotationsInNode(
    tokenizationFunding: LayoutToken[],
    annotations: Pair<OffsetPosition, Element>[],
    rootElement: Element,
  ): Element {
    let pos = 0;
    for (const annotation of annotations) {
      const annotationPosition = annotation.getA();
      const annotationContentElement = annotation.getB();

      const before = tokenizationFunding.slice(pos, annotationPosition.start);
      const clusterContentBefore = LayoutTokensUtil.toText(before);

      if (isNotEmpty(before) && before[0]!.getText() === " ") {
        rootElement.appendChild(new Text(" "));
      }

      rootElement.appendChild(clusterContentBefore);

      pos = annotationPosition.end;
      rootElement.appendChild(annotationContentElement);
    }

    // add last chunk of paragraph stuff (or whole paragraph if no note callout matching)
    const remaining = tokenizationFunding.slice(pos, tokenizationFunding.length);
    const remainingClusterContent = LayoutTokensUtil.normalizeDehyphenizeText(remaining);

    if (isNotEmpty(remaining) && remaining[0]!.getText() === " ") {
      rootElement.appendChild(new Text(" "));
    }

    rootElement.appendChild(remainingClusterContent);

    return rootElement;
  }

  /**
   * For convenience, a processing method taking an TEI XML segment as input - only paragraphs (Element p)
   * will be processed in this segment and paragraph element will be replaced with the processed content.
   * Resulting entities are relative to the whole processed XML segment.
   *
   * Tokenization is done with the default Grobid analyzer triggered by the identified language.
   */
  async processingXmlFragment(
    tei: string,
    config: GrobidAnalysisConfig,
  ): Promise<MutablePair<Element, MutableTriple<Funding[], Person[], Affiliation[]>> | null> {
    let globalResult: MutablePair<Element, MutableTriple<Funding[], Person[], Affiliation[]>> | null = null;
    try {
      tei = tei.split(' xmlns="http://www.tei-c.org/ns/1.0"').join("");

      //System.out.println(tei);
      const rootElementStatement = XmlBuilderUtils.fromString(tei);

      // get the paragraphs
      const paragraphs: Element[] = queryDescendantElements(rootElementStatement, "p");

      const sentenceSegmentation = config.isWithSentenceSegmentation();

      for (const paragraph of paragraphs) {
        const paragraphText: string = paragraph.getValue();
        const analyzer = GrobidAnalyzer.getInstance();
        const tokenizationFunding: LayoutToken[] = analyzer.tokenizeWithLayoutToken(paragraphText);

        const localResult = await this.processing(tokenizationFunding, config);

        if (localResult === null || !isNotEmpty(localResult.left)) {
          continue;
        }
        let annotations: AnnotatedXMLElement[] = localResult.left;
        const localEntities = localResult.right;

        const annotationsPositionTokens: OffsetPosition[] = annotations.map((a) =>
          a.getOffsetPosition(),
        );

        const annotationsPositionText: OffsetPosition[] = TextUtilities.matchTokenAndString(
          tokenizationFunding,
          paragraphText,
          annotationsPositionTokens,
        );
        const annotationsWithPosRefToText: AnnotatedXMLElement[] = [];
        for (let i = 0; i < annotationsPositionText.length; i++) {
          annotationsWithPosRefToText.push(
            new AnnotatedXMLElement(annotations[i]!.getAnnotationNode(), annotationsPositionText[i]!),
          );
        }

        annotations = annotationsWithPosRefToText;

        if (sentenceSegmentation) {
          const sentences: Element[] = queryDescendantElements(paragraph, "s");

          if (sentences.length === 0) {
            // Overly careful - we should never end up here.
            LOGGER.warn(
              "While the configuration claim that paragraphs must be segmented, we did not find any sentence. ",
            );
            FundingAcknowledgementParser.updateParagraphNodeWithAnnotations(paragraph, annotations);
          }
          FundingAcknowledgementParser.mergeSentencesFallingOnAnnotations(sentences, annotations, config);
          FundingAcknowledgementParser.updateSentencesNodesWithAnnotations(sentences, annotations);
        } else {
          FundingAcknowledgementParser.updateParagraphNodeWithAnnotations(paragraph, annotations);
        }

        // update extracted entities
        if (globalResult === null) {
          globalResult = MutablePair.of(
            rootElementStatement,
            MutableTriple.of(
              localEntities.getFundings(),
              localEntities.getPersons(),
              localEntities.getAffiliations(),
            ),
          );
        } else {
          // concatenate members of the local results to the global ones
          globalResult = FundingAcknowledgementParser.aggregateResults(
            MutableTriple.of(
              localEntities.getFundings(),
              localEntities.getPersons(),
              localEntities.getAffiliations(),
            ),
            globalResult,
          );
        }
      }

      //System.out.println(globalResult.getLeft().toXML());
    } catch (exp) {
      // Mirrors upstream's three catch blocks (ValidityException, ParsingException,
      // IOException). In the TS port all parse failures funnel through fromString
      // which throws a single Error; we log it as a parsing error.
      LOGGER.warn("Parsing error of the TEI fragment from funding/acknowledgement section", exp);
    }

    return globalResult;
  }

  /**
   * This method identify the sentences that should be merged because the annotations are falling on their boundaries.
   * This is necessary when the annotations are extracted from the paragraphs they need to be applied to sentences
   * calculated from the plain text.
   * <b>This method modify the sentences in input</b>
   */
  private static mergeSentencesFallingOnAnnotations(
    sentences: Element[],
    annotations: AnnotatedXMLElement[],
    config: GrobidAnalysisConfig,
  ): Element[] {
    // We merge the sentences (including their coordinates) for which the annotations
    // are falling in between two of them or they will be lost later.

    const sentencePositions: OffsetPosition[] = FundingAcknowledgementParser.getOffsetPositionsFromNodes(
      sentences,
    );

    // We obtain the corrected coordinates that don't fall over the annotations
    const correctedOffsetPositions: OffsetPosition[] = SentenceUtilities.correctSentencePositions(
      sentencePositions,
      annotations.map((a) => a.getOffsetPosition()),
    );

    const toRemove: number[] = [];
    for (const correctedOffsetPosition of correctedOffsetPositions) {
      const originalSentences: OffsetPosition[] = sentencePositions.filter(
        (a) => a.start >= correctedOffsetPosition.start && a.end <= correctedOffsetPosition.end,
      );

      // if for each "corrected sentences offset" there are more than one original sentence that
      // falls into it, it means we need to merge
      if (originalSentences.length > 1) {
        const toMerge: number[] = originalSentences.map((s) => sentencePositions.indexOf(s));

        const destination: Element = sentences[toMerge[0]!]!;
        const needToMergeCoordinates = config.isGenerateTeiCoordinates("s");
        let boundingBoxes: BoundingBox[] = [];
        let destCoordinates: Attribute | null = null;

        if (needToMergeCoordinates) {
          destCoordinates = destination.getAttribute("coords");
          const coordinates: string = destCoordinates!.getValue();
          boundingBoxes = coordinates
            .split(";")
            .filter((c) => c.trim().length > 0)
            .map((c) => BoundingBox.fromString(c));
          removeAttribute(destination, destCoordinates!);
        }

        for (let i = 1; i < toMerge.length; i++) {
          const sentenceToMergeIndex = toMerge[i]!;
          const sentenceToMerge: Element = sentences[sentenceToMergeIndex]!;

          // Merge coordinates
          if (needToMergeCoordinates) {
            const coords = sentenceToMerge.getAttribute("coords");
            const coordinates = coords!.getValue();
            for (const c of coordinates
              .split(";")
              .filter((c) => c.trim().length > 0)
              .map((c) => BoundingBox.fromString(c))) {
              boundingBoxes.push(c);
            }

            // Group by page, then merge
            const postMergeBoxes: BoundingBox[] = [];
            const boundingBoxesByPage: Map<number, BoundingBox[]> = new Map();
            for (const b of boundingBoxes) {
              const k = b.getPage();
              if (!boundingBoxesByPage.has(k)) boundingBoxesByPage.set(k, []);
              boundingBoxesByPage.get(k)!.push(b);
            }
            for (const [, boxes] of boundingBoxesByPage) {
              const mergedBoundingBoxes = VectorGraphicBoxCalculator.mergeBoxes(boxes);
              for (const m of mergedBoundingBoxes) postMergeBoxes.push(m);
            }

            const coordsAsString = postMergeBoxes.map((b) => b.toString()).join(";");
            const newCoords = new Attribute("coords", coordsAsString);
            destination.addAttribute(newCoords);
          }

          // Merge content
          let first = true;
          let previous: Node | null = null;
          for (let c = 0; c < sentenceToMerge.getChildCount(); c++) {
            const child = sentenceToMerge.getChild(c);

            if (first) {
              first = false;
              const lastNodeDestination = destination.getChild(destination.getChildCount() - 1);
              previous = lastNodeDestination;
              //                                        if (lastNodeDestination instanceof Text) {
              //                                            ((Text) lastNodeDestination).setValue(((Text) lastNodeDestination).getValue() + " ");
              //                                            previous = lastNodeDestination;
              //                                        } else {
              //                                            Text newSpace = new Text(" ");
              //                                            destination.appendChild(newSpace);
              //                                            previous = newSpace;
              //                                        }
            }

            if (previous instanceof Text && child instanceof Text) {
              (previous as Text).setValue(previous.getValue() + child.getValue());
            } else {
              replaceChild(sentenceToMerge, child, new Text("placeholder"));
              child.detach();
              destination.appendChild(child);
              previous = child;
            }
          }
          sentenceToMerge.detach();
          toRemove.push(sentenceToMergeIndex);
        }
      }
    }
    toRemove
      .slice()
      .sort((a, b) => b - a)
      .forEach((idx) => sentences.splice(idx, 1));

    return sentences;
  }

  private static getOffsetPositionsFromNodes(sentences: Element[]): OffsetPosition[] {
    const sentencePositions: OffsetPosition[] = [];
    let start = 0;
    for (const sentence of sentences) {
      const end = start + sentence.getValue().length;
      sentencePositions.push(new OffsetPosition(start, end));
      start = end;
    }
    return sentencePositions;
  }

  private static updateParagraphNodeWithAnnotations(
    paragraph: Node,
    annotations: AnnotatedXMLElement[],
  ): void {
    let pos = 0;
    const newChildren: Node[] = [];
    const paragraphEl = paragraph as Element;
    for (let i = 0; i < paragraphEl.getChildCount(); i++) {
      //Assumption here is that the structure is flat to maximum one level down
      const currentNode = paragraphEl.getChild(i);
      if (currentNode instanceof Text) {
        const text: string = currentNode.getValue();
        const finalPos = pos;
        const annotationsInThisChunk: AnnotatedXMLElement[] = annotations.filter(
          (a) =>
            a.getOffsetPosition().start >= finalPos && a.getOffsetPosition().end <= finalPos + text.length,
        );

        if (isNotEmpty(annotationsInThisChunk)) {
          const nodes = FundingAcknowledgementParser.getNodesAnnotationsInTextNode(
            currentNode,
            annotationsInThisChunk,
            pos,
          );
          for (const n of nodes) newChildren.push(n);
        } else {
          newChildren.push(currentNode);
        }
        pos += text.length;
      } else if (currentNode instanceof Element) {
        newChildren.push(currentNode);
        pos += currentNode.getValue().length;
      }
    }

    for (let i = 0; i < paragraphEl.getChildCount(); i++) {
      paragraphEl.getChild(i).detach();
    }
    for (const node of newChildren) {
      node.detach();
      paragraphEl.appendChild(node);
    }
  }

  private static updateSentencesNodesWithAnnotations(
    sentences: Element[],
    annotations: AnnotatedXMLElement[],
  ): void {
    let pos = 0;
    let sentenceStartOffset = 0;
    for (const sentence of sentences) {
      const sentenceText = sentence.getValue();
      const newChildren: Node[] = [];
      for (let i = 0; i < sentence.getChildCount(); i++) {
        //Assumption here is that the structure is flat to maximum one level down
        const currentNode = sentence.getChild(i);
        if (currentNode instanceof Text) {
          const text = currentNode.getValue();
          const finalPos = pos;
          const annotationsInThisChunk: AnnotatedXMLElement[] = annotations.filter(
            (a) =>
              a.getOffsetPosition().start >= finalPos &&
              a.getOffsetPosition().end <= finalPos + text.length,
          );

          if (isNotEmpty(annotationsInThisChunk)) {
            const nodes = FundingAcknowledgementParser.getNodesAnnotationsInTextNode(
              currentNode,
              annotationsInThisChunk,
              pos,
            );
            for (const n of nodes) newChildren.push(n);
          } else {
            newChildren.push(currentNode);
          }
          pos += text.length;
        } else if (currentNode instanceof Element) {
          newChildren.push(currentNode);
          pos += currentNode.getValue().length;
        } /*else {
                    System.out.println(currentNode);
                }*/
      }

      for (let i = 0; i < sentence.getChildCount(); i++) {
        sentence.getChild(i).detach();
      }
      for (const node of newChildren) {
        node.detach();
        sentence.appendChild(node);
      }

      sentenceStartOffset += sentenceText.length;
    }
    // upstream: `sentenceStartOffset` is written but never read.
    void sentenceStartOffset;
  }

  /**
   * This method return a list of nodes corresponding to the annotations as they are positioned in
   * the text content of the target node. If the node is empty, should be used @see injectedAnnotationsInNode
   * as this method will fail
   */
  protected static getNodesAnnotationsInTextNode(
    targetNode: Node,
    annotations: AnnotatedXMLElement[],
  ): Node[];
  /**
   * The sentence offset allow to calculate the position relative to the sentence of annotations that
   * have been calculated in relation with the paragraph.
   */
  protected static getNodesAnnotationsInTextNode(
    targetNode: Node,
    annotations: AnnotatedXMLElement[],
    sentenceOffset: number,
  ): Node[];
  protected static getNodesAnnotationsInTextNode(
    targetNode: Node,
    annotations: AnnotatedXMLElement[],
    sentenceOffset: number = 0,
  ): Node[] {
    const text: string = targetNode.getValue();

    const outputNodes: Node[] = [];

    let pos = 0;
    for (const annotation of annotations) {
      const annotationPosition = annotation.getOffsetPosition();
      const annotationContentElement = annotation.getAnnotationNode() as Element;

      const before = text.substring(pos, annotationPosition.start - sentenceOffset);

      //            if (StringUtils.isNotEmpty(before) && before.startsWith(" ")) {
      //                outputNodes.add(new Text(" "));
      //            }

      outputNodes.push(new Text(before));
      pos = annotationPosition.end - sentenceOffset;
      outputNodes.push(annotationContentElement);
    }

    const remaining = text.substring(pos);

    //        if (StringUtils.isNotEmpty(remaining) && remaining.startsWith(" ")) {
    //            outputNodes.add(new Text(" "));
    //        }

    outputNodes.push(new Text(remaining));

    return outputNodes;
  }

  private static aggregateResults(
    localEntities: MutableTriple<Funding[], Person[], Affiliation[]>,
    globalResult: MutablePair<Element, MutableTriple<Funding[], Person[], Affiliation[]>>,
  ): MutablePair<Element, MutableTriple<Funding[], Person[], Affiliation[]>> {
    const globalEntities = globalResult.getRight();

    const localFundings: Funding[] = localEntities.getLeft();
    const globalFundings: Funding[] = globalEntities.getLeft();
    for (const f of localFundings) globalFundings.push(f);
    globalEntities.setLeft(globalFundings);

    const localPersons: Person[] = localEntities.getMiddle();
    const globalPersons: Person[] = globalEntities.getMiddle();
    for (const p of localPersons) globalPersons.push(p);
    globalEntities.setMiddle(globalPersons);

    const localAffiliation: Affiliation[] = localEntities.getRight();
    const globalAffiliations: Affiliation[] = globalEntities.getRight();
    for (const a of localAffiliation) globalAffiliations.push(a);
    globalEntities.setRight(globalAffiliations);

    globalResult.setRight(globalEntities);

    return globalResult;
  }

  protected static extractSentencesAndPositionsFromParagraphElement(
    paragraphElement: Element,
  ): Pair<string[], OffsetPosition[]> {
    let offset = 0;
    const sentenceOffsetPositions: OffsetPosition[] = [];

    const sentences: Element[] = queryDescendantElements(paragraphElement, "s");
    const sentencesAsString: string[] = [];
    for (const sentence of sentences) {
      const sentenceText = sentence.getValue();
      sentenceOffsetPositions.push(new OffsetPosition(offset, offset + sentenceText.length));
      sentencesAsString.push(sentence.getValue());
      offset += sentence.getValue().length;
    }

    return new Pair<string[], OffsetPosition[]>(sentencesAsString, sentenceOffsetPositions);
  }

  /**
   * The processing here is called from the header and/or full text parser in cascade
   * when one of these higher-level model detect a "funding" section, or in case
   * no funding section is found, when a acknolwedgements section is detected.
   *
   * Independently from the place this parser is called, it process the input sequence
   * of layout tokens in a context free manner.
   *
   * The expected input here is a paragraph.
   *
   *     // This returns a Element of the annotation and the position where should be injected, relative to the paragraph.
   *     // TODO: make new data objects for the annotations
   *
   * Return an XML fragment with inline annotations of the input text, together with
   * extracted normalized entities. These entities are referenced by the inline
   * annotations with the usual @target attribute pointing to xml:id.
   */
  protected getExtractionResult(
    tokensParagraph: LayoutToken[],
    labellingResult: string,
  ): MutablePair<AnnotatedXMLElement[], FundingAcknowledgmentParse> {
    const fundings: Funding[] = [];
    const persons: Person[] = [];
    const affiliations: Affiliation[] = [];
    const institutions: Affiliation[] = [];

    const parsedStatement = new FundingAcknowledgmentParse();
    parsedStatement.setFundings(fundings);
    parsedStatement.setPersons(persons);
    parsedStatement.setAffiliations(affiliations);

    // current funding
    let funding = new Funding();

    // current person
    let person = new Person();

    // current organization
    let affiliation = new Affiliation();
    let institution = new Affiliation();

    const clusteror = new TaggingTokenClusteror(
      GrobidModels.FUNDING_ACKNOWLEDGEMENT,
      labellingResult,
      tokensParagraph,
    );
    const clusters: TaggingTokenCluster[] = clusteror.cluster();
    // upstream `previousLabel` is updated but never read.
    let previousLabel: TaggingLabel | null = null;

    const elements: Element[] = [];
    const positions: OffsetPosition[] = [];

    let posTokenization = 0;
    let posCharacters = 0;

    for (const cluster of clusters) {
      if (cluster === null) {
        continue;
      }

      // upstream `spaceBefore` is computed but never read.
      let spaceBefore = false;
      if (
        posTokenization > 0 &&
        tokensParagraph.length >= posTokenization &&
        tokensParagraph[posTokenization - 1]!.getText() === " "
      ) {
        spaceBefore = true;
      }
      void spaceBefore;

      const clusterLabel = cluster.getTaggingLabel();
      Engine.getCntManager().i(clusterLabel);

      const tokens: LayoutToken[] = cluster.concatTokens();
      const clusterContent = LayoutTokensUtil.normalizeText(LayoutTokensUtil.toText(tokens));

      if (clusterLabel === FUNDING_OTHER) {
        posTokenization += tokens.length;
        posCharacters += clusterContent.length;
        continue;
      }

      // We adjust the end position when the entity ends with a space
      let endPosTokenization = posTokenization + tokens.length;
      if (tokens[tokens.length - 1]!.getText() === " ") {
        endPosTokenization -= 1;
      }

      let endPosCharacters = posCharacters + clusterContent.length;
      if (tokens[tokens.length - 1]!.getText() === " ") {
        endPosCharacters -= 1;
      }
      // upstream `endPosCharacters` is computed but never read.
      void endPosCharacters;

      if (clusterLabel === FUNDING_FUNDER_NAME) {
        let localFunder: Funder | null = funding.getFunder();
        if (localFunder === null) {
          localFunder = new Funder();
          funding.setFunder(localFunder);
        }

        if (isNotBlank(localFunder.getFullName())) {
          if (funding.isValid()) {
            fundings.push(funding);
            // next funding object
            funding = new Funding();
            localFunder = new Funder();
            funding.setFunder(localFunder);
          }
        }

        localFunder.setFullName(clusterContent);
        localFunder.appendFullNameLayoutTokens(tokens);
        localFunder.addLayoutTokens(tokens);
        funding.addLayoutTokens(tokens);

        const entity = teiElement("rs");
        entity.addAttribute(new Attribute("type", "funder"));
        entity.appendChild(clusterContent);
        elements.push(entity);

        positions.push(new OffsetPosition(posTokenization, endPosTokenization));
      } else if (clusterLabel === FUNDING_GRANT_NAME) {
        if (isNotBlank(funding.getGrantName())) {
          if (funding.isValid()) {
            fundings.push(funding);
            // next funding object
            funding = new Funding();
          }
        }

        funding.setGrantName(clusterContent);
        funding.appendGrantNameLayoutTokens(tokens);
        funding.addLayoutTokens(tokens);

        const entity = teiElement("rs");
        entity.addAttribute(new Attribute("type", "grantName"));
        entity.appendChild(clusterContent);
        elements.push(entity);

        positions.push(new OffsetPosition(posTokenization, endPosTokenization));
      } else if (clusterLabel === FUNDING_PERSON) {
        if (isNotBlank(person.getRawName())) {
          if (person.isValid()) {
            persons.push(person);
            // next funding object
            person = new Person();
          }
        }

        person.setRawName(clusterContent);
        person.appendLayoutTokens(tokens);

        const entity = teiElement("rs");
        entity.addAttribute(new Attribute("type", "person"));
        entity.appendChild(clusterContent);
        elements.push(entity);

        positions.push(new OffsetPosition(posTokenization, endPosTokenization));
      } else if (clusterLabel === FUNDING_AFFILIATION) {
        if (isNotBlank(affiliation.getAffiliationString())) {
          if (affiliation.isNotNull()) {
            affiliations.push(affiliation);
            // next funding object
            affiliation = new Affiliation();
          }
        }

        affiliation.setRawAffiliationString(clusterContent);
        affiliation.appendLayoutTokens(tokens);

        const entity = teiElement("rs");
        entity.addAttribute(new Attribute("type", "affiliation"));
        entity.appendChild(clusterContent);
        elements.push(entity);

        positions.push(new OffsetPosition(posTokenization, endPosTokenization));
      } else if (clusterLabel === FUNDING_INSTITUTION) {
        if (isNotBlank(institution.getAffiliationString())) {
          //if (institution.isNotNull()) {
          institutions.push(institution);
          // next funding object
          institution = new Affiliation();
          //}
        }

        institution.setAffiliationString(clusterContent);
        institution.appendLayoutTokens(tokens);

        const entity = teiElement("rs");
        entity.addAttribute(new Attribute("type", "institution"));
        entity.appendChild(clusterContent);
        elements.push(entity);

        positions.push(new OffsetPosition(posTokenization, endPosTokenization));
      } else if (clusterLabel === FUNDING_INFRASTRUCTURE) {
        if (isNotBlank(institution.getAffiliationString())) {
          //if (institution.isNotNull()) {
          institutions.push(institution);
          // next funding object
          institution = new Affiliation();
          //}
        }
        institution.setAffiliationString(clusterContent);
        institution.appendLayoutTokens(tokens);
        institution.setInfrastructure(true);

        const entity = teiElement("rs");
        entity.addAttribute(new Attribute("type", "institution"));
        entity.addAttribute(new Attribute("subtype", "infrastructure"));
        entity.appendChild(clusterContent);
        elements.push(entity);

        positions.push(new OffsetPosition(posTokenization, endPosTokenization));
      } else if (clusterLabel === FUNDING_GRANT_NUMBER) {
        let previousFounding: Funding | null = null;
        if (isNotBlank(funding.getGrantNumber())) {
          if (funding.isValid()) {
            previousFounding = funding;
            fundings.push(funding);
            // next funding object
            funding = new Funding();
          }
        }

        funding.setGrantNumber(clusterContent);
        funding.appendGrantNumberLayoutTokens(tokens);
        funding.addLayoutTokens(tokens);

        // possibly copy funder from previous funding object (case of "factorization" of grant numbers)
        if (
          previousFounding !== null &&
          previousFounding.getGrantNumber() !== null &&
          clusterContent.length === (previousFounding.getGrantNumber() as string).length
        ) {
          funding.setFunder(previousFounding.getFunder());
        }

        const entity = teiElement("rs");
        entity.addAttribute(new Attribute("type", "grantNumber"));
        entity.appendChild(clusterContent);
        elements.push(entity);

        positions.push(new OffsetPosition(posTokenization, endPosTokenization));
      } else if (clusterLabel === FUNDING_PROGRAM_NAME) {
        if (isNotBlank(funding.getProgramFullName())) {
          if (funding.isValid()) {
            fundings.push(funding);
            // next funding object
            funding = new Funding();
          }
        }

        funding.setProgramFullName(clusterContent);
        funding.appendProgramFullNameLayoutTokens(tokens);
        funding.addLayoutTokens(tokens);

        const entity = teiElement("rs");
        entity.addAttribute(new Attribute("type", "programName"));
        entity.appendChild(clusterContent);
        elements.push(entity);

        positions.push(new OffsetPosition(posTokenization, endPosTokenization));
      } else if (clusterLabel === FUNDING_PROJECT_NAME) {
        if (isNotBlank(funding.getProjectFullName())) {
          if (funding.isValid()) {
            fundings.push(funding);
            // next funding object
            funding = new Funding();
          }
        }

        funding.setProjectFullName(clusterContent);
        funding.appendProjectFullNameLayoutTokens(tokens);
        funding.addLayoutTokens(tokens);

        const entity = teiElement("rs");
        entity.addAttribute(new Attribute("type", "projectName"));
        entity.appendChild(clusterContent);
        elements.push(entity);

        positions.push(new OffsetPosition(posTokenization, endPosTokenization));
      } else {
        LOGGER.warn(
          "Unexpected funding model label - " + clusterLabel.getLabel() + " for " + clusterContent,
        );
      }

      previousLabel = clusterLabel;
      posTokenization += tokens.length;
      posCharacters += clusterContent.length;
    }
    void previousLabel;

    // last funding, person, institution/affiliation
    if (person.isValid()) {
      persons.push(person);
    }

    if (funding.isValid()) {
      fundings.push(funding);
    }

    if (institution.isNotNull()) institutions.push(institution);

    if (affiliation.isNotNull()) affiliations.push(affiliation);

    if (isNotEmpty(institutions)) {
      for (const i of institutions) affiliations.push(i);
    }

    for (const localFunding of fundings) {
      localFunding.inferAcronyms();
    }

    const annotations: AnnotatedXMLElement[] = [];

    for (let i = 0; i < elements.length; i++) {
      annotations.push(new AnnotatedXMLElement(elements[i]!, positions[i]!));
    }

    return MutablePair.of(annotations, parsedStatement);
  }

  /**
   * The training data creation is called from the full text training creation in cascade.
   */
  async createTrainingData(
    tokenizations: LayoutToken[],
    // upstream `id` is bound but never read.
    _id: string,
  ): Promise<Pair<string | null, string | null>> {
    let res: string | null = null;
    let featureVector: string | null = null;
    try {
      featureVector = FeaturesVectorFunding.addFeatures(tokenizations, null);
      res = await this.label(featureVector);
    } catch (e) {
      LOGGER.error("Sequence labeling in FundingParser fails.", e);
    }
    if (res === null) {
      return new Pair<string | null, string | null>(null, featureVector);
    }

    const labeled: (Pair<string, string> | null)[] = GenericTaggerUtils.getTokensAndLabels(res);
    const sb: string[] = [];

    let tokPtr = 0;
    let addSpace = false;
    let lastTag: string | null = null;
    let fundOpen = false;
    for (const l of labeled) {
      if (l === null) continue;
      const tok = l.getA();
      const label = l.getB();

      let tokPtr2 = tokPtr;
      for (; tokPtr2 < tokenizations.length; tokPtr2++) {
        if (tokenizations[tokPtr2]!.getText() === " ") {
          addSpace = true;
        } else if (
          tokenizations[tokPtr2]!.getText() === "\n" ||
          tokenizations[tokPtr]!.getText() === "\r"
        ) {
          addSpace = true;
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
        let tokenizationToken = tokenizations[tokPtr]!.getText();

        if (tokPtr !== tokenizations.length && tokenizationToken !== tok) {
          // and we add a space by default to avoid concatenated text
          addSpace = true;
          if (!tok.startsWith(tokenizationToken!)) {
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

      const plainLabel: string = (GenericTaggerUtils.getPlainLabel(label) ?? "") as string;

      let output: string | null = null;
      if (lastTag !== null) {
        FundingAcknowledgementParser.testClosingTag(sb, plainLabel, lastTag, addSpace);
      }

      output = FundingAcknowledgementParser.writeField(
        label,
        lastTag,
        tok,
        "<funderFull>",
        "<fundingAgency>",
        addSpace,
        3,
      );
      const fundingOpening = "\t\t<funding>\n";
      if (output !== null) {
        if (!fundOpen) {
          sb.push(fundingOpening);
          fundOpen = true;
        }
        sb.push(output);
      }
      output = FundingAcknowledgementParser.writeField(
        label,
        lastTag,
        tok,
        "<funderAbbrv>",
        "<fundingAgency>",
        addSpace,
        3,
      );
      if (output !== null) {
        if (!fundOpen) {
          sb.push(fundingOpening);
          fundOpen = true;
        }
        sb.push(output);
      }
      output = FundingAcknowledgementParser.writeField(
        label,
        lastTag,
        tok,
        "<grantNumber>",
        "<grantNumber>",
        addSpace,
        3,
      );
      if (output !== null) {
        if (!fundOpen) {
          sb.push(fundingOpening);
          fundOpen = true;
        }
        sb.push(output);
      }
      output = FundingAcknowledgementParser.writeField(
        label,
        lastTag,
        tok,
        "<projectFull>",
        "<projectName>",
        addSpace,
        3,
      );
      if (output !== null) {
        if (!fundOpen) {
          sb.push(fundingOpening);
          fundOpen = true;
        }
        sb.push(output);
      }
      output = FundingAcknowledgementParser.writeField(
        label,
        lastTag,
        tok,
        "<projectAbbrv>",
        "<projectName>",
        addSpace,
        3,
      );
      if (output !== null) {
        if (!fundOpen) {
          sb.push(fundingOpening);
          fundOpen = true;
        }
        sb.push(output);
      }
      output = FundingAcknowledgementParser.writeField(label, lastTag, tok, "<url>", "<url>", addSpace, 3);
      if (output !== null) {
        if (!fundOpen) {
          sb.push(fundingOpening);
          fundOpen = true;
        }
        sb.push(output);
      }

      lastTag = plainLabel;
      addSpace = false;
      tokPtr++;
    }

    if (fundOpen) {
      FundingAcknowledgementParser.testClosingTag(sb, "", lastTag, addSpace);
      sb.push("\t\t</funding>\n");
    }

    return new Pair<string | null, string | null>(sb.join(""), featureVector);
  }

  getTEIHeader(id: string): string {
    const sb: string[] = [];
    sb.push(
      "<tei>\n" +
        "    <teiHeader>\n" +
        '        <fileDesc xml:id="_' +
        id +
        '"/>\n' +
        "    </teiHeader>\n" +
        '    <text xml:lang="en">\n',
    );
    return sb.join("");
  }

  // Fixed from upstream: in the `<funderFull>` branch upstream emits the
  // opening tag `"<funderFull>\n"` instead of the closing `"</funderFull>\n"`.
  // All sibling branches emit the matching close tag; this is a copy-paste
  // typo. Corrected here.
  private static testClosingTag(
    buffer: string[],
    currentTag: string,
    lastTag: string | null,
    addSpace: boolean,
  ): boolean {
    let res = false;
    if (currentTag !== lastTag) {
      res = true;
      // we close the current tag
      if (lastTag === "<funderFull>") {
        if (addSpace) buffer.push(" ");
        // Fixed from upstream: was `"<funderFull>\n"` (opening); changed
        // to closing form to match sibling branches.
        buffer.push("</funderFull>\n");
      } else if (lastTag === "<funderAbbrv>") {
        if (addSpace) buffer.push(" ");
        buffer.push("</funderAbbrv>\n");
      } else if (lastTag === "<grantNumber>") {
        if (addSpace) buffer.push(" ");
        buffer.push("</grantNumber>\n");
      } else if (lastTag === "<projectFull>") {
        if (addSpace) buffer.push(" ");
        buffer.push("</projectFull>\n");
      } else if (lastTag === "<projectAbbrv>") {
        if (addSpace) buffer.push(" ");
        buffer.push("</projectAbbrv>\n");
      } else if (lastTag === "<url>") {
        if (addSpace) buffer.push(" ");
        buffer.push("</url>\n");
      } else {
        res = false;
      }
    }
    return res;
  }

  private static writeField(
    currentTag: string,
    lastTag: string | null,
    token: string,
    field: string,
    outField: string,
    addSpace: boolean,
    nbIndent: number,
  ): string | null {
    let result: string | null = null;
    if (currentTag.endsWith(field)) {
      /*if (currentTag.endsWith("<other>") || currentTag.endsWith("<content>")) {
                result = "";
                if (currentTag.startsWith("I-") || (lastTag == null)) {
                    result += "\n";
                    for (int i = 0; i < nbIndent; i++) {
                        result += "    ";
                    }
                }
                if (addSpace)
                    result += " ";
                result += TextUtilities.HTMLEncode(token);
            }
            else*/
      if (lastTag !== null && currentTag.endsWith(lastTag)) {
        result = "";
        if (addSpace) result += " ";
        if (currentTag.startsWith("I-")) result += outField;
        result += TextUtilities.HTMLEncode(token);
      } else {
        result = "";
        if (addSpace) result += " ";
        result += "\n";
        if (outField.length > 0) {
          for (let i = 0; i < nbIndent; i++) {
            result += "    ";
          }
        }

        result += outField + TextUtilities.HTMLEncode(token);
      }
    }
    return result;
  }
}
