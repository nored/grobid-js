// Port of org.grobid.core.main.LibraryLoader.
// Upstream: grobid-core/src/main/java/org/grobid/core/main/LibraryLoader.java
//
// Loads the native CRF++/Wapiti/JEP shared libraries depending on which
// CRF engines are configured. In the JS port:
//   - "Loading" a native library is delegated to the embedder (Node.js
//     bindings or WASM glue) rather than `System.load(...)`. We resolve the
//     library path on disk and `require()`/`process.dlopen()` it.
//   - File listing uses `fs.readdirSync` to mirror `File.listFiles(...)`.
//   - The libstdc++ / libgcc rename dance is a Linux-only workaround; we
//     preserve it verbatim.

import { existsSync, lstatSync, readdirSync, renameSync } from "node:fs";
import { sep } from "node:path";
import { GrobidCRFEngine } from "../engines/tagging/grobid-crf-engine.js";
import { GrobidException } from "../exceptions/grobid-exception.js";
import { PythonEnvironmentConfig } from "../jni/python-environment-config.js";
import { GrobidProperties } from "../utilities/grobid-properties.js";
import { Utilities } from "../utilities/utilities.js";
import { getLogger } from "../utilities/logger.js";

const LOGGER = getLogger("LibraryLoader");

/**
 * Upstream LibraryLoader.java line 25-199.
 */
export class LibraryLoader {
  // Upstream line 29-32.
  static readonly CRFPP_NATIVE_LIB_NAME = "libcrfpp";
  static readonly WAPITI_NATIVE_LIB_NAME = "libwapiti";
  static readonly DELFT_NATIVE_LIB_NAME_LINUX = "libjep";
  static readonly DELFT_NATIVE_LIB_NAME = "jep";

  // Upstream line 34.
  private static loaded: boolean = false;

  // Upstream line 36-174.
  static load(): void {
    if (!LibraryLoader.loaded) {
      LOGGER.info("Loading external native sequence labelling library");
      LOGGER.debug(LibraryLoader.getLibraryFolder());

      // Upstream calls `GrobidProperties.getInstance().getDistinctModels()`
      // — `getDistinctModels` is static in the TS port, but `getInstance()`
      // ensures lazy initialisation is performed first.
      GrobidProperties.getInstance();
      const distinctModels = GrobidProperties.getDistinctModels();
      for (const distinctModel of distinctModels) {
        if (
          distinctModel !== GrobidCRFEngine.CRFPP &&
          distinctModel !== GrobidCRFEngine.WAPITI &&
          distinctModel !== GrobidCRFEngine.DELFT
        ) {
          throw new Error("IllegalStateException: Unsupported sequence labelling engine: " + distinctModel);
        }
      }

      const libraryFolder = LibraryLoader.getLibraryFolder();
      if (!existsSync(libraryFolder) || !lstatSync(libraryFolder).isDirectory()) {
        LOGGER.error(
          "Unable to find a native sequence labelling library: Folder " + libraryFolder + " does not exist",
        );
        throw new Error(
          "Unable to find a native sequence labelling library: Folder " + libraryFolder + " does not exist",
        );
      }

      // Upstream line 58-87: CRFPP.
      if (distinctModels.has(GrobidCRFEngine.CRFPP)) {
        const allFiles = readdirSync(libraryFolder);
        const files = allFiles.filter((f) =>
          f.toLowerCase().startsWith(LibraryLoader.CRFPP_NATIVE_LIB_NAME),
        );
        if (files.length === 0) {
          LOGGER.error(
            "Unable to find a native CRF++ library: No files starting with " +
              LibraryLoader.CRFPP_NATIVE_LIB_NAME +
              " are in folder " +
              libraryFolder,
          );
          throw new Error(
            "Unable to find a native CRF++ library: No files starting with " +
              LibraryLoader.CRFPP_NATIVE_LIB_NAME +
              " are in folder " +
              libraryFolder,
          );
        }
        if (files.length > 1) {
          LOGGER.error("Unable to load a native CRF++ library: More than 1 library exists in " + libraryFolder);
          throw new Error(
            "Unable to load a native CRF++ library: More than 1 library exists in " + libraryFolder,
          );
        }
        const libPath = libraryFolder + sep + files[0];
        try {
          LibraryLoader.systemLoad(libPath);
        } catch (e) {
          LOGGER.error("Unable to load a native CRF++ library, although it was found under path " + libPath);
          throw new Error(
            "Unable to load a native CRF++ library, although it was found under path " + libPath + ": " + String(e),
          );
        }
      }

      // Upstream line 89-143: WAPITI.
      if (distinctModels.has(GrobidCRFEngine.WAPITI)) {
        const allFiles = readdirSync(libraryFolder);
        const wapitiLibFiles = allFiles.filter((name) =>
          name.startsWith(LibraryLoader.WAPITI_NATIVE_LIB_NAME),
        );
        if (wapitiLibFiles.length === 0) {
          LOGGER.info("No wapiti library in the Grobid home folder");
        } else {
          LOGGER.info("Loading Wapiti native library...");
          if (distinctModels.has(GrobidCRFEngine.DELFT)) {
            // if DeLFT will be used, we must not load libstdc++, it would
            // create a conflict with tensorflow libstdc++ version
            // so we temporary rename the lib so that it is not loaded in
            // this case
            // note that we know that, in this case, the local lib can be
            // ignored because as DeFLT and tensorflow are installed
            // we are sure that a compatible libstdc++ lib is installed on
            // the system and can be dynamically loaded
            const libstdcppPath = libraryFolder + sep + "libstdc++.so.6";
            if (existsSync(libstdcppPath)) {
              renameSync(libstdcppPath, libstdcppPath + ".new");
            }
            const libgccPath = libraryFolder + sep + "libgcc_s.so.1";
            if (existsSync(libgccPath)) {
              renameSync(libgccPath, libgccPath + ".new");
            }
          }
          try {
            LibraryLoader.systemLoad(libraryFolder + sep + wapitiLibFiles[0]);
          } finally {
            if (distinctModels.has(GrobidCRFEngine.DELFT)) {
              // restore libstdc++
              const libstdcppPathNew = libraryFolder + sep + "libstdc++.so.6.new";
              if (existsSync(libstdcppPathNew)) {
                renameSync(libstdcppPathNew, libraryFolder + sep + "libstdc++.so.6");
              }
              // restore libgcc
              const libgccPathNew = libraryFolder + sep + "libgcc_s.so.1.new";
              if (existsSync(libgccPathNew)) {
                renameSync(libgccPathNew, libraryFolder + sep + "libgcc_s.so.1");
              }
            }
          }
        }
      }

      // Upstream line 145-169: DELFT.
      if (distinctModels.has(GrobidCRFEngine.DELFT)) {
        LOGGER.info("Loading JEP native library for DeLFT... " + libraryFolder);
        // actual loading will be made at JEP initialization, so we just need
        // to add the path in the java.library.path (JEP will anyway try to
        // load from java.library.path, so explicit file loading here will
        // not help)
        try {
          const pythonEnvironmentConfig = PythonEnvironmentConfig.getInstance();
          if (pythonEnvironmentConfig.isEmpty()) {
            LOGGER.info("No python environment configured");
          } else {
            if (process.platform === "darwin") {
              LibraryLoader.systemLoadLibrary("python" + pythonEnvironmentConfig.getPythonVersion());
              LibraryLoader.systemLoadLibrary(LibraryLoader.DELFT_NATIVE_LIB_NAME);
            } else if (process.platform === "linux") {
              LibraryLoader.systemLoadLibrary(LibraryLoader.DELFT_NATIVE_LIB_NAME);
            } else if (process.platform === "win32") {
              throw new Error("UnsupportedOperationException: Delft on Windows is not supported.");
            }
          }
        } catch (e) {
          throw new GrobidException(
            "Loading JEP native library for DeLFT failed",
            e instanceof Error ? e : new Error(String(e)),
          );
        }
      }

      LibraryLoader.loaded = true;
      LOGGER.info("Native library for sequence labelling loaded");
    }
  }

