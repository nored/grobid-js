// Port of org.grobid.core.lexicon.FastMatcher.
// Upstream: grobid-core/src/main/java/org/grobid/core/lexicon/FastMatcher.java
//
// Class for fast matching of word sequences over text stream. The matcher
// stores terms in a trie (`Map<String, Map>` recursively, with `"#"` marking
// term-end nodes), and walks input tokens/characters maintaining a list of
// in-progress matches. All call paths return `OffsetPosition[]`.
//
// Several Java constructors take `File`/`InputStream` arguments and read the
// dictionary file on disk. Those are exposed here as `loadTerms(...)` methods
// that accept either a string of UTF-8 file contents or a list of lines, so
// the file I/O stays out of `src/grobid/` (see CONVENTIONS.md).

import { Analyzer } from "../analyzers/analyzer.js";
import { Language } from "../lang/language.js";
import { LayoutToken } from "../layout/layout-token.js";
import { OffsetPosition } from "../utilities/offset-position.js";
import { Pair } from "../utilities/pair.js";
import { TextUtilities } from "../utilities/text-utilities.js";
import { UnicodeUtil } from "../utilities/unicode-util.js";

/**
 * Legacy alias for the upstream `org.grobid.core.analyzers.Analyzer` interface.
 * Kept as a re-export so existing callers compile; prefer importing
 * `Analyzer` directly.
 */
export type FastMatcherAnalyzer = Analyzer;

/** English language tag used for the `tokenize(term, lang)` call on the analyzer. */
const EN_LANG = new Language(Language.EN, 1.0);

/** Trie node — recursive `Map<string, TrieNode>`, with `"#"` marking term end. */
type TrieNode = Map<string, TrieNode>;

/** `StringUtils.isBlank` equivalent — null/empty/all-whitespace. */
function isBlank(s: string | null | undefined): boolean {
  if (s === null || s === undefined || s.length === 0) return true;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    // Java Character.isWhitespace is broader, but this covers all the
    // characters reachable via FastMatcher inputs.
    if (c !== 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0b && c !== 0x0c && c !== 0x0d && c !== 0xa0) {
      // also treat any other Unicode whitespace as whitespace
      if (!/\s/.test(s.charAt(i))) return false;
    }
  }
  return true;
}

/** `StringUtils.normalizeSpace` equivalent — trim + collapse internal whitespace. */
function normalizeSpace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Java `StringTokenizer(text, delimiters, true)` — returns both tokens and
 * delimiters in source order. We mirror its splitting semantics exactly:
 * a run of non-delimiter chars is one token; each delimiter char is one token.
 */
function* stringTokenizerKeepDelims(text: string, delims: string): Generator<string> {
  let buf = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (delims.indexOf(ch) !== -1) {
      if (buf.length > 0) {
        yield buf;
        buf = "";
      }
      yield ch;
    } else {
      buf += ch;
    }
  }
  if (buf.length > 0) yield buf;
}

/**
 * Class for fast matching of word sequences over text stream.
 *
 * Upstream FastMatcher.java line 27-694.
 */
export class FastMatcher {
  // Upstream line 28: `private Map terms = null;`
  // Trie root. `null` matches upstream's initial state; we lazy-init on first
  // use exactly like upstream.
  private terms: TrieNode | null = null;

  // Upstream line 219: `private static String delimiters = TextUtilities.delimiters;`
  private static readonly delimiters: string = TextUtilities.delimiters;

  /**
   * Default constructor — upstream line 30-34.
   *
   * Note: upstream also offers `(File)`, `(File, Analyzer)`, `(File, Analyzer,
   * boolean)`, `(InputStream)`, `(InputStream, Analyzer)`, `(InputStream,
   * Analyzer, boolean)` overloads that immediately call `loadTerms`. In the
   * JS port we keep the constructor argument-less and offer separate
   * `loadTerms*` entry points, because we don't do disk I/O inside
   * `src/grobid/`.
   */
  constructor() {
    if (this.terms === null) {
      this.terms = new Map();
    }
  }

