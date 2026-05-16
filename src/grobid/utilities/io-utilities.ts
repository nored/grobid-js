// Port of org.grobid.core.utilities.IOUtilities.
// Upstream: grobid-core/src/main/java/org/grobid/core/utilities/IOUtilities.java
//
// Utilities related to file and directory management.
//
// NOTE: upstream uses java.io.File extensively. The TS port uses node:fs and
// node:os, which means these methods only function under Node.js (the browser
// build is expected to avoid this module). CONVENTIONS.md notes File I/O
// "belongs in src/node/" but the port is kept here to maintain a 1:1 mapping
// with the upstream class; callers are responsible for choosing the right
// runtime.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { GrobidResourceException } from "../exceptions/grobid-resource-exception.js";
import { GrobidProperties } from "./grobid-properties.js";
import { getLogger } from "./logger.js";

const LOGGER = getLogger("IOUtilities");

/**
 * Mirrors `org.apache.commons.lang3.StringUtils.isEmpty`.
 */
function isEmptyStr(s: string | null | undefined): boolean {
  return s === null || s === undefined || s.length === 0;
}

export class IOUtilities {
  /**
   * Creates a file and writes some string content in it.
   *
   * @param file    The file to write in.
   * @param content the content to write
   */
  static writeInFile(file: string, content: string): void {
    fs.writeFileSync(file, content);
  }

  /**
   * Creates a file and writes a list of string in it separated by a given separator.
   *
   * @param file    The file to write in.
   * @param content the list of string to write
   * @param sep separator to used for the list elements
   */
  static writeListInFile(file: string, content: string[], sep: string): void {
    const fd = fs.openSync(file, "w");
    try {
      let start = true;
      for (const cont of content) {
        if (start) {
          fs.writeSync(fd, cont);
          start = false;
        } else {
          fs.writeSync(fd, sep + cont);
        }
      }
    } finally {
      fs.closeSync(fd);
    }
  }

  /**
   * Read a file and return the content.
   *
   * @param pPathToFile path to file to read.
   * @return String contained in the document.
   */
  static readFile(pPathToFile: string): string {
    // Mirror upstream behaviour: stream 1k at a time, accumulating a per-chunk
    // ByteArrayOutputStream that's converted to a string AND appended to the
    // overall result. The accumulation is upstream's quirk; preserve it.
    const fd = fs.openSync(pPathToFile, "r");
    try {
      const buf = Buffer.alloc(1024);
      const outStreamChunks: Buffer[] = [];
      const outParts: string[] = [];
      let len: number;
      while ((len = fs.readSync(fd, buf, 0, 1024, null)) > 0) {
        const chunk = Buffer.from(buf.subarray(0, len));
        outStreamChunks.push(chunk);
        // Upstream: outStream.write(buf, 0, len); out.append(outStream.toString());
        // outStream is never reset, so each iteration appends ALL bytes read so
        // far. Mirror the behaviour byte-for-byte (and string-for-string).
        const cumulative = Buffer.concat(outStreamChunks);
        outParts.push(cumulative.toString());
      }
      return outParts.join("");
    } finally {
      fs.closeSync(fd);
    }
  }

  /**
   * Write an input stream in temp directory.
   *
   * The TS port accepts either a Node.js Readable (synchronously drained via
   * readable-events would need async) or a pre-read Buffer/string. We accept a
   * Buffer/Uint8Array directly to keep the method synchronous like upstream.
   * Returns the path of the newly-created file, or null on error.
   */
  static writeInputFile(inputStream: Uint8Array | null): string | null {
    LOGGER.debug(">> set origin document for stateless service'...");

    let originFile: string | null = null;
    try {
      originFile = IOUtilities.newTempFile("origin", ".pdf");

      if (inputStream !== null) {
        fs.writeFileSync(originFile, inputStream);
      }
    } catch (e) {
      LOGGER.error(
        "An internal error occurs, while writing to disk (file to write '" +
          originFile +
          "').",
        e,
      );
      originFile = null;
    }
    return originFile;
  }

