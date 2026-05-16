// Port of org.grobid.core.utilities.crossref.CrossrefClient.
// Upstream: grobid-core/src/main/java/org/grobid/core/utilities/crossref/CrossrefClient.java
//
// Request pool to get data from api.crossref.org without exceeding limits
// supporting multi-thread.
//
// CrossRef enforces two types of limits depending on the API pool:
// - Rate limit (x-rate-limit-limit / x-rate-limit-interval): max requests per time interval
// - Concurrency limit (x-concurrency-limit): max simultaneous requests
//
// Plus tier: rate=150/sec, no concurrency limit
// Polite tier: rate=10/sec, concurrency=3
// Public tier: rate=5/sec, concurrency=1
//
// See https://www.crossref.org/documentation/retrieve-metadata/rest-api/access-and-authentication/

import { GrobidProperties } from "../grobid-properties.js";
import { getLogger } from "../logger.js";

import type { CrossrefDeserializer } from "./crossref-deserializer.js";
import { CrossrefRequest } from "./crossref-request.js";
import type { CrossrefRequestListener } from "./crossref-request-listener.js";
import { CrossrefRequestTask } from "./crossref-request-task.js";

export class CrossrefClient {
  public static readonly LOGGER = getLogger("CrossrefClient");

  protected static instance: CrossrefClient | null = null;

  // Concurrency limit: max simultaneous requests (from x-concurrency-limit header)
  // Plus tier has no concurrency limit; Polite=3, Public=1
  protected maxPoolSize: number = 1;
  protected configuredPoolSize: number = 1;
  protected static limitAuto: boolean = true;

  // Default rate limits per tier (requests per second)
  // See https://www.crossref.org/documentation/retrieve-metadata/rest-api/access-and-authentication/
  private static readonly PLUS_RATE_LIMIT: number = 150;
  private static readonly POLITE_RATE_LIMIT: number = 10;
  private static readonly PUBLIC_RATE_LIMIT: number = 5;

  // Default concurrency limits per tier
  private static readonly PLUS_CONCURRENCY: number = 50; // no official limit, practical cap
  private static readonly POLITE_CONCURRENCY: number = 3;
  private static readonly PUBLIC_CONCURRENCY: number = 1;

  // exponential backoff with jitter for rate limiting (HTTP 429)
  // Uses "full jitter" strategy: sleep = random(0, min(cap, base * 2^attempt))
  protected backoffAttempt: number = 0;
  private static readonly BACKOFF_BASE_MS: number = 1000;
  private static readonly MAX_BACKOFF_MS: number = 60_000;

  // Minimum delay between submitting consecutive requests (milliseconds).
  // Computed from rate limit: intervalMs / rateLimit.
  // Can be overridden via grobid.yaml minRequestIntervalMs (>0 to override, <=0 for auto).
  private minRequestIntervalMs: number = 200; // Public default: 1000/5
  private lastRequestTimeMs: number = 0;

  // when true, the API token is not sent in request headers (disabled after validation failure or 401)
  protected tokenDisabled: boolean = false;

  // active task count (mirrors getActiveCount() of the underlying ThreadPoolExecutor)
  protected activeCount: number = 0;

  // this list is used to maintain a list of "futures" that were submitted,
  // so we can wait on them at finish(threadId).
  protected futures: Map<number, Promise<void>[]> = new Map();

  public static getInstance(): CrossrefClient {
    if (CrossrefClient.instance === null) {
      CrossrefClient.getNewInstance();
    }
    return CrossrefClient.instance!;
  }

  /**
   * Creates a new instance.
   */
  private static getNewInstance(): void {
    CrossrefClient.LOGGER.debug("Get new instance of CrossrefClient");
    CrossrefClient.instance = new CrossrefClient();
  }

  /**
   * Hidden constructor
   */
  protected constructor() {
    this.futures = new Map();

    // set initial pool size and rate limit based on API tier
    this.initializeTierLimits();

    // validate Plus tier token at startup
    if (this.hasToken()) {
      // Fire-and-forget; original Java does this synchronously in the constructor.
      void this.validateApiToken();
    }
  }

  private hasToken(): boolean {
    try {
      return GrobidProperties.getCrossrefToken() !== null;
    } catch (e) {
      void e;
      return false;
    }
  }

