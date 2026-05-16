// Port of org.grobid.core.utilities.TextUtilities.
// Upstream: grobid-core/src/main/java/org/grobid/core/utilities/TextUtilities.java
//
// Class for holding static methods for text processing.

import { GrobidAnalyzer } from "../analyzers/grobid-analyzer.js";
import { GrobidException } from "../exceptions/grobid-exception.js";
import { LayoutToken } from "../layout/layout-token.js";
import { Lexicon } from "../lexicon/lexicon.js";
import { LayoutTokensUtil } from "./layout-tokens-util.js";
import { OffsetPosition } from "./offset-position.js";
import { Pair } from "./pair.js";
import { SentenceUtilities } from "./sentence-utilities.js";

/** Mirrors `java.lang.Character.isDigit(char)` for BMP characters. */
function isDigit(ch: string): boolean {
  if (ch.length === 0) return false;
  // Java's Character.isDigit matches Unicode Nd category; for our usage the
  // input is ASCII / common digits.
  return /\p{Nd}/u.test(ch);
}

/** Mirrors `java.lang.Character.isLetter(char)`. */
function isLetter(ch: string): boolean {
  if (ch.length === 0) return false;
  return /\p{L}/u.test(ch);
}

/** Mirrors `java.lang.Character.isUpperCase(char)`. */
function isUpperCase(ch: string): boolean {
  if (ch.length === 0) return false;
  return /\p{Lu}/u.test(ch);
}

/** Mirrors `java.lang.Character.isLowerCase(char)`. */
function isLowerCase(ch: string): boolean {
  if (ch.length === 0) return false;
  return /\p{Ll}/u.test(ch);
}

/** Mirrors `org.apache.commons.lang3.StringUtils.isEmpty`. */
function isEmpty(s: string | null | undefined): boolean {
  return s === null || s === undefined || s.length === 0;
}

/** Mirrors `org.apache.commons.lang3.StringUtils.isNotEmpty`. */
function isNotEmpty(s: string | null | undefined): boolean {
  return !isEmpty(s);
}

/** Mirrors `org.apache.commons.lang3.StringUtils.isNumeric`. */
function isNumeric(s: string | null | undefined): boolean {
  if (s === null || s === undefined || s.length === 0) return false;
  for (let i = 0; i < s.length; i++) {
    if (!isDigit(s.charAt(i))) return false;
  }
  return true;
}

/** Mirrors `org.apache.commons.lang3.StringUtils.countMatches(text, sub)`. */
function countMatches(text: string | null | undefined, sub: string | null | undefined): number {
  if (isEmpty(text) || isEmpty(sub)) return 0;
  let count = 0;
  let idx = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const found = (text as string).indexOf(sub as string, idx);
    if (found === -1) break;
    count++;
    idx = found + (sub as string).length;
  }
  return count;
}

/** Mirrors `org.apache.commons.lang3.StringUtils.stripStart(text, chars)`. */
function stripStart(text: string, stripChars: string | null): string {
  if (text === null || text.length === 0) return text;
  let start = 0;
  if (stripChars === null) {
    while (start < text.length && /\s/.test(text.charAt(start))) start++;
  } else if (stripChars.length === 0) {
    return text;
  } else {
    while (start < text.length && stripChars.indexOf(text.charAt(start)) !== -1) start++;
  }
  return text.substring(start);
}

/** Mirrors `org.apache.commons.lang3.StringUtils.stripEnd(text, chars)`. */
function stripEnd(text: string, stripChars: string | null): string {
  if (text === null || text.length === 0) return text;
  let end = text.length;
  if (stripChars === null) {
    while (end > 0 && /\s/.test(text.charAt(end - 1))) end--;
  } else if (stripChars.length === 0) {
    return text;
  } else {
    while (end > 0 && stripChars.indexOf(text.charAt(end - 1)) !== -1) end--;
  }
  return text.substring(0, end);
}

/**
 * Java's `DecimalFormat#applyPattern("#.##")` rounds half-even by default; for
 * practical purposes we emit at most N fractional digits without trailing
 * zeros, which matches the observed upstream behaviour.
 */
function formatDecimals(d: number, maxFraction: number): string {
  if (!isFinite(d)) return String(d);
  // toFixed uses banker rounding inconsistently across JS engines; for Grobid
  // outputs the absolute precision is sufficient.
  const rounded = Number.parseFloat(d.toFixed(maxFraction));
  let s = rounded.toString();
  // toString may render scientific notation for very small numbers; for the
  // typical Grobid range this won't trigger.
  if (s.indexOf(".") === -1 && Math.abs(d) < 1 && d !== 0) {
    // Should not happen at the magnitudes we expect; emit raw.
  }
  // Match upstream DecimalFormat("#.##"): integers print without decimal point.
  if (Number.isInteger(rounded)) {
    s = String(rounded);
  }
  return s;
}

export class TextUtilities {
  static readonly punctuations = " •*,:;?.!)-−–\"“”‘’'`$]*♦♥♣♠ 。、，・";
  static readonly fullPunctuations = "(（[ •*,:;?.!/)）-−–‐«»„\"“”‘’'`$#@]*♦♥♣♠ 。、，・";
  static readonly restrictedPunctuations = ",:;?.!/-–«»„\"“”‘’'`*♦♥♣♠。、，・";
  static delimiters = "\n\r\t\f ‌" + TextUtilities.fullPunctuations;

  static readonly OR = "|";
  static readonly NEW_LINE = "\n";
  static readonly SPACE = " ";
  static readonly COMMA = ",";
  static readonly QUOTE = "'";
  static readonly END_BRACKET = ")";
  static readonly START_BRACKET = "(";
  static readonly SHARP = "#";
  static readonly COLON = ":";
  static readonly DOUBLE_QUOTE = "\"";
  static readonly ESC_DOUBLE_QUOTE = "&quot;";
  static readonly LESS_THAN = "<";
  static readonly ESC_LESS_THAN = "&lt;";
  static readonly GREATER_THAN = ">";
  static readonly ESC_GREATER_THAN = "&gt;";
  static readonly AND = "&";
  static readonly ESC_AND = "&amp;";
  static readonly SLASH = "/";

  // note: be careful of catastrophic backtracking here as a consequence of PDF noise!

