// Port of org.grobid.core.utilities.Consolidation.
// Upstream: grobid-core/src/main/java/org/grobid/core/utilities/Consolidation.java
//
// Adaptations:
// - Java's blocking thread-id keyed request queue (`Thread.currentThread().getId()`)
//   collapses to a single value in JS (single-threaded event loop). We use a
//   stable per-instance counter that increments per `consolidate(...)` call,
//   which is functionally equivalent for the upstream CrossrefClient's
//   per-thread queue semantics.
// - The Apache `CollectionUtils.isNotEmpty` / `isEmpty` helpers are inlined.
// - Scala `RatcliffObershelpMetric` is inlined using a faithful TS port
//   of the Ratcliff/Obershelp similarity algorithm (longest-common-substring
//   recursion). Upstream relies on `stringmetric`'s implementation; the
//   algorithm is well-defined and the JS implementation here is exact.
// - Java `ConcurrentHashMap<Integer, BiblioItem>` becomes a plain `Map`;
//   the JS port is single-threaded.

import { getLogger } from "./logger.js";
// Cross-package imports: the data classes are still being ported by a sibling
// subagent. Both value and type-only imports against an `export {};` stub
// produce TS2305 ("no exported member"). Until those modules are ported, we
// suppress the error with `@ts-expect-error`; it will fire as a build error
// the moment the real export lands and prompt cleanup here.
import type { BibDataSet } from "../data/bib-data-set.js";
import { BiblioItem } from "../data/biblio-item.js";
import type { Funder } from "../data/funder.js";
import type { CntManager } from "./counters/cnt-manager.js";
import { CrossrefClient } from "./crossref/crossref-client.js";
import { CrossrefRequestListener } from "./crossref/crossref-request-listener.js";
import { FunderDeserializer } from "./crossref/funder-deserializer.js";
import { WorkDeserializer } from "./crossref/work-deserializer.js";
import { GluttonClient } from "./glutton/glutton-client.js";
import { ConsolidationCounters } from "./consolidation-counters.js";
import { TextUtilities } from "./text-utilities.js";
import { GrobidProperties } from "./grobid-properties.js";

/** Re-export name preserved verbatim from upstream's nested `GrobidConsolidationService` enum. */
export class GrobidConsolidationService {
  static readonly CROSSREF: GrobidConsolidationService = new GrobidConsolidationService(
    "CROSSREF",
    "crossref",
  );
  static readonly GLUTTON: GrobidConsolidationService = new GrobidConsolidationService(
    "GLUTTON",
    "glutton",
  );

  private readonly _name: string;
  private readonly ext: string;

  private constructor(name: string, ext: string) {
    this._name = name;
    this.ext = ext;
  }

  name(): string {
    return this._name;
  }

  getExt(): string {
    return this.ext;
  }

  static values(): readonly GrobidConsolidationService[] {
    return [GrobidConsolidationService.CROSSREF, GrobidConsolidationService.GLUTTON];
  }

  static get(name: string | null | undefined): GrobidConsolidationService {
    if (name == null) {
      throw new Error("Name of consolidation service must not be null");
    }
    const n = name.toLowerCase();
    for (const e of GrobidConsolidationService.values()) {
      if (e.name().toLowerCase() === n) {
        return e;
      }
    }
    throw new Error(
      "No consolidation service with name '" +
        name +
        "', possible values are: [" +
        GrobidConsolidationService.values()
          .map((e) => e.name())
          .join(", ") +
        "]",
    );
  }

  toString(): string {
    return this._name;
  }
}

// --- helpers replacing commons-lang3 -----------------------------------

function isBlank(s: string | null | undefined): boolean {
  return s == null || s.trim().length === 0;
}
function isNotBlank(s: string | null | undefined): boolean {
  return !isBlank(s);
}
function isEmpty(s: string | null | undefined): boolean {
  return s == null || s.length === 0;
}
function isNotEmpty<T>(s: T[] | null | undefined): boolean {
  return s != null && s.length !== 0;
}
function collIsEmpty<T>(s: T[] | null | undefined): boolean {
  return !isNotEmpty(s);
}

