// Port of org.grobid.core.engines.TableParser.
// Upstream: grobid-core/src/main/java/org/grobid/core/engines/TableParser.java
//
// Adaptations:
// - Java Apache Commons `Pair<String, String>` is mapped to the local
//   `Pair<A, B>` from `utilities/pair.ts`. Uses `getA()` / `getB()`.
// - `StringUtils.isEmpty(s)` → `s === null || s === ""`.
// - `Collections.singletonList(...)` → `[...]`.

import { Table } from "../data/table.js";
import { AbstractParser } from "./abstract-parser.js";
import { Engine } from "./engine.js";
import { GrobidException } from "../exceptions/grobid-exception.js";
import { GrobidModels } from "../grobid-models.js";
import type { LayoutToken } from "../layout/layout-token.js";
import { BoundingBoxCalculator } from "../utilities/bounding-box-calculator.js";
import { LayoutTokensUtil } from "../utilities/layout-tokens-util.js";
import { TextUtilities } from "../utilities/text-utilities.js";
import { Pair } from "../utilities/pair.js";
import { TaggingTokenCluster } from "../tokenization/tagging-token-cluster.js";
import { TaggingTokenClusteror } from "../tokenization/tagging-token-clusteror.js";
import { GenericTaggerUtils } from "./tagging/generic-tagger-utils.js";
import type { TaggingLabel } from "./label/tagging-label.js";
import { TaggingLabels } from "./label/tagging-labels.js";
import { getLogger } from "../utilities/logger.js";

const LOGGER = getLogger("TableParser");

// Local aliases for the `import static TaggingLabels.*` in upstream.
const TBL_DESC = TaggingLabels.TBL_DESC;
const TBL_HEAD = TaggingLabels.TBL_HEAD;
const TBL_LABEL = TaggingLabels.TBL_LABEL;
const TBL_NOTE = TaggingLabels.TBL_NOTE;
const TBL_OTHER = TaggingLabels.TBL_OTHER;
const TBL_CONTENT = TaggingLabels.TBL_CONTENT;

export class TableParser extends AbstractParser {
  constructor() {
    super(GrobidModels.TABLE);
  }

  /**
   * The processing here is called from the full text parser in cascade.
   * Normally we should find only one table in the sequence to be labelled.
   * But for robustness and recovering error from the higher level, we allow
   * sub-segmenting several tables that appears one after the other.
   */
  async processing(tokenizationTable: LayoutToken[], featureVector: string): Promise<Table[] | null> {
    let res: string | null;
    try {
      res = await this.label(featureVector);
    } catch (e) {
      throw new GrobidException("Sequence labeling with table model fails.", e);
    }

    if (res === null) {
      return null;
    }
    //        List<Pair<String, String>> labeled = GenericTaggerUtils.getTokensAndLabels(res);
    return this.getExtractionResult(tokenizationTable, res);
  }

  private getExtractionResult(tokenizations: LayoutToken[], result: string): Table[] {
    const tables: Table[] = [];

    // first table
    let table = new Table();

    const clusteror = new TaggingTokenClusteror(GrobidModels.TABLE, result, tokenizations);
    const clusters: TaggingTokenCluster[] = clusteror.cluster();
    let previousLabel: TaggingLabel | null = null;

    for (const cluster of clusters) {
      if (cluster === null) {
        continue;
      }

      const clusterLabel = cluster.getTaggingLabel();
      Engine.getCntManager().i(clusterLabel);

      const tokens: LayoutToken[] = cluster.concatTokens();
      const clusterContent: string = LayoutTokensUtil.normalizeText(LayoutTokensUtil.toText(tokens));
      if (clusterLabel === TBL_DESC) {
        table.appendCaption(clusterContent);
        table.appendCaptionLayoutTokens(tokens);
        for (const t of tokens) table.getFullDescriptionTokens().push(t);
        table.addLayoutTokens(tokens);
      } else if (clusterLabel === TBL_HEAD) {
        // if we already have a header (it could be via label) and we are not continuing some header/label
        // we consider the non-connected header field as the introduction of a new table
        // TBD: this work fine for header located before the table content, but not sure otherwise
        const header = table.getHeader();
        if (
          !(header === null || header === "") &&
          previousLabel !== null &&
          (previousLabel === TBL_CONTENT || previousLabel === TBL_NOTE || previousLabel === TBL_DESC)
        ) {
          // we already have a table header, this means that we have a distinct table starting now
          tables.push(table);
          const box = BoundingBoxCalculator.calculateOneBox(table.getLayoutTokens() ?? [], true);
          table.setTextArea(box === null ? [] : [box]);
          table = new Table();
        }
        table.appendHeader(clusterContent);
        for (const t of tokens) table.getFullDescriptionTokens().push(t);
        table.addLayoutTokens(tokens);
      } else if (clusterLabel === TBL_LABEL) {
        //label should also go to head
        table.appendHeader(" " + clusterContent + " ");
        table.appendLabel(clusterContent);
        for (const t of tokens) table.getFullDescriptionTokens().push(t);
        table.addLayoutTokens(tokens);
      } else if (clusterLabel === TBL_NOTE) {
        table.appendNote(clusterContent);
        for (const t of tokens) table.getFullDescriptionTokens().push(t);
        table.addAllNoteLayoutTokens(tokens);
        table.addLayoutTokens(tokens);
      } else if (clusterLabel === TBL_OTHER) {
        table.addDiscardedPieceTokens(cluster.concatTokens());
        table.addLayoutTokens(tokens);
      } else if (clusterLabel === TBL_CONTENT) {
        table.appendContent(clusterContent);
        for (const t of tokens) table.getContentTokens().push(t);
        table.addLayoutTokens(tokens);
      } else {
        LOGGER.warn("Unexpected table model label - " + clusterLabel.getLabel() + " for " + clusterContent);
      }

      previousLabel = clusterLabel;
    }

    // last table
    const lastBox = BoundingBoxCalculator.calculateOneBox(table.getLayoutTokens() ?? [], true);
    table.setTextArea(lastBox === null ? [] : [lastBox]);
    tables.push(table);

    return tables;
  }

