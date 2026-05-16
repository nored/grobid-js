// Port of org.grobid.core.main.GrobidHomeFinder.
// Upstream: grobid-core/src/main/java/org/grobid/core/main/GrobidHomeFinder.java
//
// Node-only: this class uses `node:fs` and `node:path` to mirror Java's
// `File` / `FileOutputStream` / `ZipInputStream` semantics. The browser
// build never reaches this layer (entry points live in `src/node/`).
//
// Adaptations vs upstream:
// - Java system properties (`System.getProperty(PROP_GROBID_HOME)`) map to
//   environment variables `process.env.ORG_GROBID_HOME` / `ORG_GROBID_CONFIG`
//   first, then fall back to the JVM-style `-Dorg.grobid.home=...` syntax
//   parsed from `--grobid-home` CLI args is the caller's responsibility.
// - HTTP-fetched grobid-home zip extraction is preserved end-to-end via
//   `node:https` to mirror upstream's URL.openStream/ZipInputStream pipeline.
// - Guava `Hashing.md5().hashString(...)` is replaced by Node's
//   `crypto.createHash('md5')`.

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import * as urlMod from "node:url";
import { execFileSync } from "node:child_process";
import * as zlib from "node:zlib";
import { GrobidPropertyException } from "../exceptions/grobid-property-exception.js";
import { getLogger } from "../utilities/logger.js";

/**
 * This class is responsible for finding a right grobid home
 */
export class GrobidHomeFinder {
  private static readonly PROP_GROBID_HOME: string = "org.grobid.home";
  private static readonly PROP_GROBID_CONFIG: string = "org.grobid.config";

  private static readonly LOGGER = getLogger("GrobidHomeFinder");
  private static readonly GROBID_FOLDER_POSSIBLE_LOCATIONS: readonly string[] = [
    "../grobid-home",
    "grobid-home",
    "GROBID_HOME",
  ];
  private static readonly BUFFER_SIZE: number = 4096;
  private readonly grobidHomePossibleLocations: readonly string[];

  constructor(grobidHomePossibleLocations?: readonly string[] | null) {
    if (grobidHomePossibleLocations === undefined) {
      this.grobidHomePossibleLocations = GrobidHomeFinder.GROBID_FOLDER_POSSIBLE_LOCATIONS;
    } else if (grobidHomePossibleLocations === null) {
      this.grobidHomePossibleLocations = [];
    } else {
      this.grobidHomePossibleLocations = grobidHomePossibleLocations;
    }
  }

  findGrobidHomeOrFail(): string {
    const gh = this.getGrobidHomePathOrLoadFromClasspath();
    GrobidHomeFinder.LOGGER.info("*** USING GROBID HOME: " + path.resolve(gh));
    let stat: fs.Stats | null;
    try {
      stat = fs.statSync(gh);
    } catch {
      stat = null;
    }
    if (stat === null || !stat.isDirectory()) {
      GrobidHomeFinder.fail(
        "Grobid home folder '" + path.resolve(gh) + "' was detected for usage, but does not exist",
      );
    }

    return gh;
  }

  findGrobidConfigOrFail(grobidHome: string | null): string {
    let homeStat: fs.Stats | null;
    try {
      homeStat = grobidHome !== null ? fs.statSync(grobidHome) : null;
    } catch {
      homeStat = null;
    }
    if (grobidHome === null || homeStat === null || !homeStat.isDirectory()) {
      GrobidHomeFinder.fail(
        "Grobid home folder '" + grobidHome + "' was detected for usage, but does not exist or null",
      );
    }

    const grobidConfig = GrobidHomeFinder.getSystemProperty(GrobidHomeFinder.PROP_GROBID_CONFIG);
    let grobidConfigFile: string;
    if (grobidConfig === null) {
      grobidConfigFile = path.resolve(path.join(grobidHome as string, "config/grobid.yaml"));
      GrobidHomeFinder.LOGGER.info(
        "Grobid config file location was not explicitly set via '" +
          GrobidHomeFinder.PROP_GROBID_CONFIG +
          "' system variable, defaulting to: " +
          grobidConfigFile,
      );
    } else {
      grobidConfigFile = path.resolve(grobidConfig);
    }

    let cfgStat: fs.Stats | null;
    try {
      cfgStat = fs.statSync(grobidConfigFile);
    } catch {
      cfgStat = null;
    }
    if (cfgStat === null || cfgStat.isDirectory()) {
      GrobidHomeFinder.fail(
        "Grobid property file '" + grobidConfigFile + "' does not exist or a directory",
      );
    }
    return grobidConfigFile;
  }

