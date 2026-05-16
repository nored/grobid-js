// Port of org.grobid.core.engines.FigureParser.
// Upstream: grobid-core/src/main/java/org/grobid/core/engines/FigureParser.java
//
// Adaptations:
// - Java Apache Commons `Pair<String, String>` is mapped to the local
//   `Pair<A, B>` from `utilities/pair.ts`. The TS `Pair` exposes `getA()` /
//   `getB()` (not `getLeft()` / `getRight()`); the call sites here use those
//   accessors. We also preserve a static-style `Pair.of(...)` shape via
//   `new Pair(...)`.
// - The class is package-private in upstream Java; in TS we still `export`
//   it (no package-private equivalent). Constructor is `public` here for the
//   same reason; the `FigureParser()` upstream constructor is package-private.
// - `Engine.getCntManager()` is imported via @ts-expect-error because Engine
//   is a stub at the moment.

import { Figure } from "../data/figure.js";
import { AbstractParser } from "./abstract-parser.js";
import { Engine } from "./engine.js";
import { GrobidException } from "../exceptions/grobid-exception.js";
import { GrobidModels } from "../grobid-models.js";
import type { LayoutToken } from "../layout/layout-token.js";
import { LayoutTokensUtil } from "../utilities/layout-tokens-util.js";
import { TextUtilities } from "../utilities/text-utilities.js";
import { Pair } from "../utilities/pair.js";
import { TaggingTokenCluster } from "../tokenization/tagging-token-cluster.js";
import { TaggingTokenClusteror } from "../tokenization/tagging-token-clusteror.js";
import { GenericTaggerUtils } from "./tagging/generic-tagger-utils.js";
import { TaggingLabels } from "./label/tagging-labels.js";
import { getLogger } from "../utilities/logger.js";

const LOGGER = getLogger("FigureParser");

// Local aliases for the `import static TaggingLabels.*` in upstream.
const FIG_DESC = TaggingLabels.FIG_DESC;
const FIG_HEAD = TaggingLabels.FIG_HEAD;
const FIG_LABEL = TaggingLabels.FIG_LABEL;
const FIG_OTHER = TaggingLabels.FIG_OTHER;
const FIG_CONTENT = TaggingLabels.FIG_CONTENT;

export class FigureParser extends AbstractParser {
  constructor() {
    super(GrobidModels.FIGURE);
  }

  /**
   * The processing here is called from the full text parser in cascade.
   * Start and end position in the higher level tokenization are indicated in
   * the resulting Figure object.
   */
  async processing(tokenizationFigure: LayoutToken[], featureVector: string): Promise<Figure | null> {
    let res: string | null;
    try {
      res = await this.label(featureVector);
    } catch (e) {
      throw new GrobidException("Sequence labeling with figure model fails.", e);
    }
    if (res === null) {
      return null;
    }
    return this.getExtractionResult(tokenizationFigure, res);
  }