  /**
   * The training data creation is called from the full text training creation in cascade.
   */
  async createTrainingData(
    tokenizations: LayoutToken[],
    featureVector: string,
    // upstream takes `id` but never reads it
    _id: string,
  ): Promise<Pair<string | null, string>> {
    let res: string | null = null;
    try {
      res = await this.label(featureVector);
    } catch (e) {
      LOGGER.error("Sequence labeling in TableParser fails.", e);
    }
    if (res === null) {
      return new Pair<string | null, string>(null, featureVector);
    }

    const labeled: (Pair<string, string> | null)[] = GenericTaggerUtils.getTokensAndLabels(res);
    const sb: string[] = [];

    let tokPtr = 0;
    let addSpace = false;
    let addEOL = false;
    let lastTag: string | null = null;
    let figOpen = false;
    for (const l of labeled) {
      if (l === null) continue;
      const tok = l.getA();
      const label = l.getB();

      let tokPtr2 = tokPtr;
      for (; tokPtr2 < tokenizations.length; tokPtr2++) {
        if (tokenizations[tokPtr2]!.getText() === " ") {
          addSpace = true;
        } else if (
          tokenizations[tokPtr2]!.getText() === "\n" ||
          tokenizations[tokPtr]!.getText() === "\r"
        ) {
          addEOL = true;
        } else {
          break;
        }
      }
      tokPtr = tokPtr2;

      if (tokPtr >= tokenizations.length) {
        LOGGER.error("Implementation error: Reached the end of tokenizations, but current token is " + tok);
        // we add a space to avoid concatenated text
        addSpace = true;
      } else {
        let tokenizationToken = tokenizations[tokPtr]!.getText();

        if ((tokPtr !== tokenizations.length) && tokenizationToken !== tok) {
          // and we add a space by default to avoid concatenated text
          addSpace = true;
          if (!tok.startsWith(tokenizationToken!)) {
            // this is a very exceptional case due to a sequence of accent/diacresis, in this case we skip
            // a shift in the tokenizations list and continue on the basis of the labeled token
            // we check one ahead
            tokPtr++;
            tokenizationToken = tokenizations[tokPtr]!.getText();
            if (tok !== tokenizationToken) {
              // we try another position forward (second hope!)
              tokPtr++;
              tokenizationToken = tokenizations[tokPtr]!.getText();
              if (tok !== tokenizationToken) {
                // we try another position forward (last hope!)
                tokPtr++;
                tokenizationToken = tokenizations[tokPtr]!.getText();
                if (tok !== tokenizationToken) {
                  // we return to the initial position
                  tokPtr = tokPtr - 3;
                  tokenizationToken = tokenizations[tokPtr]!.getText();
                  LOGGER.error(
                    "Implementation error, tokens out of sync: " +
                      tokenizationToken +
                      " != " +
                      tok +
                      ", at position " +
                      tokPtr,
                  );
                }
              }
            }
          }
          // note: if the above condition is true, this is an exceptional case due to a
          // sequence of accent/diacresis and we can go on as a full string match
        }
      }

      const plainLabel: string = (GenericTaggerUtils.getPlainLabel(label) ?? "") as string;

      let output: string | null = null;
      if (lastTag !== null) {
        TableParser.testClosingTag(sb, plainLabel, lastTag, addSpace, addEOL);
      }

      output = TableParser.writeField(label, lastTag, tok, "<figure_head>", "<head>", addSpace, addEOL, 3);
      const tableOpening = '\t\t<figure type="table">\n';
      if (output !== null) {
        if (!figOpen) {
          sb.push(tableOpening);
          figOpen = true;
        }
        sb.push(output);
      }
      output = TableParser.writeField(label, lastTag, tok, "<figDesc>", "<figDesc>", addSpace, addEOL, 3);
      if (output !== null) {
        if (!figOpen) {
          sb.push(tableOpening);
          figOpen = true;
        }
        sb.push(output);
      }
      output = TableParser.writeField(label, lastTag, tok, "<label>", "<label>", addSpace, addEOL, 3);
      if (output !== null) {
        if (!figOpen) {
          sb.push(tableOpening);
          figOpen = true;
        }
        sb.push(output);
      }
      output = TableParser.writeField(label, lastTag, tok, "<content>", "<table>", addSpace, addEOL, 3);
      if (output !== null) {
        if (!figOpen) {
          sb.push(tableOpening);
          figOpen = true;
        }
        sb.push(output);
        //continue;
      }
      output = TableParser.writeField(label, lastTag, tok, "<note>", "<note>", addSpace, addEOL, 3);
      if (output !== null) {
        if (!figOpen) {
          sb.push(tableOpening);
          figOpen = true;
        }
        sb.push(output);
      }
      output = TableParser.writeField(label, lastTag, tok, "<other>", "<other>", addSpace, addEOL, 2);
      if (output !== null) {
        sb.push(output);
      }

      lastTag = plainLabel;
      addSpace = false;
      addEOL = false;
      tokPtr++;
    }

    if (figOpen) {
      TableParser.testClosingTag(sb, "", lastTag, addSpace, addEOL);
      sb.push("\t\t</figure>\n");
    }

    return new Pair<string | null, string>(sb.join(""), featureVector);
  }