  /**
   * Initialize concurrency and rate limits based on CrossRef API tier.
   * Plus: rate=150/sec, no concurrency limit (practical cap at 50)
   * Polite: rate=10/sec, concurrency=3
   * Public: rate=5/sec, concurrency=1
   *
   * If the user has set minRequestIntervalMs > 0 in config, that overrides the tier-based rate.
   */
  private initializeTierLimits(): void {
    let concurrency: number;
    let rateIntervalMs: number;

    try {
      if (this.hasToken()) {
        // Plus tier: start with Polite defaults until validation confirms Plus pool.
        // validateApiToken() will upgrade if the token is valid.
        concurrency = CrossrefClient.POLITE_CONCURRENCY;
        rateIntervalMs = Math.trunc(1000 / CrossrefClient.POLITE_RATE_LIMIT); // 100ms
        CrossrefClient.LOGGER.info(
          "CrossRef API tier: Plus (token set) - starting with Polite defaults " +
            "(concurrency: " +
            concurrency +
            ", rate: " +
            CrossrefClient.POLITE_RATE_LIMIT +
            " req/sec) " +
            "until token is validated",
        );
      } else {
        let mailto: string | null = null;
        try {
          mailto = GrobidProperties.getCrossrefMailto();
        } catch (e) {
          void e;
        }
        if (mailto !== null) {
          concurrency = CrossrefClient.POLITE_CONCURRENCY;
          rateIntervalMs = Math.trunc(1000 / CrossrefClient.POLITE_RATE_LIMIT); // 100ms
          CrossrefClient.LOGGER.info(
            "CrossRef API tier: Polite (mailto set) - concurrency: " +
              concurrency +
              ", rate: " +
              CrossrefClient.POLITE_RATE_LIMIT +
              " req/sec",
          );
        } else {
          concurrency = CrossrefClient.PUBLIC_CONCURRENCY;
          rateIntervalMs = Math.trunc(1000 / CrossrefClient.PUBLIC_RATE_LIMIT); // 200ms
          CrossrefClient.LOGGER.info(
            "CrossRef API tier: Public (no mailto, no token) - concurrency: " +
              concurrency +
              ", rate: " +
              CrossrefClient.PUBLIC_RATE_LIMIT +
              " req/sec",
          );
        }
      }
    } catch (e) {
      void e;
      concurrency = CrossrefClient.PUBLIC_CONCURRENCY;
      rateIntervalMs = Math.trunc(1000 / CrossrefClient.PUBLIC_RATE_LIMIT);
    }

    this.configuredPoolSize = concurrency;
    this.setMaxPoolSize(concurrency);

    // Allow config override for rate limit
    try {
      const configOverride = GrobidProperties.getCrossrefMinRequestInterval();
      if (configOverride > 0) {
        this.minRequestIntervalMs = configOverride;
        CrossrefClient.LOGGER.info(
          "CrossRef rate limit overridden by config: " +
            configOverride +
            "ms between requests",
        );
      } else {
        this.minRequestIntervalMs = rateIntervalMs;
      }
    } catch (e) {
      void e;
      this.minRequestIntervalMs = rateIntervalMs;
    }
  }

  /**
   * Returns whether the API token has been disabled (due to validation failure or 401 response).
   * When true, requests should not include the Crossref-Plus-API-Token header.
   */
  public isTokenDisabled(): boolean {
    return this.tokenDisabled;
  }

  /**
   * Disable the API token and downgrade concurrency to polite or public tier.
   */
  public disableToken(): void {
    if (!this.tokenDisabled) {
      this.tokenDisabled = true;
      let mailto: string | null = null;
      try {
        mailto = GrobidProperties.getCrossrefMailto();
      } catch (e) {
        void e;
      }
      if (mailto !== null) {
        this.configuredPoolSize = CrossrefClient.POLITE_CONCURRENCY;
        this.setMaxPoolSize(CrossrefClient.POLITE_CONCURRENCY);
        this.minRequestIntervalMs = Math.trunc(1000 / CrossrefClient.POLITE_RATE_LIMIT);
        CrossrefClient.LOGGER.warn(
          "CrossRef API token disabled. Falling back to polite tier " +
            "(concurrency: " +
            CrossrefClient.POLITE_CONCURRENCY +
            ", rate: " +
            CrossrefClient.POLITE_RATE_LIMIT +
            " req/sec)",
        );
      } else {
        this.configuredPoolSize = CrossrefClient.PUBLIC_CONCURRENCY;
        this.setMaxPoolSize(CrossrefClient.PUBLIC_CONCURRENCY);
        this.minRequestIntervalMs = Math.trunc(1000 / CrossrefClient.PUBLIC_RATE_LIMIT);
        CrossrefClient.LOGGER.warn(
          "CrossRef API token disabled. Falling back to public tier " +
            "(concurrency: " +
            CrossrefClient.PUBLIC_CONCURRENCY +
            ", rate: " +
            CrossrefClient.PUBLIC_RATE_LIMIT +
            " req/sec)",
        );
      }
    }
  }

