// Port of org.grobid.core.utilities.PathUtil.
// Upstream: grobid-core/src/main/java/org/grobid/core/utilities/PathUtil.java

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export class PathUtil {
  /** Return the first file in `root` whose name ends with `ext` (or throw). */
  static getOneFile(root: string, ext: string): string {
    let entries: string[];
    try {
      entries = readdirSync(root);
    } catch {
      throw new Error(`Cannot find files in ${root} with extension ${ext}`);
    }
    const matches = entries.filter((n) => n.endsWith(ext));
    if (matches.length === 0) {
      throw new Error(`Cannot find files in ${root} with extension ${ext}`);
    }
    return join(root, matches[0]!);
  }

  /** Collect every file under `root` whose name ends with one of `extensions`. */
  static getAllPaths(root: string, ...extensions: string[]): string[] {
    const out: string[] = [];
    PathUtil.collectAll(out, root, extensions);
    return out;
  }

  private static collectAll(paths: string[], root: string, extensions: string[]): void {
    let entries: string[];
    try {
      entries = readdirSync(root);
    } catch {
      return; // upstream swallows IOException too
    }
    for (const entry of entries) {
      const p = join(root, entry);
      try {
        const stat = statSync(p);
        if (stat.isDirectory()) {
          PathUtil.collectAll(paths, p, extensions);
        } else if (stat.isFile() && PathUtil.isSupportedFile(p, extensions)) {
          paths.push(p);
        }
      } catch {
        // skip on access errors
      }
    }
  }

  private static isSupportedFile(file: string, extensions: string[]): boolean {
    const lower = file.toLowerCase();
    for (const ext of extensions) {
      if (lower.endsWith("." + ext)) return true;
    }
    return false;
  }
}
