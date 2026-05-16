// Port of org.grobid.core.utilities.LabelUtils.
// Upstream: grobid-core/src/main/kotlin/org/grobid/core/utilities/LabelUtils.kt
//
// Note: upstream is Kotlin, not Java. The original inventory pass missed it
// because the BFS only scanned `src/main/java/`. Functionally a static utility
// class (`object` in Kotlin) — ported here as a class with static methods.

import { TaggingLabels } from "../engines/label/tagging-labels.js";

/** `StringUtils.isBlank` — null/empty/all-whitespace. */
function isBlank(s: string): boolean {
  return s.trim().length === 0;
}

export class LabelUtils {
  /**
   * Post-process text labeled by the fulltext model on chunks that are known
   * to be text (no table, or figure). Converts `<figure>`/`<table>` labels
   * to `<paragraph>` labels.
   */
  static postProcessFullTextLabeledText(fulltextLabeledText: string): string {
    const result: string[] = [];

    // Kotlin `split("\n".toRegex()).dropLastWhile { it.isEmpty() }` —
    // splits on newline and trims trailing empty entries.
    const lines = fulltextLabeledText.split("\n");
    while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

    let previousLabel: string | null = null;
    const figureLabel = TaggingLabels.FIGURE.getLabel();
    const tableLabel = TaggingLabels.TABLE.getLabel();
    const paragraphLabel = TaggingLabels.PARAGRAPH.getLabel();

    for (const line of lines) {
      if (isBlank(line)) continue;

      const pieces = line.split("\t");
      while (pieces.length > 0 && pieces[pieces.length - 1] === "") pieces.pop();
      const label = pieces[pieces.length - 1]!;

      if (label === "I-" + figureLabel || label === "I-" + tableLabel) {
        if (previousLabel === null || !previousLabel.endsWith(paragraphLabel)) {
          pieces[pieces.length - 1] = "I-" + paragraphLabel;
        } else {
          pieces[pieces.length - 1] = paragraphLabel;
        }
      } else if (label === figureLabel || label === tableLabel) {
        pieces[pieces.length - 1] = paragraphLabel;
      }
      result.push(pieces.join("\t"));
      previousLabel = label;
      result.push("\n");
    }

    return result.join("");
  }

  /**
   * Correct the fulltext sequence when the model predicted several unlikely
   * start sequences of table or figures. e.g., consecutive `I-<figure>` →
   * the second one is rewritten as plain `<figure>` (continuation).
   */
  static postProcessFulltextFixInvalidTableOrFigure(fulltextLabeledText: string): string {
    const result: string[] = [];

    const lines = fulltextLabeledText.split("\n");
    while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

    let previousLabel: string | null = null;
    const figureLabel = TaggingLabels.FIGURE.getLabel();
    const tableLabel = TaggingLabels.TABLE.getLabel();

    for (const line of lines) {
      if (isBlank(line)) continue;

      const pieces = line.split("\t");
      while (pieces.length > 0 && pieces[pieces.length - 1] === "") pieces.pop();
      const label = pieces[pieces.length - 1]!;

      if (label === "I-" + figureLabel) {
        if (previousLabel === "I-" + figureLabel) {
          pieces[pieces.length - 1] = figureLabel;
        }
      } else if (label === "I-" + tableLabel) {
        if (previousLabel === "I-" + tableLabel) {
          pieces[pieces.length - 1] = tableLabel;
        }
      }

      result.push(pieces.join("\t"));
      previousLabel = label;
      result.push("\n");
    }

    return result.join("");
  }
}
