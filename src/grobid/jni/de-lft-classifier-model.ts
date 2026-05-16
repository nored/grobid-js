// Port of `org.grobid.core.jni.DeLFTClassifierModel`.
// Upstream: grobid-core/src/main/java/org/grobid/core/jni/DeLFTClassifierModel.java
//
// ADAPTATION: same "throw-on-construct" pattern as `de-lft-model.ts`. DeLFT
// requires a Python interpreter via JEP; the JS runtime cannot host one, so
// every constructor and method throws `"DeLFT not supported in JS port"`.
// The full Java surface (every constructor, every method, every inner class
// name) is preserved so consumers in `engines/tagging/*` keep compiling.

import { GrobidException } from "../exceptions/grobid-exception.js";

const NOT_SUPPORTED = "DeLFT not supported in JS port";

export class DeLFTClassifierModel {
  private readonly modelName: string;
  private readonly architecture: string;

  /**
   * Port of upstream's `DeLFTClassifierModel(String model, String architecture)`.
   */
  constructor(model: string, architecture: string) {
    this.modelName = model;
    this.architecture = architecture;
    throw new GrobidException(NOT_SUPPORTED);
  }

  /**
   * Port of `DeLFTClassifierModel.classify(List<String> data)`. Returns the
   * JSON-encoded prediction array.
   */
  classify(_data: readonly string[]): string {
    void this.modelName;
    void this.architecture;
    throw new GrobidException(NOT_SUPPORTED);
  }

  /** Port of `DeLFTClassifierModel.trainJNI`. */
  static trainJNI(_modelName: string, _trainingData: string, _outputModel: string): void {
    throw new GrobidException(NOT_SUPPORTED);
  }

  /** Port of `DeLFTClassifierModel.train`. */
  static train(_modelName: string, _trainingData: string, _outputModel: string): void {
    throw new GrobidException(NOT_SUPPORTED);
  }

  /** Port of `DeLFTClassifierModel.close`. */
  close(): void {
    throw new GrobidException(NOT_SUPPORTED);
  }
}

// ---------------------------------------------------------------------
// Inner-class shells (every name preserved). All throw on construction.
// ---------------------------------------------------------------------

/** Mirrors `DeLFTClassifierModel.InitModel`. */
export class DeLFTClassifierModelInitModel {
  constructor(_modelName: string, _modelPath: string, _architecture: string) {
    throw new GrobidException(NOT_SUPPORTED);
  }
  run(): void { throw new GrobidException(NOT_SUPPORTED); }
}

/** Mirrors `DeLFTClassifierModel.ClassificationTask`. */
export class DeLFTClassifierModelClassificationTask {
  constructor(_modelName: string, _data: readonly string[]) {
    throw new GrobidException(NOT_SUPPORTED);
  }
  call(): string { throw new GrobidException(NOT_SUPPORTED); }
}

/** Mirrors `DeLFTClassifierModel.TrainTask`. */
export class DeLFTClassifierModelTrainTask {
  constructor(_modelName: string, _trainPath: string, _modelPath: string) {
    throw new GrobidException(NOT_SUPPORTED);
  }
  run(): void { throw new GrobidException(NOT_SUPPORTED); }
}

/** Mirrors `DeLFTClassifierModel.CloseModel`. */
export class DeLFTClassifierModelCloseModel {
  constructor(_modelName: string) { throw new GrobidException(NOT_SUPPORTED); }
  run(): void { throw new GrobidException(NOT_SUPPORTED); }
}

/** Mirrors `DeLFTClassifierModel.SimpleStreamGobbler`. */
export class DeLFTClassifierModelSimpleStreamGobbler {
  constructor(_inputStream: unknown, _consumer: (s: string) => void) {
    throw new GrobidException(NOT_SUPPORTED);
  }
  run(): void { throw new GrobidException(NOT_SUPPORTED); }
}

/** Mirrors `DeLFTClassifierModel.CustomStreamGobbler`. */
export class DeLFTClassifierModelCustomStreamGobbler {
  constructor(_is: unknown, _os: unknown) {
    throw new GrobidException(NOT_SUPPORTED);
  }
  run(): void { throw new GrobidException(NOT_SUPPORTED); }
}
