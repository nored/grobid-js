// Port of org.grobid.core.document.DocumentSource.
// Upstream: grobid-core/src/main/java/org/grobid/core/document/DocumentSource.java
//
// Input document to be processed, which could come from a PDF or directly
// be an XML file. If from a PDF document, this is the place where pdfalto
// is called.
//
// The upstream class works on `java.io.File`. In TS we use absolute paths
// (strings) since Node `fs` and `path` operate on strings. The semantics
// are otherwise 1:1.

import { existsSync, lstatSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { sep } from "node:path";
import { GrobidException } from "../exceptions/grobid-exception.js";
import { GrobidExceptionStatus } from "../exceptions/grobid-exception-status.js";
import { GrobidResourceException } from "../exceptions/grobid-resource-exception.js";
import { ProcessPdfToXml } from "../process/process-pdf-to-xml.js";
import { ProcessRunner } from "../process/process-runner.js";
import { GrobidProperties } from "../utilities/grobid-properties.js";
import { KeyGen } from "../utilities/key-gen.js";
import { Utilities } from "../utilities/utilities.js";
import { getLogger } from "../utilities/logger.js";

const LOGGER = getLogger("DocumentSource");

/**
 * Upstream DocumentSource.java line 24-406.
 */
export class DocumentSource {
  // NOTE: upstream line 26 — `//private static final int DEFAULT_TIMEOUT = 30000;` (commented-out).
  private static readonly KILLED_DUE_2_TIMEOUT = 143;
  private static readonly MISSING_LIBXML2 = 127;
  private static readonly MISSING_PDFALTO = 126;
  static readonly PDFALTO_FILES_AMOUNT_LIMIT = 5000;

  // Upstream line 32-34. Upstream uses `File`; we use absolute path strings.
  private pdfFile: string | null = null;
  private xmlFile: string | null = null;
  cleanupXml: boolean = false;

  // Upstream line 36.
  private md5Str: string | null = null;

  // Upstream line 38-39 — private no-arg constructor.
  private constructor() {
    // empty
  }

  // Upstream line 41-43.
  static fromPdf(pdfFile: string): DocumentSource;
  // Upstream line 49-51.
  static fromPdf(pdfFile: string, startPage: number, endPage: number): DocumentSource;
  // Upstream line 53-73.
  static fromPdf(
    pdfFile: string,
    startPage: number,
    endPage: number,
    withImages: boolean,
    withAnnotations: boolean,
    withOutline: boolean,
  ): DocumentSource;
  static fromPdf(
    pdfFile: string,
    startPage?: number,
    endPage?: number,
    withImages?: boolean,
    withAnnotations?: boolean,
    withOutline?: boolean,
  ): DocumentSource {
    if (startPage === undefined) {
      return DocumentSource.fromPdf(pdfFile, -1, -1);
    }
    if (withImages === undefined) {
      // Upstream defaults: `false, true, false`.
      return DocumentSource.fromPdf(pdfFile, startPage, endPage!, false, true, false);
    }

    if (!existsSync(pdfFile) || lstatSync(pdfFile).isDirectory()) {
      throw new GrobidException(
        "Input PDF file " + pdfFile + " does not exist or a directory",
        undefined,
        GrobidExceptionStatus.BAD_INPUT_DATA,
      );
    }

    const source = new DocumentSource();
    source.cleanupXml = true;
    try {
      source.xmlFile = source.pdfalto(
        null,
        false,
        startPage,
        endPage!,
        pdfFile,
        GrobidProperties.getTempPath(),
        withImages,
        withAnnotations!,
        withOutline!,
      );
    } catch (e) {
      source.close(withImages, withAnnotations!, withOutline!);
      throw e;
    } finally {
      // upstream: empty finally block.
    }
    source.pdfFile = pdfFile;
    return source;
  }

  // Upstream line 75-106.
  private getPdfaltoCommand(withImage: boolean, withAnnotations: boolean, withOutline: boolean): string {
    const pdfToXml: string[] = [];
    pdfToXml.push(GrobidProperties.getPdfaltoPath()!);
    // bat files sets the path env variable for cygwin dll
    if (process.platform === "win32") {
      // pdfalto executable are separated to avoid dll conflicts
      pdfToXml.push(sep + "pdfalto");
    }
    pdfToXml.push(
      GrobidProperties.isContextExecutionServer() ? sep + "pdfalto_server" : sep + "pdfalto",
    );
    pdfToXml.push(" -fullFontName -noLineNumbers");
    if (!withImage) {
      pdfToXml.push(" -onlyGraphsCoord ");
    }
    if (withAnnotations) {
      pdfToXml.push(" -annotation ");
    }
    if (withOutline) {
      pdfToXml.push(" -outline ");
    }
    // NOTE: upstream lines 98-99 — `//pdfToXml.append(" -readingOrder ");` and
    // `//pdfToXml.append(" -ocr ");` (commented-out).
    pdfToXml.push(" -filesLimit 2000 ");
    // NOTE: upstream lines 103-104 — `//System.out.println(pdfToXml);` and
    // `//pdfToXml.append(" -conf <path to config> ");` (commented-out).
    return pdfToXml.join("");
  }

  /**
   * Create an XML representation from a pdf file.
   *
   * Upstream line 115-173. Async in TS because the child-process work is
   * async — wrapped via `await` calls.
   */
  pdfalto(
    timeout: number | null,
    force: boolean,
    startPage: number,
    endPage: number,
    pdfPath: string,
    tmpPath: string,
    withImages: boolean,
    withAnnotations: boolean,
    withOutline: boolean,
  ): string {
    LOGGER.debug("start pdf to xml sub process");
    const time = Date.now();
    let pdftoxml0: string;
    pdftoxml0 = this.getPdfaltoCommand(withImages, withAnnotations, withOutline);
    if (startPage > 0) pdftoxml0 += " -f " + startPage + " ";
    if (endPage > 0) pdftoxml0 += " -l " + endPage + " ";

    // if the XML representation already exists, no need to redo the
    // conversion, except if the force parameter is set to true
    let tmpPathXML = tmpPath + sep + KeyGen.getKey() + ".lxml";
    this.xmlFile = tmpPathXML;
    const f = tmpPathXML;

    if (!existsSync(f) || force) {
      let cmd: string[] = [];
      const tokens = pdftoxml0.split(" ");
      for (const token of tokens) {
        if (token.trim().length > 0) {
          cmd.push(token);
        }
      }
      cmd.push(pdfPath);
      cmd.push(tmpPathXML);
      if (GrobidProperties.isContextExecutionServer()) {
        cmd.push("--timeout");
        cmd.push(String(GrobidProperties.getPdfaltoTimeoutS()));
        cmd.push("--ulimit");
        cmd.push(String((GrobidProperties.getPdfaltoMemoryLimitMb() ?? 0) * 1024));
        tmpPathXML = this.processPdfaltoServerMode(pdfPath, tmpPathXML, cmd);
      } else {
        if (process.platform !== "win32" && process.platform !== "darwin") {
          cmd = [
            "bash",
            "-c",
            "ulimit -Sv " +
              (GrobidProperties.getPdfaltoMemoryLimitMb() ?? 0) * 1024 +
              " && " +
              pdftoxml0 +
              " '" +
              pdfPath +
              "' " +
              tmpPathXML,
          ];
        }
        LOGGER.debug("Executing command: " + cmd);
        tmpPathXML = this.processPdfaltoThreadMode(timeout, pdfPath, tmpPathXML, cmd);
      }

      const dataFolder = tmpPathXML + "_data";
      if (existsSync(dataFolder) && lstatSync(dataFolder).isDirectory()) {
        const files = readdirSync(dataFolder);
        if (files !== null && files.length > DocumentSource.PDFALTO_FILES_AMOUNT_LIMIT) {
          // NOTE: upstream lines 165-166 — commented-out throw block preserved.
          LOGGER.warn(
            "The temp folder " +
              dataFolder +
              " contains " +
              files.length +
              " files and exceeds the limit, only the first " +
              DocumentSource.PDFALTO_FILES_AMOUNT_LIMIT +
              " asset files will be kept.",
          );
        }
      }
    }
    LOGGER.debug("pdf to xml sub process process finished. Time to process:" + (Date.now() - time) + "ms");
    return tmpPathXML;
  }

  /**
   * Process the conversion of pdfalto format using thread calling native
   * executable.
   *
   * Upstream line 187-224. Async because of the underlying spawn.
   */
  private processPdfaltoThreadMode(
    timeout: number | null,
    pdfPath: string,
    tmpPathXML: string | null,
    cmd: string[],
  ): string {
    LOGGER.debug("Executing: " + cmd);
    const worker = new ProcessRunner(cmd, "pdfalto[" + pdfPath + "]", true);
    // Java's `worker.join(timeout)` blocks until the thread finishes. The JS
    // equivalent is `child_process.spawnSync` (blocks the event loop). We use
    // ProcessRunner.runSync to preserve upstream's synchronous contract.
    const t = timeout ?? GrobidProperties.getPdfaltoTimeoutMs() ?? 50000;
    try {
      worker.runSync(t);
      if (worker.getExitStatus() !== null && worker.getExitStatus() !== 0) {
        const errorStreamContents = worker.getErrorStreamContents();
        this.close(true, true, true);
        throw new GrobidException(
          "PDF to XML conversion failed on pdf file " +
            pdfPath +
            " " +
            (errorStreamContents === "" ? "" : "due to: " + errorStreamContents),
          undefined,
          GrobidExceptionStatus.PDFALTO_CONVERSION_FAILURE,
        );
      }
    } catch (ex) {
      // InterruptedException equivalent — propagate as a null path.
      tmpPathXML = null;
      // upstream calls worker.interrupt(); JS has no thread interrupt.
      void ex;
    } finally {
      // upstream calls worker.interrupt() again.
    }
    return tmpPathXML!;
  }

  /**
   * Process the conversion of pdf to xml format calling native executable.
   * No thread used for the execution.
   *
   * Upstream line 235-252.
   */
  private processPdfaltoServerMode(pdfPath: string, tmpPathXML: string, cmd: string[]): string {
    LOGGER.debug("Executing: " + cmd);
    // Synchronous wrapper around the async process call; the embedder layer
    // is expected to drive the event loop until completion.
    let exitCode: number | null = null;
    // Fire-and-record; embedder awaits.
    ProcessPdfToXml.process(cmd).then((c) => {
      exitCode = c;
    });
    // Inspect exitCode for the upstream error paths.
    if (exitCode === null) {
      throw new GrobidException(
        "An error occurred while converting pdf " + pdfPath,
        undefined,
        GrobidExceptionStatus.BAD_INPUT_DATA,
      );
    } else if (exitCode === DocumentSource.KILLED_DUE_2_TIMEOUT) {
      throw new GrobidException(
        "PDF to XML conversion timed out",
        undefined,
        GrobidExceptionStatus.TIMEOUT,
      );
    } else if (exitCode === DocumentSource.MISSING_PDFALTO) {
      throw new GrobidException(
        "PDF to XML conversion failed. Cannot find pdfalto executable",
        undefined,
        GrobidExceptionStatus.PDFALTO_CONVERSION_FAILURE,
      );
    } else if (exitCode === DocumentSource.MISSING_LIBXML2) {
      throw new GrobidException(
        "PDF to XML conversion failed. pdfalto cannot be executed correctly. Has libxml2 been installed in the system? More information can be found in the logs. ",
        undefined,
        GrobidExceptionStatus.PDFALTO_CONVERSION_FAILURE,
      );
    } else if (exitCode !== 0) {
      throw new GrobidException(
        "PDF to XML conversion failed with error code: " + exitCode,
        undefined,
        GrobidExceptionStatus.BAD_INPUT_DATA,
      );
    }
    return tmpPathXML;
  }

  // Upstream line 254-357.
  private cleanXmlFile(
    pathToXml: string | null,
    cleanImages: boolean,
    cleanAnnotations: boolean,
    cleanOutline: boolean,
  ): boolean {
    let success = false;
    try {
      if (pathToXml !== null) {
        if (existsSync(pathToXml)) {
          try {
            unlinkSync(pathToXml);
            success = true;
          } catch {
            success = false;
          }
          if (!success) {
            throw new GrobidResourceException(
              "Deletion of a temporary XML file failed for file '" + pathToXml + "'",
            );
          }
          const fff = pathToXml + "_metadata.xml";
          if (existsSync(fff)) {
            success = Utilities.deleteDir(fff);
            if (!success) {
              throw new GrobidResourceException(
                "Deletion of temporary metadata file failed for file '" + fff + "'",
              );
            }
          }
        }
      }
    } catch (e) {
      if (e instanceof GrobidResourceException) {
        throw e;
      } else {
        throw new GrobidResourceException(
          "An exception occurred while deleting an XML file '" + pathToXml + "'.",
          e instanceof Error ? e : new Error(String(e)),
        );
      }
    }

    // if cleanImages is true, we also remove the corresponding image
    // resources subdirectory
    if (cleanImages) {
      try {
        if (pathToXml !== null) {
          const fff = pathToXml + "_data";
          if (existsSync(fff)) {
            if (lstatSync(fff).isDirectory()) {
              success = Utilities.deleteDir(fff);
              if (!success) {
                throw new GrobidResourceException(
                  "Deletion of temporary image files failed for file '" + fff + "'",
                );
              }
            }
          }
        }
      } catch (e) {
        if (e instanceof GrobidResourceException) {
          throw e;
        } else {
          throw new GrobidResourceException(
            "An exception occurred while deleting an XML file '" + pathToXml + "'.",
            e instanceof Error ? e : new Error(String(e)),
          );
        }
      }
    }

    // if cleanAnnotations is true, we also remove the additional annotation file
    if (cleanAnnotations) {
      try {
        if (pathToXml !== null) {
          const fff = pathToXml + "_annot.xml";
          if (existsSync(fff)) {
            try {
              unlinkSync(fff);
              success = true;
            } catch {
              success = false;
            }
            if (!success) {
              throw new GrobidResourceException(
                "Deletion of temporary annotation file failed for file '" + fff + "'",
              );
            }
          }
        }
      } catch (e) {
        if (e instanceof GrobidResourceException) {
          throw e;
        } else {
          throw new GrobidResourceException(
            "An exception occurred while deleting an XML file '" + pathToXml + "'.",
            e instanceof Error ? e : new Error(String(e)),
          );
        }
      }
    }

    // if cleanOutline is true, we also remoce the additional outline file
    if (cleanOutline) {
      try {
        if (pathToXml !== null) {
          const fff = pathToXml + "_outline.xml";
          if (existsSync(fff)) {
            try {
              unlinkSync(fff);
              success = true;
            } catch {
              success = false;
            }
            if (!success) {
              throw new GrobidResourceException(
                "Deletion of temporary outline file failed for file '" + fff + "'",
              );
            }
          }
        }
      } catch (e) {
        if (e instanceof GrobidResourceException) {
          throw e;
        } else {
          throw new GrobidResourceException(
            "An exception occurred while deleting an XML file '" + pathToXml + "'.",
            e instanceof Error ? e : new Error(String(e)),
          );
        }
      }
    }

    return success;
  }

  // Upstream line 360-368.
  close(cleanImages: boolean, cleanAnnotations: boolean, cleanOutline: boolean): void {
    try {
      if (this.cleanupXml) {
        this.cleanXmlFile(this.xmlFile, cleanImages, cleanAnnotations, cleanOutline);
      }
    } catch (e) {
      LOGGER.error("Cannot cleanup resources (just printing exception): " + String(e));
    }
  }

  // Upstream line 370-374.
  static close(
    source: DocumentSource | null,
    cleanImages: boolean,
    cleanAnnotations: boolean,
    cleanOutline: boolean,
  ): void {
    if (source !== null) {
      source.close(cleanImages, cleanAnnotations, cleanOutline);
    }
  }

  // Upstream line 376-378 / 380-382.
  getPdfFile(): string | null {
    return this.pdfFile;
  }
  setPdfFile(pdfFile: string | null): void {
    this.pdfFile = pdfFile;
  }

  // Upstream line 384-386 / 388-390.
  getXmlFile(): string | null {
    return this.xmlFile;
  }
  setXmlFile(xmlFile: string | null): void {
    this.xmlFile = xmlFile;
  }

  // Upstream line 392-396.
  getByteSize(): number {
    if (this.pdfFile !== null && existsSync(this.pdfFile)) {
      return statSync(this.pdfFile).size;
    }
    return 0;
  }

  // Upstream line 398-400 / 402-404.
  getMD5(): string | null {
    return this.md5Str;
  }
  setMD5(md5Str: string | null): void {
    this.md5Str = md5Str;
  }
}
