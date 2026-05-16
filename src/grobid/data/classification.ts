// Port of org.grobid.core.data.Classification.
// Upstream: grobid-core/src/main/java/org/grobid/core/data/Classification.java

/**
 * Class for representing a classification.
 */
export class Classification {
  private classificationScheme: string | null = null;
  private classes: string[] | null = null;
  private rawString: string | null = null;

  getClassificationScheme(): string | null {
    return this.classificationScheme;
  }

  setClassificationScheme(s: string | null): void {
    this.classificationScheme = s;
  }

  getClasses(): string[] | null {
    return this.classes;
  }

  setClasses(c: string[] | null): void {
    this.classes = c;
  }

  getRawString(): string | null {
    return this.rawString;
  }

  setRawString(s: string | null): void {
    this.rawString = s;
  }
}
