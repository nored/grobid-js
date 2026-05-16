// Port of org.grobid.core.utilities.crossref.CrossrefRequestListener.
// Upstream: grobid-core/src/main/java/org/grobid/core/utilities/crossref/CrossrefRequestListener.java
//
// Listener to catch response from a CrossrefRequest.

/**
 * Response is a static nested class on CrossrefRequestListener<T>. Exported
 * directly since TS has no inner classes.
 */
export class CrossrefResponse<T> {
  public status: number = -1;
  public results: T[] | null = null;
  public interval: number = 0;
  public limitIterations: number = 1;
  public time: number = 0;
  public errorMessage: string | null = null;
  public errorException: Error | null = null;
  public concurrencyLimit: number = -1;
  public apiPool: string | null = null;

  public constructor() {
    this.status = -1;
    this.results = null;
    this.interval = 0;
    this.limitIterations = 1;
    this.time = Date.now(); // System.currentTimeMillis()
    this.errorMessage = null;
    this.errorException = null;
    this.concurrencyLimit = -1;
    this.apiPool = null;
  }

  public setTimeLimit(limitInterval: string, limitLimit: string): void {
    // Java: this.interval = (int)Duration.parse("PT"+limitInterval.toUpperCase()).getMillis();
    // Joda's Duration.parse parses ISO-8601 durations like "PT1S" (1 second), "PT500MS".
    this.interval = CrossrefResponse.parseDurationMs("PT" + limitInterval.toUpperCase());
    this.limitIterations = parseInt(limitLimit, 10);
  }

  /** Minimal ISO-8601 PnYnMnDTnHnMnS-style duration parser, sufficient for crossref headers. */
  private static parseDurationMs(s: string): number {
    // Accept forms like "PT1S", "PT500MS", "PT100MS", "PT1M30S"
    const m = /^P(?:T(?:(\d+)H)?(?:(\d+)M(?!S))?(?:(\d+(?:\.\d+)?)S)?(?:(\d+)MS)?)?$/.exec(s);
    if (m === null) {
      // Try simple "PT<n>S" with milliseconds via fractional seconds
      const m2 = /^PT(\d+(?:\.\d+)?)S$/.exec(s);
      if (m2 !== null) {
        return Math.round(parseFloat(m2[1]!) * 1000);
      }
      return 0;
    }
    const hours = m[1] !== undefined ? parseInt(m[1]!, 10) : 0;
    const minutes = m[2] !== undefined ? parseInt(m[2]!, 10) : 0;
    const seconds = m[3] !== undefined ? parseFloat(m[3]!) : 0;
    const millis = m[4] !== undefined ? parseInt(m[4]!, 10) : 0;
    return (hours * 3600 + minutes * 60) * 1000 + Math.round(seconds * 1000) + millis;
  }

  /*public void setException(Exception e, CrossrefRequest<T> request) {
		errorException = e;
		errorMessage = e.getClass().getName()+" thrown during request execution : "+request.toString()+"\n"+e.getMessage();
	}*/

  public setException(e: Error, requestString: string): void {
    this.errorException = e;
    this.errorMessage =
      (e as { constructor: { name: string } }).constructor.name +
      " thrown during request execution : " +
      requestString +
      "\n" +
      e.message;
  }

  public getOneStepTime(): number {
    return Math.trunc(this.interval / this.limitIterations);
  }

  public toString(): string {
    return (
      "Response (status:" +
      this.status +
      " timeLimit:" +
      this.interval +
      "/" +
      this.limitIterations +
      ", results:" +
      (this.results === null ? "null" : this.results.length)
    );
  }

  public hasError(): boolean {
    return this.errorMessage !== null || this.errorException !== null;
  }

  public hasResults(): boolean {
    return this.results !== null && this.results.length > 0;
  }
}

export class CrossrefRequestListener<T> {
  protected currentResponse: CrossrefResponse<T> | null = null;
  private rank: number = -1;

  // Promise resolver-based wait, mirroring synchronized(this){notifyAll()} semantics.
  private waiters: ((value: CrossrefResponse<T>) => void)[] = [];

  public constructor(rank?: number) {
    if (rank !== undefined) {
      this.rank = rank;
    }
  }

  /**
   * Called when request executed and get any response
   */
  public onResponse(_response: CrossrefResponse<T>): void {
    void _response;
  }

  /**
   * Called when request succeed and response format is as expected
   */
  public onSuccess(_results: T[]): void {
    void _results;
  }

  /**
   * Called when request gives an error
   */
  public onError(_status: number, _message: string | null, _exception: Error | null): void {
    void _status;
    void _message;
    void _exception;
  }

  public notify(response: CrossrefResponse<T>): void {
    this.onResponse(response);

    if (response === null) {
      // eslint-disable-next-line no-console
      console.log("Response is null");
    }

    if (response !== null && response.results !== null && response.results.length > 0)
      this.onSuccess(response.results);

    if (response.hasError()) {
      this.onError(response.status, response.errorMessage, response.errorException);
    }

    this.currentResponse = response;
    const ws = this.waiters;
    this.waiters = [];
    for (const w of ws) w(response);
  }

  /**
   * Get response after waiting listener, usefull for synchronous call
   */
  public getResponse(): CrossrefResponse<T> | null {
    return this.currentResponse;
  }

  /**
   * Async-await equivalent of Java's synchronized(listener) { listener.wait(); }.
   */
  public waitForResponse(): Promise<CrossrefResponse<T>> {
    if (this.currentResponse !== null) {
      return Promise.resolve(this.currentResponse);
    }
    return new Promise<CrossrefResponse<T>>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  /**
   * Associate the listener to a rank for identifying the response
   */
  public getRank(): number {
    return this.rank;
  }
}
