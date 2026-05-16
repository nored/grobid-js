// Port of org.grobid.core.utilities.EnvironmentVariableValues.
// Upstream: grobid-core/src/main/java/org/grobid/core/utilities/EnvironmentVariableValues.java

/**
 * Filters environment variables by a regex pattern. Used by upstream to
 * collect env-driven config overrides.
 */
export class EnvironmentVariableValues {
  private readonly configParameters: Map<string, string> = new Map();

  /**
   * Mirrors both upstream constructors: `(matcher)` reads `process.env`,
   * `(envMap, matcher)` lets callers inject a map (useful for tests).
   */
  constructor(matcher: string, environmentVariablesMap?: Record<string, string | undefined>) {
    // Node's process.env values are string | undefined; coerce to string-only.
    const env: Record<string, string | undefined> =
      environmentVariablesMap ?? (typeof process !== "undefined" ? process.env : {});
    const re = new RegExp(matcher);
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) continue;
      if (!re.test(key)) continue;
      this.configParameters.set(key, value);
    }
  }

  getConfigParameters(): Map<string, string> {
    return this.configParameters;
  }
}
