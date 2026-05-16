// Port of org.grobid.core.data.Passage.
// Upstream: grobid-core/src/main/java/org/grobid/core/data/Passage.java

/**
 * Class for managing passage of citations.
 */
export class Passage {
  private pageBegin = -1;
  private pageEnd = -1;
  private lineBegin = -1;
  private lineEnd = -1;

  private colBegin: string | null = null;
  private colEnd: string | null = null;

  private figure: string | null = null;
  private table: string | null = null;

  private rawPassage: string | null = null;

  getPageBegin(): number {
    return this.pageBegin;
  }

  getPageEnd(): number {
    return this.pageEnd;
  }

  getLineBegin(): number {
    return this.lineBegin;
  }

  getLineEnd(): number {
    return this.lineEnd;
  }

  getColBegin(): string | null {
    return this.colBegin;
  }

  getColEnd(): string | null {
    return this.colEnd;
  }

  getFigure(): string | null {
    return this.figure;
  }

  getTable(): string | null {
    return this.table;
  }

  getRawPassage(): string | null {
    return this.rawPassage;
  }

  setRawPassage(s: string | null): void {
    this.rawPassage = s;
  }
}
