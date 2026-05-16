// Port of org.grobid.core.sax.ST36SaxParser.
// Upstream: grobid-core/src/main/java/org/grobid/core/sax/ST36SaxParser.java
//
// SAX parser initially made for XML CLEF IP data (collection, training and
// topics), but it works also fine for parsing ST.36 flavors as the formats
// are similar.

import { GrobidAnalyzer } from "../analyzers/grobid-analyzer.js";
import { GrobidException } from "../exceptions/grobid-exception.js";
import { LayoutToken } from "../layout/layout-token.js";
import { getLogger } from "../utilities/logger.js";
import { parseSax, type SaxAttributes, type SaxHandler } from "./sax-walker.js";

const LOGGER = getLogger("ST36SaxParser");

/**
 * Upstream ST36SaxParser.java line 22-549.
 */
export class ST36SaxParser implements SaxHandler {
  // Upstream line 23.
  static readonly LOGGER = LOGGER;

  // Upstream line 25-26.
  private accumulator: string[] = [];
  private accumulatorRef: string[] = [];

  // Upstream line 28-37.
  private PatentNumber: string | null = null;
  private PatentID: number = -1;
  private PublicDate: string | null = null;
  private PriorityDate: string | null = null;
  private CodeType: string | null = null;
  private PublicationDate: string | null = null;
  private Content: string | null = null;
  private CitedPatentNumber: string[] | null = null;
  private CitationID: number[] | null = null;
  private Classification: string | null = null;

  // Upstream line 40.
  private cited_number: string | null = null;

  // Upstream line 42-44.
  referencesPatent: Map<string, string[]> | null = null;
  referencesNPL: string[] | null = null;
  citations: string[] | null = null; // search report citations

  // Upstream line 46-47.
  private npl: boolean = false; // indicate if the current reference is to patent or to a npl
  private ref: boolean = false; // are we reading a ref?

  // Upstream line 50.
  private refFound: boolean = false;

  // Upstream line 54.
  private outsideParagraph: boolean = true;

  // Upstream line 56-58.
  private nbNPLRef: number = 0;
  private nbPatentRef: number = 0;
  nbAllRef: number = 0;

  // Upstream line 60-61.
  private window: number = -1;

  // Upstream line 63-64.
  patentReferences: boolean = false;
  nplReferences: boolean = false;

  // Upstream line 66.
  private currentFileName: string | null = null;

  // Upstream line 69-70.
  allAccumulatedTokens: LayoutToken[][] | null = null;
  allAccumulatedLabels: string[][] | null = null;

  // Upstream line 73-74.
  accumulatedTokens: LayoutToken[] = [];
  accumulatedLabels: string[] = [];

  // Upstream line 76.
  private analyzer: GrobidAnalyzer = GrobidAnalyzer.getInstance();

  // Upstream line 78-79.
  constructor() {
    // empty
  }

  /** Drive the parser from an XML string. */
  parse(xml: string): void {
    parseSax(this, xml);
  }

  // Upstream line 81-83.
  setWindow(n: number): void {
    this.window = n;
  }

  // Upstream line 85-91.
  characters(buffer: string, _start: number, _length: number): void {
    if (this.ref) {
      this.accumulatorRef.push(buffer);
    } else {
      this.accumulator.push(buffer);
    }
  }

  // Upstream line 93-96.
  getText(): string {
    // NOTE: upstream line 94 — `//System.out.println(...)` (commented-out).
    return this.accumulator.join("").trim();
  }

  // Upstream line 98-100.
  getNbNPLRef(): number {
    return this.nbNPLRef;
  }

  // Upstream line 102-104.
  getNbPatentRef(): number {
    return this.nbPatentRef;
  }

  // Upstream line 106-109.
  getRefText(): string {
    // NOTE: upstream line 107 — `//System.out.println(...)` (commented-out).
    return this.accumulatorRef.join("").trim();
  }

  // Upstream line 111-117.
  setFileName(name: string): void {
    this.currentFileName = name;
    if (this.referencesPatent === null) {
      this.referencesPatent = new Map<string, string[]>();
    }
    this.referencesPatent.set(name, []);
  }

