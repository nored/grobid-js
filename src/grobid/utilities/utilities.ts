// Port of org.grobid.core.utilities.Utilities.
// Upstream: grobid-core/src/main/java/org/grobid/core/utilities/Utilities.java
//
// Some utilities methods that I don't know where to put.

import * as fs from "node:fs";
import * as path from "node:path";

import { BiblioItem } from "../data/biblio-item.js";
import { GrobidException } from "../exceptions/grobid-exception.js";
import { LayoutToken } from "../layout/layout-token.js";
import { OffsetPosition } from "./offset-position.js";
import { TextUtilities } from "./text-utilities.js";

/**
 * Mirrors `org.apache.commons.lang3.StringUtils.isEmpty`.
 */
function isEmptyStr(s: string | null | undefined): boolean {
  return s === null || s === undefined || s.length === 0;
}

/** Mirrors `StringUtils.isNotBlank` (non-null, length > 0, contains non-whitespace). */
function isNotBlank(s: string | null | undefined): boolean {
  if (s === null || s === undefined) return false;
  for (let i = 0; i < s.length; i++) {
    if (!/\s/.test(s.charAt(i))) return true;
  }
  return false;
}

/** Mirrors `StringUtils.equals(a, b)` (null-safe). */
function strEquals(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return a === b;
}

/** Mirrors `CollectionUtils.isEmpty` for arrays / iterables. */
function isCollectionEmpty<T>(c: T[] | null | undefined): boolean {
  return c === null || c === undefined || c.length === 0;
}