  private static fail(msg: string, e?: unknown): never {
    throw new GrobidPropertyException(msg, e);
  }

  /**
   * Look up a Java-style system property. The Node port reads both
   * environment variables (`ORG_GROBID_HOME`) and a `--D<prop>=<val>` style
   * mapping pre-populated on `process.env._JAVA_SYSTEM_PROPERTIES` if the
   * host bootstrap chose to expose one. Returns `null` when unset.
   */
  private static getSystemProperty(name: string): string | null {
    // Convention: org.grobid.home → ORG_GROBID_HOME
    const envName = name.toUpperCase().replace(/\./g, "_");
    const v = process.env[envName];
    if (v !== undefined && v.length !== 0) return v;
    const v2 = process.env[name];
    if (v2 !== undefined && v2.length !== 0) return v2;
    return null;
  }

  private getGrobidHomePathOrLoadFromClasspath(): string {
    const grobidHomeProperty = GrobidHomeFinder.getSystemProperty(GrobidHomeFinder.PROP_GROBID_HOME);
    if (grobidHomeProperty !== null) {
      try {
        const url = new urlMod.URL(grobidHomeProperty);
        if (url.protocol === "file:") {
          return urlMod.fileURLToPath(url);
        } else if (url.protocol === "http:" || url.protocol === "https:") {
          // to do, download and cache
          try {
            return GrobidHomeFinder.unzipToTempFile(url, false);
          } catch (e) {
            GrobidHomeFinder.fail("Cannot fetch Grobid home from: " + url, e);
          }
        }
      } catch {
        // just normal path, return it
        return grobidHomeProperty;
      }
    } else {
      GrobidHomeFinder.LOGGER.info(
        "No Grobid property was provided. Attempting to find Grobid home in the current directory...",
      );
      for (const possibleName of this.grobidHomePossibleLocations) {
        if (fs.existsSync(possibleName)) {
          return path.resolve(possibleName);
        }
      }

      GrobidHomeFinder.LOGGER.info("Attempting to find and in the classpath...");

      // TODO: inject a descriptive file into Grobid home
      //
      // ADAPTATION: There is no Java-style classpath at runtime in Node, so
      // we look for a packaged grobid-home alongside this module. If the
      // package is installed as `grobid-js`, the bundled grobid-home (if
      // any) lives at `<pkg>/grobid-home/` — search a couple of well-known
      // relative paths. Mirrors the upstream `getResource("/grobid-home/...")`
      // lookup that resolves to either a directory on the classpath or to a
      // jar entry.
      const here = path.dirname(urlMod.fileURLToPath(import.meta.url));
      const candidates = [
        path.resolve(here, "../../../grobid-home"),
        path.resolve(here, "../../../../grobid-home"),
      ];
      for (const c of candidates) {
        if (fs.existsSync(path.join(c, "lexicon/names/firstname.5k"))) {
          return c;
        }
      }
      GrobidHomeFinder.fail("No Grobid home was found in classpath and no Grobid home location was not provided");
    }
    GrobidHomeFinder.fail(
      "Cannot locate Grobid home: add it to classpath or explicitly provide a system property: '-D" +
        GrobidHomeFinder.PROP_GROBID_HOME +
        "'",
    );
    // not reachable code since exception is thrown
    return null as unknown as string;
  }

  private static unzipToTempFile(zipUrl: urlMod.URL, forceReload: boolean): string {
    const hash = crypto
      .createHash("md5")
      .update(zipUrl.toString(), "utf-8")
      .digest("hex");
    const tempRootDir = os.tmpdir();
    const userName = os.userInfo().username;

    const grobidHome = path.join(tempRootDir, "grobid-home-" + userName + "-" + hash);
    GrobidHomeFinder.LOGGER.info("Extracting and caching Grobid home to " + grobidHome);

    if (fs.existsSync(grobidHome)) {
      if (forceReload) {
        fs.rmSync(grobidHome, { recursive: true, force: true });
      } else {
        GrobidHomeFinder.LOGGER.warn(
          "Grobid home already cached under: " + grobidHome + "; delete it if you want a new copy",
        );
        return path.join(grobidHome, "grobid-home");
      }
    }

    try {
      fs.mkdirSync(grobidHome);
    } catch {
      GrobidHomeFinder.fail("Cannot create folder for Grobid home: " + grobidHome);
    }
    const buf = GrobidHomeFinder.openStream(zipUrl);
    GrobidHomeFinder.unzip(buf, grobidHome);

    return path.join(grobidHome, "grobid-home");
  }