  private static readonly ORCIDRegex = "^\\s*(?:(?:https?://)?orcid.org/)?([0-9]{4})\\-?([0-9]{4})\\-?([0-9]{4})\\-?([0-9]{3}[\\dX])\\s*$";
  static readonly ORCIDPattern = new RegExp(TextUtilities.ORCIDRegex);

  // the magical DOI regular expression...
  static readonly DOIPattern = /(10\.\d{4,5}\/[\S]+[^;,.\s])/;

  // a regular expression for arXiv identifiers
  // see https://arxiv.org/help/arxiv_identifier and https://arxiv.org/help/arxiv_identifier_for_services
  static readonly arXivPattern =
    /(arXiv\s?(\.org)?\s?\:\s?\d{4}\s?\.\s?\d{4,5}(v\d+)?)|(arXiv\s?(\.org)?\s?\:\s?[ a-zA-Z\-\.]*\s?\/\s?\d{7}(v\d+)?)/;

  // regular expression for PubMed identifiers, last group gives the PMID digits
  static readonly pmidPattern = /((PMID)|(Pub(\s)?Med(\s)?(ID)?))(\s)?(\:)?(\s)*(\d{1,8})/;

  // regular expression for PubMed Central identifiers (note: contrary to PMID, we include the prefix PMC here, see
  // https://www.ncbi.nlm.nih.gov/pmc/pmctopmid/ for instance), last group gives the PMC ID digits
  static readonly pmcidPattern = /((PMC\s?(ID)?)|(Pub(\s)?Med(\s)?(Central)?(\s)?(ID)?))(\s)?(\:)?(\s)*(\d{1,9})/;

