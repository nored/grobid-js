// Port of org.grobid.core.utilities.LayoutTokensUtil.
// Upstream: grobid-core/src/main/java/org/grobid/core/utilities/LayoutTokensUtil.java

import type { BoundingBox } from "../layout/bounding-box.js";
import { LayoutToken } from "../layout/layout-token.js";
import { BoundingBoxCalculator } from "./bounding-box-calculator.js";

/** `normalizeSpace` mirroring Apache commons-lang3 `StringUtils.normalizeSpace`. */
function normalizeSpace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function isAllLowerCase(s: string): boolean {
  if (s.length === 0) return false;
  for (const ch of s) {
    if (ch !== ch.toLowerCase() || !/\p{L}/u.test(ch)) {
      if (/\p{L}/u.test(ch)) return false;
    }
  }
  // Stricter: must contain at least one letter and no uppercase letters.
  return /\p{L}/u.test(s) && s === s.toLowerCase();
}

function isAlpha(s: string): boolean {
  if (s.length === 0) return false;
  return /^\p{L}+$/u.test(s);
}

export class LayoutTokensUtil {
  /** Function-equivalent helper; matches upstream's `TO_TEXT_FUNCTION`. */
  static readonly TO_TEXT_FUNCTION = (t: LayoutToken): string => t.t() ?? "";

  /**
   * Walk the token list, marking each token that is immediately followed by
   * "\n" with `newLineAfter=true`, and rewriting "\n" tokens themselves to " ".
   * Returns the same list (mutated in place, matching upstream).
   */
  static enrichWithNewLineInfo(toks: LayoutToken[]): LayoutToken[] {
    for (let i = 0; i < toks.length; i++) {
      const cur = toks[i]!;
      const peek = toks[i + 1];
      if (peek !== undefined && peek.getText() === "\n") {
        cur.setNewLineAfter(true);
      }
      if (cur.getText() === "\n") {
        cur.setText(" ");
      }
    }
    return toks;
  }

  /** Normalize: replace "\n" with " ", then collapse runs of whitespace. */
  static normalizeText(input: string | LayoutToken[]): string {
    if (typeof input === "string") {
      return normalizeSpace(input.replace(/\n/g, " "));
    }
    return normalizeSpace(LayoutTokensUtil.toText(input).replace(/\n/g, " "));
  }

  static normalizeDehyphenizeText(tokens: LayoutToken[]): string {
    return normalizeSpace(LayoutTokensUtil.toText(LayoutTokensUtil.dehyphenize(tokens)).replace(/\n/g, " "));
  }

  static toText(tokens: LayoutToken[]): string {
    let out = "";
    for (const t of tokens) {
      const s = t.t();
      if (s !== null) out += s;
    }
    return out;
  }

  static noCoords(t: LayoutToken): boolean {
    return t.getPage() === -1 || t.getWidth() <= 0;
  }

  static spaceyToken(tok: string): boolean {
    return tok === " ";
  }

  static newLineToken(tok: string): boolean {
    return tok === "\n";
  }

  static containsToken(toks: LayoutToken[], text: string): boolean {
    for (const t of toks) {
      if (text === t.t()) return true;
    }
    return false;
  }

  static tokenPos(toks: LayoutToken[], text: string | RegExp): number {
    if (text instanceof RegExp) {
      for (let i = 0; i < toks.length; i++) {
        const s = toks[i]!.t();
        if (s !== null && text.test(s)) return i;
      }
      return -1;
    }
    for (let i = 0; i < toks.length; i++) {
      if (text === toks[i]!.t()) return i;
    }
    return -1;
  }

  static split(
    toks: LayoutToken[],
    p: RegExp,
    preserveSeparator: boolean,
    preserveLeftOvers = true,
  ): LayoutToken[][] {
    const result: LayoutToken[][] = [];
    let cur: LayoutToken[] = [];
    for (const tok of toks) {
      const s = tok.t() ?? "";
      if (p.test(s)) {
        if (preserveSeparator) cur.push(tok);
        result.push(cur);
        cur = [];
      } else {
        cur.push(tok);
      }
    }
    if (preserveLeftOvers && cur.length > 0) result.push(cur);
    return result;
  }

  static tooFarAwayVertically(boxes: BoundingBox[] | null, distance: number): boolean {
    if (boxes === null) return false;
    for (let i = 0; i < boxes.length - 1; i++) {
      if (boxes[i]!.verticalDistanceTo(boxes[i + 1]!) > distance) return true;
    }
    return false;
  }

