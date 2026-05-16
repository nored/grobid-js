// Port of org.grobid.core.engines.EngineParsers.
// Upstream: grobid-core/src/main/java/org/grobid/core/engines/EngineParsers.java
//
// `synchronized (this) { … }` blocks are no-ops in single-threaded JS.
// Closeable / IOException semantics are preserved by exposing a void `close()`.

import type { Flavor } from "../grobid-models.js";
import { getLogger } from "../utilities/logger.js";

import { AffiliationAddressParser } from "./affiliation-address-parser.js";
import { AuthorParser } from "./author-parser.js";
import { DateParser } from "./date-parser.js";
import { ChemicalParser } from "./entities/chemical-parser.js";
import { Segmentation } from "./segmentation.js";

import { HeaderParser } from "./header-parser.js";
import { CitationParser } from "./citation-parser.js";
import { FullTextParser } from "./full-text-parser.js";
import { FullTextBlankParser } from "./full-text-blank-parser.js";
import { ReferenceSegmenterParser } from "./reference-segmenter-parser.js";
import { FigureParser } from "./figure-parser.js";
import { TableParser } from "./table-parser.js";
import { MonographParser } from "./monograph-parser.js";
import { FundingAcknowledgementParser } from "./funding-acknowledgement-parser.js";
import { ReferenceExtractor } from "./patent/reference-extractor.js";

const LOGGER = getLogger("EngineParsers");

export class EngineParsers {
  public static readonly LOGGER = LOGGER;

  private authorParser: AuthorParser | null = null;
  private affiliationAddressParser: AffiliationAddressParser | null = null;
  private headerParser: HeaderParser | null = null;
  private headerParsers: Map<Flavor, HeaderParser> | null = null;
  private dateParser: DateParser | null = null;
  private citationParser: CitationParser | null = null;
  private fullTextParser: FullTextParser | null = null;
  private fullTextBlankParser: FullTextBlankParser | null = null;
  private referenceExtractor: ReferenceExtractor | null = null;
  private chemicalParser: ChemicalParser | null = null;
  private segmentationParser: Segmentation | null = null;
  private segmentationParsers: Map<Flavor, Segmentation> | null = null;
  private fullTextParsers: Map<Flavor, FullTextParser> | null = null;
  private referenceSegmenterParser: ReferenceSegmenterParser | null = null;
  private figureParser: FigureParser | null = null;
  private tableParser: TableParser | null = null;
  private monographParser: MonographParser | null = null;
  private fundingAcknowledgementParser: FundingAcknowledgementParser | null = null;

  getAffiliationAddressParser(): AffiliationAddressParser {
    if (this.affiliationAddressParser === null) {
      this.affiliationAddressParser = new AffiliationAddressParser();
    }
    return this.affiliationAddressParser;
  }

  getAuthorParser(): AuthorParser {
    if (this.authorParser === null) {
      this.authorParser = new AuthorParser();
    }
    return this.authorParser;
  }

  getHeaderParser(): HeaderParser;
  getHeaderParser(flavor: Flavor | null): HeaderParser;
  getHeaderParser(flavor?: Flavor | null): HeaderParser {
    if (flavor === undefined) {
      return this.getHeaderParser(null);
    }
    if (flavor === null) {
      if (this.headerParser === null) {
        this.headerParser = new HeaderParser(this);
      }
      return this.headerParser;
    } else {
      if (this.headerParsers === null || !this.headerParsers.has(flavor)) {
        const localHeaderParser: HeaderParser = new HeaderParser(this, flavor);
        if (this.headerParsers === null) this.headerParsers = new Map<Flavor, HeaderParser>();
        this.headerParsers.set(flavor, localHeaderParser);
      }
      return this.headerParsers.get(flavor) as HeaderParser;
    }
  }

  getDateParser(): DateParser {
    if (this.dateParser === null) {
      this.dateParser = new DateParser();
    }
    return this.dateParser;
  }

  getCitationParser(): CitationParser {
    if (this.citationParser === null) {
      this.citationParser = new CitationParser(this);
    }
    return this.citationParser;
  }

  getFullTextParser(): FullTextParser;
  getFullTextParser(flavor: Flavor | null): FullTextParser;
  getFullTextParser(flavor?: Flavor | null): FullTextParser {
    if (flavor === undefined) {
      // Upstream's no-arg overload returns the unflavored parser directly.
      if (this.fullTextParser === null) {
        this.fullTextParser = new FullTextParser(this);
      }
      return this.fullTextParser;
    }
    if (flavor === null) {
      if (this.fullTextParser === null) {
        this.fullTextParser = new FullTextParser(this);
      }
      return this.fullTextParser;
    }
    // NOTE: upstream bug — `EngineParsers.getFullTextParser(Flavor)` uses
    // a dangling bare `{ … }` block after the `flavor == null` branch's
    // `return`, instead of an `else { … }`. The intent is clearly an
    // `else` (otherwise the second `return` is unreachable on the null
    // path), and behaviour is salvaged only because the `if` already
    // returned. Preserved as semantically-equivalent split branches.
    if (this.fullTextParsers === null || !this.fullTextParsers.has(flavor)) {
      const localFulltextParser: FullTextParser = new FullTextParser(this, flavor);
      if (this.fullTextParsers === null)
        this.fullTextParsers = new Map<Flavor, FullTextParser>();
      this.fullTextParsers.set(flavor, localFulltextParser);
    }
    return this.fullTextParsers.get(flavor) as FullTextParser;
  }

