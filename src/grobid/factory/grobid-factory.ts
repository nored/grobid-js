// Port of org.grobid.core.factory.GrobidFactory.
// Upstream: grobid-core/src/main/java/org/grobid/core/factory/GrobidFactory.java
//
// Factory to get engine instances.

import type { Engine } from "../engines/engine.js";
import { AbstractEngineFactory } from "./abstract-engine-factory.js";

/**
 * Upstream GrobidFactory.java line 8-84.
 */
export class GrobidFactory extends AbstractEngineFactory {
  // Upstream line 13.
  private static factory: GrobidFactory | null = null;

  // Upstream line 18-20.
  protected constructor() {
    super();
    GrobidFactory.init();
  }

  /**
   * Return a new instance of GrobidFactory if it doesn't exist, the
   * existing instance else.
   *
   * Upstream line 28-33.
   */
  static getInstance(): GrobidFactory {
    if (GrobidFactory.factory === null) {
      GrobidFactory.factory = GrobidFactory.newInstance();
    }
    return GrobidFactory.factory;
  }

  // Upstream line 38-49 — both overloads delegate to the parent.
  override getEngine(): Engine;
  override getEngine(preload: boolean): Engine;
  override getEngine(preload?: boolean): Engine {
    if (preload === undefined) {
      return super.getEngine(false);
    }
    return super.getEngine(preload);
  }

  // Upstream line 54-65.
  override createEngine(): Engine;
  override createEngine(preload: boolean): Engine;
  override createEngine(preload?: boolean): Engine {
    if (preload === undefined) {
      return this.createEngine(false);
    }
    return super.createEngine(preload);
  }

  /**
   * Creates a new instance of GrobidFactory.
   *
   * Upstream line 72-74.
   */
  protected static newInstance(): GrobidFactory {
    return new GrobidFactory();
  }

  /**
   * Resets this class and all its static fields. For instance sets the
   * current object to null.
   *
   * Upstream line 80-82.
   */
  static reset(): void {
    GrobidFactory.factory = null;
  }
}
