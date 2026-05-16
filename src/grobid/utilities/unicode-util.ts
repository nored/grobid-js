// Port of org.grobid.core.utilities.UnicodeUtil.
// Upstream: grobid-core/src/main/java/org/grobid/core/utilities/UnicodeUtil.java
//
// Pure regex-driven character-class normalization. Used everywhere — every
// token's text passes through normaliseText before feature extraction so the
// CRF sees a canonical, ASCII-leaning representation regardless of source PDF.

/**
 * Java `\s` doesn't cover the full Unicode White_Space property. Upstream
 * enumerates the 26 code points explicitly; we mirror the set verbatim.
 */
export const WHITESPACE_CHARS =
  "[" +
  "\\u0009" + // CHARACTER TABULATION, \t
  "\\u000A" + // LINE FEED (LF), \n
  "\\u000B" + // LINE TABULATION, \v
  "\\u000C" + // FORM FEED (FF)
  "\\u000D" + // CARRIAGE RETURN (CR), \r
  "\\u0020" + // SPACE
  "\\u0085" + // NEXT LINE (NEL)
  "\\u00A0" + // NO-BREAK SPACE
  "\\u1680" + // OGHAM SPACE MARK
  "\\u180E" + // MONGOLIAN VOWEL SEPARATOR
  "\\u2000" + // EN QUAD
  "\\u2001" + // EM QUAD
  "\\u2002" + // EN SPACE
  "\\u2003" + // EM SPACE
  "\\u2004" + // THREE-PER-EM SPACE
  "\\u2005" + // FOUR-PER-EM SPACE
  "\\u2006" + // SIX-PER-EM SPACE
  "\\u2007" + // FIGURE SPACE
  "\\u2008" + // PUNCTUATION SPACE
  "\\u2009" + // THIN SPACE
  "\\u200A" + // HAIR SPACE
  "\\u2028" + // LINE SEPARATOR
  "\\u2029" + // PARAGRAPH SEPARATOR
  "\\u202F" + // NARROW NO-BREAK SPACE
  "\\u205F" + // MEDIUM MATHEMATICAL SPACE
  "\\u3000" + // IDEOGRAPHIC SPACE
  "]";

/** Horizontal-only whitespace (excludes newline and vertical separators). */
export const MY_WHITESPACE_CHARS =
  "[" +
  "\\u0009\\u0020\\u00A0\\u1680\\u180E\\u2000\\u2001\\u2002\\u2003\\u2004\\u2005\\u2006\\u2007\\u2008\\u2009\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000" +
  "]";

export const HORIZONTAL_LOW_LINES_CHARS =
  "[\\u005F\\u203F\\u2040\\u2054\\uFE4D\\uFE4E\\uFE4F\\uFF3F\\uFE33\\uFE34]";

export const VERTICAL_LINES_CHARS = "[\\u007C\\u01C0\\u05C0\\u2223\\u2758]";

export const NEW_LINE_CHARS = "[\\u000C\\u000A\\u000D\\u000B\\u0085\\u2029\\u2028]";

export const BULLET_CHARS =
  "[\\u2022\\u2023\\u25E6\\u2043\\u204C\\u204D\\u2219\\u25D8\\u29BE\\u29BF\\u23FA\\u25CF\\u26AB\\u2B24\\u00B7]";

export const OPEN_PARENTHESIS_CHARS =
  "[\\u0028\\uFF08\\u27EE\\u2985\\u2768\\u276A\\u27EC]";

export const CLOSE_PARENTHESIS_CHARS =
  "[\\u0029\\uFF09\\u27EF\\u2986\\u2769\\u276B\\u27ED]";

// Pre-compiled patterns (mirror upstream's static Pattern constants).
const DASH_PATTERN = /[\p{Pd}−]/gu;
const MY_WHITESPACE_PATTERN = new RegExp(MY_WHITESPACE_CHARS, "gu");
const NEW_LINE_CHARS_PATTERN = new RegExp(NEW_LINE_CHARS, "gu");
const HORIZONTAL_LOW_LINES_CHARS_PATTERN = new RegExp(HORIZONTAL_LOW_LINES_CHARS, "gu");
const VERTICAL_LINES_CHARS_PATTERN = new RegExp(VERTICAL_LINES_CHARS, "gu");
const BULLET_CHARS_PATTERN = new RegExp(BULLET_CHARS, "gu");
const OPEN_PARENTHESIS_PATTERN = new RegExp(OPEN_PARENTHESIS_CHARS, "gu");
const CLOSE_PARENTHESIS_PATTERN = new RegExp(CLOSE_PARENTHESIS_CHARS, "gu");
const NORMALISE_REGEX_PATTERN = /[ \n]/g;

export class UnicodeUtil {
  static readonly whitespace_chars = WHITESPACE_CHARS;
  static readonly my_whitespace_chars = MY_WHITESPACE_CHARS;
  static readonly horizontal_low_lines_chars = HORIZONTAL_LOW_LINES_CHARS;
  static readonly vertical_lines_chars = VERTICAL_LINES_CHARS;
  static readonly new_line_chars = NEW_LINE_CHARS;
  static readonly bullet_chars = BULLET_CHARS;
  static readonly open_parenthesis = OPEN_PARENTHESIS_CHARS;
  static readonly close_parenthesis = CLOSE_PARENTHESIS_CHARS;

  /**
   * Normalise space, EOL, and punctuation unicode characters. The resulting
   * string is canonical for downstream Wapiti feature generation: spaces
   * collapsed to ASCII, EOLs collapsed to \n, dashes/underscores/bullets/
   * parens normalized.
   */
  static normaliseText(text: string | null | undefined): string | null {
    if (text === null || text === undefined) return null as unknown as string | null;

    let s = text;
    s = s.replace(MY_WHITESPACE_PATTERN, " ");
    s = s.replace(/\r\n/g, "\n");
    s = s.replace(NEW_LINE_CHARS_PATTERN, "\n");
    s = s.replace(DASH_PATTERN, "-");
    s = s.replace(HORIZONTAL_LOW_LINES_CHARS_PATTERN, "_");
    s = s.replace(VERTICAL_LINES_CHARS_PATTERN, "|");
    s = s.replace(BULLET_CHARS_PATTERN, "•");
    s = s.replace(OPEN_PARENTHESIS_PATTERN, "(");
    s = s.replace(CLOSE_PARENTHESIS_PATTERN, ")");
    return s;
  }

  /**
   * Same as `normaliseText` but additionally removes spaces and newlines.
   * Used for token-level normalization where whitespace is non-meaningful.
   */
  static normaliseTextAndRemoveSpaces(text: string): string {
    const normalised = UnicodeUtil.normaliseText(text);
    if (normalised === null) return "";
    return normalised.replace(NORMALISE_REGEX_PATTERN, "");
  }
}
