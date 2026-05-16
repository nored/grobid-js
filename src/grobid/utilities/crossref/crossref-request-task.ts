// Port of org.grobid.core.utilities.crossref.CrossrefRequestTask.
// Upstream: grobid-core/src/main/java/org/grobid/core/utilities/crossref/CrossrefRequestTask.java
//
// Task to execute its request at the right time.

import { CrossrefClient } from "./crossref-client.js";
import type { CrossrefRequest } from "./crossref-request.js";
import { CrossrefRequestListener, CrossrefResponse } from "./crossref-request-listener.js";

export class CrossrefRequestTask<T> extends CrossrefRequestListener<T> {
  protected client: CrossrefClient;
  protected request: CrossrefRequest<T>;

  public constructor(client: CrossrefClient, request: CrossrefRequest<T>) {
    super();
    this.client = client;
    this.request = request;

    CrossrefClient.printLog(request, "New request in the pool");
  }

  public async run(): Promise<void> {
    try {
      CrossrefClient.printLog(this.request, ".. executing");

      this.request.addListener(this);
      await this.request.execute();
    } catch (e) {
      const message = new CrossrefResponse<T>();
      message.setException(
        e instanceof Error ? e : new Error(String(e)),
        this.request.toString(),
      );
      this.request.notifyListeners(message);
    }
  }

  public override onResponse(response: CrossrefResponse<T>): void {
    if (response.status === 429) {
      this.client.triggerBackoff();
    } else if (response.status === 401) {
      // token invalid or expired — disable it and downgrade to polite/public
      this.client.disableToken();
    } else if (!response.hasError()) {
      this.client.resetBackoff();
      // update rate limit from x-rate-limit-limit / x-rate-limit-interval headers
      this.client.updateRateLimit(response.limitIterations, response.interval);
      // update concurrency from x-concurrency-limit header
      if (response.concurrencyLimit > 0) {
        this.client.updateConcurrencyLimit(response.concurrencyLimit);
      }
    }
  }

  public override onSuccess(_results: T[]): void {
    void _results;
  }

  public override onError(_status: number, _message: string | null, _exception: Error | null): void {
    void _status;
    void _message;
    void _exception;
  }
}