  /**
   * Load a set of terms to the fast matcher from a string containing the
   * complete UTF-8 contents of a term list file, one term per line.
   *
   * Upstream line 111-114, `loadTerms(File file)`:
   * ```java
   * public int loadTerms(File file) throws IOException {
   *     InputStream fileIn = new FileInputStream(file);
   *     return loadTerms(fileIn, GrobidAnalyzer.getInstance(), false);
   * }
   * ```
   */
  loadTerms(contents: string, analyzer: Analyzer, caseSensitive?: boolean): number;
  /**
   * Upstream line 119-122 and 127-130, the `caseSensitive` and `analyzer`
   * overloads, collapsed into the single signature above.
   */
  loadTerms(contents: string, analyzer: Analyzer, caseSensitive: boolean = false): number {
    if (this.terms === null) {
      this.terms = new Map();
    }
    let nbTerms = 0;
    // Upstream line 140-156: read line by line.
    // Java BufferedReader splits on \n / \r\n / \r; mirror that.
    const lines = contents.split(/\r\n|\r|\n/);
    for (const rawLine of lines) {
      if (rawLine.length === 0) continue;
      let line: string = UnicodeUtil.normaliseText(rawLine) ?? "";
      line = normalizeSpace(line);
      if (!caseSensitive) line = line.toLowerCase();
      nbTerms += this.loadTerm(line, analyzer, true, true);
    }
    return nbTerms;
  }

  /**
   * Load a term to the fast matcher.
   *
   * Upstream line 164-217 (three overloads collapsed): defaults are
   * `ignoreDelimiters=true` (upstream line 164-166) and `caseSensitive=true`
   * (upstream line 172-174).
   */
  loadTerm(
    term: string,
    analyzer: Analyzer,
    ignoreDelimiters: boolean = true,
    caseSensitive: boolean = true,
  ): number {
    let nbTerms = 0;
    if (isBlank(term)) return 0;
    let t: TrieNode = this.terms!;
    // Upstream line 185: `analyzer.tokenize(term, new Language("en", 1.0));`
    const tokens: string[] = analyzer.tokenize(term, EN_LANG);
    for (let token of tokens) {
      if (token.length === 0) continue;
      if (token === " " || token === "\n") continue;
      if (ignoreDelimiters && FastMatcher.delimiters.indexOf(token) !== -1) continue;
      if (!caseSensitive) token = token.toLowerCase();
      let t2 = t.get(token);
      if (t2 === undefined) {
        t2 = new Map<string, TrieNode>();
        t.set(token, t2);
      }
      t = t2;
    }
    // end of the term — upstream line 207-215.
    if (t !== this.terms) {
      let t2 = t.get("#");
      if (t2 === undefined) {
        t2 = new Map<string, TrieNode>();
        t.set("#", t2);
      }
      nbTerms++;
      // upstream line 214: `t = terms;` — purely cosmetic in upstream (t is
      // local and goes out of scope), preserved here for fidelity.
      t = this.terms!;
    }
    return nbTerms;
  }

  /**
   * Identify terms in a piece of text and gives corresponding token positions.
   * All the matches are returned.
   *
   * Upstream line 228-318 (`matchToken(String)` + `matchToken(String, boolean)`).
   */
  matchToken(text: string, caseSensitive: boolean = false): OffsetPosition[] {
    const results: OffsetPosition[] = [];
    let startPos: number[] = [];
    let lastNonSeparatorPos: number[] = [];
    let t: TrieNode[] = [];
    let currentPos = 0;

    for (let token of stringTokenizerKeepDelims(text, FastMatcher.delimiters)) {
      if (token === " " || token === "\n") continue;
      if (FastMatcher.delimiters.indexOf(token) !== -1) {
        currentPos++;
        continue;
      }
      if (!caseSensitive) token = token.toLowerCase();

      // we try to complete opened matching
      let i = 0;
      const new_t: TrieNode[] = [];
      const new_startPos: number[] = [];
      const new_lastNonSeparatorPos: number[] = [];
      // continuation of current opened matching
      for (const tt of t) {
        const t2 = tt.get(token);
        if (t2 !== undefined) {
          new_t.push(t2);
          new_startPos.push(startPos[i]!);
          new_lastNonSeparatorPos.push(currentPos);
        }
        // else (upstream comments out the `else` but the block runs unconditionally — preserved verbatim)
        {
          const t2b = tt.get("#");
          if (t2b !== undefined) {
            // end of the current term, matching sucesssful
            const ofp = new OffsetPosition();
            ofp.start = startPos[i]!;
            ofp.end = lastNonSeparatorPos[i]!;
            results.push(ofp);
          }
        }
        i++;
      }

      // we start new matching starting at the current token
      const t2 = this.terms!.get(token);
      if (t2 !== undefined) {
        new_t.push(t2);
        new_startPos.push(currentPos);
        new_lastNonSeparatorPos.push(currentPos);
      }

      t = new_t;
      startPos = new_startPos;
      lastNonSeparatorPos = new_lastNonSeparatorPos;
      currentPos++;
    }

    // test if the end of the string correspond to the end of a term
    let i = 0;
    // upstream line 303: `if (t != null)` — t is never null here in our port
    // (we initialise to []), but mirror the guard semantically.
    for (const tt of t) {
      const t2 = tt.get("#");
      if (t2 !== undefined) {
        const ofp = new OffsetPosition();
        ofp.start = startPos[i]!;
        ofp.end = lastNonSeparatorPos[i]!;
        results.push(ofp);
      }
      i++;
    }

    return results;
  }

