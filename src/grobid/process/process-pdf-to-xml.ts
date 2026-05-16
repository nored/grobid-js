// Port of org.grobid.core.process.ProcessPdfToXml.
// Upstream: grobid-core/src/main/java/org/grobid/core/process/ProcessPdfToXml.java
//
// Spawns the pdfalto command and forwards its stderr lines to the GROBID
// log as warnings. Returns the process exit code (null when the process
// could not be started).
//
// `process(cmd)` is async in TS because Node child processes are async; the
// upstream return type `Integer` is preserved as `number | null`.

import { spawn } from "node:child_process";
import { getLogger } from "../utilities/logger.js";

const LOGGER = getLogger("ProcessPdfToXml");

/**
 * Upstream ProcessPdfToXml.java line 12-62.
 */
export class ProcessPdfToXml {
  /**
   * Process the conversion.
   *
   * Upstream line 19-61.
   */
  static async process(cmd: string[]): Promise<number | null> {
    let exit: number | null = null;
    let message: string = "error message cannot be retrieved";
    let proc: ReturnType<typeof spawn> | null = null;
    try {
      const command = cmd[0] as string;
      const args = cmd.slice(1);
      // Upstream: builder.redirectErrorStream(true) — merges stderr into stdout.
      proc = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });

      // Upstream reads stdout line by line, logging non-duplicate lines as
      // warnings ("pdfalto stderr: ..."). Note the comment in upstream calls
      // it "stderr" even though `redirectErrorStream(true)` merges both
      // streams into stdout. Preserved verbatim.
      let buffer = "";
      let previousOutput: string | null = null;
      const mergedStream = proc!.stdout!;
      // With redirectErrorStream(true) the merged stream is stdout. We
      // additionally drain real stderr into `message` for the final log,
      // mirroring `IOUtils.toString(process.getErrorStream(), UTF_8)`.
      const onLine = (output: string): void => {
        if (output !== previousOutput) {
          LOGGER.warn("pdfalto stderr: " + output);
          previousOutput = output;
        }
      };
      mergedStream.on("data", (chunk: Buffer | string) => {
        const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
        buffer += text;
        let idx: number;
        while ((idx = buffer.indexOf("\n")) !== -1) {
          let line = buffer.substring(0, idx);
          if (line.endsWith("\r")) line = line.substring(0, line.length - 1);
          buffer = buffer.substring(idx + 1);
          onLine(line);
        }
      });

      const errChunks: Buffer[] = [];
      proc!.stderr!.on("data", (c: Buffer) => errChunks.push(c));

      exit = await new Promise<number | null>((resolve, reject) => {
        proc!.on("exit", (code) => resolve(code));
        proc!.on("error", (err) => reject(err));
      });

      // Flush any trailing buffered line.
      if (buffer.length > 0) onLine(buffer);

      // Upstream: `message = IOUtils.toString(process.getErrorStream(), UTF_8)`.
      message = Buffer.concat(errChunks).toString("utf8");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Upstream distinguishes InterruptedException (warn: "pdfalto process
      // is about to be killed.") from IOException (error log).
      LOGGER.error(`IOException while launching the command ${JSON.stringify(cmd)} : ${msg}`);
    } finally {
      if (proc !== null) {
        // IOUtils.closeQuietly(...).
        try { proc.stdin?.end(); } catch { /* ignored */ }
        try { proc.stdout?.destroy(); } catch { /* ignored */ }
        try { proc.stderr?.destroy(); } catch { /* ignored */ }
        try { proc.kill(); } catch { /* ignored */ }

        if (exit === null || exit !== 0) {
          LOGGER.error("pdfalto process finished with error code: " + exit + ". " + cmd);
          LOGGER.error("pdfalto return message: \n" + message);
        }
      }
    }
    return exit;
  }
}
