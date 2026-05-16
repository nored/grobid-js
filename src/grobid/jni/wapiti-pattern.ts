// Port of the C `pattern` module from upstream Wapiti (v1.5.0).
// Upstream: upstream/wapiti/pattern.{c,h}
//
// Contains both the home-grown regex matcher (`rex_match*`) and the pattern
// compiler/executor (`pat_comp`, `pat_exec`). Patterns are the heart of input
// transformation: every line of `pat_comp` and `pat_exec` is preserved here,
// including the boundary-token markers ("_x-1", "_x+#", etc.), the absolute
// vs relative offset bookkeeping, and the `caps` lowercasing fallthrough.

/**
 * Mirrors C `tok_t` (sequence.h:93-99). At each row `t`, `toks[t]` is a list
 * of `cnts[t]` string columns. The label column (when present) is moved into
 * `lbl[t]` before pattern application by `rdr_raw2seq`.
 */
export interface TokT {
  len: number;          // T
  lbl: (string | null)[] | null;  // [T] labels, or null when unlabelled
  cnts: number[];       // [T] column counts
  toks: string[][];     // [T][cnts[t]] column tokens
}

/** Compiled pattern item — mirrors C `struct pat_item_s` (pattern.h:42-50). */
export interface PatItemT {
  type: "s" | "x" | "t" | "m";
  caps: boolean;
  value: string | null; // 's' segment text, or regex for 't'/'m'
  absolute: boolean;
  offset: number;
  column: number;
}

/** Compiled pattern — mirrors C `struct pat_s` (pattern.h:38-50). */
export interface PatT {
  src: string;
  ntoks: number;
  nitems: number;
  items: PatItemT[];
}

// =====================================================================
//  Regex matcher
// =====================================================================
//
// Subset implemented (verbatim, pattern.c:38-67):
//   match-set:    .  \x  x
//     classes:    \d \a \w \l \u \p \s     (uppercase = complement)
//   constructs:   ^  $  *  ?