  /**
   * Synchronously fetch a URL's bytes into a buffer, mirroring Java's
   * blocking `URL.openStream()`. Implemented by spawning `curl` (commonly
   * available on Node deployment targets); falls back to a hard error if
   * curl is not on PATH. Upstream is also synchronous here.
   */
  private static openStream(zipUrl: urlMod.URL): Buffer {
    try {
      return execFileSync("curl", ["-fsSL", zipUrl.toString()], {
        maxBuffer: 1024 * 1024 * 1024,
      }) as Buffer;
    } catch (e) {
      GrobidHomeFinder.fail("Cannot fetch URL " + zipUrl.toString(), e);
      // unreachable
      return Buffer.alloc(0);
    }
  }

  /**
   * Extract a ZIP archive byte buffer into `destinationDir`, mirroring
   * upstream's ZipInputStream loop. Uses `node:zlib`-based decompression of
   * each local-file-header entry parsed inline (no third-party dependency).
   * Returns the list of extracted paths (always empty in upstream too).
   */
  private static unzip(is: Buffer, destinationDir: string): string[] {
    const list: string[] = [];
    // ZIP local file header signature: 0x04034b50 (little-endian).
    // We only need to traverse local headers; the central directory at the
    // end is unused by upstream's ZipInputStream as well.
    let off = 0;
    while (off + 30 <= is.length) {
      const sig = is.readUInt32LE(off);
      if (sig !== 0x04034b50) break; // end of local entries
      const compressionMethod = is.readUInt16LE(off + 8);
      const compressedSize = is.readUInt32LE(off + 18);
      const uncompressedSize = is.readUInt32LE(off + 22);
      const fileNameLen = is.readUInt16LE(off + 26);
      const extraLen = is.readUInt16LE(off + 28);
      const nameStart = off + 30;
      const dataStart = nameStart + fileNameLen + extraLen;
      const name = is.slice(nameStart, nameStart + fileNameLen).toString("utf-8");
      const compressed = is.slice(dataStart, dataStart + compressedSize);
      const filePath = path.normalize(path.join(destinationDir, name));
      if (!filePath.startsWith(path.normalize(destinationDir))) {
        throw new Error("Bad zip entry: " + name);
      }
      const isDirectory = name.endsWith("/");
      try {
        if (!isDirectory) {
          let bytes: Buffer;
          if (compressionMethod === 0) {
            bytes = compressed;
          } else if (compressionMethod === 8) {
            bytes = zlib.inflateRawSync(compressed);
          } else {
            throw new Error(
              "Unsupported ZIP compression method " + compressionMethod + " for entry " + name,
            );
          }
          GrobidHomeFinder.extractFile(bytes, filePath);
          if (bytes.length !== uncompressedSize) {
            // not fatal, but log
            GrobidHomeFinder.LOGGER.debug(
              "Unzip size mismatch for " + name + ": expected " + uncompressedSize + " got " + bytes.length,
            );
          }
        } else {
          fs.mkdirSync(filePath, { recursive: true });
        }
      } finally {
        off = dataStart + compressedSize;
      }
    }
    return list;
  }

  private static extractFile(bytes: Buffer, filePath: string): void {
    const parent = path.dirname(filePath);
    if (!fs.existsSync(parent)) {
      try {
        fs.mkdirSync(parent, { recursive: true });
      } catch {
        throw new Error("Cannot create parent folders: " + parent);
      }
    }
    // Write in BUFFER_SIZE chunks to mirror upstream's BufferedOutputStream loop.
    const fd = fs.openSync(filePath, "w");
    try {
      let written = 0;
      while (written < bytes.length) {
        const chunkLen = Math.min(GrobidHomeFinder.BUFFER_SIZE, bytes.length - written);
        fs.writeSync(fd, bytes, written, chunkLen);
        written += chunkLen;
      }
    } finally {
      fs.closeSync(fd);
    }
  }

  static main(_args: string[]): void {
    const t = Date.now();
    const grobidHomePathOrLoadFromClasspath = new GrobidHomeFinder().findGrobidHomeOrFail();
    // eslint-disable-next-line no-console
    console.log(grobidHomePathOrLoadFromClasspath);

    // eslint-disable-next-line no-console
    console.log("Took: " + (Date.now() - t));
  }
}