  // Upstream line 119-324.
  endElement(_uri: string, _localName: string, qName: string): void {
    if (qName === "date") {
      this.accumulator = [];
    } else if (qName === "ref" || qName === "bibl") {
      let refString = this.getRefText();
      refString = refString.split("\n").join(" ");
      refString = refString.split("\t").join(" ");
      refString = refString.split("  ").join(" ");

      if (this.npl && this.ref) {
        if (this.referencesNPL === null) this.referencesNPL = [];
        this.referencesNPL.push(refString);
        this.refFound = true;
        if (this.nplReferences) this.nbNPLRef++;
      } else if (this.ref) {
        if (this.referencesPatent === null) {
          this.referencesPatent = new Map<string, string[]>();
        }
        let refss = this.referencesPatent.get(this.currentFileName!);
        if (refss === undefined) {
          refss = [];
        }
        refss.push(refString);
        this.referencesPatent.set(this.currentFileName!, refss);
        this.refFound = true;
        if (this.patentReferences) {
          this.nbPatentRef++;
        }
      }

      if (this.refFound) {
        // we tokenize the text
        let tokenizations: string[] = [];
        try {
          // TBD: pass a language object to the tokenize method call
          tokenizations = this.analyzer.tokenize(refString);
        } catch {
          LOGGER.debug("Tokenization for XML patent document has failed.");
        }
        let i = 0;
        for (const token of tokenizations) {
          // NOTE: upstream line 169 — `//token = st.nextToken().trim();` (commented-out).
          if (
            token.trim().length === 0 ||
            token === " " ||
            token === "\t" ||
            token === "\n" ||
            token === "\r"
          ) {
            continue;
          }
          try {
            this.accumulatedTokens.push(new LayoutToken(token));
            if (this.npl) {
              if (this.nplReferences) {
                if (i === 0) {
                  this.accumulatedLabels.push("I-<refNPL>");
                } else if (token === null) {
                  // NOTE: upstream check `token == null` is unreachable here
                  // (we already iterated `tokenizations`), preserved verbatim.
                  this.accumulatedLabels.push("E-<refNPL>");
                } else {
                  this.accumulatedLabels.push("<refNPL>");
                }
              } else {
                this.accumulatedLabels.push("<other>");
              }
            } else {
              if (this.patentReferences) {
                if (i === 0) {
                  this.accumulatedLabels.push("I-<refPatent>");
                } else if (token === null) {
                  // NOTE: same as above.
                  this.accumulatedLabels.push("E-<refPatent>");
                } else {
                  this.accumulatedLabels.push("<refPatent>");
                }
              } else {
                this.accumulatedLabels.push("<other>");
              }
            }
          } catch (e) {
            throw new GrobidException(
              "An exception occured while running Grobid.",
              e instanceof Error ? e : new Error(String(e)),
            );
          }
          i++;
        }
      }
      this.ref = false;
    } else if (qName === "classification-ipcr") {
      this.accumulator = [];
    } else if (qName === "classification-symbol") {
      this.accumulator = [];
    } else if (qName === "abstract") {
      this.accumulator = [];
    } /* NOTE: upstream lines 218-220 — `else if (qName.equals("heading")) {
            accumulator.append(" ");
        }` (commented-out). */ else if (
      qName === "description"
    ) {
      // In case we have no paragraph structures, we will get the whole
      // description in a huge single text block — this text needs to be
      // segmented in to paragraph-like blocks to be used by Deep Learning
      // approaches.
      // (upstream block is empty, preserved verbatim)
    } else if (qName === "p" || qName === "heading") {
      this.accumulator.push("\n");
      const allTokenizations: string[][] = [];
      const content = this.getText();

      // we tokenize the text
      let tokenization: string[] = [];
      try {
        // TBD: pass a language object to the tokenize method call
        tokenization = this.analyzer.tokenize(content);
      } catch {
        LOGGER.debug("Tokenization for XML patent document has failed.");
      }
      // we could introduce here some further sub-segmentation
      allTokenizations.push(tokenization);

      for (const tokenizations of allTokenizations) {
        let i = 0;
        for (let token of tokenizations) {
          // NOTE: upstream line 248 — `//token = st.nextToken().trim();` (commented-out).
          if (
            token.trim().length === 0 ||
            token === " " ||
            token === "\t" ||
            token === "\n" ||
            token === "\r"
          ) {
            continue;
          }
          // we print only a window of N words
          if (i > this.window && this.window !== -1) {
            token = token.trim();
            if (token.length > 0) {
              this.accumulatedTokens.push(new LayoutToken(token));
              this.accumulatedLabels.push("<ignore>");
            }
          } else {
            try {
              token = token.trim();
              if (token.length > 0) {
                this.accumulatedTokens.push(new LayoutToken(token));
                this.accumulatedLabels.push("<other>");
              }
            } catch (e) {
              throw new GrobidException(
                "An exception occured while running Grobid.",
                e instanceof Error ? e : new Error(String(e)),
              );
            }
          }
          i++;
        }

        this.allAccumulatedTokens!.push(this.accumulatedTokens);
        this.allAccumulatedLabels!.push(this.accumulatedLabels);
        this.accumulatedTokens = [];
        this.accumulatedLabels = [];
      }

      this.accumulator = [];
      this.refFound = false;

      this.allAccumulatedTokens!.push(this.accumulatedTokens);
      this.allAccumulatedLabels!.push(this.accumulatedLabels);
      this.outsideParagraph = true;
    } else if (qName === "patcit") {
      // we register the citation, the citation context will be marked in a later stage
      if (this.citations === null) this.citations = [];
      this.citations.push(this.cited_number!);
      this.accumulator = [];
    } else if (qName === "invention-title") {
      this.accumulator = [];
    } else if (qName === "applicants") {
      this.accumulator = [];
    } else if (qName === "inventors") {
      this.accumulator = [];
    } else if (qName === "document-id") {
      this.accumulator = [];
    } else if (qName === "legal-status") {
      this.accumulator = [];
    } else if (qName === "bibliographic-data") {
      this.accumulator = [];
    } else if (qName === "doc-number") {
      this.accumulator = [];
    } else if (qName === "country") {
      this.accumulator = [];
    } else if (qName === "kind") {
      this.accumulator = [];
    } else if (qName === "classification-symbol") {
      this.accumulator = [];
    } else if (qName === "classification-ecla") {
      this.accumulator = [];
    } else if (qName === "patent-document" || qName === "fulltext-document") {
      // upstream: empty branch.
    } else if (qName === "row") {
      this.accumulator.push(" ");
    }
  }

