// Port of org.grobid.core.utilities.glutton.GluttonClient.
// Upstream: grobid-core/src/main/java/org/grobid/core/utilities/glutton/GluttonClient.java
//
// Client to the Glutton bibliographical service

import { cpus } from "node:os";

import { CrossrefClient } from "../crossref/crossref-client.js";
import type { CrossrefDeserializer } from "../crossref/crossref-deserializer.js";
import type { CrossrefRequestListener } from "../crossref/crossref-request-listener.js";
import { getLogger } from "../logger.js";

import { GluttonRequest } from "./glutton-request.js";
import { GluttonRequestTask } from "./glutton-request-task.js";

export class GluttonClient extends CrossrefClient {
  public static readonly GLUTTON_LOGGER = getLogger("GluttonClient");

  private static gluttonInstance: GluttonClient | null = null;

  //private volatile ExecutorService executorService;

  //private static boolean limitAuto = true;
  //private volatile TimedSemaphore timedSemaphore;

  // this list is used to maintain a list of Futures that were submitted,
  // that we can use to check if the requests are completed
  //private volatile Map<Long, List<Future<?>>> futures = new HashMap<>();

  public static override getInstance(): CrossrefClient {
    if (GluttonClient.gluttonInstance === null) {
      GluttonClient.gluttonInstance = GluttonClient.makeNewGluttonInstance();
    }
    return GluttonClient.gluttonInstance!;
  }

  /**
   * Type-narrowed accessor for callers that need the GluttonClient identity.
   */
  public static getGluttonInstance(): GluttonClient {
    return GluttonClient.getInstance() as GluttonClient;
  }

  /**
   * Creates a new instance.
   */
  private static makeNewGluttonInstance(): GluttonClient {
    GluttonClient.GLUTTON_LOGGER.debug("Get new instance of GluttonClient");
    return new GluttonClient();
  }

  /**
   * Hidden constructor
   */
  private constructor() {
    super();
    /*this.executorService = Executors.newCachedThreadPool(r -> {
            Thread t = Executors.defaultThreadFactory().newThread(r);
            t.setDaemon(true);
            return t;
        });
        this.timedSemaphore = null;
        this.futures = new HashMap<>();*/
    const nThreads = cpus().length;
    //int nThreads = (int) Math.ceil((double)Runtime.getRuntime().availableProcessors() / 2);
    GluttonClient.GLUTTON_LOGGER.debug("nThreads: " + nThreads);
    // Java sets `this.executorService = Executors.newFixedThreadPool(nThreads*2)`;
    // our async port has no thread pool — we just store the size for parity.
    this.setMaxPoolSize(nThreads * 2);
    //setLimits(20, 1000); // default calls per second
  }

  public static override printLog<T>(request: GluttonRequest<T> | { toString(): string } | null, message: string): void {
    GluttonClient.GLUTTON_LOGGER.debug((request !== null ? request + ": " : "") + message);
    //System.out.println((request != null ? request+": " : "")+message);
  }

  /**
   * Push a request in pool to be executed as soon as possible, then wait a response through the listener.
   */
  public async pushGluttonRequest<U>(
    request: GluttonRequest<U>,
    listener: CrossrefRequestListener<U> | null,
    threadId: number,
  ): Promise<void> {
    if (listener !== null) request.addListener(listener);
    const task = new GluttonRequestTask<U>(this, request);
    const f: Promise<void> = task.run();
    let localFutures = this.futures.get(threadId);
    if (localFutures === undefined) localFutures = [];
    localFutures.push(f);
    this.futures.set(threadId, localFutures);
    //System.out.println("add request to thread " + threadId + " / current total for the thread: " +  localFutures.size());
  }

  /**
   * Push a request in pool to be executed soon as possible, then wait a response through the listener.
   *
   * @param model         crossref model parameter (kept for parity with the base class)
   * @param params        query parameters, can be null, ex: ?query.title=[title]&query.author=[author]
   * @param deserializer  json response deserializer, ex: WorkDeserializer to convert Work to BiblioItem
   * @param threadId      the java identifier of the thread providing the request
   * @param listener      catch response from request
   */
  public override async pushRequest<U>(
    requestOrModel: import("../crossref/crossref-request.js").CrossrefRequest<U> | string,
    listenerOrParams: CrossrefRequestListener<U> | Map<string, string> | null,
    threadId: number,
    deserializerArg?: CrossrefDeserializer<U>,
    listenerArg?: CrossrefRequestListener<U> | null,
  ): Promise<void> {
    if (typeof requestOrModel === "string") {
      const model = requestOrModel;
      const params = listenerOrParams as Map<string, string>;
      const deserializer = deserializerArg!;
      const listener = listenerArg ?? null;
      const request = new GluttonRequest<U>(model, params, deserializer);
      await this.pushGluttonRequest(request, listener, threadId);
      return;
    }
    // CrossrefRequest variant — defer to base impl to mirror upstream when a
    // raw CrossrefRequest is provided.
    return super.pushRequest(
      requestOrModel,
      listenerOrParams,
      threadId,
      deserializerArg,
      listenerArg,
    );
  }
}
