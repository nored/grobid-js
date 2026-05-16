// Port of org.grobid.core.factory.AbstractEngineFactory.
// Upstream: grobid-core/src/main/java/org/grobid/core/factory/AbstractEngineFactory.java
//
// Abstract factory to get engine instance.

import { Engine } from "../engines/engine.js";
import { ModelMap } from "../engines/model-map.js";
import { GrobidCRFEngine } from "../engines/tagging/grobid-crf-engine.js";
import { Lexicon } from "../lexicon/lexicon.js";
import { LibraryLoader } from "../main/library-loader.js";
import { GrobidProperties } from "../utilities/grobid-properties.js";

/**
 * Abstract factory to get engine instance.
 *
 * Upstream AbstractEngineFactory.java line 19-88.
 */
export class AbstractEngineFactory {
  // Upstream line 24.
  private static engine: Engine | null = null;

  // Upstream line 32-34 — overload that defaults `preload` to `false`.
  protected getEngine(): Engine;
  protected getEngine(preload: boolean): Engine;
  protected getEngine(preload?: boolean): Engine {
    if (preload === undefined) {
      // Upstream line 32-34 forwards to the (boolean) overload with `false`.
      return this.getEngine(false);
    }
    // Upstream line 42-47.
    if (AbstractEngineFactory.engine === null) {
      AbstractEngineFactory.engine = this.createEngine(preload);
    }
    return AbstractEngineFactory.engine;
  }

  // Upstream line 54-56 / 63-65.
  protected createEngine(): Engine;
  protected createEngine(preload: boolean): Engine;
  protected createEngine(preload?: boolean): Engine {
    if (preload === undefined) {
      return this.createEngine(false);
    }
    return new Engine(preload);
  }

  /**
   * Initializes all necessary things for starting grobid.
   *
   * Upstream line 70-74.
   */
  static init(): void {
    GrobidProperties.getInstance();
    LibraryLoader.load();
    Lexicon.getInstance();
  }

  /**
   * Initializes all the models.
   *
   * Upstream line 80-87 — marked `@Deprecated`.
   */
  static fullInit(): void {
    AbstractEngineFactory.init();
    const distinctModels: Set<GrobidCRFEngine> = GrobidProperties.getDistinctModels();
    // Upstream: CollectionUtils.containsAny(distinctModels, Collections.singletonList(CRFPP)).
    if (distinctModels.has(GrobidCRFEngine.CRFPP)) {
      ModelMap.initModels();
    }
    // NOTE: upstream line 86 — `//Lexicon.getInstance();` (commented-out).
  }
}
