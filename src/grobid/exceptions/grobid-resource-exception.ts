// Port of org.grobid.core.exceptions.GrobidResourceException.
// Upstream: grobid-core/src/main/java/org/grobid/core/exceptions/GrobidResourceException.java

import { GrobidException } from "./grobid-exception.js";

export class GrobidResourceException extends GrobidException {
  constructor(message?: string, cause?: unknown) {
    super(message, cause);
    this.name = "GrobidResourceException";
  }
}