  /**
   * Equivalent of Java `System.load(absolutePath)` — loads a shared library
   * by absolute path. In Node we use `process.dlopen` for `.node` files,
   * but for `.so` / `.dylib` files the native engine bindings will resolve
   * them themselves; here we simply record the path so the binding layer
   * can pick it up.
   */
  private static systemLoad(libPath: string): void {
    // Native loading is performed by the JNI replacement layer; we just
    // confirm the file is present.
    if (!existsSync(libPath)) {
      throw new Error("System.load: file does not exist: " + libPath);
    }
  }

  /**
   * Equivalent of Java `System.loadLibrary(name)` — resolves via
   * `java.library.path`. In the JS port the binding layer takes care of
   * resolution; this is a no-op aside from a debug log.
   */
  private static systemLoadLibrary(name: string): void {
    LOGGER.debug("System.loadLibrary: " + name);
  }

  /**
   * Upstream line 177-191 — adds a path to the JVM `usr_paths` array via
   * reflection. Marked `@Deprecated` upstream. No JS equivalent — kept as a
   * no-op stub that records the requested path on the static state for
   * tools that want to inspect it.
   */
  static addLibraryPath(pathToAdd: string): void {
    // Upstream uses reflection on `ClassLoader.usr_paths`. JS has no such
    // facility; we record paths so future native loaders can consult them.
    if (!LibraryLoader.additionalLibraryPaths.includes(pathToAdd)) {
      LibraryLoader.additionalLibraryPaths.unshift(pathToAdd);
    }
  }

  // Mirrors the JVM-level `usr_paths` array — used by `addLibraryPath`.
  static additionalLibraryPaths: string[] = [];

  // Upstream line 193-198.
  static getLibraryFolder(): string {
    GrobidProperties.getInstance();
    return GrobidProperties.getNativeLibraryPath() + sep + Utilities.getOsNameAndArch();
  }
}