/**
 * Value holder for extracted bibliographic query fields, used to deduplicate
 * field extraction logic across single and batch consolidation methods.
 */
export class BibQueryFields {
  readonly doi: string | null;
  readonly halId: string | null;
  readonly author: string | null;
  readonly title: string | null;
  readonly journalTitle: string | null;
  readonly volume: string | null;
  readonly firstPage: string | null;
  readonly year: string | null;

  constructor(
    doi: string | null,
    halId: string | null,
    author: string | null,
    title: string | null,
    journalTitle: string | null,
    volume: string | null,
    firstPage: string | null,
    year: string | null,
  ) {
    this.doi = doi;
    this.halId = halId;
    this.author = author;
    this.title = title;
    this.journalTitle = journalTitle;
    this.volume = volume;
    this.firstPage = firstPage;
    this.year = year;
  }
}

// Module-level scoping helpers (Java `static` methods translated to free
// helpers and class statics; we expose extractFieldsFromBiblioItem /
// buildWorkQueryArguments / buildFunderQueryArguments as package-visible
// helpers on the Consolidation class to mirror the Java visibility scheme.)

/**
 * Singleton class for managing the extraction of bibliographical information from pdf documents.
 * When consolidation operations are realized, be sure to call the close() method
 * to ensure that all Executors are terminated.
 */
export class Consolidation {
  private static readonly LOGGER = getLogger("Consolidation");

  private static instance: Consolidation | null = null;

  private client: CrossrefClient | null = null;
  private workDeserializer: WorkDeserializer | null = null;
  private funderDeserializer: FunderDeserializer | null = null;
  private cntManager: CntManager | null = null;

  private threadIdCounter = 0;

  static CONSOLIDATION_STATUS_CONSOLIDATED: string = "consolidated";
  static CONSOLIDATION_STATUS_EXTRACTED: string = "extracted";

  /**
   * Extract query fields from a BiblioItem, replacing duplicate extraction blocks
   * in single and batch consolidation methods.
   */
  static extractFieldsFromBiblioItem(bib: InstanceType<typeof BiblioItem>): BibQueryFields {
    let doi: string | null = bib.getDOI() as string | null;
    if (isNotBlank(doi)) {
      doi = BiblioItem.cleanDOI(doi) as string | null;
    }
    const halId = bib.getHalId() as string | null;
    const author = bib.getFirstAuthorSurname() as string | null;
    const title = bib.getTitle() as string | null;
    const journalTitle = bib.getJournal() as string | null;

    let volume = bib.getVolume() as string | null;
    if (isBlank(volume)) volume = bib.getVolumeBlock() as string | null;

    let firstPage: string | null = null;
    const pageRange = bib.getPageRange() as string | null;
    const beginPage = bib.getBeginPage() as number;
    if (beginPage !== -1) {
      firstPage = "" + beginPage;
    } else if (pageRange !== null) {
      // Upstream: `new StringTokenizer(pageRange, "--")`. Java's
      // StringTokenizer splits on ANY of the characters in the delimiter
      // string (so "--" effectively means split on '-'). Empty tokens are
      // suppressed.
      const tokens = pageRange.split(/-+/).filter((s) => s.length !== 0);
      if (tokens.length === 2) {
        firstPage = tokens[0]!;
      } else if (tokens.length === 1) {
        firstPage = pageRange;
      }
    }

    let year: string | null = null;
    if (bib.getNormalizedPublicationDate() !== null) {
      year = "" + (bib.getNormalizedPublicationDate() as { getYear(): number }).getYear();
    }
    if (year === null) year = bib.getYear() as string | null;

    return new BibQueryFields(doi, halId, author, title, journalTitle, volume, firstPage, year);
  }

