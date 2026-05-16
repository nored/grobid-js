// Port of org.grobid.core.utilities.glutton.GluttonRequestTask.
// Upstream: grobid-core/src/main/java/org/grobid/core/utilities/glutton/GluttonRequestTask.java
//
// Task to execute its request at the right time.

import {
  CrossrefRequestListener,
  CrossrefResponse,
} from "../crossref/crossref-request-listener.js";

import type { GluttonClient } from "./glutton-client.js";
import type { GluttonRequest } from "./glutton-request.js";
import { GluttonClient as GluttonClientImpl } from "./glutton-client.js";

export class GluttonRequestTask<T> extends CrossrefRequestListener<T> {
  protected client: GluttonClient;
  protected request: GluttonRequest<T>;

  public constructor(client: GluttonClient, request: GluttonRequest<T>) {
    super();
    this.client = client;
    this.request = request;

    GluttonClientImpl.printLog(request, "New request in the pool");
  }

  public async run(): Promise<void> {
    try {
      //client.checkLimits();

      GluttonClientImpl.printLog(this.request, ".. executing");

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

  public override onResponse(_response: CrossrefResponse<T>): void {
    /*if (!response.hasError())
            client.updateLimits(response.limitIterations, response.interval);*/
    void _response;
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