  /**
   * Identify terms in a piece of text and gives corresponding token positions.
   * All the matches are returned. Here the input is a list of LayoutToken object.
   *
   * Upstream line 342-435 (`matchLayoutToken(List<LayoutToken>)` plus the
   * `(tokens, ignoreDelimiters, caseSensitive)` overload).
   */
  matchLayoutToken(
    tokens: LayoutToken[] | null | undefined,
    ignoreDelimiters: boolean = true,
    caseSensitive: boolean = false,
  ): OffsetPosition[] {
    // CollectionUtils.isEmpty(tokens) — upstream line 356-358.
    if (tokens === null || tokens === undefined || tokens.length === 0) {
      return [];
    }

    const results: OffsetPosition[] = [];
    let startPosition: number[] = [];
    let lastNonSeparatorPos: number[] = [];
    let currentMatches: TrieNode[] = [];
    let currentPos = 0;

    for (const token of tokens) {
      const text = token.getText();
      if (text === " " || text === "\n") {
        currentPos++;
        continue;
      }

      if (ignoreDelimiters && text !== null && FastMatcher.delimiters.indexOf(text) !== -1) {
        currentPos++;
        continue;
      }

      let tokenText: string = UnicodeUtil.normaliseText(text) ?? "";
      if (!caseSensitive) tokenText = tokenText.toLowerCase();

      // we try to complete opened matching
      let i = 0;
      const matchesTreeList: TrieNode[] = [];
      const matchesPosition: number[] = [];
      const new_lastNonSeparatorPos: number[] = [];

      // we check whether the current token matches as continuation of a previous match.
      for (const currentMatch of currentMatches) {
        const childMatches = currentMatch.get(tokenText);
        if (childMatches !== undefined) {
          matchesTreeList.push(childMatches);
          matchesPosition.push(startPosition[i]!);
          new_lastNonSeparatorPos.push(currentPos);
        }

        // check if the token itself is present, I add the match in the list of results
        const childMatchesEnd = currentMatch.get("#");
        if (childMatchesEnd !== undefined) {
          // end of the current term, matching successful
          const ofp = new OffsetPosition(startPosition[i]!, lastNonSeparatorPos[i]!);
          results.push(ofp);
        }

        i++;
      }

      // we start new matching starting at the current token
      const match = this.terms!.get(tokenText);
      if (match !== undefined) {
        matchesTreeList.push(match);
        matchesPosition.push(currentPos);
        new_lastNonSeparatorPos.push(currentPos);
      }

      currentMatches = matchesTreeList;
      startPosition = matchesPosition;
      lastNonSeparatorPos = new_lastNonSeparatorPos;
      currentPos++;
    }

    // test if the end of the string correspond to the end of a term
    let i = 0;
    for (const tt of currentMatches) {
      const t2 = tt.get("#");
      if (t2 !== undefined) {
        const ofp = new OffsetPosition(startPosition[i]!, lastNonSeparatorPos[i]!);
        results.push(ofp);
      }
      i++;
    }

    return results;
  }

  /**
   * Gives the character positions within a text where matches occur.
   * <p>
   * By iterating over the OffsetPosition and applying substring, we get all the matches.
   * <p>
   * All the matches are returned.
   *
   * Upstream line 449-543 (`matchCharacter(String)` + `matchCharacter(String, boolean)`).
   */
  matchCharacter(text: string, caseSensitive: boolean = false): OffsetPosition[] {
    const results: OffsetPosition[] = [];
    let startPosition: number[] = [];
    let lastNonSeparatorPos: number[] = [];
    let currentMatches: TrieNode[] = [];
    let currentPos = 0;

    for (let token of stringTokenizerKeepDelims(text, FastMatcher.delimiters)) {
      if (token === " ") {
        currentPos++;
        continue;
      }
      if (FastMatcher.delimiters.indexOf(token) !== -1) {
        currentPos++;
        continue;
      }
      if (!caseSensitive) token = token.toLowerCase();

      // we try to complete opened matching
      let i = 0;
      const matchesTreeList: TrieNode[] = [];
      const matchesPosition: number[] = [];
      const new_lastNonSeparatorPos: number[] = [];

      for (const currentMatch of currentMatches) {
        const childMatches = currentMatch.get(token);
        if (childMatches !== undefined) {
          matchesTreeList.push(childMatches);
          matchesPosition.push(startPosition[i]!);
          new_lastNonSeparatorPos.push(currentPos + token.length);
        }

        const childMatchesEnd = currentMatch.get("#");
        if (childMatchesEnd !== undefined) {
          const ofp = new OffsetPosition(startPosition[i]!, lastNonSeparatorPos[i]!);
          results.push(ofp);
        }

        i++;
      }

      // TODO: e.g. The Bronx matches 'The Bronx' and 'Bronx' is this correct?  (upstream comment)

      // we start new matching starting at the current token
      const match = this.terms!.get(token);
      if (match !== undefined) {
        matchesTreeList.push(match);
        matchesPosition.push(currentPos);
        new_lastNonSeparatorPos.push(currentPos + token.length);
      }

      currentMatches = matchesTreeList;
      startPosition = matchesPosition;
      lastNonSeparatorPos = new_lastNonSeparatorPos;
      currentPos += token.length;
    }

    // test if the end of the string correspond to the end of a term
    let i = 0;
    for (const tt of currentMatches) {
      const t2 = tt.get("#");
      if (t2 !== undefined) {
        const ofp = new OffsetPosition(startPosition[i]!, lastNonSeparatorPos[i]!);
        results.push(ofp);
      }
      i++;
    }

    return results;
  }