  /**
   * Build query arguments for work consolidation requests.
   *
   * @param fields extracted fields from the BiblioItem
   * @param rawCitation raw citation string, can be null
   * @param consolidateMode consolidation mode; use -1 for batch mode where query.bibliographic
   *                        is sent for CrossRef when DOI is absent
   * @param service the consolidation service being used
   * @return query arguments map, or null if insufficient data
   */
  static buildWorkQueryArguments(
    fields: BibQueryFields,
    rawCitation: string | null,
    consolidateMode: number,
    service: GrobidConsolidationService,
  ): Map<string, string> | null {
    const args = new Map<string, string>();

    if (isNotBlank(fields.doi)) {
      args.set("doi", fields.doi as string);
    }

    // In batch mode (consolidateMode == -1), CrossRef gets query.bibliographic when no DOI
    if (consolidateMode !== -1 && consolidateMode !== 3 && isBlank(fields.doi)) {
      // single mode, non-DOI, non-mode-3
      if (isNotBlank(rawCitation) && service !== GrobidConsolidationService.CROSSREF) {
        args.set("query.bibliographic", rawCitation as string);
      }
      if (isNotBlank(fields.halId) && service !== GrobidConsolidationService.CROSSREF) {
        args.set("halid", fields.halId as string);
      }
      if (isNotBlank(fields.author) && service !== GrobidConsolidationService.CROSSREF) {
        args.set("query.author", fields.author as string);
      }
      if (isNotBlank(fields.title) && service !== GrobidConsolidationService.CROSSREF) {
        args.set("query.title", fields.title as string);
      }
      if (isNotBlank(fields.journalTitle) && service !== GrobidConsolidationService.CROSSREF) {
        args.set("query.container-title", fields.journalTitle as string);
      }
      if (isNotBlank(fields.volume) && service !== GrobidConsolidationService.CROSSREF) {
        args.set("volume", fields.volume as string);
      }
      if (isNotBlank(fields.firstPage) && service !== GrobidConsolidationService.CROSSREF) {
        args.set("firstPage", fields.firstPage as string);
      }
      if (isNotBlank(fields.year) && service !== GrobidConsolidationService.CROSSREF) {
        args.set("year", fields.year as string);
      }
    } else if (consolidateMode === -1 && isBlank(fields.doi)) {
      // batch mode, no DOI
      if (isNotBlank(fields.halId) && service !== GrobidConsolidationService.CROSSREF) {
        args.set("halid", fields.halId as string);
      }
      if (isNotBlank(rawCitation)) {
        if (service !== GrobidConsolidationService.CROSSREF || isBlank(fields.doi)) {
          args.set("query.bibliographic", rawCitation as string);
        }
      }
      if (isNotBlank(fields.title)) {
        if (
          service !== GrobidConsolidationService.CROSSREF ||
          (isBlank(rawCitation) && isBlank(fields.doi))
        ) {
          args.set("query.title", fields.title as string);
        }
      }
      if (isNotBlank(fields.author)) {
        if (
          service !== GrobidConsolidationService.CROSSREF ||
          (isBlank(rawCitation) && isBlank(fields.doi))
        ) {
          args.set("query.author", fields.author as string);
        }
      }
      if (isNotBlank(fields.journalTitle) && service !== GrobidConsolidationService.CROSSREF) {
        args.set("query.container-title", fields.journalTitle as string);
      }
      if (isNotBlank(fields.volume) && service !== GrobidConsolidationService.CROSSREF) {
        args.set("volume", fields.volume as string);
      }
      if (isNotBlank(fields.firstPage) && service !== GrobidConsolidationService.CROSSREF) {
        args.set("firstPage", fields.firstPage as string);
      }
      if (isNotBlank(fields.year) && service !== GrobidConsolidationService.CROSSREF) {
        args.set("year", fields.year as string);
      }
    }

    if (args.size === 0) {
      return null;
    }

    // check if there's enough information for CrossRef
    if (service === GrobidConsolidationService.CROSSREF) {
      if (
        isBlank(fields.doi) &&
        isBlank(rawCitation) &&
        (isBlank(fields.author) || isBlank(fields.title))
      ) {
        return null;
      }
    }

    if (service === GrobidConsolidationService.CROSSREF) {
      args.set("rows", "1");
    } else if (service === GrobidConsolidationService.GLUTTON) {
      args.set("parseReference", "false");
    }

    return args;
  }

