// Port of org.grobid.core.engines.AuthorParser.
// Upstream: grobid-core/src/main/java/org/grobid/core/engines/AuthorParser.java
//
// Note: this class does NOT extend AbstractParser upstream. It owns two
// taggers directly (header / citation names), constructed via TaggerFactory.

import { Person } from "../data/person.js";
import { FeaturesVectorName } from "../features/features-vector-name.js";
import { GrobidException } from "../exceptions/grobid-exception.js";
import { GrobidModels } from "../grobid-models.js";
import { Language } from "../lang/language.js";
import { GrobidAnalyzer } from "../analyzers/grobid-analyzer.js";
import { BoundingBox } from "../layout/bounding-box.js";
import { LayoutToken } from "../layout/layout-token.js";
import { PDFAnnotation } from "../layout/pdf-annotation.js";
import { Lexicon } from "../lexicon/lexicon.js";
import type { OffsetPosition } from "../utilities/offset-position.js";
import { TaggingTokenClusteror } from "../tokenization/tagging-token-clusteror.js";
import { LayoutTokensUtil } from "../utilities/layout-tokens-util.js";
import { TextUtilities } from "../utilities/text-utilities.js";
import { getLogger } from "../utilities/logger.js";
import type { GenericTagger } from "./tagging/generic-tagger.js";
import { TaggerFactory } from "./tagging/tagger-factory.js";
import { TaggingLabels } from "./label/tagging-labels.js";
import { Engine } from "./engine.js";

// Upstream: static Logger LOGGER (the field is declared but never used).
void getLogger("AuthorParser");

const ET_AL_PATTERN: RegExp = /et\.? al\.?/;

/** Apache Commons isEmpty / isNotBlank / isBlank shims. */
function isEmpty(s: string | null | undefined): boolean {
  return s === null || s === undefined || s.length === 0;
}
function isNotBlank(s: string | null | undefined): boolean {
  return s !== null && s !== undefined && s.trim().length > 0;
}
function isBlank(s: string | null | undefined): boolean {
  return !isNotBlank(s);
}
/** Apache Commons `StringUtils.normalizeSpace`: collapse whitespace + trim. */
function normalizeSpace(s: string | null): string {
  if (s === null) return "";
  return s.replace(/\s+/g, " ").trim();
}

export class AuthorParser {
  private readonly namesHeaderParser: GenericTagger;
  private readonly namesCitationParser: GenericTagger;

  constructor() {
    this.namesHeaderParser = TaggerFactory.getTagger(GrobidModels.NAMES_HEADER);
    this.namesCitationParser = TaggerFactory.getTagger(GrobidModels.NAMES_CITATION);
  }

  /**
   * Processing of authors in citations
   */
  async processingCitation(input: string | null): Promise<Person[] | null> {
    if (isEmpty(input)) {
      return null;
    }
    let s: string = input!.trim();
    const matcher = ET_AL_PATTERN.exec(s);
    if (matcher !== null) {
      s = s.substring(0, matcher.index) + " ";
    }

    // set the language to English for the analyser to avoid any bad surprises
    const tokens: LayoutToken[] = GrobidAnalyzer.getInstance().tokenizeWithLayoutToken(
      s,
      new Language("en", 1.0),
    );
    return this.processing(tokens, null, false);
  }

  async processingCitationLayoutTokens(tokens: LayoutToken[] | null): Promise<Person[] | null> {
    if (tokens === null || tokens.length === 0) {
      return null;
    }
    return this.processing(tokens, null, false);
  }

  /**
   * Processing of authors in authors
   */
  async processingHeader(input: string | null): Promise<Person[] | null> {
    if (isEmpty(input)) {
      return null;
    }
    let s: string = input!.trim();
    const matcher = ET_AL_PATTERN.exec(s);
    if (matcher !== null) {
      s = s.substring(0, matcher.index) + " ";
    }

    // set the language to English for the analyser to avoid any bad surprises
    const tokens: LayoutToken[] = GrobidAnalyzer.getInstance().tokenizeWithLayoutToken(
      s,
      new Language("en", 1.0),
    );
    return this.processing(tokens, null, true);
  }

  async processingHeaderWithLayoutTokens(
    inputs: LayoutToken[],
    pdfAnnotations: PDFAnnotation[] | null,
  ): Promise<Person[] | null> {
    return this.processing(inputs, pdfAnnotations, true);
  }

