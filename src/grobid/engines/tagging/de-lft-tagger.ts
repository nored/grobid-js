// Port of org.grobid.core.engines.tagging.DeLFTTagger.
// Upstream: grobid-core/src/main/java/org/grobid/core/engines/tagging/DeLFTTagger.java
//
// ADAPTATION: DeLFT support is unavailable in the pure-JS port. Upstream's
// `DeLFTTagger` shells out to a Python virtualenv via JNI/JEP. We keep the
// class compilable so `TaggerFactory`'s switch over the engine enum still
// type-checks and so the `GrobidModels`/`GrobidProperties` surface that
// references DeLFT compiles. Any attempt to instantiate the tagger throws.

import { GrobidException } from "../../exceptions/grobid-exception.js";
import type { GenericTagger } from "./generic-tagger.js";
import type { GrobidModel } from "../../grobid-model.js";

export class DeLFTTagger implements GenericTagger {
  /**
   * Two-arg constructor matches upstream:
   *   `DeLFTTagger(GrobidModel)` and `DeLFTTagger(GrobidModel, String architecture)`.
   * Both throw immediately in this port; DeLFT is not supported in the
   * JS port (it relies on a Python runtime).
   */
  constructor(_model: GrobidModel, _architecture?: string | null) {
    throw new GrobidException(
      "DeLFT (Deep Learning) sequence labelling engine is not supported in the JS port of GROBID. " +
        "Please configure the model to use the WAPITI engine.",
    );
  }

  label(data: Iterable<string>): Promise<string>;
  label(data: string): Promise<string>;
  label(_data: Iterable<string> | string): Promise<string> {
    throw new GrobidException("DeLFT not supported in JS port.");
  }

  close(): void {
    // no-op
  }
}
