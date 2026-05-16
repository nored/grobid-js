// Port of the C `quark` module from upstream Wapiti (v1.5.0).
// Upstream: upstream/wapiti/quark.{c,h}
//
// Implements the string<->id dictionary (PATRICIA / crit-bit trie in C). The
// only operations actually exercised by GROBID's read-only `label` path are
// `qrk_count`, `qrk_id2str`, `qrk_str2id` (with `lock=true`), `qrk_load` and
// `qrk_lock`. We keep the public API surface verbatim.
//
// We don't replicate the crit-bit trie literally: in JS a plain `Map<string,
// number>` plus a parallel `string[]` gives identical externally-observable
// behaviour and uses less memory. The `lock` semantics, the special
// "not-found" sentinel (`none = (uint64_t)-1` in C, see tools.h:36), and the
// stable insertion-order id assignment are preserved.

export const QRK_NONE = -1; // Mirrors C `#define none ((uint64_t)-1)` (tools.h).

/** Port of C `qrk_t` (see quark.c:57-70). */
export class QrkT {
  /** id -> key, indexed by id. Mirrors `leafs[]`. */
  private readonly _keys: string[] = [];
  /** key -> id reverse index. */
  private readonly _ids: Map<string, number> = new Map();
  /** When true, str2id refuses to create new ids and returns `none`. */
  private _lock: boolean = false;

  /** Port of `qrk_count`. */
  count(): number {
    return this._keys.length;
  }

  /** Port of `qrk_lock`. Returns the previous lock state. */
  lock(lock: boolean): boolean {
    const old = this._lock;
    this._lock = lock;
    return old;
  }

  /** Port of `qrk_id2str`. */
  id2str(id: number): string {
    if (id < 0 || id >= this._keys.length) {
      // Upstream calls `fatal("invalid identifier")` which exits the process.
      throw new Error("invalid identifier");
    }
    // noUncheckedIndexedAccess: we just checked the bounds.
    return this._keys[id] as string;
  }

  /**
   * Port of `qrk_str2id`. Returns the id assigned to `key`, allocating one if
   * needed. If the quark is locked and the key is unknown, returns `QRK_NONE`.
   */
  str2id(key: string): number {
    const existing = this._ids.get(key);
    if (existing !== undefined) return existing;
    if (this._lock) return QRK_NONE;
    const id = this._keys.length;
    this._keys.push(key);
    this._ids.set(key, id);
    return id;
  }

  /**
   * Port of `qrk_load` (quark.c:235-253). Reads a `#qrk#<count>\n` header
   * followed by `<count>` netstrings from the caller-supplied tokenizer.
   */
  load(reader: NsReader): void {
    const header = reader.readLine();
    const m = /^#qrk#(\d+)$/.exec(header);
    if (!m) {
      // Mirrors `pfatal("invalid format")`.
      throw new Error("invalid format");
    }
    const cnt = Number(m[1]);
    for (let n = 0; n < cnt; n++) {
      const str = reader.readNetstring();
      this.str2id(str);
    }
  }
}

/**
 * Reader interface used by `qrk_load`, `rdr_load` and the model loader.
 * The C reader operates on a `FILE *`. We instead pass an in-memory cursor
 * over the model file, exposing only the two operations we actually need.
 */
export interface NsReader {
  /**
   * Read one line up to and including the next `\n` (consumed), returning the
   * line without the trailing newline. Throws if EOF is hit mid-line.
   */
  readLine(): string;
  /**
   * Read a Bernstein netstring: `<len>:<bytes>,\n`. Returns the payload bytes
   * decoded as UTF-8. Mirrors `ns_readstr` (tools.c:160-172) including the
   * trailing newline consumption.
   */
  readNetstring(): string;
}