export class Utilities {
  /**
   * Deletes all files and subdirectories under dir. Returns true if all
   * deletions were successful. If a deletion fails, the method stops
   * attempting to delete and returns false.
   */
  static deleteDir(dir: string): boolean {
    let isDirectory = false;
    try {
      isDirectory = fs.statSync(dir).isDirectory();
    } catch {
      isDirectory = false;
    }
    if (isDirectory) {
      //String[] children = dir.list();
      let children: string[] = [];
      try {
        children = fs.readdirSync(dir);
      } catch {
        children = [];
      }
      for (let i = 0; i < children.length; i++) {
        const success = Utilities.deleteDir(path.join(dir, children[i]!));
        if (!success) {
          return false;
        }
      }
    }
    // the directory is now empty so delete it
    try {
      if (isDirectory) {
        fs.rmdirSync(dir);
      } else {
        fs.unlinkSync(dir);
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Download `urlmsg` and write the body to `path/name`. Returns the full
   * destination path on success.
   *
   * Upstream is synchronous (URL.openStream + read loop). To preserve the
   * upstream control flow we use a synchronous XHR-style fetch via
   * `fetch + Atomics.wait` is impractical in Node, so the TS port falls back
   * to `node:http`/`node:https` synchronous wrappers… which don't exist.
   * The simplest faithful mapping is to require the caller to pre-fetch the
   * bytes and pass them in, OR keep the method synchronous by using
   * `child_process.execSync` to call `curl`. Since the method is rarely used
   * and Node 20+ has top-level await available to callers, the TS port
   * exposes a synchronous signature but internally throws if no network
   * adapter is wired. Callers in src/node/ should prefer their own async
   * variant. The method preserves the upstream error semantics.
   */
  static uploadFile(urlmsg: string, pathArg: string, name: string): string {
    try {
      console.log("Sending: " + urlmsg);
      // The closest synchronous fetch in Node 20+ is via `XMLHttpRequest`-less
      // approach; node:net cannot easily synchronously download HTTPS. We use
      // the experimental `fetch` API in async form and wait via Atomics is not
      // safe. Instead, we go through a small synchronous helper: write through
      // a pre-provided downloader callable on the global, or fall back to an
      // error mirroring upstream's "exception while running Grobid".
      const downloader = (globalThis as unknown as { __grobidSyncDownload?: (url: string) => Uint8Array }).__grobidSyncDownload;
      let body: Uint8Array;
      if (typeof downloader === "function") {
        body = downloader(urlmsg);
      } else {
        throw new Error(
          "Utilities.uploadFile: no synchronous downloader installed. " +
            "Install one by setting globalThis.__grobidSyncDownload = (url) => Uint8Array.",
        );
      }
      const outFile = path.join(pathArg, name);
      // Serve the file: stream 4K at a time mirroring upstream's `byte[4*1024]` buffer.
      const fd = fs.openSync(outFile, "w");
      try {
        const bufSize = 4 * 1024;
        let offset = 0;
        while (offset < body.length) {
          const bytesRead = Math.min(bufSize, body.length - offset);
          fs.writeSync(fd, body, offset, bytesRead, null);
          offset += bytesRead;
        }
      } finally {
        fs.closeSync(fd);
      }
      return pathArg + name;
    } catch (e) {
      throw new GrobidException("An exception occurred while running Grobid.", e);
    }
  }

  static punctuationsSub = "([,;])";

  /**
   * Special cleaning for ZFN extracted data in a BiblioItem
   * @deprecated mirrors upstream `@Deprecated`
   */
  static cleanZFNMetadata(item: BiblioItem): BiblioItem {
    // general cleaning: remove brackets, parenthesis, etc.

    // date
    if (item.getPublicationDate() !== null) {
      let new_date = "";
      const pd = item.getPublicationDate()!;
      for (let i = 0; i < pd.length; i++) {
        const c = pd.charAt(i);
        if (TextUtilities.fullPunctuations.indexOf(c) === -1) new_date += c;
      }
      item.setPublicationDate(new_date.trim());
    }

    // affiliation
    let affiliation = item.getAffiliation();
    if (affiliation !== null) {
      if (affiliation.startsWith("Aus dem")) affiliation = affiliation.replace("Aus dem", "");
      if (affiliation.startsWith("Aus der")) affiliation = affiliation.replace("Aus der", "");
      affiliation = affiliation.trim();
      item.setAffiliation(affiliation);
    }

    // journal
    let journal = item.getJournal();
    if (journal !== null) {
      let new_journal = "";
      for (let i = 0; i < journal.length; i++) {
        const c = journal.charAt(i);
        if (Utilities.punctuationsSub.indexOf(c) === -1) new_journal += c;
      }
      journal = new_journal.trim();
      journal = journal.replace(/ \./g, ".");
      if ((journal.startsWith(",")) || (journal.startsWith("."))) {
        journal = journal.substring(1, journal.length).trim();
      }
      item.setJournal(journal);
    }

    // page block
    let pageRange = item.getPageRange();
    if (pageRange !== null) {
      let new_pageRange = "";
      for (let i = 0; i < pageRange.length; i++) {
        const c = pageRange.charAt(i);
        if (Utilities.punctuationsSub.indexOf(c) === -1) new_pageRange += c;
      }
      pageRange = new_pageRange.trim();
      item.setPageRange(pageRange);
    }

    // note
    let note = item.getNote();
    if (note !== null) {
      let new_note = "";
      for (let i = 0; i < note.length; i++) {
        const c = note.charAt(i);
        if (Utilities.punctuationsSub.indexOf(c) === -1) new_note += c;
      }
      note = new_note.trim();
      note = note.replace(/ \./g, ".");
      note = note.replace(/\.\.\./g, ".");
      note = note.replace(/\.\./g, ".");
      if ((note.startsWith(",")) || (note.startsWith("."))) {
        note = note.substring(1, note.length).trim();
      }
      //note = note.replace("@BULLET", " • ");
      item.setNote(note);
    }

    // submission
    let submission = item.getSubmission();
    if (submission !== null) {
      let new_submission = "";
      for (let i = 0; i < submission.length; i++) {
        const c = submission.charAt(i);
        if (Utilities.punctuationsSub.indexOf(c) === -1) new_submission += c;
      }
      submission = new_submission.trim();
      submission = submission.replace(/ \./g, ".");
      submission = submission.replace(/\.\.\./g, ".");
      submission = submission.replace(/\.\./g, ".");
      if ((submission.startsWith(",")) || (submission.startsWith("."))) {
        submission = submission.substring(1, submission.length).trim();
      }
      //submission = submission.replace("@BULLET", " • ");
      item.setSubmission(submission);
    }

    // dedication
    let dedication = item.getDedication();
    if (dedication !== null) {
      let new_dedication = "";
      for (let i = 0; i < dedication.length; i++) {
        const c = dedication.charAt(i);
        if (Utilities.punctuationsSub.indexOf(c) === -1) new_dedication += c;
      }
      dedication = new_dedication.trim();
      dedication = dedication.replace(/ \./g, ".");
      dedication = dedication.replace(/\.\.\./g, ".");
      dedication = dedication.replace(/\.\./g, ".");
      if ((dedication.startsWith(",")) || (dedication.startsWith("."))) {
        dedication = dedication.substring(1, dedication.length).trim();
      }
      //dedication = dedication.replace("@BULLET", " • ");
      item.setDedication(dedication);
    }

    // title
    let title = item.getTitle();
    if (title !== null) {
      if (title.endsWith("'")) {
        title = title.substring(0, title.length - 1).trim();
      }
      //title = title.replace("@BULLET", " • ");
      item.setTitle(title);
    }

    // English title
    let english_title = item.getEnglishTitle();
    if (english_title !== null) {
      if (english_title.endsWith("'")) {
        english_title = english_title.substring(0, english_title.length - 1).trim();
      }
      //english_title = english_title.replace("@BULLET", " • ");
      item.setEnglishTitle(english_title);
    }

    // abstract
    let abstract_ = item.getAbstract();
    if (abstract_ !== null) {
      if (abstract_.startsWith(") ")) {
        abstract_ = abstract_.substring(1, abstract_.length).trim();
      }
      //abstract_ = abstract_.replace("@BULLET", " • ");
      item.setAbstract(abstract_);
    }

    // address
    let address = item.getAddress();
    if (address !== null) {
      // Note: upstream has `address.replace("\t", " ");` whose return value is
      // discarded; mirror the quirk verbatim.
      address.replace(/\t/g, " ");
      address = address.trim();
      if ((address.startsWith(",")) || (address.startsWith("("))) {
        address = address.substring(1, address.length).trim();
      }
      if (address.endsWith(")")) {
        address = address.substring(0, address.length - 1).trim();
      }
      item.setAddress(address);
    }

    // email
    let email = item.getEmail();
    if (email !== null) {
      if (email.startsWith("E-mail :")) {
        email = email.replace("E-mail :", "").trim();
        item.setEmail(email);
      }
    }

    // authors
    let authors = item.getAuthors();
    if (authors !== null) {
      authors = authors.replace(/0\. /g, "O. ");
      item.setAuthors(authors);
    }

    // keywords
    let keyword = item.getKeyword();
    if (keyword !== null) {
      if (keyword.startsWith(":")) {
        keyword = keyword.substring(1, keyword.length).trim();
        item.setKeyword(keyword);
      }
    }

    return item;
  }

  /**
   * Return the name of directory to use given the os and the architecture.
   *
   * Possibles returned values should match one of the following:
   *   win-32
   *   lin-32
   *   lin-64
   *   mac-64
   *
   * @return name of the directory corresponding to the os name and architecture.
   */
  static getOsNameAndArch(): string {
    // System.getProperty("os.name") returns e.g. "Mac OS X", "Linux", "Windows 10".
    // The TS port reads from process.platform / process.arch which are not
    // identical; we map them to mirror the upstream substring(0,3) outcome.
    let osPart: string;
    const nodePlat = typeof process !== "undefined" ? process.platform : "";
    switch (nodePlat) {
      case "darwin":
        osPart = "macosx";
        break;
      case "linux":
        osPart = "linux";
        break;
      case "win32":
      case "cygwin":
        osPart = "windows";
        break;
      default:
        osPart = nodePlat;
    }
    osPart = osPart.replace(/ /g, "").toLowerCase().substring(0, 3);
    if (strEquals(osPart, "mac") || strEquals(osPart, "lin")) {
      const nodeArch = typeof process !== "undefined" ? process.arch : "";
      if (strEquals(nodeArch, "arm64")) {
        // node 'arm64' === Java 'aarch64'
        osPart = osPart + "_arm";
      }
    }
    // System.getProperty("sun.arch.data.model") is "32" or "64".
    const archPart =
      typeof process !== "undefined" && (process.arch === "x64" || process.arch === "arm64") ? "64" : "32";
    return `${osPart}-${archPart}`;
  }

  /**
   * Convert a string to boolean.
   *
   * @param value the value to convert
   * @return true if the string value is "true", false is it equals to "false".
   *         If the value does not correspond to one of these 2 values, return false.
   */
  static stringToBoolean(value: string | null): boolean {
    let res = false;
    if (isNotBlank(value) && "true".toLowerCase() === value!.trim().toLowerCase()) {
      res = true;
    }
    return res;
  }

  /**
   * Call a "method" using the method name given in string. The TS port uses
   * dynamic property access (`obj[methodName](...args)`) in place of Java
   * reflection. The signature mirrors upstream.
   */
  static launchMethod(obj: unknown, args: unknown[] | null, methodName: string): unknown;
  static launchMethod(
    obj: unknown,
    args: unknown[] | null,
    paramTypes: unknown[] | null,
    methodName: string,
  ): unknown;
  static launchMethod(
    obj: unknown,
    args: unknown[] | null,
    paramTypesOrMethodName: unknown[] | null | string,
    methodName?: string,
  ): unknown {
    let name: string;
    if (typeof paramTypesOrMethodName === "string") {
      name = paramTypesOrMethodName;
    } else {
      // upstream second overload: paramTypes ignored at runtime in JS
      name = methodName!;
    }

    if (isEmptyStr(name)) {
      throw new GrobidException(
        "Missing method in command line. To specify with -exe [methodName]. " + name,
      );
    }
    const method = Utilities.getMethod(obj, null, name);
    const argList = args ?? [];
    return (method as (...a: unknown[]) => unknown).apply(obj, argList);
  }

  /**
   * Get the method given in string in input corresponding to the given
   * arguments.
   *
   * @return the method (function reference) bound nominally to `obj`.
   */
  static getMethod(obj: unknown, paramTypes: unknown[] | null, methodName: string): unknown {
    void paramTypes;
    if (obj === null || obj === undefined) {
      throw new Error("NoSuchMethodException: target object is null");
    }
    const fn = (obj as Record<string, unknown>)[methodName];
    if (typeof fn !== "function") {
      throw new Error("NoSuchMethodException: " + methodName);
    }
    return fn;
  }

  /**
   * Format a date in string using pFormat.
   *
   * @param pDate the date to parse.
   * @param pFormat the format to use following SimpleDateFormat patterns.
   *
   * @return the formatted date.
   */
  static dateToString(pDate: Date, pFormat: string): string {
    return Utilities._simpleDateFormat(pDate, pFormat);
  }

  /**
   * Minimal SimpleDateFormat-compatible formatter for the patterns used by
   * grobid (yyyy, MM, dd, HH, mm, ss, SSS, etc.).
   */
  private static _simpleDateFormat(d: Date, pattern: string): string {
    const pad = (n: number, w: number): string => String(n).padStart(w, "0");
    const tokens: { [k: string]: () => string } = {
      "yyyy": () => pad(d.getFullYear(), 4),
      "yy": () => pad(d.getFullYear() % 100, 2),
      "MM": () => pad(d.getMonth() + 1, 2),
      "M": () => String(d.getMonth() + 1),
      "dd": () => pad(d.getDate(), 2),
      "d": () => String(d.getDate()),
      "HH": () => pad(d.getHours(), 2),
      "H": () => String(d.getHours()),
      "mm": () => pad(d.getMinutes(), 2),
      "m": () => String(d.getMinutes()),
      "ss": () => pad(d.getSeconds(), 2),
      "s": () => String(d.getSeconds()),
      "SSS": () => pad(d.getMilliseconds(), 3),
    };
    // Build output by walking the pattern; longest token first.
    const order = ["yyyy", "yy", "SSS", "MM", "M", "dd", "d", "HH", "H", "mm", "m", "ss", "s"];
    let out = "";
    let i = 0;
    outer:
    while (i < pattern.length) {
      for (const tk of order) {
        if (pattern.startsWith(tk, i)) {
          out += tokens[tk]!();
          i += tk.length;
          continue outer;
        }
      }
      out += pattern.charAt(i);
      i++;
    }
    return out;
  }

  static doubleEquals(d1: number, d2: number, epsilon?: number): boolean {
    if (epsilon === undefined) {
      // Mirrors `Math.abs(d1 - d2) <= Double.MIN_VALUE` — the smallest positive
      // double (≈ 5e-324); essentially a bit-identity check.
      return Math.abs(d1 - d2) <= Number.MIN_VALUE;
    }
    return Math.abs(d1 - d2) <= epsilon;
  }

  /**
   * Merge the offset positions of two lists, merging overlapping positions
   * into a spanning one.
   *
   * @param positions1 the first offset position list to be merged
   * @param positions2 the second offset position list to be merged
   *
   * @return the merged list of (merged) offset positions
   */
  static mergePositions(
    positions1: OffsetPosition[] | null,
    positions2: OffsetPosition[] | null,
  ): OffsetPosition[] | null {
    if (isCollectionEmpty(positions1)) return positions2;
    if (isCollectionEmpty(positions2)) return positions1;

    // Sort both inputs in place (matches `Collections.sort(positions1)`).
    positions1!.sort((a, b) => a.compareTo(b));
    positions2!.sort((a, b) => a.compareTo(b));

    const result: OffsetPosition[] = [];
    for (const pos of positions1!) {
      result.push(pos);
    }
    for (const pos of positions2!) {
      // `!result.contains(pos)` uses identity/equality; the Java `OffsetPosition`
      // overrides equals on (start,end), so port via a structural check.
      let found = false;
      for (const existing of result) {
        if (existing.equals(pos)) {
          found = true;
          break;
        }
      }
      if (!found) result.push(pos);
    }
    result.sort((a, b) => a.compareTo(b));
    const finalResult: OffsetPosition[] = [];
    let prevPos: OffsetPosition | null = null;
    for (const pos of result) {
      if (prevPos === null) {
        finalResult.push(pos);
        prevPos = pos;
      } else {
        if ((pos.start >= prevPos.start) && (pos.end <= prevPos.end)) {
          // nothing to do
        } else if (prevPos.end >= pos.start) {
          prevPos.end = pos.end;
        } else {
          prevPos = pos;
          finalResult.push(pos);
        }
      }
    }

    return finalResult;
  }

  /**
   * This version uses general LayoutToken offsets relative to the complete document.
   * It supposes that the stringPosition have been identified on the complete document string
   */
  static convertStringOffsetToTokenOffsetOld(
    stringPosition: OffsetPosition[],
    tokens: LayoutToken[],
  ): OffsetPosition[] {
    const result: OffsetPosition[] = [];
    let indexToken = 0;
    let currentPosition: OffsetPosition | null = null;
    let token: LayoutToken | null = null;
    for (const pos of stringPosition) {
      while (indexToken < tokens.length) {
        token = tokens[indexToken]!;
        if (token.getOffset() >= pos.start) {
          // we have a start
          currentPosition = new OffsetPosition(indexToken, indexToken);
          // we need an end
          let found = false;
          while (indexToken < tokens.length) {
            token = tokens[indexToken]!;
            if (token.getOffset() + (token.getText()?.length ?? 0) >= pos.end) {
              // we have an end
              currentPosition.end = indexToken;
              result.push(currentPosition);
              found = true;
              break;
            }
            indexToken++;
          }
          if (found) {
            indexToken++;
            break;
          } else {
            currentPosition.end = indexToken - 1;
            result.push(currentPosition);
          }
        }
        indexToken++;
      }
    }
    return result;
  }

  /**
   * This version uses actual LayoutToken offsets relative to the tokens present in argument only.
   * It supposes that the stringPosition have been identified on the provided tokens only, and not
   * restricted to the complete document.
   */
  static convertStringOffsetToTokenOffset(
    stringPosition: OffsetPosition[],
    tokens: LayoutToken[],
  ): OffsetPosition[] {
    const result: OffsetPosition[] = [];
    let indexText = 0;
    let indexToken = 0;
    let currentPosition: OffsetPosition | null = null;
    let token: LayoutToken | null = null;
    for (const pos of stringPosition) {
      while (indexToken < tokens.length) {
        token = tokens[indexToken]!;
        if (token.getText() === null) {
          indexToken++;
          continue;
        }

        if (indexText >= pos.start) {
          // we have a start
          currentPosition = new OffsetPosition(indexToken, indexToken);
          // we need an end
          let found = false;
          while (indexToken < tokens.length) {
            token = tokens[indexToken]!;

            if (token.getText() === null) {
              indexToken++;
              continue;
            }

            if (indexText + token.getText()!.length >= pos.end) {
              // we have an end
              currentPosition.end = indexToken;
              result.push(currentPosition);
              found = true;
              break;
            }
            indexToken++;
            indexText += token.getText()!.length;
          }
          if (found) {
            indexToken++;
            indexText += token!.getText()!.length;
            break;
          } else {
            currentPosition.end = indexToken - 1;
            result.push(currentPosition);
          }
        }
        indexToken++;
        indexText += token.getText()!.length;
      }
    }
    return result;
  }
}
