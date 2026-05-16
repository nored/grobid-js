// Port of org.grobid.core.engines.tagging.DummyTagger.
// Upstream: grobid-core/src/main/java/org/grobid/core/engines/tagging/DummyTagger.java
//
// Tagger that returns a constant `<dummy>` label for every input row. Used
// for tests and for parsers that don't use a CRF/DeLFT model. Guava
// `Joiner.on('\n').join(...)` becomes `Array.join("\n")`.

import { GrobidException } from "../../exceptions/grobid-exception.js";
import type { GenericTagger } from "./generic-tagger.js";
import { GrobidModels } from "../../grobid-models.js";
import type { GrobidModel } from "../../grobid-model.js";

/**
 * This tagger just return one label <dummy>
 */
export class DummyTagger implements GenericTagger {
  static readonly DUMMY_LABEL: string = "<dummy>";

  constructor(model: GrobidModel) {
    // Java `.equals` on enum identity; in JS, both sides will be the same
    // singleton instance imported from GrobidModels.
    if (model !== (GrobidModels as { DUMMY: GrobidModel }).DUMMY) {
      throw new GrobidException(
        "Cannot use a non-dummy model with the dummy tagger. All dummies or no dummies. ",
      );
    }
  }

  label(data: Iterable<string>): Promise<string>;
  label(data: string): Promise<string>;
  label(data: Iterable<string> | string): Promise<string> {
    if (typeof data === "string") {
      return Promise.resolve("<dummy>");
    }
    const output: string[] = [];
    for (const d of data) {
      output.push(d + "\t" + DummyTagger.DUMMY_LABEL);
    }
    return Promise.resolve(output.join("\n"));
  }

  close(): void {
    // no-op
  }
}
