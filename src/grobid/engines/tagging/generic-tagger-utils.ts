// Port of org.grobid.core.engines.tagging.GenericTaggerUtils.
// Upstream: grobid-core/src/main/java/org/grobid/core/engines/tagging/GenericTaggerUtils.java
//
// Notes:
// - Guava's `Joiner` / `Splitter` and Apache `StringUtils.startsWith` are
//   inlined as plain JS string ops.
// - `SEPARATOR_PATTERN` regex preserved verbatim.
// - The Java grobidkr `StringUtil` wrapper used in upstream is just a
//   null-safe `String.startsWith` / `String.substring`; we inline equivalent
//   null-safe checks here.

import { Pair } from "../../utilities/pair.js";
import { Triple } from "../../utilities/triple.js";
import { TaggingLabels } from "../label/tagging-labels.js";

export class GenericTaggerUtils {
  // Deprecated, please use the constants from TaggingLabels
  /** @deprecated */
  static readonly START_ENTITY_LABEL_PREFIX: string = "I-";
  /** @deprecated */
  static readonly START_ENTITY_LABEL_PREFIX_ALTERNATIVE: string = "B-";
  /** @deprecated */
  static readonly START_ENTITY_LABEL_PREFIX_ALTERNATIVE_2: string = "E-";

  static readonly SEPARATOR_PATTERN: RegExp = /[\t ]/;

  /**
   * @param labeledResult labeled result from a tagger
   * @return a list of pairs - first element in a pair is a token itself, the second is a label (e.g. <footnote> or I-<footnote>)
   * Note an empty line in the result will be transformed to a 'null' pointer of a pair
   */
  static getTokensAndLabels(labeledResult: string): (Pair<string, string> | null)[] {
    return GenericTaggerUtils.processLabeledResult<Pair<string, string>>(
      labeledResult,
      (splits) => new Pair<string, string>(splits[0]!, splits[splits.length - 1]!),
    );
  }

  /**
   * @param labeledResult labeled result from a tagger
   * @return a list of triples - first element in a pair is a token itself, the second is a label (e.g. <footnote> or I-<footnote>)
   * and the third element is a string with the features
   * Note an empty line in the result will be transformed to a 'null' pointer of a pair
   */
  static getTokensWithLabelsAndFeatures(
    labeledResult: string,
    addFeatureString: boolean,
  ): (Triple<string, string, string | null> | null)[] {
    const fromSplits = (splits: string[]): Triple<string, string, string | null> => {
      const featureString: string | null = addFeatureString
        ? splits.slice(0, splits.length - 1).join("\t")
        : null;
      return new Triple<string, string, string | null>(
        splits[0]!,
        splits[splits.length - 1]!,
        featureString,
      );
    };

    return GenericTaggerUtils.processLabeledResult<Triple<string, string, string | null>>(
      labeledResult,
      fromSplits,
    );
  }

  private static processLabeledResult<T>(
    labeledResult: string,
    fromSplits: (splits: string[]) => T,
  ): (T | null)[] {
    const lines = labeledResult.split("\n");
    const res: (T | null)[] = [];
    for (let line of lines) {
      line = line.trim();
      if (line.length === 0) {
        res.push(null);
        continue;
      }
      // Split on the SEPARATOR_PATTERN (tab or space). Java's
      // Splitter.on(Pattern).splitToList returns all groups, no trailing
      // empties trimmed by default — JS String.split(regex) behaves the
      // same when no `limit` is provided.
      const splits = line.split(GenericTaggerUtils.SEPARATOR_PATTERN);
      res.push(fromSplits(splits));
    }
    return res;
  }

  static getPlainIOBLabel(label: string | null | undefined): string | null | undefined {
    return GenericTaggerUtils.isBeginningOfIOBEntity(label)
      ? (label as string).substring(2)
      : label;
  }

  static isBeginningOfIOBEntity(label: string | null | undefined): boolean {
    if (label == null) return false;
    return (
      label.startsWith(TaggingLabels.IOB_START_ENTITY_LABEL_PREFIX as string) ||
      label.startsWith(TaggingLabels.ENAMEX_START_ENTITY_LABEL_PREFIX as string)
    );
  }

  // I-<citation> --> <citation>
  // <citation> --> <citation>
  static getPlainLabel(label: string | null | undefined): string | null | undefined {
    return GenericTaggerUtils.isBeginningOfEntity(label)
      ? (label as string).substring(2)
      : label;
  }

  static isBeginningOfEntity(label: string | null | undefined): boolean {
    if (label == null) return false;
    return (
      label.startsWith(TaggingLabels.GROBID_START_ENTITY_LABEL_PREFIX as string) ||
      label.startsWith(TaggingLabels.ENAMEX_START_ENTITY_LABEL_PREFIX as string)
    );
  }
}
