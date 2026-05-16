// Port of org.grobid.core.document.PatentDocument.
// Upstream: grobid-core/src/main/java/org/grobid/core/document/PatentDocument.java
//
// Class for additional information for patent documents.

import { Document } from "./document.js";
import type { DocumentSource } from "./document-source.js";

/**
 * Upstream PatentDocument.java line 12-83.
 */
export class PatentDocument extends Document {
  // Upstream line 14.
  private beginBlockPAReport: number = -1;

  // Upstream line 16-20.
  // Java flags: CASE_INSENSITIVE | MULTILINE — TS equivalent is `im`.
  static readonly searchReport: RegExp = new RegExp(
    "((international|interna(\\s)+Η(\\s)+onal)(\\s)+(search)(\\s)+(report))|" +
      "((internationaler)(\\s)+(recherchenberich))|" +
      "(I(\\s)+N(\\s)+T(\\s)+E(\\s)+R(\\s)+N(\\s)+A(\\s)+T(\\s)+I(\\s)+O(\\s)+N(\\s)+A(\\s)+L(\\s)+S(\\s)+E(\\s)+A(\\s)+R(\\s)+C(\\s)+H)",
    "im",
  );

  // Upstream line 22-24.
  static readonly FamilyMembers: RegExp = new RegExp("(patent)(\\s)+(famil(v|y))(\\s)+(members)?", "im");

  // Upstream line 26-28.
  constructor(documentSource: DocumentSource) {
    super(documentSource);
  }

  // Upstream line 30-32.
  getBeginBlockPAReport(): number {
    return this.beginBlockPAReport;
  }

  // Upstream line 34-36.
  setBeginBlockPAReport(begin: number): void {
    this.beginBlockPAReport = begin;
  }

  /**
   * Return all blocks corresponding to the prior art report of a WO patent
   * publication.
   *
   * Upstream line 41-81.
   */
  getWOPriorArtBlocks(): string {
    // eslint-disable-next-line no-console
    console.log("getWOPriorArtBlocks");
    const accumulated: string[] = [];
    let i = 0;
    let PAReport = false;
    let newPage = false;
    if (this.getBlocks() !== null) {
      for (const block of this.getBlocks()) {
        let content = block.getText();
        if (content !== null) {
          content = content.trim();
          // NOTE: upstream line 52 — `//System.out.println(content);` (commented-out).
          // NOTE: upstream uses bitwise `&` instead of logical `&&` here (line 53).
          // Preserved verbatim.
          if (newPage && !PAReport) {
            // NOTE: upstream line 54 — `//System.out.println("new page");` (commented-out).
            // Java `m.find()` is `regex.exec(text) !== null` in TS.
            PatentDocument.searchReport.lastIndex = 0;
            const m = PatentDocument.searchReport.exec(content);
            if (m !== null) {
              PAReport = true;
              this.beginBlockPAReport = i;
            }
          }
          // NOTE: upstream lines 63-69 — commented-out FamilyMembers detection block.
          newPage = content.startsWith("@PAGE");
          if (PAReport) {
            accumulated.push(content);
            accumulated.push("\n");
          }
        }
        i++;
      }
    }
    // eslint-disable-next-line no-console
    console.log(accumulated.join(""));
    return accumulated.join("");
  }
}
