// Port of org.grobid.core.exceptions.GrobidExceptionStatus.
// Upstream: grobid-core/src/main/java/org/grobid/core/exceptions/GrobidExceptionStatus.java

export enum GrobidExceptionStatus {
  BAD_INPUT_DATA = "BAD_INPUT_DATA",
  TAGGING_ERROR = "TAGGING_ERROR",
  PARSING_ERROR = "PARSING_ERROR",
  TIMEOUT = "TIMEOUT",
  TOO_MANY_BLOCKS = "TOO_MANY_BLOCKS",
  NO_BLOCKS = "NO_BLOCKS",
  PDFALTO_CONVERSION_FAILURE = "PDFALTO_CONVERSION_FAILURE",
  TOO_MANY_TOKENS = "TOO_MANY_TOKENS",
  GENERAL = "GENERAL",
}
