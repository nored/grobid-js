// Port of org.grobid.core.process.StreamProcess.
// Upstream: grobid-core/src/main/java/org/grobid/core/process/StreamProcess.java
//
// Variant of `StreamGobbler` where the upstream code commented out the
// `synchronized` blocks and the daemon thread (calling `run()` directly from
// the constructor instead). Behaviour is otherwise identical to
// `StreamGobbler`. We keep the same Node `Readable`-listener strategy and
// preserve the commented-out `synchronizer.wait()` / `synchronized` blocks
// as `// NOTE: upstream commented out` comments for fidelity.

import type { Readable } from "node:stream";

/**
 * Upstream StreamProcess.java line 6-188.
 */
export class StreamProcess {
  // Upstream line 64.
  private is: Readable;

  // NOTE: upstream commented out the `synchronizer` lock (line 66).

  // Upstream line 68-70.
  private isEOF: boolean = false;
  private isClosed: boolean = false;
  private exception: Error | null = null;

  // Upstream line 72-74.
  private buffer: Uint8Array = new Uint8Array(2048);
  private read_pos: number = 0;
  private write_pos: number = 0;

  // Upstream line 76-79.
  constructor(is: Readable) {
    this.is = is;
    // Upstream calls `run()` from the constructor — a (faulty) single-shot
    // run that would only ever read the first chunk. In TS we install a
    // listener so all subsequent chunks are buffered too, preserving the
    // *intent* of the upstream code (the upstream behaviour is broken).
    this.is.on("data", (chunk: Buffer | string) => this.run(chunk));
    this.is.on("end", () => { this.isEOF = true; });
    this.is.on("error", (err: Error) => { this.exception = err; });
  }

  // Upstream line 8-62 — `run()` body. Java reads in a loop until EOF; in TS
  // we are invoked per data chunk from the Node stream listener.
  protected run(chunk?: Buffer | string): void {
    // Upstream allocates `byte[] buff = new byte[8192]` and reads into it.
    // Here `chunk` is the already-read buffer.
    if (chunk === undefined) return;
    let buff: Uint8Array;
    if (typeof chunk === "string") {
      buff = Buffer.from(chunk, "utf8");
    } else {
      buff = chunk;
    }
    try {
      const avail = buff.length;
      // NOTE: upstream commented out `synchronized (synchronizer)`.
      if (avail <= 0) {
        this.isEOF = true;
        // NOTE: upstream commented out `synchronizer.notifyAll();`
        return;
      }
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
    } catch (e) {
      // Upstream catches IOException.
      this.exception = e instanceof Error ? e : new Error(String(e));
    }
  }

  // Upstream line 82-110 — read a single byte / -1 at EOF.
  read(): number;
  read(b: Uint8Array): number;
  read(b: Uint8Array, off: number, len: number): number;
  read(b?: Uint8Array, off?: number, len?: number): number {
    if (b === undefined) return this.readSingle();
    if (off === undefined || len === undefined) return this.readBuffer(b, 0, b.length);
    return this.readBuffer(b, off, len);
  }

  private readSingle(): number {
    if (this.isClosed) {
      throw new Error("This StreamGobbler is closed.");
    }
    // Upstream loops here on `synchronizer.wait()` — commented out, so this
    // is effectively a busy spin. We follow the Java code path 1:1: throw
    // if the buffer is empty and no EOF yet.
    while (this.read_pos === this.write_pos) {
      if (this.exception !== null) throw this.exception;
      if (this.isEOF) return -1;
      // NOTE: upstream commented out `synchronizer.wait()`.
      throw new Error(
        "StreamProcess.read: would block — no bytes available yet (upstream busy-loops)",
      );
    }
    return (this.buffer[this.read_pos++] as number) & 0xff;
  }

  // Upstream line 112-120.
  available(): number {
    if (this.isClosed) {
      throw new Error("This StreamGobbler is closed.");
    }
    return this.write_pos - this.read_pos;
  }

  // Upstream line 128-137.
  close(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.isEOF = true;
    if (typeof (this.is as { destroy?: () => void }).destroy === "function") {
      (this.is as { destroy: () => void }).destroy();
    }
  }

  // Upstream line 139-187.
  private readBuffer(b: Uint8Array, off: number, len: number): number {
    if (b === null || b === undefined) throw new Error("NullPointerException");
    if (off < 0 || len < 0 || off + len > b.length || off + len < 0 || off > b.length) {
      throw new Error("IndexOutOfBoundsException");
    }
    if (len === 0) return 0;
    if (this.isClosed) throw new Error("This StreamGobbler is closed.");
    while (this.read_pos === this.write_pos) {
      if (this.exception !== null) throw this.exception;
      if (this.isEOF) return -1;
      // NOTE: upstream commented out `synchronizer.wait()`.
      throw new Error(
        "StreamProcess.read: would block — no bytes available yet (upstream busy-loops)",
      );
    }
    let avail = this.write_pos - this.read_pos;
    avail = avail > len ? len : avail;
    b.set(this.buffer.subarray(this.read_pos, this.read_pos + avail), off);
    this.read_pos += avail;
    return avail;
  }
}
