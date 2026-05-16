// Port of org.grobid.core.engines.tagging.WapitiTagger.
// Upstream: grobid-core/src/main/java/org/grobid/core/engines/tagging/WapitiTagger.java
//
// Thin wrapper over `WapitiModel` (the JNI bridge upstream, the WASM
// bridge in this port). The Java overloads are collapsed into a single
// `label(...)` that accepts either an iterable of feature rows or the
// already-joined feature string, matching upstream behaviour line-for-line.

import type { GenericTagger } from "./generic-tagger.js";
import { WapitiModel } from "../../jni/wapiti-model.js";
import type { GrobidModel } from "../../grobid-model.js";

export class WapitiTagger implements GenericTagger {
  private readonly wapitiModel: InstanceType<typeof WapitiModel>;

  /**
   * Two-overload constructor: from a GrobidModel descriptor or from an
   * explicit file path (used by `TaggerFactory.getTaggerFromPath`).
   */
  constructor(model: GrobidModel);
  constructor(modelFile: string);
  constructor(modelOrFile: GrobidModel | string) {
    // `WapitiModel` upstream has matching overloads `(GrobidModel)` and `(File)`.
    // In Node we use `string` paths instead of `java.io.File`.
    this.wapitiModel = new WapitiModel(modelOrFile);
  }

  label(data: Iterable<string>): Promise<string>;
  label(data: string): Promise<string>;
  label(data: Iterable<string> | string): Promise<string> {
    if (typeof data === "string") {
      return Promise.resolve(this.wapitiModel.label(data) as string);
    }
    const buf: string[] = [];
    for (const d of data) buf.push(d);
    return this.label(buf.join("\n"));
  }

  close(): void {
    this.wapitiModel.close();
  }
}