  /**
   * Gives the character positions within a tokenized text where matches occur.
   * <p>
   * All the matches are returned.
   *
   * Upstream line 555-646 (`matchCharacterLayoutToken(List<LayoutToken>)` plus
   * the case-sensitive overload).
   */
  matchCharacterLayoutToken(tokens: LayoutToken[], caseSensitive: boolean = false): OffsetPosition[] {
    const results: OffsetPosition[] = [];
    let startPosition: number[] = [];
    let lastNonSeparatorPos: number[] = [];
    let currentMatches: TrieNode[] = [];
    let currentPos = 0;

    for (const token of tokens) {
      const text = token.getText();
      if (text === " ") {
        currentPos++;
        continue;
      }
      if (text !== null && FastMatcher.delimiters.indexOf(text) !== -1) {
        currentPos++;
        continue;
      }
      let tokenString: string = text ?? "";
      if (!caseSensitive) tokenString = tokenString.toLowerCase();

      let i = 0;
      const matchesTreeList: TrieNode[] = [];
      const matchesPosition: number[] = [];
      const new_lastNonSeparatorPos: number[] = [];

      for (const currentMatch of currentMatches) {
        const childMatches = currentMatch.get(tokenString);
        if (childMatches !== undefined) {
          matchesTreeList.push(childMatches);
          matchesPosition.push(startPosition[i]!);
          new_lastNonSeparatorPos.push(currentPos);
        }

        const childMatchesEnd = currentMatch.get("#");
        if (childMatchesEnd !== undefined) {
          const ofp = new OffsetPosition(startPosition[i]!, lastNonSeparatorPos[i]!);
          results.push(ofp);
        }

        i++;
      }

      const match = this.terms!.get(tokenString);
      if (match !== undefined) {
        matchesTreeList.push(match);
        matchesPosition.push(currentPos);
        new_lastNonSeparatorPos.push(currentPos);
      }

      currentMatches = matchesTreeList;
      startPosition = matchesPosition;
      lastNonSeparatorPos = new_lastNonSeparatorPos;
      currentPos++;
    }

    let i = 0;
    for (const tt of currentMatches) {
      const t2 = tt.get("#");
      if (t2 !== undefined) {
        const ofp = new OffsetPosition(startPosition[i]!, lastNonSeparatorPos[i]!);
        results.push(ofp);
      }
      i++;
    }

    return results;
  }

  /**
   * Identify terms in a piece of text and gives corresponding token positions.
   * All the matches are returned. This case correspond to text from a trainer,
   * where the text is already tokenized with some labeled that can be ignored.
   *
   * Upstream line 657-677 (`matcherPairs` + `matcherPairs(_, caseSensitive)`).
   */
  matcherPairs(tokens: Pair<string, string>[], caseSensitive: boolean = false): OffsetPosition[] {
    const parts: string[] = [];
    for (const tokenP of tokens) {
      const token = tokenP.getA();
      parts.push(this.processToken(token));
    }
    return this.matchToken(parts.join(""), caseSensitive);
  }

  /**
   * Process token, if different than @newline.
   *
   * Upstream line 682-693.
   */
  protected processToken(token: string): string {
    if (token.trim() !== "@newline") {
      let ind = token.indexOf(" ");
      if (ind === -1) ind = token.indexOf("\t");
      if (ind === -1) return " " + token;
      else return " " + token.substring(0, ind);
    }
    return "";
  }
}