  /**
   * Build query arguments for funder consolidation requests.
   */
  static buildFunderQueryArguments(funder: Funder): Map<string, string> | null {
    let funderNameString = funder.getFullName() as string | null;
    if (isEmpty(funderNameString)) return null;

    funderNameString = TextUtilities.removeFieldStopwords(funderNameString as string);

    const args = new Map<string, string>();
    args.set("query", funderNameString);
    args.set("rows", "10");
    return args;
  }

  static getInstance(): Consolidation {
    if (Consolidation.instance === null) {
      Consolidation.getNewInstance();
    }
    return Consolidation.instance as Consolidation;
  }

  /** Creates a new instance. */
  private static getNewInstance(): void {
    Consolidation.LOGGER.debug("Get new instance of Consolidation");
    Consolidation.instance = new Consolidation();
  }

  /** Hidden constructor */
  private constructor() {
    if (
      GrobidProperties.getInstance().getConsolidationService() ===
      GrobidConsolidationService.GLUTTON
    ) {
      this.client = GluttonClient.getInstance();
    } else {
      this.client = CrossrefClient.getInstance();
    }
    this.workDeserializer = new WorkDeserializer();
    this.funderDeserializer = new FunderDeserializer();
  }

  setCntManager(cntManager: CntManager): void {
    this.cntManager = cntManager;
  }

  getCntManager(): CntManager | null {
    return this.cntManager;
  }

  /**
   * After consolidation operations, this need to be called to ensure that all
   * involved Executors are shut down immediatly, otherwise non terminated thread
   * could prevent the JVM from exiting
   */
  close(): void {
    try {
      (this.client as { close(): void }).close();
    } catch (e) {
      Consolidation.LOGGER.warn("Error closing consolidation client", e);
    }
    Consolidation.instance = null;
  }

  private nextThreadId(): number {
    this.threadIdCounter = (this.threadIdCounter + 1) | 0;
    return this.threadIdCounter;
  }

  /**
   * Try to consolidate one bibliographical object with crossref metadata lookup web services based on
   * core metadata. In practice, this method is used for consolidating header metadata.
   *
   * The Java method `throws Exception`; in TS the equivalent is a normal
   * sync method that may throw.
   */
  consolidate(
    bib: InstanceType<typeof BiblioItem>,
    rawCitation: string | null,
    consolidateMode: number,
  ): InstanceType<typeof BiblioItem> | null {
    const results: InstanceType<typeof BiblioItem>[] = [];

    const fields = Consolidation.extractFieldsFromBiblioItem(bib);
    const consolidationService = GrobidProperties.getInstance().getConsolidationService();

    const args = Consolidation.buildWorkQueryArguments(
      fields,
      rawCitation,
      consolidateMode,
      consolidationService,
    );
    if (args === null) {
      return null;
    }

    if (this.cntManager !== null) {
      this.cntManager.i(ConsolidationCounters.CONSOLIDATION);
    }

    const threadId = this.nextThreadId();

    let doiQuery: boolean;
    try {
      if (this.cntManager !== null) {
        this.cntManager.i(ConsolidationCounters.CONSOLIDATION);
      }

      if (isNotBlank(fields.doi) && this.cntManager !== null) {
        this.cntManager.i(ConsolidationCounters.CONSOLIDATION_PER_DOI);
        doiQuery = true;
      } else {
        doiQuery = false;
      }

      const localDoiQuery = doiQuery;
      const localCntManager = this.cntManager;
      const listener = new CrossrefRequestListener<InstanceType<typeof BiblioItem>>(0);
      // Override `onSuccess` / `onError` (the upstream uses an anonymous subclass).
      (listener as unknown as { onSuccess(res: InstanceType<typeof BiblioItem>[]): void }).onSuccess = (
        res: InstanceType<typeof BiblioItem>[],
      ) => {
        if (isNotEmpty(res)) {
          for (const oneRes of res) {
            /*
              Glutton integrates its own post-validation, so we can skip post-validation in GROBID when it is used as
              consolidation service.

              Post-validation for CrossRef is configurable. When disabled, all results are accepted.
              When enabled (default), DOI-based queries skip post-validation, and other queries require it.
            */
            if (
              consolidationService === GrobidConsolidationService.GLUTTON ||
              !GrobidProperties.getCrossrefPostValidation() ||
              localDoiQuery ||
              this.postValidation(bib, oneRes)
            ) {
              oneRes.setStatus(Consolidation.CONSOLIDATION_STATUS_CONSOLIDATED);
              oneRes.setConsolidationService(consolidationService.getExt());
              results.push(oneRes);
              if (localCntManager !== null) {
                localCntManager.i(ConsolidationCounters.CONSOLIDATION_SUCCESS);
                if (localDoiQuery) localCntManager.i(ConsolidationCounters.CONSOLIDATION_PER_DOI_SUCCESS);
              }
              break;
            }
          }
        }
      };
      (
        listener as unknown as {
          onError(status: number, message: string, exception: unknown): void;
        }
      ).onError = (status, message, exception) => {
        Consolidation.LOGGER.info(
          "Consolidation service returns error (" + status + ") : " + message,
          exception,
        );
      };

      (this.client as { pushRequest: (...a: unknown[]) => void }).pushRequest(
        "works",
        args,
        this.workDeserializer,
        threadId,
        listener,
      );
    } catch (e) {
      Consolidation.LOGGER.info("Consolidation error - ", e);
    }

    (this.client as { finish: (id: number) => void }).finish(threadId);
    if (results.length === 0) return null;
    return results[0]!;
  }

