// Port of org.grobid.core.data.BibDataSet.
// Upstream: grobid-core/src/main/java/org/grobid/core/data/BibDataSet.java

// BiblioItem and GrobidAnalysisConfig are still stubs at this point in the
// port. Imported by namespace so this file compiles before they land; the
// concrete runtime references resolve once those modules are filled in.
import * as BiblioItemNs from "./biblio-item.js";
import * as GACNs from "../engines/config/grobid-analysis-config.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BiblioItem = any;
const GrobidAnalysisConfig: Any = (GACNs as Any).GrobidAnalysisConfig;
void BiblioItemNs;

/**
 * Structure for representing the different information for a citation and
 * its different context of citation.
 */

/** Counters enum, hoisted to top-level. */
export enum BibDataSetCounters {
  CITATIONS_CNT = "CITATIONS_CNT",
  CITATIONS_WITH_CONTEXT_CNT = "CITATIONS_WITH_CONTEXT_CNT",
  CITATIONS_WITHOUT_CONTEXT_CNT = "CITATIONS_WITHOUT_CONTEXT_CNT",
}

export class BibDataSet {
  /** Re-expose nested Counters enum. */
  static readonly Counters = BibDataSetCounters;

  private resBib: BiblioItem | null = null; // identified parsed bibliographical item
  private sourceBib: string[] | null = null;
  // the context window (raw text) where the bibliographical item is cited
  private refSymbol: string | null = null; // reference marker in the text body
  private rawBib: string | null = null; // raw text of the bibliographical item
  private confidence = 1.0; // confidence score of the extracted bibiliographical item
  private offsets: number[] | null = null; // list of offsets corresponding to the position of the reference

  // private List<grisp.nlp.Term> terms = null;
  // set of terms describing the reference obtained in the citation context

  constructor() {
    // intentionally empty (mirrors upstream)
  }

  setResBib(res: BiblioItem | null): void {
    this.resBib = res;
  }

  addSourceBib(sentence: string): void {
    if (this.sourceBib == null) this.sourceBib = [];
    // sourceBib.add(org.grobid.core.utilities.TextUtilities.HTMLEncode(sentence));
    this.sourceBib.push(sentence);
  }

  setRawBib(s: string | null): void {
    // rawBib = org.grobid.core.utilities.TextUtilities.HTMLEncode(s);
    this.rawBib = s;
  }

  setRefSymbol(s: string | null): void {
    this.refSymbol = s;
  }

  // public void setTerms(List<grisp.nlp.Term> a) { terms = a; }
  setConfidence(c: number): void {
    this.confidence = c;
  }

  getResBib(): BiblioItem | null {
    return this.resBib;
  }

  getRawBib(): string | null {
    return this.rawBib;
  }

  getRefSymbol(): string | null {
    return this.refSymbol;
  }

  getSourceBib(): string[] | null {
    return this.sourceBib;
  }
  // public List<grisp.nlp.Term> getTerms() { return terms; }

  getConfidence(): number {
    return this.confidence;
  }

  addOffset(begin: number): void {
    if (this.offsets == null) {
      this.offsets = [];
    }
    this.offsets.push(begin);
  }

  getOffsets(): number[] | null {
    return this.offsets;
  }

  toString(): string {
    // Upstream calls resBib.toString() unconditionally — preserve the NPE
    // contract when resBib is null.
    return (
      "BibDataSet [resBib=" +
      (this.resBib == null ? "null" : (this.resBib as { toString(): string }).toString()) +
      ", sourceBib=" +
      String(this.sourceBib) +
      ", refSymbol=" +
      String(this.refSymbol) +
      ", rawBib=" +
      String(this.rawBib) +
      ", confidence=" +
      String(this.confidence) +
      ", offsets=" +
      String(this.offsets) +
      "]"
    );
  }

  /**
   * Java overloads:
   *   toTEI()
   *   toTEI(boolean includeRawCitations)
   *   toTEI(int p)
   *   toTEI(int p, boolean includeRawCitations)
   */
  toTEI(pOrIncludeRaw?: number | boolean, includeRawCitations?: boolean): string {
    let p = -1;
    let includeRaw = false;
    if (typeof pOrIncludeRaw === "boolean") {
      includeRaw = pOrIncludeRaw;
    } else if (typeof pOrIncludeRaw === "number") {
      p = pOrIncludeRaw;
      if (includeRawCitations !== undefined) includeRaw = includeRawCitations;
    }

    if (this.resBib != null) {
      const config = GrobidAnalysisConfig
        .builder()
        .includeRawCitations(includeRaw)
        .build();
      return (this.resBib as Any).toTEI(p, 0, config);
    } else {
      return "";
    }
  }
}