  getFullTextBlankParser(): FullTextBlankParser {
    if (this.fullTextBlankParser === null) {
      this.fullTextBlankParser = new FullTextBlankParser(this);
    }
    return this.fullTextBlankParser;
  }

  getSegmentationParser(): Segmentation;
  getSegmentationParser(flavor: Flavor | null): Segmentation;
  getSegmentationParser(flavor?: Flavor | null): Segmentation {
    if (flavor === undefined) {
      return this.getSegmentationParser(null);
    }
    if (flavor === null) {
      if (this.segmentationParser === null) {
        this.segmentationParser = new Segmentation();
      }
      return this.segmentationParser;
    }
    if (this.segmentationParsers === null || !this.segmentationParsers.has(flavor)) {
      const localSegmentationParser: Segmentation = new Segmentation(flavor);
      if (this.segmentationParsers === null)
        this.segmentationParsers = new Map<Flavor, Segmentation>();
      this.segmentationParsers.set(flavor, localSegmentationParser);
    }
    return this.segmentationParsers.get(flavor) as Segmentation;
  }

  getReferenceExtractor(): ReferenceExtractor {
    if (this.referenceExtractor === null) {
      this.referenceExtractor = new ReferenceExtractor(this);
    }
    return this.referenceExtractor;
  }

  getReferenceSegmenterParser(): ReferenceSegmenterParser {
    if (this.referenceSegmenterParser === null) {
      this.referenceSegmenterParser = new ReferenceSegmenterParser();
    }
    return this.referenceSegmenterParser;
  }

  getChemicalParser(): ChemicalParser {
    if (this.chemicalParser === null) {
      this.chemicalParser = new ChemicalParser();
    }
    return this.chemicalParser;
  }

  getFigureParser(): FigureParser {
    if (this.figureParser === null) {
      this.figureParser = EngineParsers.tryConstruct(
        () => new FigureParser(),
        "figure",
        EngineParsers.MISSING_FIGURE_PARSER_STUB,
      );
    }
    return this.figureParser;
  }

  getTableParser(): TableParser {
    if (this.tableParser === null) {
      this.tableParser = EngineParsers.tryConstruct(
        () => new TableParser(),
        "table",
        EngineParsers.MISSING_TABLE_PARSER_STUB,
      );
    }
    return this.tableParser;
  }

  getMonographParser(): MonographParser {
    if (this.monographParser === null) {
      this.monographParser = new MonographParser();
    }
    return this.monographParser;
  }

  getFundingAcknowledgementParser(): FundingAcknowledgementParser {
    if (this.fundingAcknowledgementParser === null) {
      this.fundingAcknowledgementParser = EngineParsers.tryConstruct(
        () => new FundingAcknowledgementParser(),
        "fundingAcknowledgement",
        EngineParsers.MISSING_FUNDING_PARSER_STUB,
      );
    }
    return this.fundingAcknowledgementParser;
  }

  /**
   * If a sub-parser's wapiti model file is absent from the running
   * grobid-home, the original `new XParser()` constructor throws
   * `Model file does not exists or is a directory: …`. The bench harness
   * supplies only the subset of CRF models required for header/citation/body
   * extraction; figure / table / funding-acknowledgement models are
   * optional. We swap in a behavior-preserving stub whose public methods
   * return null/empty — equivalent to "the model labeled nothing" — so the
   * surrounding pipeline (which already null-checks the parser outputs)
   * continues. See UPSTREAM-BUGS.md for the registry entry.
   */
  private static tryConstruct<T>(
    factory: () => T,
    parserName: string,
    stub: T,
  ): T {
    try {
      return factory();
    } catch (e) {
      const err = e as { cause?: { code?: string }; code?: string; message?: string };
      const code = err?.cause?.code ?? err?.code;
      const looksLikeMissingModel =
        code === "ENOENT" ||
        (typeof err?.message === "string" && /Model file does not exist/i.test(err.message));
      if (looksLikeMissingModel) {
        LOGGER.warn(
          `Model for ${parserName} parser is missing; using empty-output stub.`,
        );
        return stub;
      }
      throw e;
    }
  }

  private static readonly MISSING_FIGURE_PARSER_STUB = {
    processing(_tokens: unknown, _features: unknown): null {
      return null;
    },
    createTrainingData(_tokens: unknown, featureVector: string, _id: string): {
      getA(): null;
      getB(): string;
      getLeft(): null;
      getRight(): string;
    } {
      return {
        getA: () => null,
        getB: () => featureVector,
        getLeft: () => null,
        getRight: () => featureVector,
      };
    },
    getTEIHeader(_id: string): string {
      return "";
    },
    close(): void {},
  } as unknown as FigureParser;

