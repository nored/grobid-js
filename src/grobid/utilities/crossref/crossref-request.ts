// Port of org.grobid.core.utilities.crossref.CrossrefRequest.
// Upstream: grobid-core/src/main/java/org/grobid/core/utilities/crossref/CrossrefRequest.java
//
// GET crossref request
// @see <a href="https://github.com/CrossRef/rest-api-doc/blob/master/rest_api.md">Crossref API Documentation</a>

import { GrobidProperties } from "../grobid-properties.js";

import { CrossrefClient } from "./crossref-client.js";
import type { CrossrefDeserializer } from "./crossref-deserializer.js";
import {
  CrossrefRequestListener,
  CrossrefResponse,
} from "./crossref-request-listener.js";

export class CrossrefRequest<T> {
  protected static readonly BASE_URL: string = "https://api.crossref.org";

  /**
   * Model key in crossref, ex: "works", "journals"..
   */
  public model: string;

  /**
   * Model identifier in crossref, can be null, ex: doi for a work
   */
  //public String id;

  /**
   * Query parameters, cannot be null, ex: ?query.bibliographic=[title]&query.author=[author]
   */
  public params: Map<string, string>;

  /**
   * JSON response deserializer, ex: WorkDeserializer to convert Work to BiblioItem
   */
  protected deserializer: CrossrefDeserializer<T>;

  protected listeners: CrossrefRequestListener<T>[];

  public constructor(
    model: string,
    params: Map<string, string>,
    deserializer: CrossrefDeserializer<T>,
  ) {
    this.model = model;
    //this.id = id;
    this.params = params;
    this.deserializer = deserializer;
    this.listeners = [];
  }

  /**
   * Add listener to catch response when request is executed.
   */
  public addListener(listener: CrossrefRequestListener<T>): void {
    this.listeners.push(listener);
  }

  /**
   * Notify all connected listeners
   */
  public notifyListeners(message: CrossrefResponse<T>): void {
    for (const listener of this.listeners) listener.notify(message);
  }

  /**
   * Execute request, handle response by sending to listeners a CrossrefRequestListener.Response.
   * Async per CONVENTIONS.md (CrossRef HTTP boundary).
   */
  public async execute(): Promise<void> {
    if (this.params === null || this.params === undefined) {
      // this should not happen
      const message = new CrossrefResponse<T>();
      message.setException(
        new Error(
          "Empty list of parameter, cannot build request to the consolidation service",
        ),
        this.toString(),
      );
      this.notifyListeners(message);
      return;
    }

    const timeout = GrobidProperties.getCrossrefConsolidationTimeout() * 1000; // Convert to milliseconds

    try {
      const url = new URL(CrossrefRequest.BASE_URL);

      let path = this.model;

      if (this.params.get("query.title") !== undefined) {
        this.params.set("query.bibliographic", this.params.get("query.title")!);
        this.params.delete("query.title");
      }

      if (this.params.get("DOI") !== undefined || this.params.get("doi") !== undefined) {
        let doi = this.params.get("DOI");
        if (doi === undefined) doi = this.params.get("doi");
        //uriBuilder.setParameter("doi", doi);
        path += "/" + doi;
        url.pathname = "/" + path;
      } else {
        url.pathname = "/" + path;
        for (const [k, v] of this.params.entries()) {
          if (k !== "doi" && k !== "DOI" && k !== "firstPage" && k !== "volume") {
            url.searchParams.set(k, v);
          }
        }
      }

      // "mailto" parameter to be used in the crossref query and in User-Agent
      //  header, as recommended by CrossRef REST API documentation, e.g. &mailto=GroovyBib@example.org
      if (GrobidProperties.getCrossrefMailto() !== null) {
        url.searchParams.set("mailto", GrobidProperties.getCrossrefMailto()!);
      }

      // set recommended User-Agent header
      const headers: Record<string, string> = {};

      if (GrobidProperties.getCrossrefMailto() !== null) {
        headers["User-Agent"] =
          "GROBID/" +
          GrobidProperties.getVersion() +
          " (https://github.com/kermitt2/grobid; mailto:" +
          GrobidProperties.getCrossrefMailto() +
          ")";
      } else {
        headers["User-Agent"] =
          "GROBID/" +
          GrobidProperties.getVersion() +
          " (https://github.com/kermitt2/grobid)";
      }

      // set the authorization token for the Metadata Plus service if available
      // skip if token has been disabled (validation failure or 401 at runtime)
      if (
        GrobidProperties.getCrossrefToken() !== null &&
        !CrossrefClient.getInstance().isTokenDisabled()
      ) {
        headers["Crossref-Plus-API-Token"] = "Bearer " + GrobidProperties.getCrossrefToken();
      }

      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), timeout);
      let response: Response;
      try {
        response = await fetch(url.toString(), {
          method: "GET",
          headers,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(t);
      }

      const message = new CrossrefResponse<T>();
      message.status = response.status;

      // note: header field names are case insensitive
      const limitIntervalHeader = response.headers.get("X-Rate-Limit-Interval");
      const limitLimitHeader = response.headers.get("X-Rate-Limit-Limit");
      if (limitIntervalHeader !== null && limitLimitHeader !== null) {
        message.setTimeLimit(limitIntervalHeader, limitLimitHeader);
      }

      // read concurrency limit and API pool headers
      const concurrencyLimitHeader = response.headers.get("x-concurrency-limit");
      if (concurrencyLimitHeader !== null) {
        const parsed = parseInt(concurrencyLimitHeader.trim(), 10);
        if (!Number.isNaN(parsed)) {
          message.concurrencyLimit = parsed;
        }
      }
      const apiPoolHeader = response.headers.get("x-api-pool");
      if (apiPoolHeader !== null) {
        message.apiPool = apiPoolHeader.trim();
      }

      if (message.status === 429) {
        // rate limit exceeded - set error and notify without trying to parse body
        message.errorMessage = "Rate limit exceeded (HTTP 429)";
        this.notifyListeners(message);
        return;
      }

      if (message.status < 200 || message.status >= 300) {
        message.errorMessage = response.statusText;
        this.notifyListeners(message);
      }

      const body = await response.text();
      if (body !== null && body === "Resource not found.") {
        // this used to be a json object too in the past I think
        message.results = null;
      } else {
        message.results = this.deserializer.parse(body);
      }

      this.notifyListeners(message);
    } catch (e) {
      const message = new CrossrefResponse<T>();
      message.setException(e instanceof Error ? e : new Error(String(e)), this.toString());
      this.notifyListeners(message);
    }
  }

  public toString(): string {
    let str = " (";
    if (this.params !== null && this.params !== undefined) {
      for (const [k, v] of this.params.entries()) str += "," + k + "=" + v;
    }
    str += ")";
    return str;
  }
}
