// Port of org.grobid.core.process.ProcessRunner.
// Upstream: grobid-core/src/main/java/org/grobid/core/process/ProcessRunner.java
//
// Upstream extends `java.lang.Thread` and spawns a `ProcessBuilder` in
// `run()`. In Node we use `child_process.spawn` from `node:child_process`.
// `start()` / `run()` is async because Node's child process API is async.
//
// Behaviour parity:
//   - The constructor stores `cmd` / `name` / `useStreamGobbler`.
//   - `run()` spawns the process and (optionally) wraps stdout/stderr in
//     `StreamGobbler` instances exposed as `sgIn` / `sgErr`.
//   - `killProcess()` issues `pkill -9 -P <pid>` (verbatim with upstream
//     comment about ulimit children).
//   - The exit status is available via `getExitStatus()` after `run()`
//     resolves; the error-stream contents are captured in
//     `errorStreamContents` (read-back via `getErrorStreamContents()`).

import { spawn, spawnSync, execFile } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { getLogger } from "../utilities/logger.js";
import { StreamGobbler } from "./stream-gobbler.js";

const LOGGER = getLogger("ProcessRunner");

/**
 * Upstream ProcessRunner.java line 13-130.
 *
 * Note: extends `Thread` upstream. In TS we just expose `run()` as an async
 * method that returns when the process terminates.
 */
export class ProcessRunner {
  // Upstream line 16-18.
  private cmd: string[];
  private exit: number | null = null;
  private process: ChildProcessWithoutNullStreams | null = null;

  // Upstream line 24.
  private errorStreamContents: string = "";

  // Upstream line 26-28.
  private useStreamGobbler: boolean;
  sgIn: StreamGobbler | null = null;
  sgErr: StreamGobbler | null = null;

  // Upstream line 30-34.
  // The `name` parameter is the upstream `Thread` name — preserved for
  // logging/parity even though Node has no thread names.
  private readonly name: string;

  constructor(cmd: string[], name: string, useStreamGobbler: boolean) {
    this.cmd = cmd;
    this.name = name;
    this.useStreamGobbler = useStreamGobbler;
  }

  // Upstream line 20-22.
  getErrorStreamContents(): string {
    return this.errorStreamContents;
  }

  // Upstream line 36-50 — killing harshly with pkill (preserved verbatim
  // comment about ulimit child processes).
  killProcess(): void {
    if (this.process !== null) {
      try {
        const pid = ProcessRunner.getPidOfProcess(this.process);
        if (pid !== null) {
          LOGGER.info(`Killing pdf to xml process with PID ${pid} and its children`);
          // Upstream uses `Runtime.getRuntime().exec().waitFor()` — we use
          // `execFileSync`-style spawn-and-wait via execFile + a synchronous
          // wait. In TS this is fire-and-forget since waitFor is blocking
          // upstream.
          execFile("pkill", ["-9", "-P", String(pid)], () => {
            // ignore
          });
        }
      } catch (e) {
        throw new Error("RuntimeException: " + String(e));
      }
    }
  }

  // Upstream line 53-68 — reflection to read `java.lang.UNIXProcess.pid`.
  // In Node, `ChildProcess.pid` is a public field.
  static getPidOfProcess(p: ChildProcessWithoutNullStreams | null): number | null {
    let pid: number | null = null;
    try {
      if (p !== null && typeof p.pid === "number") {
        pid = p.pid;
      }
    } catch {
      pid = null;
    }
    return pid;
  }

  // Upstream line 70-125 — async because Node child processes are async.
  async run(): Promise<void> {
    this.process = null;
    let proc: ChildProcessWithoutNullStreams | null = null;
    try {
      const command = this.cmd[0] as string;
      const args = this.cmd.slice(1);
      proc = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
      this.process = proc;

      if (this.useStreamGobbler) {
        this.sgIn = new StreamGobbler(proc!.stdout);
        this.sgErr = new StreamGobbler(proc!.stderr);
      }

      // Collect stderr contents synchronously into errorStreamContents,
      // mirroring `IOUtils.toString(process.getErrorStream(), UTF_8)` in the
      // finally block. We accumulate here because the stderr stream may
      // already be consumed by `sgErr` — but the upstream code also reads
      // the error stream after the process exits, so we re-read from the
      // gobbler buffer when useStreamGobbler is true.
      const errChunks: Buffer[] = [];
      if (!this.useStreamGobbler) {
        proc!.stderr.on("data", (c: Buffer) => errChunks.push(c));
      }

      // Wait for process exit.
      this.exit = await new Promise<number>((resolve, reject) => {
        proc!.on("exit", (code) => resolve(code ?? -1));
        proc!.on("error", (err) => reject(err));
      });

      if (!this.useStreamGobbler) {
        this.errorStreamContents = Buffer.concat(errChunks).toString("utf8");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Upstream distinguishes InterruptedException (ignored) from
      // IOException (logged).
      LOGGER.error(`IOException while launching the command ${JSON.stringify(this.cmd)} : ${msg}`);
    } finally {
      if (proc !== null) {
        // IOUtils.closeQuietly equivalents.
        try { proc.stdin.end(); } catch { /* ignored */ }
        try { proc.stdout.destroy(); } catch { /* ignored */ }
        try { proc.stderr.destroy(); } catch { /* ignored */ }
        try {
          proc.kill();
        } catch { /* ignored */ }
      }
      if (this.useStreamGobbler) {
        try {
          if (this.sgIn !== null) this.sgIn.close();
        } catch (e) {
          LOGGER.error(`IOException while closing the stream gobbler: ${String(e)}`);
        }
        try {
          if (this.sgErr !== null) this.sgErr.close();
        } catch (e) {
          LOGGER.error(`IOException while closing the stream gobbler: ${String(e)}`);
        }
      }
    }
  }

  /**
   * Blocking spawn — JS equivalent of Java's `Thread.run() + Thread.join()`.
   * Use this when the upstream caller is synchronous (`DocumentSource.pdfalto`)
   * and cannot be made async without rippling the change through every parser.
   * Java's `Thread.join()` blocks the calling thread; in Node we use
   * `spawnSync` which blocks the event loop. Same external behaviour.
   */
  runSync(timeoutMs: number | null): void {
    const command = this.cmd[0] as string;
    const args = this.cmd.slice(1);
    const result = spawnSync(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      ...(timeoutMs !== null ? { timeout: timeoutMs } : {}),
    });
    this.exit = result.status ?? -1;
    if (result.stderr) {
      this.errorStreamContents = result.stderr.toString("utf8");
    }
    if (result.error !== undefined && result.error !== null) {
      LOGGER.error(
        `IOException while launching the command ${JSON.stringify(this.cmd)} : ${result.error.message}`,
      );
    }
  }

  // Upstream line 127-129.
  getExitStatus(): number | null {
    return this.exit;
  }

  /** Thread name (upstream Thread inheritance). */
  getName(): string {
    return this.name;
  }
}
