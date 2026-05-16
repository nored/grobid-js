// Port of org.grobid.core.data.PriorArtCitation.
// Upstream: grobid-core/src/main/java/org/grobid/core/data/PriorArtCitation.java

// BiblioItem still a stub at this stage of the port.
import * as BiblioItemNs from "./biblio-item.js";
import type { Passage } from "./passage.js";
import type { PatentItem } from "./patent-item.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BiblioItem = any;
void BiblioItemNs;

/**
 * Class for managing citation of patent bibliographical references.
 */
export class PriorArtCitation {
  // cited patent, null if not a patent
  private patent: PatentItem | null = null;

  // cited nlp, null if not a npl
  private npl: BiblioItem | null = null;

  private passages: Passage[] | null = null;
  private category: string | null = null;

  private comment: string | null = null;

  private rawCitation: string | null = null;
  private rawClaims: string | null = null;

  getPatent(): PatentItem | null {
    return this.patent;
  }

  setPatent(item: PatentItem | null): void {
    this.patent = item;
  }

  getNPL(): BiblioItem | null {
    return this.npl;
  }

  setNPL(item: BiblioItem | null): void {
    this.npl = item;
  }

  getPassages(): Passage[] | null {
    return this.passages;
  }

  setPassages(pass: Passage[] | null): void {
    this.passages = pass;
  }

  getCategory(): string | null {
    return this.category;
  }

  setCategory(cat: string | null): void {
    this.category = cat;
  }

  getComment(): string | null {
    return this.comment;
  }

  setComment(comm: string | null): void {
    this.comment = comm;
  }

  getRawCitation(): string | null {
    return this.rawCitation;
  }

  setRawCitation(raw: string | null): void {
    this.rawCitation = raw;
  }

  getRawClaims(): string | null {
    return this.rawClaims;
  }

  setRawClaims(raw: string | null): void {
    this.rawClaims = raw;
  }

  // TODO: TEI based encoding
}