  /**
   * Try to consolidate a list of bibliographical objects in one operation with consolidation services.
   * In practice this method is used for consolidating the metadata of all the extracted bibliographical
   * references.
   */
  consolidateBatch(biblios: BibDataSet[]): Map<number, InstanceType<typeof BiblioItem>> | null {
    if (collIsEmpty(biblios)) return null;
    const results = new Map<number, InstanceType<typeof BiblioItem>>();
    let n = 0;
    const threadId = this.nextThreadId();
    const consolidationService = GrobidProperties.getInstance().getConsolidationService();

    for (const bibDataSet of biblios) {
      const theBiblio = bibDataSet.getResBib() as InstanceType<typeof BiblioItem>;

      if (this.cntManager !== null) this.cntManager.i(ConsolidationCounters.TOTAL_BIB_REF);

      const fields = Consolidation.extractFieldsFromBiblioItem(theBiblio);
      const rawCitation = bibDataSet.getRawBib() as string | null;

      const args = Consolidation.buildWorkQueryArguments(
        fields,
        rawCitation,
        -1,
        consolidationService,
      );
      if (args === null) {
        n++;
        continue;
      }

      let doiQuery: boolean;
      const doi = fields.doi;
      try {
        if (this.cntManager !== null) {
          this.cntManager.i(ConsolidationCounters.CONSOLIDATION);
        }

        if (isNotBlank(doi) && this.cntManager !== null) {
          this.cntManager.i(ConsolidationCounters.CONSOLIDATION_PER_DOI);
          doiQuery = true;
        } else {
          doiQuery = false;
        }

        const localDoiQuery = doiQuery;
        const localCntManager = this.cntManager;
        const listener = new CrossrefRequestListener<InstanceType<typeof BiblioItem>>(n);
        (
          listener as unknown as {
            getRank(): number;
            onSuccess(res: InstanceType<typeof BiblioItem>[]): void;
          }
        ).onSuccess = (res) => {
          if (isNotEmpty(res)) {
            for (const oneRes of res) {
              if (
                consolidationService === GrobidConsolidationService.GLUTTON ||
                !GrobidProperties.getCrossrefPostValidation() ||
                this.postValidation(theBiblio, oneRes)
              ) {
                oneRes.setLabeledTokens(theBiblio.getLabeledTokens());
                oneRes.setStatus(Consolidation.CONSOLIDATION_STATUS_CONSOLIDATED);
                oneRes.setConsolidationService(consolidationService.getExt());
                results.set(
                  (listener as unknown as { getRank(): number }).getRank(),
                  oneRes,
                );
                if (localCntManager !== null) {
                  localCntManager.i(ConsolidationCounters.CONSOLIDATION_SUCCESS);
                  if (localDoiQuery)
                    localCntManager.i(ConsolidationCounters.CONSOLIDATION_PER_DOI_SUCCESS);
                }
                break;
              }
            }
          }
        };
        (
          listener as unknown as {
            onError(status: number, message: string, exception: unknown): void;
          }
        ).onError = (status, message) => {
          Consolidation.LOGGER.info("Consolidation service returns error (" + status + ") : " + message);
        };

        (this.client as { pushRequest: (...a: unknown[]) => void }).pushRequest(
          "works",
          args,
          this.workDeserializer,
          threadId,
          listener,
        );
      } catch (e) {
        Consolidation.LOGGER.info("Consolidation error - ", e);
      }
      n++;
    }
    (this.client as { finish: (id: number) => void }).finish(threadId);

    return results;
  }

