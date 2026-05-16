// Port of org.grobid.core.process.StreamGobbler.
// Upstream: grobid-core/src/main/java/org/grobid/core/process/StreamGobbler.java
//
// Copyright (c) 2006-2011 Christian Plattner. All rights reserved.
//
// Upstream extends `java.io.InputStream` and uses a daemon background thread
// (`GobblerThread`) to drain an underlying `InputStream` into a resizable
// internal buffer. Consumers call `read(...)` to pull bytes out.
//
// Node.js has no threads but `Readable` streams emit `data` events
// asynchronously. We register a `data`/`end`/`error` listener on the supplied
// readable; the listener writes into the same resizable buffer as the
// upstream `GobblerThread.run()`. Consumers call `read(...)`/`readAsync(...)`
// in the same way — `read()` returns `-1` at EOF, mirroring the contract of
// `java.io.InputStream.read()`.
//
// The byte-buffer compaction/resize logic at lines 26-50 is preserved
// verbatim. Locking (`synchronized (synchronizer)`) becomes a no-op since
// the JS event loop is single-threaded.

import type { Readable } from "node:stream";

/**
 * `InputStream`-like wrapper around a Node `Readable`.
 *
 * Upstream StreamGobbler.java line 9-191.
 */
export class StreamGobbler {
  // Upstream line 68.
  private is: Readable;

  // Upstream line 72-74.
  private isEOF: boolean = false;
  private isClosed: boolean = false;
  private exception: Error | null = null;

  // Upstream line 76-78.
  private buffer: Uint8Array = new Uint8Array(2048);
  private read_pos: number = 0;
  private write_pos: number = 0;

  // Pending readers waiting on more bytes (`synchronizer.wait()` substitute).
  // Each entry is the resolver of a promise that the readAsync() loop awaits.
  private waiters: Array<() => void> = [];

  // Upstream line 80-85.
  constructor(is: Readable) {
    this.is = is;
    // The GobblerThread is started here as a daemon. We install Node stream
    // listeners that perform the same work.
    this.is.on("data", (chunk: Buffer | string) => this.onData(chunk));
    this.is.on("end", () => this.onEnd());
    this.is.on("error", (err: Error) => this.onError(err));
  }

  /**
   * Mirrors `GobblerThread.run()` — appends bytes from the upstream
   * stream into the internal buffer with compaction/resize.
   */
  private onData(chunk: Buffer | string): void {
    let buff: Uint8Array;
    if (typeof chunk === "string") {
      buff = Buffer.from(chunk, "utf8");
    } else {
      buff = chunk;
    }
    const avail = buff.length;
    if (avail <= 0) {
      this.isEOF = true;
      this.notifyAll();
      return;
    }
    // Upstream line 26-50.
    const space_available = this.buffer.length - this.write_pos;
    if (space_available < avail) {
      const unread_size = this.write_pos - this.read_pos;
      const need_space = unread_size + avail;
      let new_buffer = this.buffer;
      if (need_space > this.buffer.length) {
        let inc = Math.floor(need_space / 3);
        inc = inc < 256 ? 256 : inc;
        inc = inc > 8192 ? 8192 : inc;
        new_buffer = new Uint8Array(need_space + inc);
      }
      if (unread_size > 0) {
        new_buffer.set(this.buffer.subarray(this.read_pos, this.read_pos + unread_size), 0);
      }
      this.buffer = new_buffer;
      this.read_pos = 0;
      this.write_pos = unread_size;
    }
    this.buffer.set(buff, this.write_pos);
    this.write_pos += avail;
    this.notifyAll();
  }

  private onEnd(): void {
    this.isEOF = true;
    this.notifyAll();
  }

  private onError(err: Error): void {
    this.exception = err;
    this.notifyAll();
  }

  private notifyAll(): void {
    const ws = this.waiters;
    this.waiters = [];
    for (const w of ws) w();
  }

  // Upstream line 87-115 — `read()` returning a single byte or -1 at EOF.
  // Synchronous in Java thanks to `synchronizer.wait()`. In TS we keep a
  // synchronous variant that throws when blocked (the buffer is empty and
  // the underlying stream has not yet emitted) and a separate async variant.
  read(): number;
  read(b: Uint8Array): number;
  read(b: Uint8Array, off: number, len: number): number;
  read(b?: Uint8Array, off?: number, len?: number): number {
    if (b === undefined) {
      return this.readSingle();
    }
    if (off === undefined || len === undefined) {
      return this.readBuffer(b, 0, b.length);
    }
    return this.readBuffer(b, off, len);
  }

  private readSingle(): number {
    if (this.isClosed) {
      throw new Error("This StreamGobbler is closed.");
    }
    if (this.read_pos === this.write_pos) {
      if (this.exception !== null) throw this.exception;
      if (this.isEOF) return -1;
      // Upstream waits here; in TS we cannot block synchronously.
      throw new Error(
        "StreamGobbler.read: would block — no bytes available yet (use readAsync)",
      );
    }
    return (this.buffer[this.read_pos++] as number) & 0xff;
  }

  // Upstream line 117-125.
  available(): number {
    if (this.isClosed) {
      throw new Error("This StreamGobbler is closed.");
    }
    return this.write_pos - this.read_pos;
  }

  // Upstream line 132-142.
  close(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.isEOF = true;
    this.notifyAll();
    if (typeof (this.is as { destroy?: () => void }).destroy === "function") {
      (this.is as { destroy: () => void }).destroy();
    }
  }

  // Upstream line 144-190.
  private readBuffer(b: Uint8Array, off: number, len: number): number {
    if (b === null || b === undefined) {
      throw new Error("NullPointerException");
    }
    if (off < 0 || len < 0 || off + len > b.length || off + len < 0 || off > b.length) {
      throw new Error("IndexOutOfBoundsException");
    }
    if (len === 0) return 0;
    if (this.isClosed) throw new Error("This StreamGobbler is closed.");
    if (this.read_pos === this.write_pos) {
      if (this.exception !== null) throw this.exception;
      if (this.isEOF) return -1;
      throw new Error(
        "StreamGobbler.read: would block — no bytes available yet (use readAsync)",
      );
    }
    let avail = this.write_pos - this.read_pos;
    avail = avail > len ? len : avail;
    b.set(this.buffer.subarray(this.read_pos, this.read_pos + avail), off);
    this.read_pos += avail;
    return avail;
  }

  /**
   * Async equivalent of `read()` — awaits more bytes via the data listener
   * before reading. Returns -1 at EOF.
   */
  async readAsync(): Promise<number>;
  async readAsync(b: Uint8Array): Promise<number>;
  async readAsync(b: Uint8Array, off: number, len: number): Promise<number>;
  async readAsync(b?: Uint8Array, off?: number, len?: number): Promise<number> {
    while (this.read_pos === this.write_pos) {
      if (this.exception !== null) throw this.exception;
      if (this.isEOF) return -1;
      if (this.isClosed) throw new Error("This StreamGobbler is closed.");
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    if (b === undefined) return this.readSingle();
    if (off === undefined || len === undefined) return this.readBuffer(b, 0, b.length);
    return this.readBuffer(b, off, len);
  }
}
