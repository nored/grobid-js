// Port of org.grobid.core.exceptions.GrobidPropertyException.
// Upstream: grobid-core/src/main/java/org/grobid/core/exceptions/GrobidPropertyException.java

import { GrobidException } from "./grobid-exception.js";

export class GrobidPropertyException extends GrobidException {
  constructor(message?: string, cause?: unknown) {
    super(message, cause);
    this.name = "GrobidPropertyException";
  }
}