function isAlpha(c: number): boolean {
  return (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
}
function isDigit(c: number): boolean {
  return c >= 0x30 && c <= 0x39;
}
function isLower(c: number): boolean {
  return c >= 0x61 && c <= 0x7a;
}
function isUpper(c: number): boolean {
  return c >= 0x41 && c <= 0x5a;
}
function isSpace(c: number): boolean {
  // C isspace covers ' ', '\t', '\n', '\v', '\f', '\r'.
  return (
    c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0b || c === 0x0c || c === 0x0d
  );
}
function isPunct(c: number): boolean {
  // C isupper/etc are locale dependent; in the "C" locale (which wapiti sets
  // via setlocale(LC_ALL, "C")) ispunct returns true for any printable byte
  // that is not space and not alnum. We mirror that interpretation.
  if (c < 0x21 || c > 0x7e) return false;
  if (isAlpha(c) || isDigit(c)) return false;
  return true;
}
function isAlnum(c: number): boolean {
  return isAlpha(c) || isDigit(c);
}

/** Port of `rex_matchit` (pattern.c:74-99). */
function rexMatchit(re: string, rePos: number, str: string, strPos: number): boolean {
  if (strPos >= str.length) return false;
  const ch0 = re.charCodeAt(rePos);
  const sb = str.charCodeAt(strPos);
  if (ch0 === 0x2e /* '.' */) return true;
  if (ch0 === 0x5c /* '\\' */) {
    const ch1 = re.charCodeAt(rePos + 1);
    switch (ch1) {
      case 0x61: return isAlpha(sb);  // 'a'
      case 0x64: return isDigit(sb);  // 'd'
      case 0x6c: return isLower(sb);  // 'l'
      case 0x70: return isPunct(sb);  // 'p'
      case 0x73: return isSpace(sb);  // 's'
      case 0x75: return isUpper(sb);  // 'u'
      case 0x77: return isAlnum(sb);  // 'w'
      case 0x41: return !isAlpha(sb); // 'A'
      case 0x44: return !isDigit(sb); // 'D'
      case 0x4c: return !isLower(sb); // 'L'
      case 0x50: return !isPunct(sb); // 'P'
      case 0x53: return !isSpace(sb); // 'S'
      case 0x55: return !isUpper(sb); // 'U'
      case 0x57: return !isAlnum(sb); // 'W'
    }
    return ch1 === sb;
  }
  return ch0 === sb;
}

/**
 * Port of `rex_matchme` (pattern.c:106-148). Returns `[matched, lenAfter]`.
 * The C code mutates `*len`; we keep the same semantics by returning the new
 * length out-of-band.
 */
function rexMatchme(re: string, rePos: number, str: string, strPos: number, len: number): [boolean, number] {
  // End of regexp check.
  if (rePos >= re.length || re.charCodeAt(rePos) === 0) return [true, len];
  if (re.charCodeAt(rePos) === 0x24 /* '$' */ && rePos + 1 >= re.length) {
    return [strPos >= str.length, len];
  }
  // Get first char of regexp + position of the next item (re + 1 + (esc?1:0)).
  let nxt = rePos + 1;
  if (re.charCodeAt(rePos) === 0x5c /* '\\' */) nxt++;
  const chCode = re.charCodeAt(rePos);
  // Reject unescaped repetition/optional operator at start.
  if (chCode === 0x2a /* '*' */ || chCode === 0x3f /* '?' */) {
    throw new Error("unescaped * or ? in regexp: " + re);
  }
  // Star repetition. Mirrors C's do-while where `str++` post-increments:
  //   do {
  //     save = *len;
  //     if (rex_matchme(nxt, str, len)) return true;
  //     *len = save + 1;
  //   } while (rex_matchit(ch, str++));
  if (re.charCodeAt(nxt) === 0x2a /* '*' */) {
    nxt++;
    let s = strPos;
    while (true) {
      const save = len;
      const [ok, newLen] = rexMatchme(re, nxt, str, s, save);
      if (ok) return [true, newLen];
      len = save + 1;
      // post-increment: test rex_matchit(ch, s), then s++.
      const cont = rexMatchit(re, rePos, str, s);
      s++;
      if (!cont) break;
    }
    return [false, len];
  }
  // Optional.
  if (re.charCodeAt(nxt) === 0x3f /* '?' */) {
    nxt++;
    if (rexMatchit(re, rePos, str, strPos)) {
      len++;
      const [ok, newLen] = rexMatchme(re, nxt, str, strPos + 1, len);
      if (ok) return [true, newLen];
      len--;
    }
    return rexMatchme(re, nxt, str, strPos, len);
  }
  // Classical char match.
  len++;
  if (rexMatchit(re, rePos, str, strPos)) {
    return rexMatchme(re, nxt, str, strPos + 1, len);
  }
  return [false, len];
}

/**
 * Port of `rex_match` (pattern.c:155-172). Returns `[matchStart, matchLen]`
 * or `[-1, 0]` on no match.
 */
export function rexMatch(re: string, str: string): [number, number] {
  if (re.length > 0 && re.charCodeAt(0) === 0x5e /* '^' */) {
    const [ok, len] = rexMatchme(re, 1, str, 0, 0);
    if (ok) return [0, len];
    return [-1, 0];
  }
  let pos = 0;
  while (true) {
    const [ok, len] = rexMatchme(re, 0, str, pos, 0);
    if (ok) return [pos, len];
    if (pos >= str.length) break;
    pos++;
  }
  return [-1, 0];
}

// =====================================================================
//  Pattern compiler / executor
// =====================================================================

/**
 * Port of `pat_comp` (pattern.c:214-304).
 *
 * Parses a pattern source string into a list of items. The compiler is
 * stateful and uses sscanf-style format parsing; we replicate the same
 * tokenization logic by hand because JS has no sscanf.
 */
export function patComp(p: string): PatT {
  // Over-allocate based on '%' count (upstream allocates `mitems*2+1`). We
  // just collect into a JS array so this is for fidelity only.
  let _mitems = 0;
  for (let pos = 0; pos < p.length; pos++) if (p.charCodeAt(pos) === 0x25) _mitems++;
  _mitems = _mitems * 2 + 1;
  void _mitems;

  const items: PatItemT[] = [];
  let ntoks = 0;
  let pos = 0;
  while (pos < p.length) {
    if (p.charCodeAt(pos) === 0x25 /* '%' */) {
      // Command: %<type>[<offset>,<col>] or %<type>[<offset>,<col>,"regex"].
      const rawType = p.charCodeAt(pos + 1);
      const typeChar = String.fromCharCode(rawType | 0x20); // tolower
      if (typeChar !== "x" && typeChar !== "t" && typeChar !== "m") {
        throw new Error("unknown command type: '" + typeChar + "'");
      }
      const caps = String.fromCharCode(rawType) !== typeChar;
      pos += 2;
      // Parse [@?<off>,<col>...
      let absolute = false;
      if (p[pos] !== "[") throw new Error("invalid pattern: " + p);
      pos++; // consume '['
      if (p[pos] === "@") {
        absolute = true;
        pos++;
      }
      // Parse signed int offset.
      const offStart = pos;
      if (p[pos] === "+" || p[pos] === "-") pos++;
      while (pos < p.length && p.charCodeAt(pos) >= 0x30 && p.charCodeAt(pos) <= 0x39) pos++;
      const offStr = p.slice(offStart, pos);
      if (!/^[-+]?\d+$/.test(offStr)) throw new Error("invalid pattern: " + p);
      const off = parseInt(offStr, 10);
      if (p[pos] !== ",") throw new Error("invalid pattern: " + p);
      pos++; // consume ','
      // Parse unsigned int column.
      const colStart = pos;
      while (pos < p.length && p.charCodeAt(pos) >= 0x30 && p.charCodeAt(pos) <= 0x39) pos++;
      const colStr = p.slice(colStart, pos);
      if (!/^\d+$/.test(colStr)) throw new Error("invalid pattern: " + p);
      const col = parseInt(colStr, 10);
      ntoks = Math.max(ntoks, col);
      // Regex argument (only for 't'/'m').
      let value: string | null = null;
      if (typeChar === "t" || typeChar === "m") {
        if (p[pos] !== "," && p[pos + 1] !== '"') {
          throw new Error("missing arg in pattern: " + p);
        }
        pos += 2; // skip ,"
        const start = pos;
        while (pos < p.length) {
          if (p[pos] === '"') break;
          if (p[pos] === "\\" && pos + 1 < p.length) pos++;
          pos++;
        }
        if (p[pos] !== '"') throw new Error("unended argument: " + p);
        value = p.slice(start, pos);
        pos++; // consume '"'
      }
      if (p[pos] !== "]") throw new Error("missing end of pattern: " + p);
      pos++; // consume ']'
      items.push({
        type: typeChar as PatItemT["type"],
        caps,
        value,
        absolute,
        offset: off,
        column: col,
      });
    } else {
      // Plain text segment until next '%' or end.
      const start = pos;
      while (pos < p.length && p.charCodeAt(pos) !== 0x25) pos++;
      items.push({
        type: "s",
        caps: false,
        value: p.slice(start, pos),
        absolute: false,
        offset: 0,
        column: 0,
      });
    }
  }
  return { src: p, ntoks, nitems: items.length, items };
}

/**
 * Port of `pat_exec` (pattern.c:312-387).
 *
 * Returns the observation string, or `null` to mirror C's `return NULL` path
 * triggered by "missing tokens, cannot apply pattern" — kept so the caller
 * (`rdr_pattok2seq`) can mirror its error-cascade behaviour.
 */
export function patExec(pat: PatT, tok: TokT, at: number): string | null {
  // C's static arrays for boundary markers.
  const bval = ["_x-1", "_x-2", "_x-3", "_x-4", "_x-#"];
  const eval_ = ["_x+1", "_x+2", "_x+3", "_x+4", "_x+#"];
  const T = tok.len;
  const out: string[] = [];

  for (let it = 0; it < pat.nitems; it++) {
    const item = pat.items[it];
    if (!item) continue;
    let value: string | null = null;
    let len = 0;

    // Retrieve token at the referenced position (for non-'s' items).
    if (item.type !== "s") {
      let p = item.offset;
      if (item.absolute) {
        // C: if (offset<0) pos += T; else pos--;
        if (item.offset < 0) p += T;
        else p -= 1;
      } else {
        p += at;
      }
      const col = item.column;
      if (p < 0) {
        value = bval[Math.min(-p - 1, 4)] ?? "_x-#";
      } else if (p >= T) {
        value = eval_[Math.min(p - T, 4)] ?? "_x+#";
      } else if (col >= tok.cnts[p]!) {
        // Upstream: `free(buffer); warning(...); return NULL;` — propagate.
        // (See `rdr_pattok2seq` which then frees the seq and returns NULL.)
        return null;
      } else {
        value = tok.toks[p]![col]!;
      }
    }

    // Handle command type.
    if (item.type === "s") {
      value = item.value!;
      len = value.length;
    } else if (item.type === "x") {
      len = value!.length;
    } else if (item.type === "t") {
      const [m, _] = rexMatch(item.value!, value!);
      void _;
      value = m === -1 ? "false" : "true";
      len = value.length;
    } else if (item.type === "m") {
      const [p, mlen] = rexMatch(item.value!, value!);
      if (p === -1) {
        len = 0;
        value = "";
      } else {
        value = value!.substring(p, p + mlen);
        len = mlen;
      }
    }

    // Append (caps-lower if requested).
    let chunk = value as string;
    if (item.caps) chunk = chunk.toLowerCase();
    out.push(chunk.substring(0, len));
  }
  return out.join("");
}