  /**
   * Common processing of authors in header or citation
   *
   * @param tokens list of LayoutToken object to process
   * @param head - if true use the model for header's name, otherwise the model for names in citation
   * @return List of identified Person entites as POJO.
   */
  async processing(
    tokens: LayoutToken[] | null,
    pdfAnnotations: PDFAnnotation[] | null,
    head: boolean,
  ): Promise<Person[] | null> {
    if (tokens === null || tokens.length === 0) {
      return null;
    }
    let fullAuthors: Person[] | null = null;
    try {
      const titlePositions: OffsetPosition[] = Lexicon.getInstance().tokenPositionsPersonTitle(
        tokens,
      );
      const suffixPositions: OffsetPosition[] = Lexicon.getInstance().tokenPositionsPersonSuffix(
        tokens,
      );

      const sequence: string = FeaturesVectorName.addFeaturesName(
        tokens,
        null,
        titlePositions,
        suffixPositions,
      );
      if (isEmpty(sequence)) return null;
      const tagger: GenericTagger = head ? this.namesHeaderParser : this.namesCitationParser;
      const res: string = await tagger.label(sequence);
      //System.out.println(res);
      const clusteror = new TaggingTokenClusteror(
        head ? GrobidModels.NAMES_HEADER : GrobidModels.NAMES_CITATION,
        res,
        tokens,
      );
      let aut: Person = new Person();
      let newMarker = false;
      let currentMarker: string | null = null;
      const clusters = clusteror.cluster();
      for (const cluster of clusters) {
        if (cluster === null) {
          continue;
        }

        if (pdfAnnotations !== null) {
          for (const authorsToken of cluster.concatTokens()) {
            for (const pdfAnnotation of pdfAnnotations) {
              const intersectBox: BoundingBox | null = pdfAnnotation.getIntersectionBox(
                authorsToken,
              );
              if (intersectBox !== null) {
                const authorsBox: BoundingBox = BoundingBox.fromLayoutToken(authorsToken);
                if (intersectBox.equals(authorsBox)) {
                  // empty (matches upstream)
                } else {
                  const pixPerChar: number =
                    authorsToken.getWidth() / (authorsToken.getText() ?? "").length;
                  const charsCovered: number = Math.trunc(intersectBox.getWidth() / pixPerChar + 0.5);
                  if (isNotBlank(pdfAnnotation.getDestination())) {
                    const orcidMatcher = TextUtilities.ORCIDPattern.exec(
                      pdfAnnotation.getDestination()!,
                    );
                    if (orcidMatcher !== null) {
                      // !! here we consider the annot is at the tail or end of the names

                      // LF: sometimes there is no token at the end of the name, and the annotation covers all the name
                      // Add boundary check to prevent StringIndexOutOfBoundsException
                      const textLength: number = (authorsToken.getText() ?? "").length;
                      if (charsCovered > 0 && charsCovered < textLength) {
                        const newToken: string = (authorsToken.getText() as string).substring(
                          0,
                          textLength - charsCovered,
                        );
                        if (isNotBlank(newToken)) {
                          authorsToken.setText(newToken);
                        }
                      }
                      aut.setORCID(
                        orcidMatcher[1] +
                          "-" +
                          orcidMatcher[2] +
                          "-" +
                          orcidMatcher[3] +
                          "-" +
                          orcidMatcher[4],
                      );
                    }
                  }
                }
              }
            }
          }
        }

        const clusterLabel = cluster.getTaggingLabel();
        Engine.getCntManager().i(clusterLabel);
        //String clusterContent = LayoutTokensUtil.normalizeText(LayoutTokensUtil.toText(cluster.concatTokens()));
        const clusterContent: string = normalizeSpace(LayoutTokensUtil.toText(cluster.concatTokens()));
        if (isBlank(clusterContent)) {
          continue;
        }

        if (clusterLabel === TaggingLabels.NAMES_HEADER_MARKER) {
          // a marker introduces a new author, and the marker could be attached to the previous (usual)
          // or following author (rare)
          currentMarker = clusterContent;
          newMarker = true;
          let markerAssigned = false;
          if (aut.notNull()) {
            if (fullAuthors === null) {
              fullAuthors = [];
            }
            aut.addMarker(currentMarker);
            markerAssigned = true;

            if (!fullAuthors.includes(aut)) {
              fullAuthors.push(aut);
              aut = new Person();
            }
          }
          if (!markerAssigned) {
            aut.addMarker(currentMarker);
          }
        } else if (
          clusterLabel === TaggingLabels.NAMES_HEADER_TITLE ||
          clusterLabel === TaggingLabels.NAMES_CITATION_TITLE
        ) {
          if (newMarker) {
            aut.setTitle(clusterContent);
            newMarker = false;
          } else if (aut.getTitle() !== null) {
            if (aut.notNull()) {
              if (fullAuthors === null) fullAuthors = [];
              fullAuthors.push(aut);
            }
            aut = new Person();
            aut.setTitle(clusterContent);
          } else {
            aut.setTitle(clusterContent);
          }
          aut.appendLayoutTokens(cluster.concatTokens());
        } else if (
          clusterLabel === TaggingLabels.NAMES_HEADER_FORENAME ||
          clusterLabel === TaggingLabels.NAMES_CITATION_FORENAME
        ) {
          if (newMarker) {
            aut.setFirstName(clusterContent);
            newMarker = false;
          } else if (aut.getFirstName() !== null) {
            // new author
            if (aut.notNull()) {
              if (fullAuthors === null) fullAuthors = [];
              fullAuthors.push(aut);
            }
            aut = new Person();
            aut.setFirstName(clusterContent);
          } else {
            aut.setFirstName(clusterContent);
          }
          aut.appendLayoutTokens(cluster.concatTokens());
        } else if (
          clusterLabel === TaggingLabels.NAMES_HEADER_MIDDLENAME ||
          clusterLabel === TaggingLabels.NAMES_CITATION_MIDDLENAME
        ) {
          if (newMarker) {
            aut.setMiddleName(clusterContent);
            newMarker = false;
          } else if (aut.getMiddleName() !== null) {
            aut.setMiddleName(aut.getMiddleName() + " " + clusterContent);
          } else {
            aut.setMiddleName(clusterContent);
          }
          aut.appendLayoutTokens(cluster.concatTokens());
        } else if (
          clusterLabel === TaggingLabels.NAMES_HEADER_SURNAME ||
          clusterLabel === TaggingLabels.NAMES_CITATION_SURNAME
        ) {
          if (newMarker) {
            aut.setLastName(clusterContent);
            newMarker = false;
          } else if (aut.getLastName() !== null) {
            // new author
            if (aut.notNull()) {
              if (fullAuthors === null) fullAuthors = [];
              fullAuthors.push(aut);
            }
            aut = new Person();
            aut.setLastName(clusterContent);
          } else {
            aut.setLastName(clusterContent);
          }
          aut.appendLayoutTokens(cluster.concatTokens());
        } else if (
          clusterLabel === TaggingLabels.NAMES_HEADER_SUFFIX ||
          clusterLabel === TaggingLabels.NAMES_CITATION_SUFFIX
        ) {
          /*if (newMarker) {
                        aut.setSuffix(clusterContent);
                        newMarker = false;
                    } else*/
          if (aut.getSuffix() !== null) {
            aut.setSuffix(aut.getSuffix() + " " + clusterContent);
          } else {
            aut.setSuffix(clusterContent);
          }
          aut.appendLayoutTokens(cluster.concatTokens());
        }
      }

      // add last built author
      if (aut.notNull()) {
        if (fullAuthors === null) {
          fullAuthors = [];
        }
        fullAuthors.push(aut);
      }

      // some more person name normalisation
      if (fullAuthors !== null) {
        for (const author of fullAuthors) {
          author.normalizeName();
          // grobid-js-only: strip honorifics + footnote markers picked up by
          // the CRF as part of the name run. Idempotent; safe to call
          // alongside the header-parser pass which targets the same fields.
          author.postProcessName();
        }
      }
    } catch (e) {
      throw new GrobidException("An exception occurred while running Grobid.", e);
    }
    return fullAuthors;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private nameLabel(label: string): boolean {
    return label.endsWith("<surname>") || label.endsWith("<forename>") || label.endsWith("<middlename>");
  }

  /**
   * Extract results from a list of name strings in the training format without any string modification.
   *
   * @param input - the sequence of author names to be processed as a string.
   * @param head - if true use the model for header's name, otherwise the model for names in citation
   * @return the pseudo-TEI training data
   */
  async trainingExtraction(input: string, head: boolean): Promise<string[] | null> {
    if (isEmpty(input)) return null;
    // force analyser with English, to avoid bad surprise
    const tokens: LayoutToken[] = GrobidAnalyzer.getInstance().tokenizeWithLayoutToken(
      input,
      new Language("en", 1.0),
    );
    const buffer: string[] = [];
    try {
      if (tokens === null || tokens.length === 0) {
        return null;
      }

      const titlePositions: OffsetPosition[] = Lexicon.getInstance().tokenPositionsPersonTitle(
        tokens,
      );
      const suffixPositions: OffsetPosition[] = Lexicon.getInstance().tokenPositionsPersonSuffix(
        tokens,
      );

      const sequence: string = FeaturesVectorName.addFeaturesName(
        tokens,
        null,
        titlePositions,
        suffixPositions,
      );
      if (isEmpty(sequence)) return null;
      const tagger: GenericTagger = head ? this.namesHeaderParser : this.namesCitationParser;
      const res: string = await tagger.label(sequence);

      // extract results from the processed file
      const lines: string[] = res.split("\n").filter((l) => l.length > 0);
      let lastTag: string | null = null;
      let start = true;
      let hasMarker = false;
      let hasSurname = false;
      let hasForename = false;
      let tagClosed: boolean;
      let q = 0;
      let addSpace: boolean;
      let lastTag0: string | null;
      let currentTag0: string | null = null;
      for (const line of lines) {
        addSpace = false;
        if (line.trim().length === 0) {
          // new author
          // Fixed from upstream: was `"/t<author>\n"` — a forward-slash typo
          // for `"\t<author>\n"` (tab). Affects training-data extraction output.
          if (head) buffer.push("\t<author>\n");
          else {
            //buffer.append("<author>");
          }
          continue;
        } else {
          let theTok = (tokens[q] as LayoutToken).getText();
          while (theTok === " " || theTok === "\n") {
            addSpace = true;
            q++;
            theTok = (tokens[q] as LayoutToken).getText();
          }
          q++;
        }

        const parts: string[] = line.split("\t");
        const ll = parts.length;
        let i = 0;
        let s1: string | null = null;
        let s2: string | null = null;
        let newLine = false;
        const localFeatures: string[] = [];
        for (const partRaw of parts) {
          const s = partRaw.trim();
          if (i === 0) {
            s2 = TextUtilities.HTMLEncode(s); // string
          } else if (i === ll - 2) {
            // empty (matches upstream)
          } else if (i === ll - 1) {
            s1 = s; // label
          } else {
            localFeatures.push(s);
            if (s === "LINESTART" && !start) {
              newLine = true;
              start = false;
            } else if (s === "LINESTART") {
              start = false;
            }
          }
          i++;
        }

        lastTag0 = null;
        if (lastTag !== null) {
          if (lastTag.startsWith("I-")) {
            lastTag0 = lastTag.substring(2);
          } else {
            lastTag0 = lastTag;
          }
        }
        currentTag0 = null;
        if (s1 !== null) {
          if (s1.startsWith("I-")) {
            currentTag0 = s1.substring(2);
          } else {
            currentTag0 = s1;
          }
        }

        tagClosed =
          lastTag0 !== null && AuthorParser.testClosingTag(buffer, currentTag0!, lastTag0, head);

        if (newLine) {
          if (tagClosed) {
            buffer.push("\t\t\t\t\t\t\t<lb/>\n");
          } else {
            buffer.push("<lb/>");
          }
        }

        let output = AuthorParser.writeField(s1!, lastTag0, s2!, "<marker>", "<marker>", addSpace, 8, head);
        if (output !== null) {
          if (hasMarker) {
            if (head) {
              buffer.push("\t\t\t\t\t\t\t</persName>\n");
            } else {
              //buffer.append("</author>\n");
            }
            hasForename = false;
            hasSurname = false;
            if (head) {
              buffer.push("\t\t\t\t\t\t\t<persName>\n");
            } else {
              //buffer.append("<author>\n");
            }
            hasMarker = true;
          }
          buffer.push(output);
          lastTag = s1;
          continue;
        } else {
          output = AuthorParser.writeField(s1!, lastTag0, s2!, "<other>", "<other>", addSpace, 8, head);
        }
        if (output === null) {
          output = AuthorParser.writeField(s1!, lastTag0, s2!, "<forename>", "<forename>", addSpace, 8, head);
        } else {
          // Mirror Java's `StringBuilder.deleteCharAt(length-1)` when the last char is '\n'.
          if (buffer.length > 0) {
            const lastIdx = buffer.length - 1;
            const last = buffer[lastIdx] as string;
            if (last.length > 0 && last.charAt(last.length - 1) === "\n") {
              buffer[lastIdx] = last.substring(0, last.length - 1);
            }
          }
          buffer.push(output);
          lastTag = s1;
          continue;
        }
        if (output === null) {
          output = AuthorParser.writeField(s1!, lastTag0, s2!, "<middlename>", "<middlename>", addSpace, 8, head);
        } else {
          if (hasForename && currentTag0 !== lastTag0) {
            if (head) {
              buffer.push("\t\t\t\t\t\t\t</persName>\n");
            } else {
              //buffer.append("</author>\n");
            }
            hasMarker = false;
            hasSurname = false;
            if (head) {
              buffer.push("\t\t\t\t\t\t\t<persName>\n");
            } else {
              //buffer.append("<author>\n");
            }
          }
          hasForename = true;
          buffer.push(output);
          lastTag = s1;
          continue;
        }
        if (output === null) {
          output = AuthorParser.writeField(s1!, lastTag0, s2!, "<surname>", "<surname>", addSpace, 8, head);
        } else {
          buffer.push(output);
          lastTag = s1;
          continue;
        }
        if (output === null) {
          output = AuthorParser.writeField(s1!, lastTag0, s2!, "<title>", "<roleName>", addSpace, 8, head);
        } else {
          if (hasSurname && currentTag0 !== lastTag0) {
            if (head) {
              buffer.push("\t\t\t\t\t\t\t</persName>\n");
            } else {
              //buffer.append("</author>\n");
            }
            hasMarker = false;
            hasForename = false;
            if (head) {
              buffer.push("\t\t\t\t\t\t\t<persName>\n");
            } else {
              //buffer.append("<author>\n");
            }
          }
          hasSurname = true;
          buffer.push(output);
          lastTag = s1;
          continue;
        }
        if (output === null) {
          output = AuthorParser.writeField(s1!, lastTag0, s2!, "<suffix>", "<suffix>", addSpace, 8, head);
        } else {
          buffer.push(output);
          lastTag = s1;
          continue;
        }
        if (output !== null) {
          buffer.push(output);
          lastTag = s1;
          continue;
        }

        lastTag = s1;
      }

      if (lastTag !== null) {
        if (lastTag.startsWith("I-")) {
          lastTag0 = lastTag.substring(2);
        } else {
          lastTag0 = lastTag;
        }
        currentTag0 = "";
        AuthorParser.testClosingTag(buffer, currentTag0, lastTag0!, head);
      }
    } catch (e) {
      //			e.printStackTrace();
      throw new GrobidException("An exception occured while running Grobid.", e);
    }
    return buffer;
  }

  private static writeField(
    s1: string,
    lastTag0: string | null,
    s2: string,
    field: string,
    outField: string,
    addSpace: boolean,
    nbIndent: number,
    head: boolean,
  ): string | null {
    let result: string | null = null;
    if (s1 === field || s1 === "I-" + field) {
      if (s1 === "<other>" || s1 === "I-<other>") {
        if (addSpace) result = " " + s2;
        else result = s2;
      } else if (s1 === lastTag0 || s1 === "I-" + lastTag0) {
        if (addSpace) result = " " + s2;
        else result = s2;
      } else {
        result = "";
        if (head) {
          for (let i = 0; i < nbIndent; i++) {
            result += "\t";
          }
        }
        if (addSpace) result += " " + outField + s2;
        else result += outField + s2;
      }
    }
    return result;
  }

  private static testClosingTag(
    buffer: string[],
    currentTag0: string,
    lastTag0: string,
    head: boolean,
  ): boolean {
    let res = false;
    if (currentTag0 !== lastTag0) {
      res = true;
      // we close the current tag
      if (lastTag0 === "<other>") {
        if (head) buffer.push("\n");
      } else if (lastTag0 === "<forename>") {
        buffer.push("</forename>");
        if (head) buffer.push("\n");
      } else if (lastTag0 === "<middlename>") {
        buffer.push("</middlename>");
        if (head) buffer.push("\n");
      } else if (lastTag0 === "<surname>") {
        buffer.push("</surname>");
        if (head) buffer.push("\n");
      } else if (lastTag0 === "<title>") {
        buffer.push("</roleName>");
        if (head) buffer.push("\n");
      } else if (lastTag0 === "<suffix>") {
        buffer.push("</suffix>");
        if (head) buffer.push("\n");
      } else if (lastTag0 === "<marker>") {
        buffer.push("</marker>");
        if (head) buffer.push("\n");
      } else {
        res = false;
      }
    }
    return res;
  }

  close(): void {
    // no-op (matches upstream)
  }
}