  static getCoordsString(toks: LayoutToken[]): string {
    const res = BoundingBoxCalculator.calculate(toks);
    return res.map((b) => b.toString()).join(";");
  }

  static getCoordsStringForOneBox(toks: LayoutToken[]): string | null {
    const res = BoundingBoxCalculator.calculateOneBox(toks, true);
    return res?.toString() ?? null;
  }

  /**
   * Join hyphen-broken words across line boundaries. For each "-" token we
   * peek backward and forward; if both neighbors look like a single word
   * split by a soft hyphen at end of line, we drop the hyphen + intervening
   * whitespace/newline. Otherwise the hyphen is kept and only intervening
   * newlines are removed.
   */
  static dehyphenize(tokens: LayoutToken[]): LayoutToken[] {
    const output: LayoutToken[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const current = tokens[i]!;
      if (current.getText() === "-" && !(current.isSubscript() || current.isSuperscript())) {
        if (LayoutTokensUtil.doesRequireDehyphenisation(tokens, i)) {
          // Strip trailing whitespace tokens already emitted to output.
          let z = output.length - 1;
          while (z >= 0 && output[z]!.getText() === " ") {
            output.pop();
            z--;
          }
          // Advance past intervening newlines and spaces.
          let j = i + 1;
          let consumed = 0;
          while (j < tokens.length && (tokens[j]!.getText() === " " || tokens[j]!.getText() === "\n")) {
            consumed++;
            j++;
          }
          i += consumed;
        } else {
          output.push(current);
          let j = i + 1;
          let consumed = 0;
          while (j < tokens.length && tokens[j]!.getText() === "\n") {
            consumed++;
            j++;
          }
          i += consumed;
        }
      } else {
        output.push(current);
      }
    }
    return output;
  }

  /**
   * Heuristic: at position `i` (a "-" token), look backward and forward for
   * the next alphabetic tokens. If a line break is in between, and both
   * neighbors look like word fragments, the hyphen joins a word split across
   * a line — return true so the caller drops it.
   */
  static doesRequireDehyphenisation(tokens: LayoutToken[], i: number): boolean {
    let forward = false;
    let backward = false;
    let j = i + 1;
    let breakLine = 0;
    let spacesAfter = 0;
    const coordinateY = tokens[i]!.getY();
    while (j < tokens.length && (tokens[j]!.getText() === " " || tokens[j]!.getText() === "\n")) {
      const tt = tokens[j]!.getText();
      if (tt === "\n") {
        breakLine++;
      } else if (tt === " ") {
        spacesAfter++;
      } else if (tokens[j]!.getY() > coordinateY) {
        breakLine++;
      }
      j++;
    }
    if (breakLine === 0) {
      // Check if there's a break-line via coordinates; if not, no dehyphenation.
      if (j < tokens.length && tokens[j]!.getY() === coordinateY) {
        return false;
      }
    }
    if (j < tokens.length) {
      forward = isAllLowerCase(tokens[j]!.getText() ?? "");
      if (forward) {
        if (i < 1) return forward;
        if (tokens[j]!.getY() > coordinateY) return forward;
        let z = i - 1;
        while (z > 0 && (tokens[z]!.getText() === " " || tokens[z]!.getText() === "\n")) {
          z--;
        }
        if (isAlpha(tokens[z]!.getText() ?? "")) {
          if (tokens[z]!.getY() < coordinateY) {
            backward = true;
          } else if (coordinateY === -1 && breakLine > 0) {
            backward = true;
          }
        }
      }
    }
    // unused `spacesAfter` mirrors upstream's tracked-but-unused variable.
    void spacesAfter;
    return backward;
  }

  static subListByOffset(token: LayoutToken[], startIncluded: number, endExcluded: number = Number.MAX_SAFE_INTEGER): LayoutToken[] {
    return token.filter((t) => t.getOffset() >= startIncluded && t.getOffset() < endExcluded);
  }

  static getLayoutTokensForTokenizedText(tokens: string[]): LayoutToken[] {
    const result: LayoutToken[] = [];
    let pos = 0;
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i]!;
      const lt = new LayoutToken();
      lt.setText(tok);
      lt.setOffset(pos);
      result.push(lt);
      pos += tok.length;
      if (i < tokens.length - 1 && tokens[i + 1] === "\n") {
        lt.setNewLineAfter(true);
      }
    }
    return result;
  }
}