  /**
   * Creates a new not used temporary file and returns it.
   */
  static newTempFile(fileName: string, extension: string): string {
    try {
      const dir = GrobidProperties.getTempPath();
      // mimic java.io.File.createTempFile: prefix=fileName, suffix=extension
      // Resulting filename is unique within dir.
      const tmpName = `${fileName}${IOUtilities._randomSuffix()}${extension}`;
      const fullPath = path.join(dir, tmpName);
      // Open with O_CREAT|O_EXCL to ensure uniqueness; on collision retry.
      let attempt = 0;
      let finalPath = fullPath;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        try {
          const fd = fs.openSync(finalPath, "wx");
          fs.closeSync(fd);
          return finalPath;
        } catch (err) {
          attempt++;
          if (attempt > 100) throw err;
          finalPath = path.join(dir, `${fileName}${IOUtilities._randomSuffix()}${extension}`);
        }
      }
    } catch (e) {
      throw new GrobidResourceException(
        "Could not create temporary file, '" +
          fileName +
          "." +
          extension +
          "' under path '" +
          GrobidProperties.getTempPath() +
          "'.",
        e,
      );
    }
  }

  private static _randomSuffix(): string {
    // 10 hex chars from a cryptographically-suitable source if available.
    const bytes: Uint8Array = new Uint8Array(5);
    // crypto is global in Node 20+ and in modern browsers.
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
      crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    let s = "";
    for (const b of bytes) {
      s += b.toString(16).padStart(2, "0");
    }
    return s;
  }

  /**
   * From JDK 1.7, creates a new system temporary file and returns the file
   */
  static newSystemTempFile(extension: string): string {
    try {
      const tmpdir = os.tmpdir();
      const name = `grobid${IOUtilities._randomSuffix()}${extension}`;
      const newFile = path.join(tmpdir, name);
      const fd = fs.openSync(newFile, "wx");
      fs.closeSync(fd);
      return newFile;
    } catch (e) {
      throw new GrobidResourceException(
        "Could not create temporary file, with extension '" + extension + "' under path tmp system path.",
        e,
      );
    }
  }

  /**
   * Delete a temporary file
   */
  static removeTempFile(file: string): void {
    try {
      // sanity cleaning
      IOUtilities.deleteOldies(GrobidProperties.getTempPath(), 300);
      LOGGER.debug("Removing " + path.resolve(file));
      try {
        fs.unlinkSync(file);
      } catch {
        /* upstream uses File.delete() which returns false on failure; no throw */
      }
    } catch (exp) {
      LOGGER.error("Error while deleting the temporary file: ", exp);
    }
  }

  /**
   * Delete a system temporary file
   */
  static removeSystemTempFile(file: string): void {
    try {
      // sanity cleaning
      IOUtilities.deleteSystemOldies(300);
      LOGGER.debug("Removing " + path.resolve(file));
      try {
        fs.unlinkSync(file);
      } catch {
        /* upstream uses File.delete() which returns false on failure; no throw */
      }
    } catch (exp) {
      LOGGER.error("Error while deleting the temporary file: ", exp);
    }
  }

  /**
   * Delete temporary directory
   */
  static removeTempDirectory(pathArg: string): void {
    try {
      LOGGER.debug("Removing " + pathArg);
      if (fs.existsSync(pathArg)) {
        try {
          // upstream uses File.delete() which only deletes empty directories;
          // mirror that semantic (not recursive).
          fs.rmdirSync(pathArg);
        } catch {
          /* swallow */
        }
      }
    } catch (exp) {
      LOGGER.error("Error while deleting the temporary directory: ", exp);
    }
  }

  /**
   * Deletes all files and subdirectories under dir if they are older than a given
   * amount of seconds. Returns true if all deletions were successful. If a deletion
   * fails, the method stops attempting to delete and returns false.
   */
  static deleteOldies(dir: string, maxLifeInSeconds: number): boolean;
  static deleteOldies(
    dir: string,
    maxLifeInSeconds: number,
    prefix: string,
    root: boolean,
  ): boolean;
  static deleteOldies(
    dir: string,
    maxLifeInSeconds: number,
    prefix?: string,
    root?: boolean,
  ): boolean {
    if (prefix === undefined) {
      return IOUtilities.deleteOldies(dir, maxLifeInSeconds, "", true);
    }
    const currentDate = new Date();
    const currentDateMillisec = currentDate.getTime();
    let empty = true;
    let success = true;
    const threasholdMillisec = currentDateMillisec - maxLifeInSeconds * 1000;
    let isDirectory = false;
    try {
      isDirectory = fs.statSync(dir).isDirectory();
    } catch {
      isDirectory = false;
    }
    const dirName = path.basename(dir);
    if (isDirectory && (isEmptyStr(prefix) || dirName.startsWith(prefix))) {
      let children: string[] | null = null;
      try {
        children = fs.readdirSync(dir);
      } catch {
        children = null;
      }
      if (children !== null) {
        for (let i = 0; i < children.length; i++) {
          const childName = children[i]!;
          const childPath = path.join(dir, childName);
          if (isEmptyStr(prefix) || childName.startsWith(prefix)) {
            let millisec = 0;
            try {
              millisec = fs.statSync(childPath).mtimeMs;
            } catch {
              millisec = 0;
            }
            if (millisec < threasholdMillisec) {
              success = IOUtilities.deleteOldies(childPath, maxLifeInSeconds, prefix, false);
              if (!success) return false;
            } else {
              empty = false;
            }
          }
        }
      }
    }
    // if the dir is a file or if the directory is empty and it is no the root dir, we delete it
    if (!root && (empty || !isDirectory)) {
      if (isEmptyStr(prefix) || dirName.startsWith(prefix)) {
        try {
          if (isDirectory) {
            fs.rmdirSync(dir);
          } else {
            fs.unlinkSync(dir);
          }
          success = true;
        } catch {
          success = false;
        }
      }
    }
    return success;
  }

  /**
   * Deletes all files and subdirectories under the system temporary folder if they are older than
   * a given amount of seconds. Returns true if all deletions were successful. If a deletion
   * fails, the method stops attempting to delete and returns false.
   * The grobid system temporary files and folders are all identified with a grobid prefix.
   */
  static deleteSystemOldies(maxLifeInSeconds: number): boolean {
    const defaultBaseDir = os.tmpdir();
    return IOUtilities.deleteOldies(defaultBaseDir, maxLifeInSeconds, "grobid", true);
  }
}
