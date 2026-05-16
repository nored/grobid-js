// Port of `org.grobid.core.jni.DeLFTModel`.
// Upstream: grobid-core/src/main/java/org/grobid/core/jni/DeLFTModel.java
//
// ADAPTATION: DeLFT support is unavailable in the pure-JS port. Upstream
// instantiates a Python interpreter via JEP (Java Embedded Python) to call
// into the DeLFT sequence-labelling stack. The JS runtime cannot host a
// Python process inside the engine, so every constructor and every public
// method throws `"DeLFT not supported in JS port"`.
//
// The full Java surface is preserved (constructor signature, every public
// method, every static method, inner-class names) so that callers in
// `engines/tagging/*` continue to compile and so that future replacements
// (e.g. a WASM port of `delft.sequenceLabelling`) can drop in without API
// churn. The "throw-on-construct" pattern matches the agreed approach used
// by `src/grobid/engines/tagging/de-lft-tagger.ts`.

import { GrobidException } from "../exceptions/grobid-exception.js";
import { getLogger } from "../utilities/logger.js";
import type { GrobidModel } from "../grobid-model.js";

const LOGGER = getLogger("DeLFTModel");
void LOGGER; // referenced by docstrings only — silence unused warning

const NOT_SUPPORTED = "DeLFT not supported in JS port";

export class DeLFTModel {
  private readonly modelName: string;
  private readonly architecture: string;

  /**
   * Port of upstream's only constructor:
   *   `DeLFTModel(GrobidModel model, String architecture)`.
   * Mirrors `this.modelName = model.getModelName().replace("-", "_")` so the
   * field is observable through the (also-throwing) accessors below if the
   * caller chooses to introspect.
   */
  constructor(model: GrobidModel, architecture: string) {
    this.modelName = model.getModelName().replace(/-/g, "_");
    this.architecture = architecture;
    throw new GrobidException(NOT_SUPPORTED);
  }

  /** Port of `DeLFTModel.label(String data)`. */
  label(_data: string): string {
    void this.modelName;
    void this.architecture;
    throw new GrobidException(NOT_SUPPORTED);
  }

  /** Port of `DeLFTModel.trainJNI`. */
  static trainJNI(
    _modelName: string,
    _trainingData: string,
    _outputModel: string,
    _architecture: string | null,
    _incremental: boolean,
  ): void {
    throw new GrobidException(NOT_SUPPORTED);
  }

  /** Port of `DeLFTModel.train`. */
  static train(
    _modelName: string,
    _trainingData: string,
    _outputModel: string,
    _architecture: string | null,
    _incremental: boolean,
  ): void {
    throw new GrobidException(NOT_SUPPORTED);
  }

  /** Port of `DeLFTModel.close`. */
  close(): void {
    throw new GrobidException(NOT_SUPPORTED);
  }
}

// ---------------------------------------------------------------------
// Inner classes (preserved verbatim by name; constructors throw so the
// names alone keep TaggerFactory introspection / `instanceof` checks
// well-typed). Upstream nests these inside `DeLFTModel`; TS doesn't have
// inner classes the same way, so we export them separately as a
// transparent renaming.
// ---------------------------------------------------------------------

/** Mirrors `DeLFTModel.InitModel` (private inner class). */
export class DeLFTModelInitModel {
  constructor(_modelName: string, _modelPath: string, _architecture: string) {
    throw new GrobidException(NOT_SUPPORTED);
  }
  run(): void { throw new GrobidException(NOT_SUPPORTED); }
}

/** Mirrors `DeLFTModel.LabelTask` (private inner Callable<String>). */
export class DeLFTModelLabelTask {
  constructor(_modelName: string, _data: string, _architecture: string) {
    throw new GrobidException(NOT_SUPPORTED);
  }
  call(): string { throw new GrobidException(NOT_SUPPORTED); }
}

/** Mirrors `DeLFTModel.TrainTask`. */
export class DeLFTModelTrainTask {
  constructor(
    _modelName: string,
    _trainPath: string,
    _modelPath: string,
    _architecture: string | null,
    _incremental: boolean,
  ) {
    throw new GrobidException(NOT_SUPPORTED);
  }
  run(): void { throw new GrobidException(NOT_SUPPORTED); }
}

/** Mirrors `DeLFTModel.CloseModel`. */
export class DeLFTModelCloseModel {
  constructor(_modelName: string) { throw new GrobidException(NOT_SUPPORTED); }
  run(): void { throw new GrobidException(NOT_SUPPORTED); }
}

/** Mirrors `DeLFTModel.SimpleStreamGobbler`. */
export class DeLFTModelSimpleStreamGobbler {
  constructor(_inputStream: unknown, _consumer: (s: string) => void) {
    throw new GrobidException(NOT_SUPPORTED);
  }
  run(): void { throw new GrobidException(NOT_SUPPORTED); }
}

/** Mirrors `DeLFTModel.CustomStreamGobbler`. */
export class DeLFTModelCustomStreamGobbler {
  constructor(_is: unknown, _os: unknown) {
    throw new GrobidException(NOT_SUPPORTED);
  }
  run(): void { throw new GrobidException(NOT_SUPPORTED); }
}