  /**
   * The public CrossRef API is a search API, and thus returns
   * many false positives. It is necessary to validate return results
   * against the (incomplete) source bibliographic item to block
   * inconsistent results.
   */
  private postValidation(
    source: InstanceType<typeof BiblioItem>,
    result: InstanceType<typeof BiblioItem>,
  ): boolean {
    const valid = true;

    const srcSurname = source.getFirstAuthorSurname() as string | null;
    const resSurname = result.getFirstAuthorSurname() as string | null;
    if (!isBlank(srcSurname) && !isBlank(resSurname)) {
      if (this.ratcliffObershelpDistance(srcSurname as string, resSurname as string, false) < 0.8)
        return false;
    }

    return valid;
  }

  private ratcliffObershelpDistance(
    string1: string,
    string2: string,
    caseDependent: boolean,
  ): number {
    if (isBlank(string1) || isBlank(string2)) return 0.0;
    let similarity = 0.0;
    let s1 = string1;
    let s2 = string2;
    if (!caseDependent) {
      s1 = s1.toLowerCase();
      s2 = s2.toLowerCase();
    }
    if (s1 === s2) {
      similarity = 1.0;
    }

    if (s1.length !== 0 && s2.length !== 0) {
      similarity = ratcliffObershelp(s1, s2);
    }

    return similarity;
  }

  consolidateFunder(funder: Funder): Funder | null {
    const results: Funder[] = [];

    const args = Consolidation.buildFunderQueryArguments(funder);
    if (args === null) return null;

    const threadId = this.nextThreadId();

    try {
      const listener = new CrossrefRequestListener<Funder>(0);
      (
        listener as unknown as { onSuccess(res: Funder[] | null): void }
      ).onSuccess = (res) => {
        if (res !== null && res.length > 0) {
          for (const oneRes of res) {
            if (oneRes.getFullName() !== null) {
              let localFullName = oneRes.getFullName() as string;
              localFullName = TextUtilities.removeFieldStopwords(localFullName) as string;
              if (
                this.ratcliffObershelpDistance(localFullName, args.get("query") as string, false) > 0.9
              ) {
                results.push(oneRes);
              }
            }
          }
        }
      };
      (
        listener as unknown as {
          onError(status: number, message: string, exception: unknown): void;
        }
      ).onError = (status, message, exception) => {
        Consolidation.LOGGER.info(
          "Funder consolidation service returns error (" + status + ") : " + message,
          exception,
        );
      };

      (this.client as { pushRequest: (...a: unknown[]) => void }).pushRequest(
        "funders",
        args,
        this.funderDeserializer,
        threadId,
        listener,
      );
    } catch (e) {
      Consolidation.LOGGER.info("Funder consolidation error - ", e);
    }
    (this.client as { finish: (id: number) => void }).finish(threadId);
    if (results.length === 0) return null;
    return results[0]!;
  }