  /**
   * Validate the CrossRef API token by making a lightweight request at startup.
   * On success: upgrade to Plus tier limits (rate=150/sec, no concurrency cap).
   * On failure: stay at Polite defaults until response headers confirm actual tier.
   */
  private async validateApiToken(): Promise<void> {
    const validationTimeout = 5000; // 5 seconds

    try {
      const headers: Record<string, string> = {};
      const token = GrobidProperties.getCrossrefToken();
      if (token !== null) {
        headers["Crossref-Plus-API-Token"] = "Bearer " + token;
      }
      const mailto = GrobidProperties.getCrossrefMailto();
      if (mailto !== null) {
        headers["User-Agent"] =
          "GROBID/" +
          GrobidProperties.getVersion() +
          " (https://github.com/kermitt2/grobid; mailto:" +
          mailto +
          ")";
      } else {
        headers["User-Agent"] =
          "GROBID/" +
          GrobidProperties.getVersion() +
          " (https://github.com/kermitt2/grobid)";
      }

      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), validationTimeout);
      let response: Response;
      try {
        response = await fetch("https://api.crossref.org/works?rows=0", {
          method: "GET",
          headers,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(t);
      }
      const status = response.status;

      if (status >= 200 && status < 300) {
        const apiPoolHeader = response.headers.get("x-api-pool");
        const apiPool: string | null = apiPoolHeader !== null ? apiPoolHeader.trim() : null;

        if (apiPool !== null && apiPool.toLowerCase() === "plus") {
          this.applyPlusLimitsFromHeaders(response);
        } else {
          CrossrefClient.LOGGER.warn(
            "CrossRef API token not recognized as Plus tier (pool: " + apiPool + ").",
          );
          this.disableToken();
        }
      } else {
        CrossrefClient.LOGGER.warn(
          "CrossRef API token validation failed (HTTP " + status + ").",
        );
        this.disableToken();
      }
    } catch (e) {
      CrossrefClient.LOGGER.warn(
        "Could not validate CrossRef API token (service unreachable: " +
          (e instanceof Error ? e.message : String(e)) +
          "). Using Polite defaults until response headers confirm tier.",
      );
    }
  }

  /**
   * Apply Plus tier limits from validation response headers.
   * Uses x-rate-limit-limit/interval for rate, x-concurrency-limit for concurrency (if present).
   */
  private applyPlusLimitsFromHeaders(response: Response): void {
    // Rate limit from headers
    const rateLimitHeader = response.headers.get("x-rate-limit-limit");
    const rateIntervalHeader = response.headers.get("x-rate-limit-interval");
    let rateLimit: number = CrossrefClient.PLUS_RATE_LIMIT;
    let rateIntervalMs: number = 1000;

    if (rateLimitHeader !== null && rateIntervalHeader !== null) {
      try {
        rateLimit = parseInt(rateLimitHeader.trim(), 10);
        // Java: Duration.parse("PT" + value.toUpperCase()).getMillis()
        rateIntervalMs = CrossrefClient.parseDurationMs(
          "PT" + rateIntervalHeader.trim().toUpperCase(),
        );
      } catch (e) {
        void e;
        CrossrefClient.LOGGER.debug("Could not parse rate limit headers, using Plus defaults");
      }
    }

    // Only apply auto-computed rate if config doesn't override
    let configOverride = -1;
    try {
      configOverride = GrobidProperties.getCrossrefMinRequestInterval();
    } catch (e) {
      void e;
    }
    if (configOverride <= 0) {
      this.minRequestIntervalMs = Math.trunc(rateIntervalMs / rateLimit);
    }

    // Concurrency from header (Plus has no official limit, use header or practical cap)
    const concurrencyHeader = response.headers.get("x-concurrency-limit");
    let concurrency: number = CrossrefClient.PLUS_CONCURRENCY;
    if (concurrencyHeader !== null) {
      const parsed = parseInt(concurrencyHeader.trim(), 10);
      if (!Number.isNaN(parsed)) concurrency = parsed;
    }
    this.configuredPoolSize = concurrency;
    this.setMaxPoolSize(concurrency);

    CrossrefClient.LOGGER.info(
      "CrossRef API token validated. Pool: plus, rate: " +
        rateLimit +
        " req/" +
        rateIntervalMs +
        "ms (interval: " +
        this.minRequestIntervalMs +
        "ms), concurrency: " +
        concurrency,
    );
  }

