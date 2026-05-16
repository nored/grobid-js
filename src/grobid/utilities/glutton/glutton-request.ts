// Port of org.grobid.core.utilities.glutton.GluttonRequest.
// Upstream: grobid-core/src/main/java/org/grobid/core/utilities/glutton/GluttonRequest.java
//
// Glutton request

import { GrobidResourceException } from "../../exceptions/grobid-resource-exception.js";
import type { CrossrefDeserializer } from "../crossref/crossref-deserializer.js";
import {
  CrossrefRequestListener,
  CrossrefResponse,
} from "../crossref/crossref-request-listener.js";
import { GrobidProperties } from "../grobid-properties.js";

export class GluttonRequest<T> {
  protected BASE_PATH: string = "/service/lookup";
  protected static readonly identifiers: string[] = [
    "doi",
    "DOI",
    "pmid",
    "PMID",
    "pmcid",
    "PMCID",
    "pmc",
    "PMC",
  ];

  /**
   * Query parameters, cannot be null, ex: ?atitle=[title]&firstAuthor=[first_author_lastname]
   * Identifier are also delivered as parameter, with the name of the identifier
   */
  public params: Map<string, string>;

  /**
   * JSON response deserializer, ex: WorkDeserializer to convert metadata to BiblioItem, it's similar
   * to CrossRef, but possibly enriched with some additional metadata (e.g. PubMed)
   */
  protected deserializer: CrossrefDeserializer<T>;

  protected listeners: CrossrefRequestListener<T>[];

  public constructor(
    _model: string,
    params: Map<string, string>,
    deserializer: CrossrefDeserializer<T>,
  ) {
    void _model;
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
   */
  public async execute(): Promise<void> {
    if (this.params === null || this.params === undefined) {
      // this should not happen
      const message = new CrossrefResponse<T>();
      message.setException(
        new Error(
          "Empty list of parameter, cannot build request to glutton service",
        ),
        this.toString(),
      );
      this.notifyListeners(message);
      return;
    }

    const timeout = GrobidProperties.getGluttonConsolidationTimeout() * 1000;

    try {
      const baseUrl = GrobidProperties.getGluttonUrl();
      if (baseUrl === null) {
        throw new Error("Invalid url for glutton service");
      }

      const url = new URL(baseUrl + this.BASE_PATH);

      // check if we have a strong identifier directly supported by Glutton: DOI, PMID, PMCID
      // more probably in the future
      if (
        this.params.get("DOI") !== undefined ||
        this.params.get("doi") !== undefined
      ) {
        let doi = this.params.get("DOI");
        if (doi === undefined) doi = this.params.get("doi");
        url.searchParams.set("doi", doi!);
      }
      if (
        this.params.get("HALID") !== undefined ||
        this.params.get("halId") !== undefined
      ) {
        let doi = this.params.get("HALID");
        if (doi === undefined) doi = this.params.get("halId");
        url.searchParams.set("halId", doi!);
      }
      if (
        this.params.get("PMID") !== undefined ||
        this.params.get("pmid") !== undefined
      ) {
        let pmid = this.params.get("PMID");
        if (pmid === undefined) pmid = this.params.get("pmid");
        url.searchParams.set("pmid", pmid!);
      }
      if (
        this.params.get("PMCID") !== undefined ||
        this.params.get("pmcid") !== undefined ||
        this.params.get("pmc") !== undefined ||
        this.params.get("PMC") !== undefined
      ) {
        let pmcid: string | undefined = this.params.get("PMCID");
        if (pmcid === undefined) pmcid = this.params.get("pmcid");
        if (pmcid === undefined) pmcid = this.params.get("PMC");
        if (pmcid === undefined) pmcid = this.params.get("pmc");
        url.searchParams.set("pmc", pmcid!);
      }
      {
        for (const [k, v] of this.params.entries()) {
          if (!GluttonRequest.identifiers.includes(k))
            url.searchParams.set(this.mapFromCrossref(k), v);
        }
      }

      //System.out.println(uriBuilder.toString());

      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), timeout);
      let response: Response;
      try {
        response = await fetch(url.toString(), {
          method: "GET",
          signal: controller.signal,
        });
      } finally {
        clearTimeout(t);
      }

      const message = new CrossrefResponse<T>();
      message.status = response.status;

      /*Header limitIntervalHeader = response.getFirstHeader("X-Rate-Limit-Interval");
       * Header limitLimitHeader = response.getFirstHeader("X-Rate-Limit-Limit");
       * if (limitIntervalHeader != null && limitLimitHeader != null)
       *     message.setTimeLimit(limitIntervalHeader.getValue(), limitLimitHeader.getValue());
       */
      if (message.status === 503) {
        throw new GrobidResourceException();
      } else if (message.status < 200 || message.status >= 300) {
        message.errorMessage = response.statusText;
      } else {
        const body = await response.text();
        if (body !== null && body !== undefined) {
          message.results = this.deserializer.parse(body);
        }
      }

      this.notifyListeners(message);
    } catch (e) {
      if (e instanceof GrobidResourceException) {
        // sleep 1 second and retry
        await new Promise<void>((resolve) => setTimeout(resolve, 1000));
        return this.execute();
      }
      const message = new CrossrefResponse<T>();
      message.setException(e instanceof Error ? e : new Error(String(e)), this.toString());
      this.notifyListeners(message);
    }
  }

  /**
   * Mapping CrossRef API field arguments to the ones of glutton, to ensure compatibility
   */
  private mapFromCrossref(field: string): string {
    if (field === "query.bibliographic") return "biblio";

    if (field === "query.title") {
      return "atitle";
    }

    if (field === "query.author") {
      return "firstAuthor";
    }

    if (field === "query.container-title") {
      return "jtitle";
    }

    return field;
  }

  public toString(): string {
    let str = "";
    str += " (";
    if (this.params !== null && this.params !== undefined) {
      for (const [k, v] of this.params.entries()) str += "," + k + "=" + v;
    }
    str += ")";
    return str;
  }
}