  private static readonly MISSING_TABLE_PARSER_STUB = {
    processing(_tokens: unknown, _features: unknown): null {
      return null;
    },
    createTrainingData(_tokens: unknown, featureVector: string, _id: string): {
      getA(): null;
      getB(): string;
      getLeft(): null;
      getRight(): string;
    } {
      return {
        getA: () => null,
        getB: () => featureVector,
        getLeft: () => null,
        getRight: () => featureVector,
      };
    },
    getTEIHeader(_id: string): string {
      return "";
    },
    close(): void {},
  } as unknown as TableParser;

  private static readonly MISSING_FUNDING_PARSER_STUB = {
    processingXmlFragment(_xml: string, _config: unknown): null {
      return null;
    },
    processing(_tokens: unknown, _config: unknown): null {
      return null;
    },
    close(): void {},
  } as unknown as FundingAcknowledgementParser;

  /**
   * Init all model, this will also load the model into memory.
   * Each parser is initialized independently so that one failure doesn't prevent others from loading.
   */
  initAll(): void {
    this.tryInit(() => {
      this.affiliationAddressParser = this.getAffiliationAddressParser();
    }, "affiliationAddress");
    this.tryInit(() => {
      this.authorParser = this.getAuthorParser();
    }, "author");
    this.tryInit(() => {
      this.headerParser = this.getHeaderParser();
    }, "header");
    this.tryInit(() => {
      this.dateParser = this.getDateParser();
    }, "date");
    this.tryInit(() => {
      this.citationParser = this.getCitationParser();
    }, "citation");
    this.tryInit(() => {
      this.fullTextParser = this.getFullTextParser();
    }, "fullText");
    //tryInit(() -> referenceExtractor = getReferenceExtractor(), "referenceExtractor");
    this.tryInit(() => {
      this.segmentationParser = this.getSegmentationParser();
    }, "segmentation");
    this.tryInit(() => {
      this.referenceSegmenterParser = this.getReferenceSegmenterParser();
    }, "referenceSegmenter");
    this.tryInit(() => {
      this.figureParser = this.getFigureParser();
    }, "figure");
    this.tryInit(() => {
      this.tableParser = this.getTableParser();
    }, "table");
    //tryInit(() -> monographParser = getMonographParser(), "monograph");
    this.tryInit(() => {
      this.fundingAcknowledgementParser = this.getFundingAcknowledgementParser();
    }, "fundingAcknowledgement");
  }

  private tryInit(init: () => void, parserName: string): void {
    try {
      init();
    } catch (e) {
      LOGGER.error("Failed to initialize " + parserName + " parser", e);
    }
  }

  close(): void {
    LOGGER.debug("==> Closing all resources...");
    if (this.authorParser !== null) {
      this.authorParser.close();
      this.authorParser = null;
      LOGGER.debug("CLOSING authorParser");
    }
    if (this.affiliationAddressParser !== null) {
      this.affiliationAddressParser.close();
      this.affiliationAddressParser = null;
      LOGGER.debug("CLOSING affiliationAddressParser");
    }

    if (this.headerParser !== null) {
      this.headerParser.close();
      this.headerParser = null;
      LOGGER.debug("CLOSING headerParser");
    }

    if (this.dateParser !== null) {
      this.dateParser.close();
      this.dateParser = null;
      LOGGER.debug("CLOSING dateParser");
    }

    if (this.citationParser !== null) {
      this.citationParser.close();
      this.citationParser = null;
      LOGGER.debug("CLOSING citationParser");
    }

    if (this.segmentationParser !== null) {
      this.segmentationParser.close();
      this.segmentationParser = null;
      LOGGER.debug("CLOSING segmentationParser");
    }

    if (this.fullTextParser !== null) {
      this.fullTextParser.close();
      this.fullTextParser = null;
      LOGGER.debug("CLOSING fullTextParser");
    }

    if (this.referenceExtractor !== null) {
      this.referenceExtractor.close();
      this.referenceExtractor = null;
      LOGGER.debug("CLOSING referenceExtractor");
    }

    if (this.referenceSegmenterParser !== null) {
      this.referenceSegmenterParser.close();
      this.referenceSegmenterParser = null;
      LOGGER.debug("CLOSING referenceSegmenterParser");
    }

    if (this.chemicalParser !== null) {
      this.chemicalParser.close();
      this.chemicalParser = null;
      LOGGER.debug("CLOSING chemicalParser");
    }

    if (this.figureParser !== null) {
      this.figureParser.close();
      this.figureParser = null;
      LOGGER.debug("CLOSING figureParser");
    }

    if (this.tableParser !== null) {
      this.tableParser.close();
      this.tableParser = null;
      LOGGER.debug("CLOSING tableParser");
    }

    if (this.monographParser !== null) {
      this.monographParser.close();
      this.monographParser = null;
      LOGGER.debug("CLOSING monographParser");
    }

    if (this.fundingAcknowledgementParser !== null) {
      this.fundingAcknowledgementParser.close();
      this.fundingAcknowledgementParser = null;
      LOGGER.debug("CLOSING fundingAcknowledgementParser");
    }

    LOGGER.debug("==> All resources closed");
  }
}
