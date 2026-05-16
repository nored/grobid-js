// Port of org.grobid.core.engines.ModelMap.
// Upstream: grobid-core/src/main/java/org/grobid/core/engines/ModelMap.java
//
// Class (deprecated upstream) that creates a tagger from a given model or
// reuses it if it already exists. Upstream uses the CRF++ JNI bindings:
// `org.chasen.crfpp.Model` / `org.chasen.crfpp.Tagger`. The JS port keeps
// the same shape via interfaces; the concrete CRF++/WASM bridge is plugged
// in at runtime (the upstream constructor `new Model("-m " + path + " ")`
// is also kept as a runtime hook).
//
// Synchronization (`synchronized` methods) is a no-op in single-threaded JS;
// the calls are preserved as plain method bodies.

import fs from "node:fs";

import { GrobidException } from "../exceptions/grobid-exception.js";
import type { GrobidModel } from "../grobid-model.js";
import { GrobidModels } from "../grobid-models.js";
import { getLogger } from "../utilities/logger.js";

const LOGGER = getLogger("ModelMap");

/**
 * Surface of the CRF++ `Tagger` returned by `Model.createTagger()`. The
 * shape matches `org.chasen.crfpp.Tagger` as it is consumed across the
 * GROBID codebase (see {@link import("./tagging/crfpp-tagger.js").CRFPPTagger}).
 */
export interface CrfppTagger {
  size(): number;
  xsize(): number;
  x(i: number, j: number): string;
  y2(i: number): string;
  clear(): void;
  parse(): boolean;
  what(): string;
  add(piece: string): boolean;
  delete(): void;
}

/** Surface of CRF++ `Model`. */
export interface CrfppModel {
  createTagger(): CrfppTagger;
}

/**
 * Hook used by `ModelMap.getNewModel(path)` to construct a `CrfppModel` for
 * the given path. Replaces upstream's `new org.chasen.crfpp.Model("-m " +
 * modelPath + " ")` JNI call. Implementations register their factory via
 * `ModelMap.setModelFactory(...)` at startup. The default factory throws
 * a {@link GrobidException} — matching upstream behaviour when the native
 * library is missing.
 */
export interface CrfppModelFactory {
  create(args: string): CrfppModel;
}

let modelFactory: CrfppModelFactory = {
  create(args: string): CrfppModel {
    throw new GrobidException(
      "CRF++ Model factory not registered; cannot instantiate Model(" + args + "). " +
        "Register a factory via ModelMap.setModelFactory(...).",
    );
  },
};

/**
 * Class that creates a tagger from a given model or reuse it if it already exists.
 *
 * @deprecated
 */
export class ModelMap {
  /**
   * Map that contains all the models loaded in memory.
   *
   * Upstream `private static Map<String, Model> models = null;` — laziness
   * preserved exactly (initialised on first access inside {@link getModel}).
   */
  private static models: Map<string, CrfppModel> | null = null;

  /**
   * Register the factory used to construct `CrfppModel` instances. Production
   * code calls this once at startup with a CRF++/WASM-backed factory.
   */
  static setModelFactory(factory: CrfppModelFactory): void {
    modelFactory = factory;
  }

  /**
   * Return a model tagger created corresponding to the model given in argument.
   *
   * @param grobidModel the model to use for the creation of the tagger.
   *
   * @deprecated
   */
  static getTagger(grobidModel: GrobidModel): CrfppTagger {
    LOGGER.debug("start getTagger");
    let tagger: CrfppTagger;
    try {
      LOGGER.debug("Creating tagger");
      const model: CrfppModel = ModelMap.getModel(grobidModel.getModelPath());
      tagger = model.createTagger();
    } catch (thb) {
      throw new GrobidException("Cannot instantiate a tagger", thb);
    }
    LOGGER.debug("end getTagger");
    return tagger;
  }

  /**
   * Loading of the models.
   *
   * @deprecated
   */
  static initModels(): void {
    LOGGER.info("Loading models");
    const models: GrobidModels[] = GrobidModels.values();
    for (const model of models) {
      if (fs.existsSync(model.getModelPath())) {
        ModelMap.getModel(model.getModelPath());
      } else {
        LOGGER.info(
          "Loading model " + model.getModelPath() + " failed because the path is not valid.",
        );
      }
    }
    LOGGER.info("Models loaded");
  }

  static getModel(grobidModel: GrobidModel): CrfppModel;
  static getModel(modelPath: string): CrfppModel;
  /**
   * Return the model corresponding to the given path. Models are loaded in
   * memory if they don't exist.
   *
   * @deprecated
   */
  static getModel(arg: GrobidModel | string): CrfppModel {
    if (typeof arg !== "string") {
      return ModelMap.getModel(arg.getModelPath());
    }
    const modelPath = arg;
    LOGGER.debug("start getModel");
    if (ModelMap.models === null) {
      ModelMap.models = new Map<string, CrfppModel>();
    }
    if (!ModelMap.models.has(modelPath)) {
      ModelMap.getNewModel(modelPath);
    }
    LOGGER.debug("end getModel");
    return ModelMap.models.get(modelPath) as CrfppModel;
  }

  /**
   * Set models with a new model.
   *
   * @param modelPath The path of the model to use.
   *
   * @deprecated
   */
  protected static getNewModel(modelPath: string): void {
    LOGGER.info("Loading model " + modelPath + " in memory");
    // Upstream: new Model("-m " + modelPath + " ").
    (ModelMap.models as Map<string, CrfppModel>).set(
      modelPath,
      modelFactory.create("-m " + modelPath + " "),
    );
  }
}