  private static parseDurationMs(s: string): number {
    const m = /^P(?:T(?:(\d+)H)?(?:(\d+)M(?!S))?(?:(\d+(?:\.\d+)?)S)?(?:(\d+)MS)?)?$/.exec(s);
    if (m === null) {
      const m2 = /^PT(\d+(?:\.\d+)?)S$/.exec(s);
      if (m2 !== null) return Math.round(parseFloat(m2[1]!) * 1000);
      return 0;
    }
    const hours = m[1] !== undefined ? parseInt(m[1]!, 10) : 0;
    const minutes = m[2] !== undefined ? parseInt(m[2]!, 10) : 0;
    const seconds = m[3] !== undefined ? parseFloat(m[3]!) : 0;
    const millis = m[4] !== undefined ? parseInt(m[4]!, 10) : 0;
    return (hours * 3600 + minutes * 60) * 1000 + Math.round(seconds * 1000) + millis;
  }

  public static printLog<U>(request: CrossrefRequest<U> | null, message: string): void {
    CrossrefClient.LOGGER.debug((request !== null ? request + ": " : "") + message);
  }

  /**
   * Update rate limit from x-rate-limit-limit and x-rate-limit-interval response headers.
   * Computes minRequestIntervalMs = intervalMs / rateLimit.
   * Ignored during active backoff.
   *
   * @param rateLimit the x-rate-limit-limit value (requests per interval)
   * @param intervalMs the x-rate-limit-interval value in milliseconds
   */
  public updateRateLimit(rateLimit: number, intervalMs: number): void {
    if (rateLimit > 0 && intervalMs > 0 && CrossrefClient.limitAuto && this.backoffAttempt === 0) {
      // Only update if config doesn't override
      let configOverride = -1;
      try {
        configOverride = GrobidProperties.getCrossrefMinRequestInterval();
      } catch (e) {
        void e;
      }
      if (configOverride <= 0) {
        const newInterval = Math.trunc(intervalMs / rateLimit);
        if (newInterval !== this.minRequestIntervalMs) {
          this.minRequestIntervalMs = newInterval;
          CrossrefClient.LOGGER.info(
            "Updated rate limit from response headers: " +
              rateLimit +
              " req/" +
              intervalMs +
              "ms (interval: " +
              newInterval +
              "ms)",
          );
        }
      }
    }
  }

  /**
   * Update concurrency limit from x-concurrency-limit response header.
   * Ignored during active backoff.
   */
  public updateConcurrencyLimit(concurrencyLimit: number): void {
    if (concurrencyLimit > 0 && CrossrefClient.limitAuto && this.backoffAttempt === 0) {
      this.configuredPoolSize = concurrencyLimit;
      this.setMaxPoolSize(concurrencyLimit);
      CrossrefClient.LOGGER.debug(
        "Updated concurrency limit from response header: " + concurrencyLimit,
      );
    }
  }

  /**
   * Trigger exponential backoff after receiving a 429 response.
   * During backoff, pool size is reduced to 1 to serialize requests.
   */
  public triggerBackoff(): void {
    this.backoffAttempt++;
    this.setMaxPoolSize(1);
    CrossrefClient.LOGGER.warn(
      "Rate limited (429). Backoff attempt " +
        this.backoffAttempt +
        ", next sleep up to " +
        this.computeBackoffCap() +
        "ms",
    );
  }