  // Upstream line 326-547.
  startElement(_namespaceURI: string, _localName: string, qName: string, atts: SaxAttributes): void {
    if (qName === "patent-document" || qName === "fulltext-document") {
      this.nbNPLRef = 0;
      this.nbPatentRef = 0;
      this.nbAllRef = 0;
      const length = atts.getLength();
      for (let i = 0; i < length; i++) {
        const name = atts.getQName(i);
        const value = atts.getValue(i);
        if (name !== null) {
          if (name === "lang") {
            // NOTE: upstream line 344 — `//Global_Language_Code = value.toLowerCase();` (commented-out).
          }
          if (name === "doc-number") {
            this.PatentNumber = "EP" + value;
          }
          if (name === "kind") {
            this.CodeType = value;
          }
          if (name === "date") {
            this.PublicDate = value;
          }
        }
      }
      this.CitedPatentNumber = [];
      this.accumulator = [];
      this.allAccumulatedTokens = [];
      this.allAccumulatedLabels = [];
    } else if (qName === "description") {
      this.accumulator = [];
    } else if (qName === "p" || qName === "heading") {
      // possible text read outside <p> and <heading>?
      this.outsideParagraph = false;
      this.accumulatedTokens = [];
      this.accumulatedLabels = [];
      this.accumulator = [];
    } else if (qName === "ref" || qName === "bibl") {
      const length = atts.getLength();
      this.nbAllRef++;
      for (let i = 0; i < length; i++) {
        const name = atts.getQName(i);
        const value = atts.getValue(i);
        if (name !== null) {
          if (name === "type" || name === "typ") {
            if (value === "npl" || value === "book" || value === "journal") {
              const content = this.getText();
              const allTokenizations: string[][] = [];

              // we output what has been read so far in the description
              let tokenization: string[] = [];
              try {
                // TBD: pass a language object to the tokenize method call
                tokenization = this.analyzer.tokenize(content);
              } catch {
                LOGGER.debug("Tokenization for XML patent document has failed.");
              }
              const nbTokens = tokenization.length;
              allTokenizations.push(tokenization);

              // NOTE: upstream lines 402-411 — `//boolean newSegment = false;`
              // block commented out.
              for (const tokenizations of allTokenizations) {
                let j = 0;
                for (const token of tokenizations) {
                  if (
                    token.trim().length === 0 ||
                    token === " " ||
                    token === "\t" ||
                    token === "\n" ||
                    token === "\r"
                  ) {
                    continue;
                  }
                  if (
                    this.window === -1 ||
                    (j > nbTokens - this.window && this.window !== -1) ||
                    (this.refFound && j < this.window && this.window !== -1)
                  ) {
                    try {
                      this.accumulatedTokens.push(new LayoutToken(token));
                      this.accumulatedLabels.push("<other>");
                    } catch (e) {
                      throw new GrobidException(
                        "An exception occured while running Grobid.",
                        e instanceof Error ? e : new Error(String(e)),
                      );
                    }
                  } else {
                    try {
                      this.accumulatedTokens.push(new LayoutToken(token));
                      this.accumulatedLabels.push("<ignore>");
                    } catch (e) {
                      throw new GrobidException(
                        "An exception occured while running Grobid.",
                        e instanceof Error ? e : new Error(String(e)),
                      );
                    }
                  }
                  j++;
                }
              }

              this.accumulator = [];
              this.npl = true;
              this.ref = true;
            } else if (value === "patent" || value === "pl") {
              const content = this.getText();
              const allTokenizations: string[][] = [];

              let tokenization: string[] = [];
              try {
                // TBD: pass a language object to the tokenize method call
                tokenization = this.analyzer.tokenize(content);
              } catch {
                LOGGER.debug("Tokenization for XML patent document has failed.");
              }
              const nbTokens = tokenization.length;
              allTokenizations.push(tokenization);

              for (const tokenizations of allTokenizations) {
                let j = 0;
                for (const token of tokenizations) {
                  if (
                    token.trim().length === 0 ||
                    token === " " ||
                    token === "\t" ||
                    token === "\n" ||
                    token === "\r"
                  ) {
                    continue;
                  }
                  if (
                    this.window === -1 ||
                    j > nbTokens - this.window ||
                    (this.refFound && j < this.window)
                  ) {
                    try {
                      this.accumulatedTokens.push(new LayoutToken(token));
                      this.accumulatedLabels.push("<other>");
                    } catch (e) {
                      throw new GrobidException(
                        "An exception occured while running Grobid.",
                        e instanceof Error ? e : new Error(String(e)),
                      );
                    }
                  } else {
                    try {
                      this.accumulatedTokens.push(new LayoutToken(token));
                      this.accumulatedLabels.push("<ignore>");
                    } catch (e) {
                      throw new GrobidException(
                        "An exception occured while running Grobid.",
                        e instanceof Error ? e : new Error(String(e)),
                      );
                    }
                  }
                  j++;
                }
              }

              this.accumulator = [];
              this.npl = false;
              this.ref = true;
            } else {
              // eslint-disable-next-line no-console
              console.log("Warning: unknown attribute value for ref or bibl: " + value);
              this.ref = false;
              this.npl = false;
            }
          }
        }
      }
      this.accumulatorRef = [];
    } else if (qName === "claim") {
      this.accumulator = [];
    } else if (qName === "invention-title") {
      this.accumulator = [];
    } else if (qName === "patcit") {
      const length = atts.getLength();
      for (let i = 0; i < length; i++) {
        const name = atts.getQName(i);
        const value = atts.getValue(i);
        if (name !== null) {
          if (name === "ucid") {
            this.cited_number = value;
            // we might need to normalize a little bit this patent nummer
          }
        }
      }
    }
  }
}
