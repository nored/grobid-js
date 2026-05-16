// Port of org.grobid.core.factory.GrobidPoolingFactory.
// Upstream: grobid-core/src/main/java/org/grobid/core/factory/GrobidPoolingFactory.java
//
// Upstream uses Apache Commons Pool 1.x (`GenericObjectPool<Engine>`). We
// port the small slice that is exercised by GROBID's callers — borrow,
// return, count active/idle/max, and "exhausted action = block". The pool
// is implemented as a queue of idle engines plus a queue of waiters
// awaiting an engine, with a max-wait timeout taken from
// `GrobidProperties.getPoolMaxWait()`.

import type { Engine } from "../engines/engine.js";
import { GrobidException } from "../exceptions/grobid-exception.js";
import { GrobidProperties } from "../utilities/grobid-properties.js";
import { getLogger } from "../utilities/logger.js";
import { AbstractEngineFactory } from "./abstract-engine-factory.js";

const LOGGER = getLogger("GrobidPoolingFactory");

/**
 * Minimal port of `org.apache.commons.pool.impl.GenericObjectPool` covering
 * only the methods used by GROBID. The factory parameter is an instance of
 * `GrobidPoolingFactory` itself (which extends `PoolableObjectFactory<Engine>`).
 */
class GenericObjectPool<T> {
  private factory: PoolableObjectFactory<T>;
  private idle: T[] = [];
  private active: number = 0;
  private maxActive: number = 8;
  private maxIdle: number = 0;
  private maxWait: number = -1; // -1 = wait forever, in milliseconds.
  private waiters: Array<{ resolve(v: T): void; reject(err: Error): void; timer: NodeJS.Timeout | null }> = [];
  private lifo: boolean = true;

  constructor(factory: PoolableObjectFactory<T>) {
    this.factory = factory;
  }

  setWhenExhaustedAction(_action: number): void {
    // Always WHEN_EXHAUSTED_BLOCK (upstream value 1) — no-op in this port.
  }
  setMaxWait(maxWait: number): void {
    this.maxWait = maxWait;
  }
  setMaxActive(maxActive: number): void {
    this.maxActive = maxActive;
  }
  setTestWhileIdle(_v: boolean): void {
    // unused — upstream calls with false.
  }
  setLifo(lifo: boolean): void {
    this.lifo = lifo;
  }
  setTimeBetweenEvictionRunsMillis(_ms: number): void {
    // unused — no eviction thread in this port.
  }
  setMaxIdle(maxIdle: number): void {
    this.maxIdle = maxIdle;
  }

  getNumActive(): number {
    return this.active;
  }
  getNumIdle(): number {
    return this.idle.length;
  }
  getMaxActive(): number {
    return this.maxActive;
  }

  async borrowObject(): Promise<T> {
    // Try idle pool first.
    if (this.idle.length > 0) {
      const obj = this.lifo ? this.idle.pop()! : this.idle.shift()!;
      this.active++;
      await this.factory.activateObject(obj);
      return obj;
    }
    // Capacity available — create new.
    if (this.active < this.maxActive) {
      this.active++;
      try {
        return await this.factory.makeObject();
      } catch (e) {
        this.active--;
        throw e;
      }
    }
    // Exhausted — block waiting for a returnObject or timeout.
    return new Promise<T>((resolve, reject) => {
      let timer: NodeJS.Timeout | null = null;
      const waiter = { resolve, reject, timer: null as NodeJS.Timeout | null };
      if (this.maxWait > 0) {
        timer = setTimeout(() => {
          const idx = this.waiters.indexOf(waiter);
          if (idx >= 0) this.waiters.splice(idx, 1);
          reject(new Error("NoSuchElementException: timeout waiting for engine"));
        }, this.maxWait);
        waiter.timer = timer;
      }
      this.waiters.push(waiter);
    });
  }

  async returnObject(obj: T): Promise<void> {
    this.active--;
    await this.factory.passivateObject(obj);
    if (this.waiters.length > 0) {
      const w = this.waiters.shift()!;
      if (w.timer !== null) clearTimeout(w.timer);
      this.active++;
      await this.factory.activateObject(obj);
      w.resolve(obj);
      return;
    }
    if (this.idle.length < this.maxIdle) {
      this.idle.push(obj);
    } else {
      // Drop — maxIdle is 0 upstream so this is the normal path.
      await this.factory.destroyObject(obj);
    }
  }
}

/** Minimal port of `org.apache.commons.pool.PoolableObjectFactory`. */
interface PoolableObjectFactory<T> {
  makeObject(): Promise<T> | T;
  activateObject(arg: T): Promise<void> | void;
  destroyObject(arg: T): Promise<void> | void;
  passivateObject(arg: T): Promise<void> | void;
  validateObject(arg: T): boolean;
}

/**
 * Upstream GrobidPoolingFactory.java line 13-167.
 */