  /**
   * Compute the jittered backoff sleep duration using "full jitter" strategy.
   * Returns a random value in [0, min(MAX_BACKOFF_MS, BACKOFF_BASE_MS * 2^attempt)].
   */
  public computeBackoffWithJitter(): number {
    const cap = this.computeBackoffCap();
    // ThreadLocalRandom.current().nextLong(cap + 1) -> uniform [0, cap]
    return Math.floor(Math.random() * (cap + 1));
  }

  /**
   * Compute the exponential backoff cap (before jitter).
   */
  private computeBackoffCap(): number {
    return Math.min(
      CrossrefClient.MAX_BACKOFF_MS,
      CrossrefClient.BACKOFF_BASE_MS * (1 << Math.min(this.backoffAttempt, 30)),
    );
  }

  /**
   * Reset backoff state after a successful response.
   * Restores pool size to the configured value.
   */
  public resetBackoff(): void {
    if (this.backoffAttempt > 0) {
      this.backoffAttempt = 0;
      this.setMaxPoolSize(this.configuredPoolSize);
      CrossrefClient.LOGGER.info(
        "Backoff reset. Restored pool size to " + this.configuredPoolSize,
      );
    }
  }

  /**
   * Push a request in pool to be executed as soon as possible, then wait a response through the listener.
   */
  public async pushRequest<U>(
    requestOrModel: CrossrefRequest<U> | string,
    listenerOrParams: CrossrefRequestListener<U> | Map<string, string> | null,
    threadId: number,
    deserializerArg?: CrossrefDeserializer<U>,
    listenerArg?: CrossrefRequestListener<U> | null,
  ): Promise<void> {
    let request: CrossrefRequest<U>;
    let listener: CrossrefRequestListener<U> | null;
    if (typeof requestOrModel === "string") {
      const model = requestOrModel;
      const params = listenerOrParams as Map<string, string>;
      const deserializer = deserializerArg!;
      listener = listenerArg ?? null;
      request = new CrossrefRequest<U>(model, params, deserializer);
    } else {
      request = requestOrModel;
      listener = listenerOrParams as CrossrefRequestListener<U> | null;
    }

    if (listener !== null) request.addListener(listener);

    // Sleep OUTSIDE synchronized block so multiple threads can jitter-sleep in parallel
    if (this.backoffAttempt > 0) {
      const sleepMs = this.computeBackoffWithJitter();
      CrossrefClient.LOGGER.debug(
        "Backoff active (attempt " +
          this.backoffAttempt +
          "), sleeping for " +
          sleepMs +
          "ms",
      );
      await CrossrefClient.sleep(sleepMs);
    }

    // we limit the number of active threads to the crossref api dynamic limit returned in the response header
    while (this.activeCount >= this.getMaxPoolSize()) {
      await CrossrefClient.sleep(1); // TimeUnit.MICROSECONDS.sleep(10) → small yield
    }

    // Enforce minimum inter-request delay to cap throughput
    const now = Date.now();
    const elapsed = now - this.lastRequestTimeMs;
    if (elapsed < this.minRequestIntervalMs) {
      await CrossrefClient.sleep(this.minRequestIntervalMs - elapsed);
    }
    this.lastRequestTimeMs = Date.now();

    const task = new CrossrefRequestTask<U>(this, request);
    this.activeCount++;
    const f: Promise<void> = task.run().finally(() => {
      this.activeCount--;
    });
    let localFutures = this.futures.get(threadId);
    if (localFutures === undefined) localFutures = [];
    localFutures.push(f);
    this.futures.set(threadId, localFutures);
    CrossrefClient.LOGGER.debug(
      "Add request to thread " +
        threadId +
        "; active threads count is now " +
        this.activeCount,
    );
  }

  private static sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Wait for all request from a specific thread to be completed
   */
  public async finish(threadId: number): Promise<void> {
    try {
      const threadFutures = this.futures.get(threadId);
      if (threadFutures !== undefined) {
        for (const future of threadFutures) {
          await future;
          // await will block until the promise is resolved
        }
        this.futures.delete(threadId);
      }
    } catch (ee) {
      void ee;
      CrossrefClient.LOGGER.error("CrossRef request execution fails");
    }
  }

  public getMaxPoolSize(): number {
    return this.maxPoolSize;
  }

  public setMaxPoolSize(maxPoolSize: number): void {
    this.maxPoolSize = maxPoolSize;
  }

  public close(): void {
    // No persistent thread pool to shutdown in our pure-JS port.
  }
}
