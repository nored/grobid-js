// Port of org.grobid.core.data.Equation.
// Upstream: grobid-core/src/main/java/org/grobid/core/data/Equation.java

import type { BoundingBox } from "../layout/bounding-box.js";
import type { LayoutToken } from "../layout/layout-token.js";
import { BoundingBoxCalculator } from "../utilities/bounding-box-calculator.js";
import { LayoutTokensUtil } from "../utilities/layout-tokens-util.js";
import { TextUtilities } from "../utilities/text-utilities.js";
// Cross-package: still-stub modules referenced for parity with upstream.
// These dependencies are imported by their final TS path — they may be
// stubs in the current tree but will be filled in by sibling ports.
import * as GACNs from "../engines/config/grobid-analysis-config.js";
import * as XBU from "../document/xml/xml-builder-utils.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GrobidAnalysisConfig = any;
void GACNs;

/**
 * Class for representing an equation.
 */
export class Equation {
  protected content: string[] = []; // upstream uses StringBuilder, we join on access
  protected label: string[] = [];
  protected id: string | null = null;
  // protected int start = -1; // start position in the full text tokenization
  // protected int end = -1; // end position in the full text tokenization
  // protected LayoutToken startToken = null; // start layout token
  // protected LayoutToken endToken = null; // end layout token
  private textArea: BoundingBox[] | null = null;
  private layoutTokens: LayoutToken[] | null = null;

  private contentTokens: LayoutToken[] = [];
  private labelTokens: LayoutToken[] = [];

  // private SortedSet<Integer> blockPtrs;

  constructor() {
    // Upstream initialises content/label to new StringBuilder(); our arrays
    // default to []. Behavior is equivalent.
  }

  toTEIElement(config: GrobidAnalysisConfig): unknown {
    if (this.getContent().length === 0) {
      return null;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const X = XBU as any;
    const formulaElement = X.XmlBuilderUtils.teiElement("formula");
    if (this.id != null) {
      X.XmlBuilderUtils.addXmlId(formulaElement, this.getTeiId());
    }

    const coords = (config as unknown as {
      getGenerateTeiCoordinates(): string[] | null;
    }).getGenerateTeiCoordinates();

    if (coords != null && coords.includes("formula")) {
      X.XmlBuilderUtils.addCoords(formulaElement, LayoutTokensUtil.getCoordsStringForOneBox(this.getLayoutTokens() ?? []));
    }

    formulaElement.appendChild(LayoutTokensUtil.normalizeText(this.getContent()).trim());

    if (this.getLabel().length > 0) {
      const labelEl = X.XmlBuilderUtils.teiElement("label", LayoutTokensUtil.normalizeText(this.getLabel()));
      formulaElement.appendChild(labelEl);
    }

    return formulaElement;
  }

  toTEI(config: GrobidAnalysisConfig): string | null {
    const formulaElement = this.toTEIElement(config) as { toXML(): string } | null;
    if (formulaElement != null) {
      return formulaElement.toXML();
    } else {
      return null;
    }
  }

  getContentTokens(): LayoutToken[] {
    return this.contentTokens;
  }

  getLabelTokens(): LayoutToken[] {
    return this.labelTokens;
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

  /* public void setStart(int start) { ... } */

  getStart(): number {
    if (this.layoutTokens != null && this.layoutTokens.length > 0) {
      return this.layoutTokens[0]!.getOffset();
    } else {
      return -1;
    }
  }

  /* public void setEnd(int end) { ... } */

  getEnd(): number {
    if (this.layoutTokens != null && this.layoutTokens.length > 0) {
      return this.layoutTokens[this.layoutTokens.length - 1]!.getOffset();
    } else {
      return -1;
    }
  }

  /* public void setStartToken(LayoutToken start) { ... }
     public LayoutToken getStartToken() { ... }
     public void setEndToken(LayoutToken end) { ... }
     public LayoutToken getEndToken() { ... } */

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

  getTeiId(): string {
    return "formula_" + this.id;
  }

  /* public void setBlockPtrs(SortedSet<Integer> blockPtrs) { ... }
     public SortedSet<Integer> getBlockPtrs() { ... } */

  getLayoutTokens(): LayoutToken[] | null {
    return this.layoutTokens;
  }

  setLayoutTokens(layoutTokens: LayoutToken[] | null): void {
    this.layoutTokens = layoutTokens;
  }

  addLayoutToken(token: LayoutToken | null): void {
    if (token == null) return;
    if (this.layoutTokens == null) this.layoutTokens = [];
    this.layoutTokens.push(token);
  }

  addLayoutTokens(tokens: LayoutToken[] | null): void {
    if (tokens == null) return;
    if (this.layoutTokens == null) this.layoutTokens = [];
    for (const token of tokens) this.layoutTokens.push(token);
  }

  getCoordinates(): BoundingBox[] | null {
    if (this.layoutTokens == null || this.layoutTokens.length === 0) {
      return null;
    }
    const oneBox = BoundingBoxCalculator.calculateOneBox(this.layoutTokens, true);
    const result: BoundingBox[] = [];
    if (oneBox != null) result.push(oneBox);
    return result;
  }

  // Accessor for the textArea field, preserved from upstream even though
  // upstream never reads it.
  getTextArea(): BoundingBox[] | null {
    return this.textArea;
  }

  setTextArea(textArea: BoundingBox[] | null): void {
    this.textArea = textArea;
  }
}
