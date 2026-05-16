// Port of org.grobid.core.data.DataSetContext.
// Upstream: grobid-core/src/main/java/org/grobid/core/data/DataSetContext.java

/**
 * Representing the context of a reference (to biblio/formula/table/figure).
 */
export class DataSetContext {
  // Java keeps `context` as a public field; mirror it.
  context: string | null = null;
  private documentCoords: string | null = null;
  private teiId: string | null = null;

  getContext(): string | null {
    return this.context;
  }

  setContext(context: string | null): void {
    this.context = context;
  }

  getDocumentCoords(): string | null {
    return this.documentCoords;
  }

  setDocumentCoords(documentCoords: string | null): void {
    this.documentCoords = documentCoords;
  }

  getTeiId(): string | null {
    return this.teiId;
  }

  setTeiId(teiId: string | null): void {
    this.teiId = teiId;
  }
}
