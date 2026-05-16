// Port of org.grobid.core.data.FundingAcknowledgmentParse.
// Upstream: grobid-core/src/main/java/org/grobid/core/data/FundingAcknowledgmentParse.java

import type { Affiliation } from "./affiliation.js";
import type { Funding } from "./funding.js";
import type { Person } from "./person.js";

/**
 * Represents the funding / acknowledgement statement.
 */
export class FundingAcknowledgmentParse {
  // Package-private in upstream; we expose via getters/setters only.
  private fundingList: Funding[] = [];
  private personList: Person[] = [];
  private affiliations: Affiliation[] = [];
  // List<Pair<OffsetPosition, Element>> statementAnnotations = new ArrayList<>();
  // (Commented out upstream.)

  getFundings(): Funding[] {
    return this.fundingList;
  }

  setFundings(fundingList: Funding[]): void {
    this.fundingList = fundingList;
  }

  getPersons(): Person[] {
    return this.personList;
  }

  setPersons(personList: Person[]): void {
    this.personList = personList;
  }

  getAffiliations(): Affiliation[] {
    return this.affiliations;
  }

  setAffiliations(fundingBodies: Affiliation[]): void {
    this.affiliations = fundingBodies;
  }

  // public List<GrobidAnnotation> getStatementAnnotations() { ... }
  // (Commented out upstream.)
}