export class GrobidPoolingFactory
  extends AbstractEngineFactory
  implements PoolableObjectFactory<Engine>
{
  // Upstream line 19.
  private static grobidEnginePool: GenericObjectPool<Engine> | null = null;
  // Upstream line 20 — kept as the `synchronizer` lock (no-op in JS).
  // private static grobidEnginePoolControl: object = {};

  // Upstream line 24.
  private static preload: boolean = false;

  // Upstream line 29-32.
  protected constructor() {
    super();
    // NOTE: upstream line 30 — `//fullInit();` (commented-out).
    GrobidPoolingFactory.init();
  }

  /**
   * Creates a pool for `Engine` objects.
   *
   * Upstream line 40-60.
   */
  protected static newPoolInstance(): GenericObjectPool<Engine> {
    if (GrobidPoolingFactory.grobidEnginePool === null) {
      LOGGER.debug("synchronized newPoolInstance");
      // Upstream's double-checked locking on `grobidEnginePoolControl` is a
      // single-threaded no-op here.
      if (GrobidPoolingFactory.grobidEnginePool === null) {
        const pool = new GenericObjectPool<Engine>(GrobidPoolingFactory.newInstance());
        GrobidPoolingFactory.grobidEnginePool = pool;
        // NOTE: upstream line 47 — `//grobidEnginePool.setFactory(...)`
        // (commented-out).
        // GenericObjectPool.WHEN_EXHAUSTED_BLOCK = 1.
        pool.setWhenExhaustedAction(1);
        pool.setMaxWait(GrobidProperties.getPoolMaxWait());
        pool.setMaxActive(GrobidProperties.getMaxConcurrency());
        pool.setTestWhileIdle(false);
        pool.setLifo(false);
        pool.setTimeBetweenEvictionRunsMillis(2000);
        pool.setMaxIdle(0);
      }
    }
    return GrobidPoolingFactory.grobidEnginePool!;
  }

  /**
   * Obtains an instance from this pool.
   *
   * Upstream line 68-85 — synchronous in Java but the pool may block; in TS
   * we expose an async variant. The synchronous `getEngineFromPool` is kept
   * as a wrapper that returns the promise.
   */
  static async getEngineFromPool(preloadModels: boolean): Promise<Engine> {
    GrobidPoolingFactory.preload = preloadModels;
    if (GrobidPoolingFactory.grobidEnginePool === null) {
      GrobidPoolingFactory.grobidEnginePool = GrobidPoolingFactory.newPoolInstance();
    }
    let engine: Engine;
    try {
      engine = await GrobidPoolingFactory.grobidEnginePool.borrowObject();
    } catch (exp) {
      if (exp instanceof Error && exp.message.includes("NoSuchElementException")) {
        throw new Error("NoSuchElementException");
      }
      throw new GrobidException(
        "An error occurred while getting an engine from the engine pool",
        exp instanceof Error ? exp : new Error(String(exp)),
      );
    }
    LOGGER.info(
      "Number of Engines in pool active/max: " +
        GrobidPoolingFactory.grobidEnginePool.getNumActive() +
        "/" +
        GrobidPoolingFactory.grobidEnginePool.getMaxActive(),
    );
    return engine;
  }

  /**
   * By contract, engine must have been obtained using
   * `GrobidPoolingFactory.getEngineFromPool`.
   *
   * Upstream line 91-101.
   */
  static async returnEngine(engine: Engine): Promise<void> {
    try {
      // NOTE: upstream line 93 — `//engine.close();` (commented-out).
      if (GrobidPoolingFactory.grobidEnginePool === null) {
        LOGGER.error("grobidEnginePool is null !");
      }
      await GrobidPoolingFactory.grobidEnginePool!.returnObject(engine);
    } catch (exp) {
      throw new GrobidException(
        "An error occurred while returning an engine from the engine pool",
        exp instanceof Error ? exp : new Error(String(exp)),
      );
    }
  }

  /**
   * Creates and returns an instance of GROBIDFactory. The `init()` method
   * will be called.
   *
   * Upstream line 109-111.
   */
  protected static newInstance(): GrobidPoolingFactory {
    return new GrobidPoolingFactory();
  }

  // Upstream line 113-115.
  activateObject(_arg: Engine): void {
    // no-op
  }

  // Upstream line 117-119.
  destroyObject(_engine: Engine): void {
    // no-op
  }

  // Upstream line 122-125.
  makeObject(): Engine {
    return this.createEngine(GrobidPoolingFactory.preload);
  }

  // Upstream line 127-129.
  passivateObject(_arg: Engine): void {
    // no-op
  }

  // Upstream line 131-134.
  validateObject(_arg: Engine): boolean {
    return false;
  }

  /**
   * Returns whether the engine pool has been initialized.
   *
   * Upstream line 139-141.
   */
  static isPoolInitialized(): boolean {
    return GrobidPoolingFactory.grobidEnginePool !== null;
  }

  /**
   * Returns the number of currently borrowed (active) engines, or -1 if
   * pool is not initialized.
   *
   * Upstream line 146-149.
   */
  static getActiveEngineCount(): number {
    const pool = GrobidPoolingFactory.grobidEnginePool;
    return pool !== null ? pool.getNumActive() : -1;
  }

  /**
   * Returns the number of idle engines in the pool, or -1 if pool is not
   * initialized.
   *
   * Upstream line 154-157.
   */
  static getIdleEngineCount(): number {
    const pool = GrobidPoolingFactory.grobidEnginePool;
    return pool !== null ? pool.getNumIdle() : -1;
  }

  /**
   * Returns the configured maximum number of active engines, or -1 if pool
   * is not initialized.
   *
   * Upstream line 162-165.
   */
  static getMaxActiveEngineCount(): number {
    const pool = GrobidPoolingFactory.grobidEnginePool;
    return pool !== null ? pool.getMaxActive() : -1;
  }
}