  private getExtractionResult(tokenizations: LayoutToken[], result: string): Figure {
    const clusteror = new TaggingTokenClusteror(GrobidModels.FIGURE, result, tokenizations);
    const clusters: TaggingTokenCluster[] = clusteror.cluster();

    const figure = new Figure();
    figure.setLayoutTokens(tokenizations);

    for (const cluster of clusters) {
      if (cluster === null) {
        continue;
      }

      const clusterLabel = cluster.getTaggingLabel();
      Engine.getCntManager().i(clusterLabel);

      const clusterContent: string = LayoutTokensUtil.normalizeText(
        LayoutTokensUtil.toText(cluster.concatTokens()),
      );
      if (clusterLabel === FIG_DESC) {
        figure.appendCaption(clusterContent);
        figure.appendCaptionLayoutTokens(cluster.concatTokens());
      } else if (clusterLabel === FIG_HEAD) {
        figure.appendHeader(clusterContent);
      } else if (clusterLabel === FIG_LABEL) {
        figure.appendLabel(clusterContent);
        //label should also go to head
        figure.appendHeader(" " + clusterContent + " ");
      } else if (clusterLabel === FIG_OTHER) {
        figure.addDiscardedPieceTokens(cluster.concatTokens());
      } else if (clusterLabel === FIG_CONTENT) {
        figure.appendContent(clusterContent);
      } else {
        LOGGER.warn("Unexpected figure model label - " + clusterLabel.getLabel() + " for " + clusterContent);
      }
    }
    return figure;
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
    //System.out.println(tokenizations.toString() + "\n" );
    let res: string | null = null;
    try {
      res = await this.label(featureVector);
    } catch (e) {
      LOGGER.error("Sequence labeling in FigureParser fails.", e);
    }
    if (res === null) {
      return new Pair<string | null, string>(null, featureVector);
    }
    //System.out.println(res + "\n" );
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
            if (tok !== tokenizationToken && tokenizations.length > tokPtr + 1) {
              // we try another position forward (second hope!)
              tokPtr++;
              tokenizationToken = tokenizations[tokPtr]!.getText();
              if (tok !== tokenizationToken && tokenizations.length > tokPtr + 1) {
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

      let output: string | null;
      if (lastTag !== null) {
        FigureParser.testClosingTag(sb, plainLabel, lastTag, addSpace, addEOL);
      }

      output = FigureParser.writeField(label, lastTag, tok, "<figure_head>", "<head>", addSpace, addEOL, 3);
      const figureOpening = "        <figure>\n";
      if (output !== null) {
        if (!figOpen) {
          sb.push(figureOpening);
          figOpen = true;
        }
        sb.push(output);
      }
      output = FigureParser.writeField(label, lastTag, tok, "<figDesc>", "<figDesc>", addSpace, addEOL, 3);
      if (output !== null) {
        if (!figOpen) {
          sb.push(figureOpening);
          figOpen = true;
        }
        sb.push(output);
      }
      output = FigureParser.writeField(label, lastTag, tok, "<label>", "<label>", addSpace, addEOL, 3);
      if (output !== null) {
        if (!figOpen) {
          sb.push(figureOpening);
          figOpen = true;
        }
        sb.push(output);
      }
      output = FigureParser.writeField(label, lastTag, tok, "<content>", "", addSpace, addEOL, 3);
      if (output !== null) {
        if (!figOpen) {
          sb.push(figureOpening);
          figOpen = true;
        }
        sb.push(output);
        //continue;
      }
      output = FigureParser.writeField(label, lastTag, tok, "<other>", "", addSpace, addEOL, 2);
      if (output !== null) {
        sb.push(output);
      }

      lastTag = plainLabel;
      addSpace = false;
      addEOL = false;
      tokPtr++;
    }

    if (figOpen) {
      FigureParser.testClosingTag(sb, "", lastTag, addSpace, addEOL);
      sb.push("        </figure>\n");
    }

    return new Pair<string | null, string>(sb.join(""), featureVector);
  }

  getTEIHeader(id: string): string {
    return (
      "<tei>\n" +
      "    <teiHeader>\n" +
      '        <fileDesc xml:id="_' +
      id +
      '"/>\n' +
      "    </teiHeader>\n" +
      '    <text xml:lang="en">\n'
    );
  }

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
      switch (lastTag) {
        case "<other>":
          if (addEOL) buffer.push("<lb/>");
          if (addSpace) buffer.push(" ");
          buffer.push("\n");
          break;
        case "<figure_head>":
          if (addEOL) buffer.push("<lb/>");
          if (addSpace) buffer.push(" ");
          buffer.push("</head>\n");
          break;
        case "<figDesc>":
          if (addEOL) buffer.push("<lb/>");
          if (addSpace) buffer.push(" ");
          buffer.push("</figDesc>\n");
          break;
        case "<label>":
          if (addEOL) buffer.push("<lb/>");
          if (addSpace) buffer.push(" ");
          buffer.push("</label>\n");
          break;
        case "<content>":
          if (addEOL) buffer.push("<lb/>");
          if (addSpace) buffer.push(" ");
          buffer.push("</content>\n");
          break;
        default:
          res = false;
          break;
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
      if (currentTag.endsWith("<other>") || currentTag.endsWith("<content>")) {
        result = "";
        if (currentTag.startsWith("I-") || lastTag === null) {
          result += "\n";
          for (let i = 0; i < nbIndent; i++) {
            result += "    ";
          }
        }
        if (addEOL) result += "<lb/>";
        if (addSpace) result += " ";
        result += TextUtilities.HTMLEncode(token);
      } else if (lastTag !== null && currentTag.endsWith(lastTag)) {
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
