// Smoke test that the SDK-level `consolidateHeader` / `consolidateCitations`
// options propagate all the way into the `GrobidAnalysisConfig`.
//
// We don't drive a full PDF through the engine here (that's covered by the
// other integration tests and requires the asset downloads); instead we
// poke at the private `buildAnalysisConfig` via a tiny subclass and verify
// the resulting config reports the expected consolidation level. This
// catches regressions in the option-mapping logic (boolean ↔ "always" ↔ int)
// without needing the CRF stack.

import { describe, it, expect } from "vitest";
import { Grobid } from "../../src/node/grobid.js";
import type { GrobidAnalysisConfig } from "../../src/grobid/engines/config/grobid-analysis-config.js";

class GrobidPeeker extends Grobid {
  /**
   * Expose the otherwise-private `buildAnalysisConfig()` so tests can
   * verify the consolidation levels without booting the full Engine.
   */
  peekConfig(): GrobidAnalysisConfig {
    return (this as unknown as { buildAnalysisConfig(): GrobidAnalysisConfig }).buildAnalysisConfig();
  }
}

describe("consolidate option wiring", () => {
  it("defaults to no consolidation when option omitted", () => {
    const cfg = new GrobidPeeker({}).peekConfig();
    expect(cfg.getConsolidateHeader()).toBe(0);
    expect(cfg.getConsolidateCitations()).toBe(0);
  });

  it("maps `false` to level 0", () => {
    const cfg = new GrobidPeeker({
      consolidateHeader: false,
      consolidateCitations: false,
    }).peekConfig();
    expect(cfg.getConsolidateHeader()).toBe(0);
    expect(cfg.getConsolidateCitations()).toBe(0);
  });

  it("maps `true` to level 1 (consolidate-and-correct)", () => {
    const cfg = new GrobidPeeker({
      consolidateHeader: true,
      consolidateCitations: true,
    }).peekConfig();
    expect(cfg.getConsolidateHeader()).toBe(1);
    expect(cfg.getConsolidateCitations()).toBe(1);
  });

  it("maps `2` to level 2 (inject identifiers only)", () => {
    const cfg = new GrobidPeeker({
      consolidateHeader: 2,
      consolidateCitations: 2,
    }).peekConfig();
    expect(cfg.getConsolidateHeader()).toBe(2);
    expect(cfg.getConsolidateCitations()).toBe(2);
  });

  it("maps `\"always\"` to level 3", () => {
    const cfg = new GrobidPeeker({
      consolidateHeader: "always",
      consolidateCitations: "always",
    }).peekConfig();
    expect(cfg.getConsolidateHeader()).toBe(3);
    expect(cfg.getConsolidateCitations()).toBe(3);
  });

  it("lets configureAnalysis override the SDK-level toggle (hook runs after)", () => {
    const cfg = new GrobidPeeker({
      consolidateHeader: true, // → level 1
      configureAnalysis: (b) => b.consolidateHeader(2), // → level 2
    }).peekConfig();
    expect(cfg.getConsolidateHeader()).toBe(2);
  });
});
