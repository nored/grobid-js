// Port of org.grobid.core.engines.tagging.TaggerFactory.
// Upstream: grobid-core/src/main/java/org/grobid/core/engines/tagging/TaggerFactory.java
//
// Synchronization in Java is replaced by simple, single-threaded JS calls
// (JS executes the factory body atomically per event-loop tick). The
// `cache` and `failedModels` maps are kept as module-level state to match
// upstream's `private static` fields.
//
// Java's `case CRFPP:` / `WAPITI:` / `DELFT:` `switch` over the enum is
// replaced by identity comparisons against the singleton `GrobidCRFEngine`
// instances (the JS port uses class-with-static-fields instead of a Java
// enum — see grobid-crf-engine.ts).

import { getLogger } from "../../utilities/logger.js";
import type { GenericTagger } from "./generic-tagger.js";
import type { GrobidModel } from "../../grobid-model.js";
import { GrobidModels } from "../../grobid-models.js";
import { GrobidProperties } from "../../utilities/grobid-properties.js";
import { GrobidCRFEngine } from "./grobid-crf-engine.js";
import { CRFPPTagger } from "./crfpp-tagger.js";
import { WapitiTagger } from "./wapiti-tagger.js";
import { DeLFTTagger } from "./de-lft-tagger.js";
import { DummyTagger } from "./dummy-tagger.js";
import { BidLSTMCRFFeaturesTagger } from "./bidlstm-crf-features-tagger.js";

/**
 * Factory for a sequence labelling, aka a tagger, instance.
 * Supported implementations are CRF (CRFPP, Wapiti) and Deep Learning (DeLFT).
 */
export class TaggerFactory {
  static readonly LOGGER = getLogger("TaggerFactory");

  private static cache: Map<GrobidModel, GenericTagger> = new Map<GrobidModel, GenericTagger>();
  private static failedModels: Map<string, string> = new Map<string, string>();

  private constructor() {}

  static getTagger(model: GrobidModel): GenericTagger;
  static getTagger(model: GrobidModel, engine: GrobidCRFEngine | null): GenericTagger;
  static getTagger(
    model: GrobidModel,
    engine: GrobidCRFEngine | null,
    architecture: string | null,
  ): GenericTagger;
  static getTagger(
    model: GrobidModel,
    engine?: GrobidCRFEngine | null,
    architecture?: string | null,
  ): GenericTagger {
    if (engine === undefined) {
      return TaggerFactory.getTagger(
        model,
        GrobidProperties.getGrobidEngine(model),
        GrobidProperties.getDelftArchitecture(model),
      );
    }
    if (architecture === undefined) {
      return TaggerFactory.getTagger(model, engine, GrobidProperties.getDelftArchitecture(model));
    }

    let t = TaggerFactory.cache.get(model);
    if (t === undefined) {
      if (model === (GrobidModels as { DUMMY: GrobidModel }).DUMMY) {
        return new DummyTagger(model);
      }

      if (engine !== null) {
        try {
          switch (engine) {
            case GrobidCRFEngine.CRFPP:
              t = new CRFPPTagger(model);
              break;
            case GrobidCRFEngine.WAPITI:
              t = new WapitiTagger(model);
              break;
            case GrobidCRFEngine.DELFT:
              t = new DeLFTTagger(model, architecture);
              break;
            case GrobidCRFEngine.BIDLSTM_CRF_FEATURES:
              t = new BidLSTMCRFFeaturesTagger(model);
              break;
            default:
              throw new Error(
                "Unsupported Grobid sequence labelling engine: " + engine.getExt(),
              );
          }
          TaggerFactory.cache.set(model, t);
        } catch (e) {
          const modelName = model.getModelName();
          const errMsg =
            e instanceof Error && e.message
              ? e.message
              : (e as object).constructor.name;
          TaggerFactory.failedModels.set(modelName, errMsg);
          TaggerFactory.LOGGER.error(
            "Failed to create tagger for model " + modelName + " with engine " + engine,
            e,
          );
          throw e;
        }
      } else {
        // Upstream dereferences `engine.getExt()` after a null check that
        // is guaranteed to fail — preserved verbatim (will NPE / TypeError).
        throw new Error(
          "Unsupported or null Grobid sequence labelling engine: " +
            (engine as unknown as GrobidCRFEngine).getExt(),
        );
      }
    }
    return t;
  }

  /**
   * Create a tagger loading from an explicit file path. Not cached.
   * Currently only supported for the Wapiti engine.
   */
  static getTaggerFromPath(modelFile: string, engine: GrobidCRFEngine): GenericTagger {
    if (engine === GrobidCRFEngine.WAPITI) return new WapitiTagger(modelFile);
    throw new Error("Custom model path is only supported for Wapiti engine, got: " + engine);
  }

  /**
   * Returns a map of successfully loaded models and their engine types.
   */
  static getLoadedModels(): Map<string, string> {
    const loaded: Map<string, string> = new Map<string, string>();
    for (const [model, tagger] of TaggerFactory.cache.entries()) {
      let engineType: string;
      if (tagger instanceof WapitiTagger) {
        engineType = "wapiti";
      } else if (tagger instanceof DeLFTTagger) {
        engineType = "delft";
      } else if (tagger instanceof CRFPPTagger) {
        engineType = "crfpp";
      } else if (tagger instanceof BidLSTMCRFFeaturesTagger) {
        engineType = "bidlstm-crf-features";
      } else {
        engineType = "unknown";
      }
      loaded.set(model.getModelName(), engineType);
    }
    return loaded;
  }

  /**
   * Returns a map of models that failed to load and their error messages.
   */
  static getFailedModels(): ReadonlyMap<string, string> {
    return new Map<string, string>(TaggerFactory.failedModels);
  }

  /**
   * Returns true if any model failed to load.
   */
  static hasFailures(): boolean {
    return TaggerFactory.failedModels.size !== 0;
  }

  /**
   * Clear the module-level tagger cache. Required when re-initialising a
   * GROBID engine in the same process with a different engine config (e.g.
   * switching from all-Wapiti to header-on-BiLSTM in tests). The cache is
   * keyed by GrobidModel singleton, so without this reset a model's tagger
   * is sticky for the lifetime of the JS process.
   */
  static reset(): void {
    for (const t of TaggerFactory.cache.values()) {
      try {
        t.close();
      } catch {
        /* ignore */
      }
    }
    TaggerFactory.cache.clear();
    TaggerFactory.failedModels.clear();
  }
}
