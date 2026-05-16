// Port of org.grobid.core.sax.PatentAnnotationSaxParser.
// Upstream: grobid-core/src/main/java/org/grobid/core/sax/PatentAnnotationSaxParser.java
//
// This SAX parser mirrors the input XML document, and adds as extra
// annotation identified references to patents and NPL. The possible tags
// within the chunk are removed to avoid hierarchical invalid documents.
//
// Upstream uses `java.io.Writer` to stream the output XML. In TS we declare
// a small `Writer` interface (matching `Writer.write(String)`); the caller
// chooses an in-memory string buffer, a Node fs.WriteStream, etc.

import { BibDataSet } from "../data/bib-data-set.js";
import { PatentItem } from "../data/patent-item.js";
import { GrobidException } from "../exceptions/grobid-exception.js";
import { parseSax, type SaxAttributes, type SaxHandler } from "./sax-walker.js";

/** Minimal port of `java.io.Writer` — only `.write(string)` is needed. */
export interface Writer {
  write(s: string): void;
}

/**
 * Upstream PatentAnnotationSaxParser.java line 20-239.
 */
export class PatentAnnotationSaxParser implements SaxHandler {
  // Upstream line 22.
  accumulator: string[] = [];

  // Upstream line 24-28.
  private writer: Writer | null = null;
  private offset: number = 0;
  private counting: boolean = false;
  private patents: PatentItem[] | null = null;
  private articles: BibDataSet[] | null = null;

  // Upstream line 31-32 — for getting track of the offset walk.
  private currentPatentIndex: number = 0;
  private currentArticleIndex: number = 0;

  // NOTE: upstream line 34 — `//private static String delimiters = " \n\t" + TextUtilities.fullPunctuations;`
  // (commented-out).

  // Upstream line 36.
  constructor() {
    // empty
  }

  /** Drive the parser from an XML string. */
  parse(xml: string): void {
    parseSax(this, xml);
  }

  // Upstream line 38-40.
  characters(buffer: string, _start: number, _length: number): void {
    this.accumulator.push(buffer);
  }

  // Upstream line 42-44.
  setWriter(writer: Writer): void {
    this.writer = writer;
  }

  // Upstream line 46-48.
  setPatents(patents: PatentItem[]): void {
    this.patents = patents;
  }

  // Upstream line 50-52.
  setArticles(articles: BibDataSet[]): void {
    this.articles = articles;
  }

  // Upstream line 54-158.
  getText(): string {
    let text = this.accumulator.join("");
    if (text.trim().length === 0) {
      return "";
    }
    // NOTE: upstream lines 59-60 — `/*text = text.replace("\n", " ");
    // text = text.replace("  ", " ");*/` (commented-out).
    if (this.counting) {
      // NOTE: upstream lines 62-73 — StringTokenizer-based word counting,
      // commented out.

      let i = this.currentPatentIndex;
      const count = text.length;

      while (i < this.patents!.length) {
        const currentPatent = this.patents![i];
        if (currentPatent !== null && currentPatent !== undefined) {
          const startOffset = currentPatent.getOffsetBegin();
          const endOffset = currentPatent.getOffsetEnd();
          if (startOffset >= this.offset && endOffset <= this.offset + count) {
            const context = currentPatent.getContext();
            if (context !== null) {
              // NOTE: upstream lines 87-92 — debug `System.out.println` block, commented out.
              let target = "";
              if (context.charAt(0) === " ") {
                target = ' <ref type="patent">' + context.substring(1, context.length) + "</ref>";
              } else {
                target = '<ref type="patent">' + context + "</ref>";
              }
              text = text.split(context).join(target);
              this.currentPatentIndex = i;
            }
          }
        }
        i++;
      }

      // NOTE: upstream line 110 — `//i = currentArticleIndex;` (commented-out).
      let j = 0;
      while (j < this.articles!.length) {
        const currentArticle = this.articles![j];
        if (currentArticle !== null && currentArticle !== undefined) {
          const offsets = currentArticle.getOffsets();
          let startOffset = -1;
          let endOffset = -1;
          const context = (currentArticle.getRawBib() ?? "").trim();
          if (offsets !== null && offsets.length > 0) {
            if (offsets[0] !== null && offsets[0] !== undefined) {
              startOffset = offsets[0];
              // NOTE: upstream lines 122-131 — commented-out StringTokenizer
              // word counting and `endOffset = offsets.get(1).intValue();`.
              endOffset = startOffset + context.length;
              void endOffset;
            }
          }
          // NOTE: upstream line 136 — `//if ( (startOffset >= offset) && (endOffset <= offset+count) ) {` (commented-out).
          if (startOffset >= this.offset) {
            // NOTE: upstream lines 138-143 — debug `System.out.println` block, commented out.
            const target = ' <ref type="npl">' + context + "</ref> ";
            text = text.split(context).join(target);
            this.currentArticleIndex = j;
          }
        }
        j++;
      }
      this.offset += count;
    }
    return text;
  }

  // Upstream line 160-194.
  endElement(_uri: string, _localName: string, qName: string): void {
    try {
      if (qName === "p" || qName === "description") {
        this.writer!.write(this.getText());
        this.accumulator = [];
      }
      if (qName === "description") {
        this.counting = false;
      }
      if (!this.counting) {
        this.writer!.write(this.getText());
        this.accumulator = [];
        this.writer!.write("</" + qName + ">\n");
      } else {
        if (qName === "row") {
          this.accumulator.push(" ");
        }
        if (qName === "p") {
          this.writer!.write("\n");
          this.accumulator.push(" ");
        }
      }
    } catch (e) {
      // NOTE: upstream line 191 — `// e.printStackTrace();` (commented-out).
      throw new GrobidException(
        "An exception occured while running Grobid.",
        e instanceof Error ? e : new Error(String(e)),
      );
    }
  }

  // Upstream line 196-237.
  startElement(_namespaceURI: string, _localName: string, qName: string, atts: SaxAttributes): void {
    try {
      // we output the remaining text
      if (!this.counting) {
        this.writer!.write(this.getText());
        this.accumulator = [];
      }
      if (!this.counting) {
        this.writer!.write("<" + qName);
        const length = atts.getLength();
        for (let i = 0; i < length; i++) {
          const name = atts.getQName(i);
          const value = atts.getValue(i);
          if (name !== null && value !== null) {
            this.writer!.write(" " + name + '="' + value + '"');
          }
        }
        this.writer!.write(">");
      }
      if (qName === "description") {
        this.offset = 0;
        this.counting = true;
      } else if (qName === "patent-document") {
        this.counting = false;
      }
    } catch (e) {
      // NOTE: upstream line 234 — `// e.printStackTrace();` (commented-out).
      throw new GrobidException(
        "An exception occured while running Grobid.",
        e instanceof Error ? e : new Error(String(e)),
      );
    }
  }
}
