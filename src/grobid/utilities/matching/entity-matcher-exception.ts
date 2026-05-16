// Port of org.grobid.core.utilities.matching.EntityMatcherException.
// Upstream: grobid-core/src/main/java/org/grobid/core/utilities/matching/EntityMatcherException.java

export class EntityMatcherException extends Error {
  public override readonly cause: Error | undefined;

  constructor(message?: string, cause?: Error | unknown) {
    super(message);
    this.name = "EntityMatcherException";
    if (cause instanceof Error) {
      this.cause = cause;
    } else if (cause !== undefined && cause !== null) {
      this.cause = new Error(String(cause));
    }
  }
}
