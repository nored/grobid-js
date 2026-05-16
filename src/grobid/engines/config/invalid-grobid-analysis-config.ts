// Port of org.grobid.core.engines.config.InvalidGrobidAnalysisConfig.
// Upstream: grobid-core/src/main/java/org/grobid/core/engines/config/InvalidGrobidAnalysisConfig.java

/**
 * Exception for invalid configs
 */
export class InvalidGrobidAnalysisConfig extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidGrobidAnalysisConfig";
  }
}