  consolidateFunders(funders: Funder[]): Map<number, Funder> | null {
    if (collIsEmpty(funders)) return null;
    const results = new Map<number, Funder>();
    let n = 0;
    const threadId = this.nextThreadId();
    for (const funder of funders) {
      const args = Consolidation.buildFunderQueryArguments(funder);
      if (args === null) {
        n++;
        continue;
      }

      try {
        const listener = new CrossrefRequestListener<Funder>(n);
        (
          listener as unknown as {
            getRank(): number;
            onSuccess(res: Funder[] | null): void;
          }
        ).onSuccess = (res) => {
          const localResults: Funder[] = [];
          if (isNotEmpty(res)) {
            for (const oneRes of res as Funder[]) {
              if (oneRes.getFullName() !== null) {
                let localFullName = oneRes.getFullName() as string;
                localFullName = TextUtilities.removeFieldStopwords(localFullName) as string;
                if (localFullName.toLowerCase() === (args.get("query") as string).toLowerCase()) {
                  localResults.push(oneRes);
                  break;
                } else if (
                  this.ratcliffObershelpDistance(
                    localFullName,
                    args.get("query") as string,
                    false,
                  ) > 0.9
                ) {
                  localResults.push(oneRes);
                }
              }
            }

            if (localResults.length > 0) {
              results.set(
                (listener as unknown as { getRank(): number }).getRank(),
                localResults[0]!,
              );
            }
          }
        };
        (
          listener as unknown as {
            onError(status: number, message: string, exception: unknown): void;
          }
        ).onError = (status, message, exception) => {
          Consolidation.LOGGER.info(
            "Funder consolidation service returns error (" + status + ") : " + message,
            exception,
          );
        };

        (this.client as { pushRequest: (...a: unknown[]) => void }).pushRequest(
          "funders",
          args,
          this.funderDeserializer,
          threadId,
          listener,
        );
      } catch (e) {
        Consolidation.LOGGER.info("Funder consolidation error - ", e);
      }
      n++;
    }

    (this.client as { finish: (id: number) => void }).finish(threadId);
    return results;
  }
}

// ----- Ratcliff/Obershelp similarity ------------------------------------

/**
 * Ratcliff/Obershelp pattern matching similarity.
 *
 * Algorithm (Ratcliff & Obershelp, 1988):
 *   1. Find the longest common substring (LCS) of s1 and s2.
 *   2. Recursively repeat for the prefix-pair and suffix-pair around the LCS.
 *   3. Sum lengths of all matched substrings, then 2 * matched / (|s1|+|s2|).
 */
function ratcliffObershelp(s1: string, s2: string): number {
  const total = s1.length + s2.length;
  if (total === 0) return 1.0;
  const matched = roMatched(s1, s2);
  return (2.0 * matched) / total;
}

function roMatched(s1: string, s2: string): number {
  if (s1.length === 0 || s2.length === 0) return 0;
  // Longest common substring via DP
  const n = s1.length;
  const m = s2.length;
  // To stay linear in memory we use two rolling rows
  let prev = new Array<number>(m + 1).fill(0);
  let curr = new Array<number>(m + 1).fill(0);
  let bestLen = 0;
  let bestI = 0;
  let bestJ = 0;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (s1.charCodeAt(i - 1) === s2.charCodeAt(j - 1)) {
        const v = (prev[j - 1] ?? 0) + 1;
        curr[j] = v;
        if (v > bestLen) {
          bestLen = v;
          bestI = i; // end of match in s1 (1-based, exclusive end is bestI)
          bestJ = j;
        }
      } else {
        curr[j] = 0;
      }
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
    for (let k = 0; k <= m; k++) curr[k] = 0;
  }
  if (bestLen === 0) return 0;
  const startI = bestI - bestLen;
  const startJ = bestJ - bestLen;
  const left = roMatched(s1.substring(0, startI), s2.substring(0, startJ));
  const right = roMatched(s1.substring(bestI), s2.substring(bestJ));
  return bestLen + left + right;
}