  getTEIHeader(id: string): string {
    const sb: string[] = [];
    sb.push(
      "<tei>\n" +
        "    <teiHeader>\n" +
        '        <fileDesc xml:id="_' +
        id +
        '"/>\n' +
        "    </teiHeader>\n" +
        '    <text xml:lang="en">\n',
    );
    return sb.join("");
  }

  // Fixed from upstream: in the `<other>` branch upstream emits `"<other>\n"`
  // (an opening tag) when the surrounding code clearly intends to close the
  // tag. All sibling branches emit `</...>`; this is a copy-paste typo.
  // Corrected here to emit `</other>\n` so the training-data XML and any
  // `toTEI` callers downstream produce well-formed XML.
  private static testClosingTag(
    buffer: string[],
    currentTag: string,
    lastTag: string | null,
    addSpace: boolean,
    addEOL: boolean,
  ): boolean {
    let res = false;
    if (currentTag !== lastTag) {
      res = true;
      // we close the current tag
      if (lastTag === "<other>") {
        if (addEOL) buffer.push("<lb/>");
        if (addSpace) buffer.push(" ");
        // Fixed from upstream: was `"<other>\n"` (opening tag); changed to
        // closing form to match sibling branches and produce well-formed XML.
        buffer.push("</other>\n");
      } else if (lastTag === "<figure_head>") {
        if (addEOL) buffer.push("<lb/>");
        if (addSpace) buffer.push(" ");
        buffer.push("</head>\n");
      } else if (lastTag === "<content>") {
        if (addEOL) buffer.push("<lb/>");
        if (addSpace) buffer.push(" ");
        buffer.push("</table>\n");
      } else if (lastTag === "<figDesc>") {
        if (addEOL) buffer.push("<lb/>");
        if (addSpace) buffer.push(" ");
        buffer.push("</figDesc>\n");
      } else if (lastTag === "<label>") {
        if (addEOL) buffer.push("<lb/>");
        if (addSpace) buffer.push(" ");
        buffer.push("</label>\n");
      } else if (lastTag === "<note>") {
        if (addEOL) buffer.push("<lb/>");
        if (addSpace) buffer.push(" ");
        buffer.push("</note>\n");
      } else {
        res = false;
      }
    }
    return res;
  }

  private static writeField(
    currentTag: string,
    lastTag: string | null,
    token: string,
    field: string,
    outField: string,
    addSpace: boolean,
    addEOL: boolean,
    nbIndent: number,
  ): string | null {
    let result: string | null = null;
    if (currentTag.endsWith(field)) {
      /*if (currentTag.endsWith("<other>") || currentTag.endsWith("<content>")) {
                result = "";
				if (currentTag.startsWith("I-") || (lastTag == null)) {
					result += "\n";
					for (int i = 0; i < nbIndent; i++) {
	                    result += "    ";
	                }
				}
				if (addEOL)
                    result += "<lb/>";
				if (addSpace)
                    result += " ";
                result += TextUtilities.HTMLEncode(token);
            }
			else*/
      if (lastTag !== null && currentTag.endsWith(lastTag)) {
        result = "";
        if (addEOL) result += "<lb/>";
        if (addSpace) result += " ";
        if (currentTag.startsWith("I-")) result += outField;
        result += TextUtilities.HTMLEncode(token);
      } else {
        result = "";
        if (addEOL) result += "<lb/>";
        if (addSpace) result += " ";
        result += "\n";
        if (outField.length > 0) {
          for (let i = 0; i < nbIndent; i++) {
            result += "    ";
          }
        }

        result += outField + TextUtilities.HTMLEncode(token);
      }
    }
    return result;
  }
}
