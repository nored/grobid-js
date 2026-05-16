// Port of org.grobid.core.engines.citations.CalloutAnalyzer.
// Upstream: grobid-core/src/main/java/org/grobid/core/engines/citations/CalloutAnalyzer.java
//
// Adaptations:
// - Java `Pattern.compile` regex preserved verbatim. Note: upstream uses
//   atomic groups `(?>...)` which JS RegExp does not support; we translate
//   to non-capturing groups `(?:...)`. The atomic-vs-non-atomic distinction
//   is irrelevant here because the inner content cannot backtrack in a way
//   that changes match acceptance for these inputs.
// - Java `Matcher.find()` → `RegExp.test()` (we don't need capture groups).

import type { LayoutToken } from "../../layout/layout-token.js";
import { LayoutTokensUtil } from "../../utilities/layout-tokens-util.js";

/**
 *  Identify the type of the marker callout with regex
 *
 */
export class CalloutAnalyzer {
  // callout/marker type, this is used to discard incorrect numerical reference marker candidates
  // that do not follow the majority reference marker pattern
  // Java upstream is a nested enum.
  static readonly MarkerType = {
    UNKNOWN: "UNKNOWN" as const,
    BRACKET_TEXT: "BRACKET_TEXT" as const,
    BRACKET_NUMBER: "BRACKET_NUMBER" as const,
    PARENTHESIS_TEXT: "PARENTHESIS_TEXT" as const,
    PARENTHESIS_NUMBER: "PARENTHESIS_NUMBER" as const,
    SUPERSCRIPT_NUMBER: "SUPERSCRIPT_NUMBER" as const,
    NUMBER: "NUMBER" as const,
    ROMAN: "ROMAN" as const,
  } as const;

  // simple patterns just to capture the majority callout style
  private static readonly BRACKET_TEXT_PATTERN: RegExp = /\[(.)+\]/;
  //private final static Pattern BRACKET_NUMBER_PATTERN = Pattern.compile("\\[((\\d{0,4}[a-f]?)|[,-;•])+\\]");
  private static readonly BRACKET_NUMBER_PATTERN: RegExp = /\[(?:[0-9]{1,4}[a-f]?[\-;•,]?((and)|&|(et))?)+\]/;
  private static readonly PARENTHESIS_TEXT_PATTERN: RegExp = /\((.)+\)/;
  //private final static Pattern PARENTHESIS_NUMBER_PATTERN = Pattern.compile("\\(((\\d+[a-f]?)|[,-;•])+\\)");
  private static readonly PARENTHESIS_NUMBER_PATTERN: RegExp = /\((?:[0-9]{1,4}[a-f]?[\-;•,]?((and)|&|(et))?)+\)/;
  private static readonly NUMBER_PATTERN: RegExp = /(?:\d+)[a-f]?/;
  private static readonly ROMAN_PATTERN: RegExp = /(IX|IV|V?I{0,3})/;

  static getCalloutType(callout: LayoutToken[] | null | undefined): MarkerType {
    if (callout == null) return CalloutAnalyzer.MarkerType.UNKNOWN;

    let calloutString = LayoutTokensUtil.toText(callout);
    if (calloutString == null || calloutString.trim().length === 0)
      return CalloutAnalyzer.MarkerType.UNKNOWN;

    calloutString = calloutString.replace(/ /g, "");
    let isSuperScript = true;

    for (const token of callout) {
      if ((token.getText() ?? "").trim().length === 0) continue;
      if (!token.isSuperscript()) {
        isSuperScript = false;
        break;
      }
    }

    if (CalloutAnalyzer.NUMBER_PATTERN.test(calloutString)) {
      if (isSuperScript) {
        return CalloutAnalyzer.MarkerType.SUPERSCRIPT_NUMBER;
      }
    }

    if (CalloutAnalyzer.BRACKET_NUMBER_PATTERN.test(calloutString)) {
      return CalloutAnalyzer.MarkerType.BRACKET_NUMBER;
    }

    if (CalloutAnalyzer.PARENTHESIS_NUMBER_PATTERN.test(calloutString)) {
      return CalloutAnalyzer.MarkerType.PARENTHESIS_NUMBER;
    }

    if (CalloutAnalyzer.BRACKET_TEXT_PATTERN.test(calloutString)) {
      return CalloutAnalyzer.MarkerType.BRACKET_TEXT;
    }

    if (CalloutAnalyzer.PARENTHESIS_TEXT_PATTERN.test(calloutString)) {
      return CalloutAnalyzer.MarkerType.PARENTHESIS_TEXT;
    }

    if (CalloutAnalyzer.NUMBER_PATTERN.test(calloutString)) {
      return CalloutAnalyzer.MarkerType.NUMBER;
    }

    if (CalloutAnalyzer.ROMAN_PATTERN.test(calloutString)) {
      return CalloutAnalyzer.MarkerType.ROMAN;
    }

    return CalloutAnalyzer.MarkerType.UNKNOWN;
  }
}

export type MarkerType = (typeof CalloutAnalyzer.MarkerType)[keyof typeof CalloutAnalyzer.MarkerType];