  // a regular expression for identifying url pattern in text
  // TODO: maybe find a better regex (better == more robust, not more "standard")
  static readonly urlPattern0 = /(https?|ftp)\s?:\s?\/\/\s?[-A-Z0-9+&@#/%?=~_()|!:,.;]*[-A-Z0-9+&@#/%=~_()|]/i;
  static readonly urlPattern = /(https?|ftp)\s{0,2}:\s{0,2}\/\/\s{0,2}[-A-Z0-9+&@#/%?=~_()|!:.;]*[-A-Z0-9+&@#/%=~_()]/i;
  static readonly urlPattern1 =
    /(https?|ftp)\s{0,2}:\s{0,2}\/\/\s{0,2}[-A-Z0-9+&@#/%?=~_()|!:.;]*[-A-Z0-9+&@#/%=~_()]|www\s{0,2}\.\s{0,2}[-A-Z0-9+&@#/%?=~_()|!:.;]*[-A-Z0-9+&@#/%=~_()]/i;

  // a regular expression for identifying email pattern in text
  // TODO: maybe find a better regex (better == more robust, not more "standard")
  static readonly emailPattern = /\w+((\.|-|_|,)\w+)?\s?((\.|-|_|,)\w+)?\s?@\s?\w+(\s?(\.|-)\s?\w+)+/;
  // variant: \w+(\s?(\.|-|_|,)\w+)?(\s?(\.|-|_|,)\w+)?\s?@\s?\w+(\s?(\.|\-)\s?\w+)+

  /**
   * Replace numbers in the string by a dummy character for string distance evaluations
   *
   * @param string the string to be processed.
   * @return Returns the string with numbers replaced by 'X'.
   */
  static shadowNumbers(string: string | null): string | null {
    let i = 0;
    if (string === null) return string;
    let res = "";
    while (i < string.length) {
      const c = string.charAt(i);
      if (isDigit(c)) res += "X";
      else res += c;
      i++;
    }
    return res;
  }

  private static getLastPunctuationCharacter(section: string): number {
    let res = -1;
    for (let i = section.length - 1; i >= 0; i--) {
      if (TextUtilities.fullPunctuations.indexOf(section.charAt(i)) !== -1) {
        res = i;
      }
    }
    return res;
  }

  /** @deprecated use LayoutTokensUtil.dehyphenize(List<LayoutToken> tokens) */
  static dehyphenizeTokens(tokens: LayoutToken[]): LayoutToken[] {
    return LayoutTokensUtil.dehyphenize(tokens);
  }

  /** @deprecated use LayoutTokenUtils.doesRequireDehyphenisation(List<LayoutToken> tokens, int i) */
  protected static doesRequireDehypenisation(tokens: LayoutToken[], i: number): boolean {
    return LayoutTokensUtil.doesRequireDehyphenisation(tokens, i);
  }

  static dehyphenize(text: string): string {
    const analyser = GrobidAnalyzer.getInstance();

    const layoutTokens: LayoutToken[] = analyser.tokenizeWithLayoutToken(text);

    return LayoutTokensUtil.toText(LayoutTokensUtil.dehyphenize(layoutTokens));
  }

  static getLastToken(section: string): string {
    let lastToken = section;
    const lastSpaceIndex = section.lastIndexOf(" ");

    //The last parenthesis cover the case 'this is a (special-one) case'
    // where the lastToken before the hyphen should be 'special' and not '(special'
    /*        int lastParenthesisIndex = section.lastIndexOf('(');
    if (lastParenthesisIndex > lastSpaceIndex)
        lastSpaceIndex = lastParenthesisIndex;*/

    if (lastSpaceIndex !== -1) {
      lastToken = section.substring(lastSpaceIndex + 1, section.length);
    } else {
      lastToken = section.substring(0, section.length);
    }
    return lastToken;
  }

  static getFirstToken(section: string): string {
    const firstSpaceIndex = section.indexOf(" ");

    if (firstSpaceIndex === 0) {
      return TextUtilities.getFirstToken(section.substring(1, section.length));
    } else if (firstSpaceIndex !== -1) {
      return section.substring(0, firstSpaceIndex);
    } else {
      return section.substring(0, section.length);
    }
  }

  /**
   * Text extracted from a PDF is usually hyphenized, which is not desirable.
   * This version supposes that the end of line are lost and than hyphenation
   * could appear everywhere. So a dictionary is used to control the recognition
   * of hyphen.
   *
   * @param text the string to be processed without preserved end of lines.
   * @return Returns the dehyphenized string.
   *
   * Deprecated method, not needed anymore since the @newline are preserved thanks to the LayoutTokens
   * @deprecated Use LayoutTokensUtil.dehypenize()
   */
  static dehyphenizeHard(text: string | null): string | null {
    if (text === null) return null;
    let res = "";

    // Note: upstream has `text.replaceAll("\n", SPACE);` whose return value is
    // discarded, so `text` is unchanged. Preserve this verbatim.
    text.replace(/\n/g, TextUtilities.SPACE);

    // StringTokenizer(text, "-"): splits on '-', no empty tokens, no delimiters returned.
    const tokens1 = TextUtilities._stringTokenizerTokens(text, "-");
    let hyphen = false;
    let failure = false;
    let lastToken: string | null = null;
    for (const rawSection of tokens1) {
      let section = rawSection.trim();

      if (hyphen) {
        // we get the first token
        const tokens2 = TextUtilities._stringTokenizerTokens(section, " ,.);!");
        if (tokens2.length > 0) {
          const firstToken = tokens2[0]!;

          // we check if the composed token is in the lexicon
          const hyphenToken = lastToken + firstToken;
          //System.out.println(hyphenToken);
          /*if (lex == null)
                   featureFactory.loadLexicon();*/
          const lex = Lexicon.getInstance();

          if (lex.inDictionary(hyphenToken.toLowerCase()) &&
              !(TextUtilities.test_digit(hyphenToken))) {
            // if yes, it is hyphenization
            res += firstToken;
            section = section.substring(firstToken.length, section.length);
          } else {
            // if not
            res += "-";
            failure = true;
          }
        } else {
          res += "-";
        }
        hyphen = false;
      }

      // we get the last token
      hyphen = true;
      lastToken = TextUtilities.getLastToken(section);

      if (failure) {
        res += section;
        failure = false;
      } else res += TextUtilities.SPACE + section;
    }

    res = res.replace(/ \. /g, ". ");
    res = res.replace(/  /g, TextUtilities.SPACE);

    return res.trim();
  }

  /**
   * Mirrors `java.util.StringTokenizer(text, delims)`: returns the substrings
   * between any of the delimiter characters; empty tokens are skipped, and
   * delimiters themselves are NOT returned.
   */
  private static _stringTokenizerTokens(text: string, delims: string): string[] {
    const out: string[] = [];
    let cur = "";
    for (let i = 0; i < text.length; i++) {
      const c = text.charAt(i);
      if (delims.indexOf(c) !== -1) {
        if (cur.length > 0) {
          out.push(cur);
          cur = "";
        }
      } else {
        cur += c;
      }
    }
    if (cur.length > 0) out.push(cur);
    return out;
  }

  /**
   * Levenstein distance between two strings
   *
   * @param s the first string to be compared.
   * @param t the second string to be compared.
   * @return Returns the Levenshtein distance.
   */
  static getLevenshteinDistance(s: string, t: string): number {
    //if (s == null || t == null) {
    //	throw new IllegalArgumentException("Strings must not be null");
    //}
    const n = s.length; // length of s
    const m = t.length; // length of t

    if (n === 0) {
      return m;
    } else if (m === 0) {
      return n;
    }

    let p: number[] = new Array<number>(n + 1).fill(0); //'previous' cost array, horizontally
    let d: number[] = new Array<number>(n + 1).fill(0); // cost array, horizontally
    let _d: number[]; //placeholder to assist in swapping p and d

    // indexes into strings s and t
    let i: number; // iterates through s
    let j: number; // iterates through t

    let t_j: string; // jth character of t

    let cost: number; // cost

    for (i = 0; i <= n; i++) {
      p[i] = i;
    }

    for (j = 1; j <= m; j++) {
      t_j = t.charAt(j - 1);
      d[0] = j;

      for (i = 1; i <= n; i++) {
        cost = s.charAt(i - 1) === t_j ? 0 : 1;
        // minimum of cell to the left+1, to the top+1, diagonally left and up +cost
        d[i] = Math.min(Math.min(d[i - 1]! + 1, p[i]! + 1), p[i - 1]! + cost);
      }

      // copy current distance counts to 'previous row' distance counts
      _d = p;
      p = d;
      d = _d;
    }

    // our last action in the above loop was to switch d and p, so p now
    // actually has the most recent cost counts
    return p[n]!;
  }

  /**
   * Appending nb times the char c to the a StringBuffer...
   */
  static appendN(buffer: string[], c: string, nb: number): void {
    for (let i = 0; i < nb; i++) {
      buffer.push(c);
    }
  }

  /**
   * To replace accented characters in a unicode string by unaccented equivalents:
   * é -> e, ü -> ue, ß -> ss, etc. following the standard transcription conventions
   *
   * @param input the string to be processed.
   * @return Returns the string without accent.
   */
  static removeAccents(input: string | null): string | null {
    if (input === null) return null;
    const output: string[] = [];
    for (let i = 0; i < input.length; i++) {
      switch (input.charAt(i)) {
        case "À": // À
        case "Á": // Á
        case "Â": // Â
        case "Ã": // Ã
        case "Å": // Å
          output.push("A");
          break;
        case "Ä": // Ä
        case "Æ": // Æ
          output.push("AE");
          break;
        case "Ç": // Ç
          output.push("C");
          break;
        case "È": // È
        case "É": // É
        case "Ê": // Ê
        case "Ë": // Ë
          output.push("E");
          break;
        case "Ì": // Ì
        case "Í": // Í
        case "Î": // Î
        case "Ï": // Ï
          output.push("I");
          break;
        case "Ð": // Ð
          output.push("D");
          break;
        case "Ñ": // Ñ
          output.push("N");
          break;
        case "Ò": // Ò
        case "Ó": // Ó
        case "Ô": // Ô
        case "Õ": // Õ
        case "Ø": // Ø
          output.push("O");
          break;
        case "Ö": // Ö
        case "Œ": // Œ
          output.push("OE");
          break;
        case "Þ": // Þ
          output.push("TH");
          break;
        case "Ù": // Ù
        case "Ú": // Ú
        case "Û": // Û
          output.push("U");
          break;
        case "Ü": // Ü
          output.push("UE");
          break;
        case "Ý": // Ý
        case "Ÿ": // Ÿ
          output.push("Y");
          break;
        case "à": // à
        case "á": // á
        case "â": // â
        case "ã": // ã
        case "å": // å
          output.push("a");
          break;
        case "ä": // ä
        case "æ": // æ
          output.push("ae");
          break;
        case "ç": // ç
          output.push("c");
          break;
        case "è": // è
        case "é": // é
        case "ê": // ê
        case "ë": // ë
          output.push("e");
          break;
        case "ì": // ì
        case "í": // í
        case "î": // î
        case "ï": // ï
          output.push("i");
          break;
        case "ð": // ð
          output.push("d");
          break;
        case "ñ": // ñ
          output.push("n");
          break;
        case "ò": // ò
        case "ó": // ó
        case "ô": // ô
        case "õ": // õ
        case "ø": // ø
          output.push("o");
          break;
        case "ö": // ö
        case "œ": // œ
          output.push("oe");
          break;
        case "ß": // ß
          output.push("ss");
          break;
        case "þ": // þ
          output.push("th");
          break;
        case "ù": // ù
        case "ú": // ú
        case "û": // û
          output.push("u");
          break;
        case "ü": // ü
          output.push("ue");
          break;
        case "ý": // ý
        case "ÿ": // ÿ
          output.push("y");
          break;
        default:
          output.push(input.charAt(i));
          break;
      }
    }
    return output.join("");
  }

  // ad hoc stopword list for the cleanField method
  static readonly stopwords: readonly string[] = [
    "the", "of", "and", "du", "de le", "de la", "des", "der", "an", "und", "for",
  ];

  /**
   * Remove useless punctuation at the end and beginning of a metadata field.
   *
   * Still experimental ! Use with care !
   */
  static cleanField(input0: string | null, applyStopwordsFilter: boolean): string | null {
    if (input0 === null) {
      return null;
    }
    if (input0.length === 0) {
      return null;
    }
    let input = input0.replace(/,,/g, ",");
    input = input.replace(/, ,/g, ",");
    let n = input.length;

    // characters at the end
    for (let i = input.length - 1; i > 0; i--) {
      const c = input.charAt(i);
      if ((c === ",") ||
        (c === " ") ||
        (c === ".") ||
        (c === "-") ||
        (c === "_") ||
        (c === "/") ||
        //(c == ')') ||
        //(c == '(') ||
        (c === ":")) {
        n = i;
      } else if (c === ";") {
        // we have to check if we have an html entity finishing
        if (i - 3 >= 0) {
          const c0 = input.charAt(i - 3);
          if (c0 === "&") {
            break;
          }
        }
        if (i - 4 >= 0) {
          const c0 = input.charAt(i - 4);
          if (c0 === "&") {
            break;
          }
        }
        if (i - 5 >= 0) {
          const c0 = input.charAt(i - 5);
          if (c0 === "&") {
            break;
          }
        }
        if (i - 6 >= 0) {
          const c0 = input.charAt(i - 6);
          if (c0 === "&") {
            break;
          }
        }
        n = i;
      } else break;
    }

    input = input.substring(0, n);

    // characters at the beginning
    n = 0;
    for (let i = 0; i < input.length; i++) {
      const c = input.charAt(i);
      if ((c === ",") ||
        (c === " ") ||
        (c === ".") ||
        (c === ";") ||
        (c === "-") ||
        (c === "_") ||
        //(c == ')') ||
        //(c == '(') ||
        (c === ":")) {
        n = i;
      } else break;
    }

    input = input.substring(n, input.length).trim();

    if ((input.endsWith(")")) && (input.startsWith("("))) {
      input = input.substring(1, input.length - 1).trim();
    }

    if ((input.length > 12) &&
      (input.endsWith("&quot;")) &&
      (input.startsWith("&quot;"))) {
      input = input.substring(6, input.length - 6).trim();
    }

    if (applyStopwordsFilter) {
      let stop = false;
      while (!stop) {
        stop = true;
        for (const word of TextUtilities.stopwords) {
          if (input.endsWith(TextUtilities.SPACE + word)) {
            input = input.substring(0, input.length - word.length).trim();
            stop = false;
            break;
          }
        }
      }
    }

    return input.trim();
  }

  /**
   * Segment piece of text following a list of segmentation characters.
   * "hello, world." -> [ "hello", ",", "world", "." ]
   *
   * @param input the string to be processed.
   * @param segments the characters creating a segment (typically space and punctuations).
   * @return Returns the string without accent.
   */
  static segment(input: string | null, segments: string): string[] | null {
    if (input === null) return null;
    const result: string[] = [];
    let token: string | null = null;
    const seg = " \n\t";
    for (let i = 0; i < input.length; i++) {
      const c = input.charAt(i);
      const ind = seg.indexOf(c);
      if (ind !== -1) {
        if (token !== null) {
          result.push(token);
          token = null;
        }
      } else {
        const ind2 = segments.indexOf(c);
        if (ind2 === -1) {
          if (token === null) token = "" + c;
          else token += c;
        } else {
          if (token !== null) {
            result.push(token);
            token = null;
          }
          result.push("" + segments.charAt(ind2));
        }
      }
    }
    if (token !== null) result.push(token);
    return result;
  }

  /**
   * Encode a string to be displayed in HTML
   *
   * If fullHTML encode, then all unicode characters above 7 bits are converted into
   * HTML entities
   */
  static HTMLEncode(string: string | null, fullHTML: boolean = false): string | null {
    if (string === null) return null;
    if (string.length === 0) return string;
    //string = string.replace("@BULLET", "•");
    const sb: string[] = [];
    // true if last char was blank
    let lastWasBlankChar = false;
    const len = string.length;
    let c: string;

    for (let i = 0; i < len; i++) {
      c = string.charAt(i);
      if (c === " ") {
        // blank gets extra work,
        // this solves the problem you get if you replace all
        // blanks with &nbsp;, if you do that you loss
        // word breaking
        if (lastWasBlankChar) {
          lastWasBlankChar = false;
          //sb.append("&nbsp;");
        } else {
          lastWasBlankChar = true;
          sb.push(" ");
        }
      } else {
        lastWasBlankChar = false;
        //
        // HTML Special Chars
        if (c === "\"") sb.push("&quot;");
        else if (c === "'") sb.push("&apos;");
        else if (c === "&") {
          let skip = false;
          // we don't want to recode an existing hmlt entity
          if (string.length > i + 3) {
            const c2 = string.charAt(i + 1);
            const c3 = string.charAt(i + 2);
            const c4 = string.charAt(i + 3);
            if (c2 === "a") {
              if (c3 === "m") {
                if (c4 === "p") {
                  if (string.length > i + 4) {
                    const c5 = string.charAt(i + 4);
                    if (c5 === ";") {
                      skip = true;
                    }
                  }
                }
              }
            } else if (c2 === "q") {
              if (c3 === "u") {
                if (c4 === "o") {
                  if (string.length > i + 5) {
                    const c5 = string.charAt(i + 4);
                    const c6 = string.charAt(i + 5);
                    if (c5 === "t") {
                      if (c6 === ";") {
                        skip = true;
                      }
                    }
                  }
                }
              }
            } else if (c2 === "l" || c2 === "g") {
              if (c3 === "t") {
                if (c4 === ";") {
                  skip = true;
                }
              }
            }
          }
          if (!skip) {
            sb.push("&amp;");
          } else {
            sb.push("&");
          }
        } else if (c === "<") sb.push("&lt;");
        else if (c === ">") sb.push("&gt;");
        /*else if (c == '\n') {
             // warning: this can be too much html!
             sb.append("&lt;br/&gt;");
         }*/
        else {
          const ci = 0xffff & c.charCodeAt(0);
          if (ci < 160) {
            // nothing special only 7 Bit
            sb.push(c);
          } else {
            if (fullHTML) {
              // Not 7 Bit use the unicode system
              sb.push("&#");
              sb.push(String(ci));
              sb.push(";");
            } else sb.push(c);
          }
        }
      }
    }
    return sb.join("");
  }

  static normalizeRegex(string: string): string {
    // NOTE: dead-code parity with upstream — upstream Java calls the same
    // `&` replacement twice. Second call is a no-op (idempotent); removed.
    string = string.replace(/&/g, "\\\\&");
    string = string.replace(/\+/g, "\\\\+");
    return string;
  }

  /*
   * To convert the InputStream to String we use the BufferedReader.readLine()
   * method. We iterate until the BufferedReader return null which means
   * there's no more data to read. Each line will appended to a StringBuilder
   * and returned as String.
   *
   * In TS the upstream `InputStream` is replaced by a string (the caller is
   * responsible for decoding bytes to a string at the I/O boundary).
   */
  static convertStreamToString(is: string): string {
    // Mirror upstream: read line-by-line, appending "\n" after each.
    const sb: string[] = [];
    try {
      const lines = is.split(/\r?\n/);
      // BufferedReader.readLine() splits on any line terminator and DROPS the
      // terminator; if the stream is empty it returns null first. To emulate
      // that, drop a final trailing empty entry when input ends with a newline.
      if (lines.length > 0 && lines[lines.length - 1] === "") {
        lines.pop();
      }
      for (const line of lines) {
        sb.push(line + "\n");
      }
    } catch (e) {
      throw new GrobidException("An exception occurred while running Grobid.", e);
    }
    return sb.join("");
  }

  /**
   * Count the number of digit in a given string.
   *
   * @param text the string to be processed.
   * @return Returns the number of digit chracaters in the string...
   */
  static countDigit(text: string): number {
    let count = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text.charAt(i);
      if (isDigit(c)) count++;
    }
    return count;
  }

  /**
   * Map special ligature and characters coming from the pdf
   */
  static clean(token: string | null): string | null {
    if (token === null) return null;
    if (token.length === 0) return token;
    let res = "";
    let i = 0;
    while (i < token.length) {
      switch (token.charAt(i)) {
        // ligature
        case "ﬀ": {
          res += "ff";
          break;
        }
        case "ﬁ": {
          res += "fi";
          break;
        }
        case "ﬂ": {
          res += "fl";
          break;
        }
        case "ﬃ": {
          res += "ffi";
          break;
        }
        case "ﬄ": {
          res += "ffl";
          break;
        }
        case "ﬆ": {
          res += "st";
          break;
        }
        case "ﬅ": {
          res += "ft";
          break;
        }
        case "æ": {
          res += "ae";
          break;
        }
        case "Æ": {
          res += "AE";
          break;
        }
        case "œ": {
          res += "oe";
          break;
        }
        case "Œ": {
          res += "OE";
          break;
        }
        // quote
        case "“": {
          res += "\"";
          break;
        }
        case "”": {
          res += "\"";
          break;
        }
        case "„": {
          res += "\"";
          break;
        }
        case "‟": {
          res += "\"";
          break;
        }
        case "’": {
          res += "'";
          break;
        }
        case "‘": {
          res += "'";
          break;
        }
        // bullet uniformity
        case "•": {
          res += "•";
          break;
        }
        case "‣": {
          res += "•";
          break;
        }
        case "⁃": {
          res += "•";
          break;
        }
        case "⁌": {
          res += "•";
          break;
        }
        case "⁍": {
          res += "•";
          break;
        }
        case "∙": {
          res += "•";
          break;
        }
        case "◉": {
          res += "•";
          break;
        }
        case "◘": {
          res += "•";
          break;
        }
        case "◦": {
          res += "•";
          break;
        }
        case "☙": {
          res += "•";
          break;
        }
        case "❥": {
          res += "•";
          break;
        }
        case "❧": {
          res += "•";
          break;
        }
        case "⦾": {
          res += "•";
          break;
        }
        case "⦿": {
          res += "•";
          break;
        }
        // asterix
        case "∗": {
          res += " * ";
          break;
        }
        // typical author/affiliation markers
        case "†": {
          res += TextUtilities.SPACE + "†";
          break;
        }
        case "‡": {
          res += TextUtilities.SPACE + "‡";
          break;
        }
        case "§": {
          res += TextUtilities.SPACE + "§";
          break;
        }
        case "¶": {
          res += TextUtilities.SPACE + "¶";
          break;
        }
        case "⁋": {
          res += TextUtilities.SPACE + "⁋";
          break;
        }
        case "ǂ": {
          res += TextUtilities.SPACE + "ǂ";
          break;
        }
        // default
        default: {
          res += token.charAt(i);
          break;
        }
      }
      i++;
    }
    return res;
  }

  static formatTwoDecimals(d: number): string {
    return formatDecimals(d, 2);
  }

  static formatFourDecimals(d: number): string {
    return formatDecimals(d, 4);
  }

  static isAllUpperCase(text: string): boolean {
    for (let i = 0; i < text.length; i++) {
      if (!isUpperCase(text.charAt(i))) {
        return false;
      }
    }
    return true;
  }

  static isAllLowerCase(text: string): boolean {
    for (let i = 0; i < text.length; i++) {
      if (!isLowerCase(text.charAt(i))) {
        return false;
      }
    }
    return true;
  }

  static generateEmailVariants(firstName: string | null, lastName: string | null): string[] {
    // current heuristics:
    // "First Last"
    // "First L"
    // "F Last"
    // "First"
    // "Last"
    // "Last First"
    // "Last F"

    const variants: string[] = [];

    if (lastName !== null) {
      variants.push(lastName);

      if (firstName !== null) {
        variants.push(firstName + TextUtilities.SPACE + lastName);
        variants.push(lastName + TextUtilities.SPACE + firstName);

        if (firstName.length > 1) {
          const firstInitial = firstName.substring(0, 1);

          variants.push(firstInitial + TextUtilities.SPACE + lastName);
          variants.push(lastName + TextUtilities.SPACE + firstInitial);
        }

        if (lastName.length > 1) {
          const lastInitial = lastName.substring(0, 1);

          variants.push(firstName + TextUtilities.SPACE + lastInitial);
        }
      }
    } else {
      if (firstName !== null) {
        variants.push(firstName);
      }
    }

    return variants;
  }

  /**
   * This is a re-implementation of the capitalizeFully of Apache commons lang, because it appears not working
   * properly.
   *
   * Convert a string so that each word is made up of a titlecase character and then a series of lowercase
   * characters. Words are defined as token delimited by one of the character in delimiters or the beginning
   * of the string.
   */
  static capitalizeFully(input: string | null, delimiters: string): string | null {
    if (input === null) {
      return null;
    }

    //input = input.toLowerCase();
    let output = "";
    let toUpper = true;
    for (let c = 0; c < input.length; c++) {
      const ch = input.charAt(c);

      if (delimiters.indexOf(ch) !== -1) {
        toUpper = true;
        output += ch;
      } else {
        if (toUpper === true) {
          output += ch.toUpperCase();
          toUpper = false;
        } else {
          output += ch.toLowerCase();
        }
      }
    }
    return output;
  }

  static wordShape(word: string): string {
    const shape: string[] = [];
    for (const c of word) {
      if (isLetter(c)) {
        if (isUpperCase(c)) {
          shape.push("X");
        } else {
          shape.push("x");
        }
      } else if (isDigit(c)) {
        shape.push("d");
      } else {
        shape.push(c);
      }
    }
    const shapeStr = shape.join("");

    const finalShape: string[] = [];
    finalShape.push(shapeStr.charAt(0));

    let suffix = "";
    if (word.length > 2) {
      suffix = shapeStr.substring(shapeStr.length - 2);
    } else if (word.length > 1) {
      suffix = shapeStr.substring(shapeStr.length - 1);
    }

    const middle: string[] = [];
    if (shapeStr.length > 3) {
      let ch = shapeStr.charAt(1);
      for (let i = 1; i < shapeStr.length - 2; i++) {
        middle.push(ch);
        while (ch === shapeStr.charAt(i) && i < shapeStr.length - 2) {
          i++;
        }
        ch = shapeStr.charAt(i);
      }

      const middleStr = middle.join("");
      if (ch !== middleStr.charAt(middleStr.length - 1)) {
        middle.push(ch);
      }
    }
    return finalShape.join("") + middle.join("") + suffix;
  }

  static wordShapeTrimmed(word: string): string {
    const shape: string[] = [];
    for (const c of word) {
      if (isLetter(c)) {
        if (isUpperCase(c)) {
          shape.push("X");
        } else {
          shape.push("x");
        }
      } else if (isDigit(c)) {
        shape.push("d");
      } else {
        shape.push(c);
      }
    }
    const shapeStr = shape.join("");

    const middle: string[] = [];

    let ch = shapeStr.charAt(0);
    for (let i = 0; i < shapeStr.length; i++) {
      middle.push(ch);
      while (ch === shapeStr.charAt(i) && i < shapeStr.length - 1) {
        i++;
      }
      ch = shapeStr.charAt(i);
    }

    const middleStr = middle.join("");
    if (ch !== middleStr.charAt(middleStr.length - 1)) {
      middle.push(ch);
    }

    return middle.join("");
  }

  /**
   * Give the punctuation profile of a line, i.e. the concatenation of all the punctuations
   * occurring in the line.
   *
   * @param line the string corresponding to a line
   * @return the punctuation profile as a string, empty string is no punctuation
   */
  static punctuationProfile(line: string | null): string {
    let profile = "";
    if ((line === null) || (line.length === 0)) {
      return profile;
    }
    for (let i = 0; i < line.length; i++) {
      const c = line.charAt(i);
      if (c === " ") {
        continue;
      }
      if (TextUtilities.fullPunctuations.indexOf(c) !== -1) profile += c;
    }
    return profile;
  }

  /**
   * Return the number of token in a line given an existing global tokenization and a current
   * start position of the line in this global tokenization.
   *
   * @param line           the string corresponding to a line
   * @param currentLinePos position of the line in the tokenization
   * @param tokenization   the global tokenization where the line appears
   * @return the punctuation profile as a string, empty string is no punctuation
   */
  static getNbTokens(line: string | null, currentLinePos: number, tokenization: string[]): number {
    if ((line === null) || (line.length === 0)) return 0;
    let currentToken = tokenization[currentLinePos]!;
    while ((currentLinePos < tokenization.length) &&
      (currentToken === " " || currentToken === "\n")) {
      currentLinePos++;
      currentToken = tokenization[currentLinePos]!;
    }
    if (!line.trim().startsWith(currentToken)) {
      console.log("out of sync. : " + currentToken);
      throw new Error("line start does not match given tokenization start");
    }
    let nbTokens = 0;
    let posMatch = 0; // current position in line
    for (let p = currentLinePos; p < tokenization.length; p++) {
      currentToken = tokenization[p]!;
      posMatch = line.indexOf(currentToken, posMatch);
      if (posMatch === -1) break;
      nbTokens++;
    }
    return nbTokens;
  }

  /**
   * Ensure that special XML characters are correctly encoded.
   */
  static trimEncodedCharaters(string: string): string {
    return string.replace(/&amp\s+;/g, "&amp;")
      .replace(/&quot\s+;|&amp;quot\s*;/g, "&quot;")
      .replace(/&lt\s+;|&amp;lt\s*;/g, "&lt;")
      .replace(/&gt\s+;|&amp;gt\s*;/g, "&gt;")
      .replace(/&apos\s+;|&amp;apos\s*;/g, "&apos;");
  }

  static filterLine(line: string | null): boolean {
    let filter = false;
    if (isEmpty(line)) {
      filter = true;
    } else if ((line as string).indexOf("@IMAGE") !== -1 || (line as string).indexOf("@PAGE") !== -1) {
      filter = true;
    }
    return filter;
  }

  /**
   * The equivalent of String.replaceAll() for StringBuilder
   *
   * In TS we operate on a string (since StringBuilder isn't a primitive) and
   * return the new string; callers must reassign.
   */
  static replaceAll(sb: string, regex: string, replacement: string): string {
    const pattern = new RegExp(regex, "g");
    return sb.replace(pattern, replacement);
  }

  /**
   * Return the prefix of a string.
   */
  static prefix(s: string | null, count: number): string | null {
    if (s === null) {
      return null;
    }

    if (s.length < count) {
      return s;
    }

    return s.substring(0, count);
  }

  /**
   * Return the suffix of a string.
   */
  static suffix(s: string | null, count: number): string | null {
    if (s === null) {
      return null;
    }

    if (s.length < count) {
      return s;
    }

    return s.substring(s.length - count);
  }

  static JSONEncode(json: string): string {
    // we assume all json string will be bounded by double quotes
    return json.replace(/"/g, "\\\"").replace(/\n/g, "\\\n");
  }

  static strrep(c: string, times: number): string {
    const builder: string[] = [];
    for (let i = 0; i < times; i++) {
      builder.push(c);
    }
    return builder.join("");
  }

  static getOccCount(term: string, string: string): number {
    return countMatches(term, string);
  }

  /**
   * Test for the current string contains at least one digit.
   *
   * @param tok the string to be processed.
   * @return true if contains a digit
   */
  static test_digit(tok: string | null): boolean {
    if (tok === null) return false;
    if (tok.length === 0) return false;
    let a: string;
    for (let i = 0; i < tok.length; i++) {
      a = tok.charAt(i);
      if (isDigit(a)) return true;
    }
    return false;
  }

  /**
   * Useful for recognising an acronym candidate: check if a text is only
   * composed of upper case, dot and digit characters
   */
  static isAllUpperCaseOrDigitOrDot(text: string): boolean {
    for (let i = 0; i < text.length; i++) {
      const charAt = text.charAt(i);
      if (!isUpperCase(charAt) && !isDigit(charAt) && charAt !== ".") {
        return false;
      }
    }
    return true;
  }

  /**
   * Remove indicated leading and trailing characters from a string
   */
  static removeLeadingAndTrailingChars(text: string, leadingChars: string, trailingChars: string): string {
    text = stripStart(text, leadingChars);
    text = stripEnd(text, trailingChars);
    return text;
  }

  /**
   * Remove indicated leading and trailing characters from a string represented as a list of LayoutToken.
   * Indicated leading and trailing characters must be matching exactly the layout token text content.
   */
  static removeLeadingAndTrailingCharsLayoutTokens(
    tokens: LayoutToken[] | null,
    leadingChars: string,
    trailingChars: string,
  ): LayoutToken[] | null {
    if (tokens === null) return tokens;
    if (tokens.length === 0) return tokens;

    let start = 0;
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!;
      if (token.getText() === null || token.getText()!.length === 0) {
        start++;
        continue;
      } else if (token.getText()!.length > 1) {
        break;
      } else if (leadingChars.indexOf(token.getText()!) !== -1) {
        start++;
      } else break;
    }

    let end = tokens.length;
    for (let i = end; i > 0; i--) {
      const token = tokens[i - 1]!;
      if (token.getText() === null || token.getText()!.length === 0) {
        end--;
        continue;
      } else if (token.getText()!.length > 1) {
        break;
      } else if (trailingChars.indexOf(token.getText()!) !== -1) {
        end--;
      } else break;
    }

    if (start === end || end < start) {
      // we return an empty list
      return [];
    }

    return tokens.slice(start, end);
  }

  /**
   * Remove ad-hoc list of stopwords for extracted field
   */
  static removeFieldStopwords(text: string): string {
    const tokens: string[] = GrobidAnalyzer.getInstance().tokenize(text);
    const filteredTokens: string[] = [];
    for (const token of tokens) {
      if (TextUtilities.stopwords.indexOf(token) === -1) {
        filteredTokens.push(token);
      }
    }

    let finalText = filteredTokens.join("");
    finalText = finalText.replace(/'s/g, " ");
    finalText = finalText.replace(/,/g, " ");
    finalText = finalText.replace(/\./g, " ");
    finalText = finalText.replace(/( )+/g, " ");
    return finalText;
  }

  /**
   * Detect in a string possible trailing acronyms, introduced in parenthesis after a full name.
   * We can typically use it on the affiliation full name, but it can also be applied to longer
   * texts.
   *
   * Return a Map with an acronym position and the corresponding full name position
   */
  static acronymCandidates(tokens: LayoutToken[]): Map<OffsetPosition, OffsetPosition> | null {
    let acronyms: Map<OffsetPosition, OffsetPosition> | null = null;

    let openParenthesis = false;
    let posParenthesis = -1;
    let i = 0;
    let acronym: LayoutToken | null = null;
    for (const token of tokens) {
      if (token.getText() === null) {
        i++;
        continue;
      }
      if (token.getText() === "(") {
        openParenthesis = true;
        posParenthesis = i;
        acronym = null;
      } else if (token.getText() === ")") {
        openParenthesis = false;
      } else if (openParenthesis) {
        if (TextUtilities.isAllUpperCaseOrDigitOrDot(token.getText()!)) {
          acronym = token;
        } else {
          acronym = null;
        }
      }

      if ((acronym !== null) && (!openParenthesis)) {
        // check if this possible acronym matches an immediately preceding term
        let j = posParenthesis;
        let k = acronym.getText()!.length;
        let stop = false;
        while ((k > 0) && (!stop)) {
          k--;
          const c = acronym.getText()!.toLowerCase().charAt(k);
          while ((j > 0) && (!stop)) {
            j--;
            if (tokens[j] !== null && tokens[j] !== undefined) {
              const tok = tokens[j]!.getText()!;
              if (tok.trim().length === 0 || TextUtilities.delimiters.indexOf(tok) !== -1)
                continue;
              let numericMatch = false;
              if ((tok.length > 1) && isNumeric(tok)) {
                // when the token is all digit, it often appears in full as such in the
                // acronym (e.g. GDF15)
                const acronymCurrentPrefix = acronym.getText()!.substring(0, k + 1);
                //System.out.println("acronymCurrentPrefix: " + acronymCurrentPrefix);
                if (acronymCurrentPrefix.endsWith(tok)) {
                  // there is a full number match
                  k = k - tok.length + 1;
                  numericMatch = true;
                  //System.out.println("numericMatch is: " + numericMatch);
                }
              }

              if ((tok.toLowerCase().charAt(0) === c) || numericMatch) {
                if (k === 0) {
                  if (acronyms === null)
                    acronyms = new Map<OffsetPosition, OffsetPosition>();
                  const baseTokens: LayoutToken[] = [];
                  const builder: string[] = [];
                  for (let l = j; l < posParenthesis; l++) {
                    builder.push(String(tokens[l]));
                    baseTokens.push(tokens[l]!);
                  }
                  // builder is unused after construction; preserve upstream.
                  void builder;
                  void baseTokens;

                  const acronymPosition = new OffsetPosition();
                  acronymPosition.start = acronym.getOffset();
                  acronymPosition.end = acronym.getOffset() + acronym.getText()!.length;

                  const basePosition = new OffsetPosition();
                  basePosition.start = tokens[j]!.getOffset();
                  basePosition.end = tokens[j]!.getOffset() + acronym.getText()!.length;

                  acronyms.set(acronymPosition, basePosition);
                  stop = true;
                } else break;
              } else {
                stop = true;
              }
            }
          }
        }
        acronym = null;
        posParenthesis = -1;
      }
      i++;
    }
    return acronyms;
  }

  /**
   * Detect in a short string field a possible trailing acronyms, introduced in parenthesis after a full name.
   * We can typically use it on the affiliation full name.
   *
   * Return the token offset positions of the acronym and the corresponding full name, null otherwise
   */
  static fieldAcronymCandidate(tokens: LayoutToken[] | null): Pair<OffsetPosition, OffsetPosition> | null {
    if (tokens === null || tokens.length === 0)
      return null;

    let openParenthesis = false;
    let posParenthesis = -1;
    let i = 0;
    let acronym: LayoutToken | null = null;
    let acronymStartIndex = 0;
    let acronymPosition: OffsetPosition | null = null;
    let basePosition: OffsetPosition | null = null;
    for (const token of tokens) {
      if (token.getText() === null) {
        i++;
        continue;
      }
      if (token.getText() === "(") {
        openParenthesis = true;
        posParenthesis = i;
        acronym = null;
      } else if (token.getText() === ")") {
        openParenthesis = false;
      } else if (openParenthesis) {
        if (TextUtilities.isAllUpperCaseOrDigitOrDot(token.getText()!)) {
          acronym = token;
          acronymStartIndex = i;
        } else {
          acronym = null;
        }
      }

      if ((acronym !== null) && (!openParenthesis)) {
        acronymPosition = new OffsetPosition();
        acronymPosition.start = acronymStartIndex;
        acronymPosition.end = acronymStartIndex + 1;

        let j = posParenthesis;
        let stop = false;
        while ((j > 0) && (!stop)) {
          j--;
          const tok = tokens[j]!.getText()!;
          if (tok.trim().length === 0 || TextUtilities.delimiters.indexOf(tok) !== -1)
            continue;
          stop = true;
        }

        basePosition = new OffsetPosition();
        basePosition.start = 0;
        basePosition.end = j + 1;
      }

      i++;
    }

    if (acronymPosition !== null && basePosition !== null)
      return new Pair(acronymPosition, basePosition);
    else
      return null;
  }

  static matchTokenAndString(
    layoutTokens: LayoutToken[],
    text: string,
    positions: OffsetPosition[],
  ): OffsetPosition[] {
    const newPositions: OffsetPosition[] = [];
    let accumulator: string[] = [];
    let pos = 0;
    let textPositionOfToken = 0;

    for (const position of positions) {
      const annotationTokens = layoutTokens.slice(position.start, position.end);
      let first = true;
      accumulator = [];
      for (let i = 0; i < annotationTokens.length; i++) {
        const token = annotationTokens[i]!;
        if (isEmpty(token.getText())) continue;
        textPositionOfToken = text.indexOf(token.getText()!, pos);
        if (textPositionOfToken !== -1) {
          //We update pos only at the first token of the annotation positions
          if (first) {
            pos = textPositionOfToken;
            first = false;
          }
          accumulator.push(String(token));
        } else {
          if (SentenceUtilities.toSkipToken(token.getText()!)) {
            continue;
          }
          if (isNotEmpty(accumulator.join(""))) {
            const accumulatorText = accumulator.join("");
            const accumulatorTextLength = accumulatorText.length;
            const start = text.indexOf(accumulatorText, pos);
            const end = start + accumulatorTextLength;
            newPositions.push(new OffsetPosition(start, end));
            pos = end;
            break;
          }
          pos = textPositionOfToken;
        }
      }
      if (isNotEmpty(accumulator.join(""))) {
        const accumulatorText = accumulator.join("");
        const annotationTextLength = accumulatorText.length;
        const start = text.indexOf(accumulatorText, pos);
        const end = start + annotationTextLength;
        newPositions.push(new OffsetPosition(start, end));
        pos = end;
        accumulator = [];
      }
    }
    if (isNotEmpty(accumulator.join(""))) {
      const accumulatorText = accumulator.join("");
      const start = text.indexOf(accumulatorText, pos);
      newPositions.push(new OffsetPosition(start, start + accumulatorText.length));
    }

    return newPositions;
  }
}