/**
 * Concrete `NsReader` backed by a `Uint8Array` and a byte cursor. Used to
 * parse `.wapiti` model files end-to-end. The C reader uses
 * `fgetc`/`fread`/`fscanf` on stdio; we mirror those primitives byte-for-byte
 * so the netstring/format parsing comes out identical.
 */
export class BufferNsReader implements NsReader {
  private pos: number = 0;
  constructor(private readonly bytes: Uint8Array) {}

  /** True iff the cursor has reached the end of the buffer. */
  eof(): boolean {
    return this.pos >= this.bytes.length;
  }

  /** Current byte cursor (for diagnostics / netstring header). */
  position(): number {
    return this.pos;
  }

  /** Force-set the cursor (used by `mdl_load` for the rewind/retry path). */
  seek(pos: number): void {
    this.pos = pos;
  }

  /** Read one byte and advance; returns -1 at EOF (mirrors `fgetc`). */
  readByte(): number {
    if (this.pos >= this.bytes.length) return -1;
    // noUncheckedIndexedAccess: bounds checked above.
    return this.bytes[this.pos++] as number;
  }

  /** Peek one byte without advancing; -1 at EOF. */
  peekByte(): number {
    if (this.pos >= this.bytes.length) return -1;
    return this.bytes[this.pos] as number;
  }

  /** Read raw bytes of fixed length. */
  readBytes(len: number): Uint8Array {
    if (this.pos + len > this.bytes.length) {
      throw new Error("cannot read from file");
    }
    const out = this.bytes.subarray(this.pos, this.pos + len);
    this.pos += len;
    return out;
  }

  /**
   * Read one line up to and including the newline; the newline is consumed but
   * not returned. Mirrors `fgets`+`\n` strip used throughout the upstream
   * loader (e.g. `rdr_readline`).
   */
  readLine(): string {
    const start = this.pos;
    while (this.pos < this.bytes.length && this.bytes[this.pos] !== 0x0a) {
      this.pos++;
    }
    const end = this.pos;
    if (this.pos < this.bytes.length) this.pos++; // consume '\n'
    return new TextDecoder("utf-8").decode(this.bytes.subarray(start, end));
  }

  /**
   * Port of `ns_readstr` (tools.c:160-172). The C version performs
   *   fscanf(file, "%u:", &len); fread(buf, len, 1); fgetc(',') ; fgetc('\n');
   * — note the trailing `\n` is consumed *unconditionally* in the C code
   * (`fgetc(file)` at the end with no check), so we mirror that behaviour.
   */
  readNetstring(): string {
    // Parse `<len>:`.
    const start = this.pos;
    while (
      this.pos < this.bytes.length &&
      this.bytes[this.pos] !== 0x3a // ':'
    ) {
      this.pos++;
    }
    if (this.pos >= this.bytes.length) {
      throw new Error("cannot read from file");
    }
    const lenStr = new TextDecoder("utf-8").decode(this.bytes.subarray(start, this.pos));
    if (!/^\d+$/.test(lenStr)) {
      throw new Error("cannot read from file");
    }
    const len = Number(lenStr);
    this.pos++; // consume ':'
    if (this.pos + len > this.bytes.length) {
      throw new Error("cannot read from file");
    }
    const payload = new TextDecoder("utf-8").decode(
      this.bytes.subarray(this.pos, this.pos + len),
    );
    this.pos += len;
    if (this.pos >= this.bytes.length || this.bytes[this.pos] !== 0x2c /* ',' */) {
      throw new Error("invalid format");
    }
    this.pos++; // consume ','
    // Unconditional trailing newline consume (mirrors `fgetc(file);` at end of
    // ns_readstr — note: not validated, so a missing newline silently does
    // nothing if we are at EOF).
    if (this.pos < this.bytes.length && this.bytes[this.pos] === 0x0a) {
      this.pos++;
    } else if (this.pos < this.bytes.length) {
      // C consumes one byte unconditionally; mirror that to stay byte-accurate.
      this.pos++;
    }
    return payload;
  }
}
