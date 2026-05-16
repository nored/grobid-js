// Port of org.grobid.core.utilities.GrobidProperties.
// Upstream: grobid-core/src/main/java/org/grobid/core/utilities/GrobidProperties.java
//
// Node-only file. Upstream uses Java `File` and `FileInputStream` to read
// the YAML config at `${GROBID_HOME}/config/grobid.yaml`; the JS port uses
// `node:fs`. The browser bundle never reaches this layer (entry points
// live in `src/node/`).
//
// Adaptations:
// - Singleton: a module-level `_instance` variable mirrors upstream's
//   `private static GrobidProperties grobidProperties`.
// - Jackson YAML → a small recursive-descent YAML reader (sufficient for
//   grobid.yaml's flat key/value + nested object shape). Replaced by a
//   real YAML parser at the integration boundary if needed; the JSON-ish
//   subset used by GROBID's config is parsed verbatim here.
// - Java `System.getProperty(...)` (e.g. for `project.version`) is mapped
//   to `process.env.<PROP_AS_UNDERSCORE>` or returns `null`.
// - `IOUtils.toString(resource, UTF_8)` for reading classpath resources
//   like `/grobid-version.txt` reads from the package's `grobid-home`
//   layout — paths mirror upstream's resources/ packaging.
// - `Map<String, String>` etc are JS `Map`s; `TreeMap` is mirrored by
//   sorting on access (we use a `Map` and sort key arrays as needed).

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as urlMod from "node:url";
import { getLogger } from "./logger.js";
import { GrobidPropertyException } from "../exceptions/grobid-property-exception.js";
import { GrobidHomeFinder } from "../main/grobid-home-finder.js";
import { GrobidCRFEngine } from "../engines/tagging/grobid-crf-engine.js";
import { GrobidConsolidationService } from "./consolidation.js";
import {
  GrobidConfig,
  GrobidParameters,
  ConsolidationParameters,
  CrossrefParameters,
  HostParameters,
  DelftParameters,
  WapitiParameters,
  PdfParameters,
  PdfAltoParameters,
  ModelParameters,
  WapitiModelParameters,
  DelftModelParameters,
  DelftModelParameterSet,
} from "./grobid-config.js";
import { Utilities } from "./utilities.js";
import type { GrobidModel } from "../grobid-model.js";

// ----- helpers ----------------------------------------------------------

function isBlank(s: string | null | undefined): boolean {
  return s == null || s.trim().length === 0;
}
function isEmpty(s: string | null | undefined): boolean {
  return s == null || s.length === 0;
}
function trimToEmpty(s: string | null | undefined): string {
  return s == null ? "" : s.trim();
}
function startsWithIgnoreCase(s: string | null | undefined, prefix: string): boolean {
  if (s == null) return false;
  return s.toLowerCase().startsWith(prefix.toLowerCase());
}

/**
 * Java's `System.getProperty(name)` accessor for the JS port. Reads
 * `process.env[NAME_UPPER]` (e.g. `PROJECT_VERSION` for `project.version`).
 */
function getSystemProperty(name: string): string | null {
  const envName = name.toUpperCase().replace(/\./g, "_");
  const v = process.env[envName];
  if (v !== undefined) return v;
  const v2 = process.env[name];
  if (v2 !== undefined) return v2;
  return null;
}

/**
 * Set a "system property" — in upstream Java these propagate the proxy
 * settings to the JVM-level HTTP client. The JS port sets the corresponding
 * environment variable (process.env), where Node's `undici`/`fetch` will
 * pick up HTTPS_PROXY/HTTP_PROXY automatically.
 */
function setSystemProperty(name: string, value: string): void {
  const envName = name.toUpperCase().replace(/\./g, "_");
  process.env[envName] = value;
}

/**
 * Minimal YAML reader for grobid.yaml. Supports nested mappings, scalar
 * values (strings/numbers/booleans), and sequences of mappings (used for
 * the `models:` list). Quote-delimited strings and naked scalars are both
 * supported, as is `#` line comments.
 */
function parseYaml(text: string): Record<string, unknown> {
  // strip BOM
  if (text.charCodeAt(0) === 0xfeff) text = text.substring(1);
  const lines: { indent: number; content: string }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const stripped = raw.replace(/\s+#.*$/, "").replace(/^#.*$/, "");
    if (stripped.trim().length === 0) continue;
    const indent = stripped.length - stripped.trimStart().length;
    lines.push({ indent, content: stripped.trimEnd() });
  }
  let i = 0;

  function parseScalar(s: string): unknown {
    const t = s.trim();
    if (t === "null" || t === "~" || t === "") return null;
    if (t === "true") return true;
    if (t === "false") return false;
    if (/^-?\d+$/.test(t)) return Number(t);
    if (/^-?\d+\.\d+$/.test(t)) return Number(t);
    if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
      return t.substring(1, t.length - 1);
    }
    return t;
  }

  function parseMap(parentIndent: number): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    while (i < lines.length) {
      const line = lines[i]!;
      if (line.indent <= parentIndent) break;
      const trimmed = line.content.substring(line.indent);
      // sequence item at this indent? — handled by parseList
      if (trimmed.startsWith("- ") || trimmed === "-") break;
      const colonIdx = trimmed.indexOf(":");
      if (colonIdx === -1) {
        i++;
        continue;
      }
      const key = trimmed.substring(0, colonIdx).trim();
      const rest = trimmed.substring(colonIdx + 1).trim();
      i++;
      if (rest.length === 0) {
        // child block: either map or list
        if (i < lines.length && lines[i]!.indent > line.indent) {
          const childIndent = lines[i]!.indent;
          const childContent = lines[i]!.content.substring(childIndent);
          if (childContent.startsWith("- ") || childContent === "-") {
            obj[key] = parseList(line.indent);
          } else {
            obj[key] = parseMap(line.indent);
          }
        } else {
          obj[key] = null;
        }
      } else {
        obj[key] = parseScalar(rest);
      }
    }
    return obj;
  }

  function parseList(parentIndent: number): unknown[] {
    const arr: unknown[] = [];
    while (i < lines.length) {
      const line = lines[i]!;
      if (line.indent <= parentIndent) break;
      const trimmed = line.content.substring(line.indent);
      if (!(trimmed.startsWith("- ") || trimmed === "-")) break;
      const rest = trimmed === "-" ? "" : trimmed.substring(2);
      const itemIndent = line.indent + 2;
      if (rest.length === 0) {
        i++;
        arr.push(parseMap(line.indent));
      } else if (rest.indexOf(":") === -1) {
        i++;
        arr.push(parseScalar(rest));
      } else {
        // inline first key/value of the map; rewrite this line so parseMap
        // can re-read it cleanly.
        line.content = " ".repeat(itemIndent) + rest;
        line.indent = itemIndent;
        // Adjust so that parseMap's parentIndent < itemIndent
        arr.push(parseMap(line.indent - 1));
      }
    }
    return arr;
  }

  return parseMap(-1);
}

/** Copy a parsed YAML object into a GrobidConfig instance with full nested type construction. */
function mapToGrobidConfig(parsed: Record<string, unknown>): GrobidConfig {
  const cfg = new GrobidConfig();
  const g = parsed["grobid"] as Record<string, unknown> | undefined;
  if (g !== undefined && g !== null) {
    const params = new GrobidParameters();
    if (typeof g["grobidHome"] === "string") params.grobidHome = g["grobidHome"] as string;
    if (typeof g["temp"] === "string") params.temp = g["temp"] as string;
    if (typeof g["nativelibrary"] === "string") params.nativelibrary = g["nativelibrary"] as string;
    if (typeof g["languageDetectorFactory"] === "string")
      params.languageDetectorFactory = g["languageDetectorFactory"] as string;
    if (typeof g["sentenceDetectorFactory"] === "string")
      params.sentenceDetectorFactory = g["sentenceDetectorFactory"] as string;
    if (typeof g["concurrency"] === "number") params.concurrency = g["concurrency"] as number;
    if (typeof g["poolMaxWait"] === "number") params.poolMaxWait = g["poolMaxWait"] as number;

    const pdf = g["pdf"] as Record<string, unknown> | undefined;
    if (pdf !== undefined && pdf !== null) {
      const pdfP = new PdfParameters();
      if (typeof pdf["blocksMax"] === "number") pdfP.blocksMax = pdf["blocksMax"] as number;
      if (typeof pdf["tokensMax"] === "number") pdfP.tokensMax = pdf["tokensMax"] as number;
      const alto = pdf["pdfalto"] as Record<string, unknown> | undefined;
      if (alto !== undefined && alto !== null) {
        const a = new PdfAltoParameters();
        if (typeof alto["path"] === "string") a.path = alto["path"] as string;
        if (typeof alto["memoryLimitMb"] === "number") a.memoryLimitMb = alto["memoryLimitMb"] as number;
        if (typeof alto["timeoutSec"] === "number") a.timeoutSec = alto["timeoutSec"] as number;
        pdfP.pdfalto = a;
      }
      params.pdf = pdfP;
    }

    const cons = g["consolidation"] as Record<string, unknown> | undefined;
    if (cons !== undefined && cons !== null) {
      const c = new ConsolidationParameters();
      if (typeof cons["service"] === "string") c.service = cons["service"] as string;
      const xr = cons["crossref"] as Record<string, unknown> | undefined;
      if (xr !== undefined && xr !== null) {
        const x = new CrossrefParameters();
        if (typeof xr["mailto"] === "string") x.mailto = xr["mailto"] as string;
        if (typeof xr["token"] === "string") x.token = xr["token"] as string;
        if (typeof xr["timeoutSec"] === "number") x.timeoutSec = xr["timeoutSec"] as number;
        if (typeof xr["minRequestIntervalMs"] === "number")
          x.minRequestIntervalMs = xr["minRequestIntervalMs"] as number;
        if (typeof xr["postValidation"] === "boolean")
          x.postValidation = xr["postValidation"] as boolean;
        c.crossref = x;
      }
      const gl = cons["glutton"] as Record<string, unknown> | undefined;
      if (gl !== undefined && gl !== null) {
        const h = new HostParameters();
        if (typeof gl["type"] === "string") h.type = gl["type"] as string;
        if (typeof gl["host"] === "string") h.host = gl["host"] as string;
        if (typeof gl["port"] === "number") h.port = gl["port"] as number;
        if (typeof gl["url"] === "string") h.url = gl["url"] as string;
        if (typeof gl["timeoutSec"] === "number") h.timeoutSec = gl["timeoutSec"] as number;
        c.glutton = h;
      }
      params.consolidation = c;
    }

    const proxy = g["proxy"] as Record<string, unknown> | undefined;
    if (proxy !== undefined && proxy !== null) {
      const p = new HostParameters();
      if (typeof proxy["host"] === "string") p.host = proxy["host"] as string;
      if (typeof proxy["port"] === "number") p.port = proxy["port"] as number;
      if (typeof proxy["type"] === "string") p.type = proxy["type"] as string;
      if (typeof proxy["url"] === "string") p.url = proxy["url"] as string;
      params.proxy = p;
    }

    const delft = g["delft"] as Record<string, unknown> | undefined;
    if (delft !== undefined && delft !== null) {
      const d = new DelftParameters();
      if (typeof delft["install"] === "string") d.install = delft["install"] as string;
      if (typeof delft["pythonVirtualEnv"] === "string")
        d.pythonVirtualEnv = delft["pythonVirtualEnv"] as string;
      params.delft = d;
    }

    const wapiti = g["wapiti"] as Record<string, unknown> | undefined;
    if (wapiti !== undefined && wapiti !== null) {
      const w = new WapitiParameters();
      if (typeof wapiti["nbThreads"] === "number") w.nbThreads = wapiti["nbThreads"] as number;
      params.wapiti = w;
    }

    const models = g["models"] as unknown[] | undefined;
    if (Array.isArray(models)) {
      const arr: ModelParameters[] = [];
      for (const m of models) {
        if (m === null || typeof m !== "object") continue;
        const mo = m as Record<string, unknown>;
        const mp = new ModelParameters();
        if (typeof mo["name"] === "string") mp.name = mo["name"] as string;
        if (typeof mo["engine"] === "string") mp.engine = mo["engine"] as string;
        const wp = mo["wapiti"] as Record<string, unknown> | undefined;
        if (wp !== undefined && wp !== null) {
          const wpp = new WapitiModelParameters();
          if (typeof wp["epsilon"] === "number") wpp.epsilon = wp["epsilon"] as number;
          if (typeof wp["window"] === "number") wpp.window = wp["window"] as number;
          if (typeof wp["nbMaxIterations"] === "number")
            wpp.nbMaxIterations = wp["nbMaxIterations"] as number;
          mp.wapiti = wpp;
        }
        const dp = mo["delft"] as Record<string, unknown> | undefined;
        if (dp !== undefined && dp !== null) {
          const dpp = new DelftModelParameters();
          if (typeof dp["architecture"] === "string") dpp.architecture = dp["architecture"] as string;
          if (typeof dp["useELMo"] === "boolean") dpp.useELMo = dp["useELMo"] as boolean;
          if (typeof dp["embeddings_name"] === "string")
            dpp.embeddings_name = dp["embeddings_name"] as string;
          if (typeof dp["transformer"] === "string") dpp.transformer = dp["transformer"] as string;
          const tr = dp["training"] as Record<string, unknown> | undefined;
          if (tr !== undefined && tr !== null) {
            const ps = new DelftModelParameterSet();
            if (typeof tr["max_sequence_length"] === "number")
              ps.max_sequence_length = tr["max_sequence_length"] as number;
            if (typeof tr["batch_size"] === "number") ps.batch_size = tr["batch_size"] as number;
            dpp.training = ps;
          }
          const rt = dp["runtime"] as Record<string, unknown> | undefined;
          if (rt !== undefined && rt !== null) {
            const ps = new DelftModelParameterSet();
            if (typeof rt["max_sequence_length"] === "number")
              ps.max_sequence_length = rt["max_sequence_length"] as number;
            if (typeof rt["batch_size"] === "number") ps.batch_size = rt["batch_size"] as number;
            dpp.runtime = ps;
          }
          mp.delft = dpp;
        }
        arr.push(mp);
      }
      params.models = arr;
    }

    cfg.grobid = params;
  }
  return cfg;
}

// ----- main class -------------------------------------------------------

/**
 * This class provide methods to set/load/access grobid config value from a yaml config file loaded
 * in the class {@link GrobidConfig}.
 *
 * New yaml parameters and former properties should be equivalent via this class. We keep the
 * class name "GrobidProperties" for compatibility with Grobid modules and other Java applications
 * using Grobid as a library.
 *
 * to be done: having parameters that can be overridden by a system property having a compatible name.
 */
export class GrobidProperties {
  static readonly LOGGER = getLogger("GrobidProperties");

  static readonly FOLDER_NAME_MODELS: string = "models";
  static readonly FILE_NAME_MODEL: string = "model";
  private static readonly GROBID_VERSION_FILE: string = "/grobid-version.txt";
  private static readonly UNKNOWN_VERSION_STR: string = "unknown";
  private static readonly GROBID_REVISION_FILE: string = "/grobid-revision.txt";

  // Version
  private static VERSION: string | null = null;
  private static REVISION: string | null = null;

  private static grobidProperties: GrobidProperties | null = null;

  // indicate if GROBID is running in server mode or not
  private static contextExecutionServer: boolean = false;

  /** {@link GrobidConfig} object containing all config parameters used by grobid. */
  private static grobidConfig: GrobidConfig | null = null;

  /** Map models specified inthe config file to their parameters */
  private static modelMap: Map<string, ModelParameters> | null = null;

  /** Path to pdf to xml converter. */
  private static pathToPdfalto: string | null = null;

  private static grobidHome: string | null = null;

  /** Path to the yaml config file */
  static GROBID_CONFIG_PATH: string | null = null;

  /** Returns an instance of {@link GrobidProperties} object. If no one is set, then it creates one. */
  static getInstance(): GrobidProperties;
  static getInstance(grobidHomeFinder: GrobidHomeFinder): GrobidProperties;
  static getInstance(grobidHomeFinder?: GrobidHomeFinder): GrobidProperties {
    if (grobidHomeFinder !== undefined) {
      if (GrobidProperties.grobidHome === null) {
        GrobidProperties.grobidHome = grobidHomeFinder.findGrobidHomeOrFail();
      }
      return GrobidProperties.getInstance();
    }
    if (GrobidProperties.grobidProperties === null) {
      return GrobidProperties.getNewInstance();
    }
    return GrobidProperties.grobidProperties;
  }

  /** Reload grobid config */
  static reload(): void {
    GrobidProperties.getNewInstance();
  }

  static reset(): void {
    GrobidProperties.getNewInstance();
  }

  /**
   * Creates a new {@link GrobidProperties} object, initializes and returns it.
   */
  protected static getNewInstance(): GrobidProperties {
    GrobidProperties.LOGGER.debug("synchronized getNewInstance");
    GrobidProperties.grobidProperties = new GrobidProperties();
    return GrobidProperties.grobidProperties;
  }

  /** Load the path to GROBID_HOME from the env-entry set in web.xml. */
  private static assignGrobidHomePath(): void {
    if (GrobidProperties.grobidHome === null) {
      GrobidProperties.grobidHome = new GrobidHomeFinder().findGrobidHomeOrFail();
    }
  }

  /** Return the grobid-home path. */
  static getGrobidHome(): string | null {
    return GrobidProperties.grobidHome;
  }

  static getGrobidHomePath(): string | null {
    return GrobidProperties.grobidHome;
  }

  /** For back compatibility @deprecated */
  static get_GROBID_HOME_PATH(): string | null {
    return GrobidProperties.grobidHome;
  }

  /** Set the grobid-home path. */
  static setGrobidHome(pGROBID_HOME_PATH: string | null | undefined): void {
    if (isBlank(pGROBID_HOME_PATH))
      throw new GrobidPropertyException("Cannot set property grobidHome to null or empty.");

    let resolved = pGROBID_HOME_PATH as string;
    if (!fs.existsSync(resolved)) {
      throw new GrobidPropertyException(
        "Could not read GROBID_HOME, the directory '" + pGROBID_HOME_PATH + "' does not exist.",
      );
    }

    try {
      resolved = fs.realpathSync(resolved);
    } catch {
      throw new GrobidPropertyException(
        "Cannot set grobid home path to the given one '" +
          pGROBID_HOME_PATH +
          "', because it does not exist.",
      );
    }
    GrobidProperties.grobidHome = resolved;
  }

  /** Load the path to grobid config yaml from the env-entry set in web.xml. */
  static loadGrobidConfigPath(): void {
    GrobidProperties.LOGGER.debug("loading grobid config yaml");
    if (GrobidProperties.GROBID_CONFIG_PATH === null) {
      GrobidProperties.GROBID_CONFIG_PATH = new GrobidHomeFinder().findGrobidConfigOrFail(
        GrobidProperties.grobidHome,
      );
    }
  }

  /** Return the path to the GROBID yaml config file */
  static getGrobidConfigPath(): string | null {
    return GrobidProperties.GROBID_CONFIG_PATH;
  }

  /** Set the GROBID config yaml file path. */
  static setGrobidConfigPath(pGrobidConfigPath: string | null | undefined): void {
    if (isBlank(pGrobidConfigPath))
      throw new GrobidPropertyException("Cannot set GROBID config file to null or empty.");

    const candidate = pGrobidConfigPath as string;
    if (!fs.existsSync(candidate)) {
      throw new GrobidPropertyException(
        "Cannot read GROBID yaml config file, the file '" + pGrobidConfigPath + "' does not exist.",
      );
    }

    try {
      GrobidProperties.GROBID_CONFIG_PATH = fs.realpathSync(candidate);
    } catch {
      throw new GrobidPropertyException(
        "Cannot set grobid yaml config file path to the given one '" +
          pGrobidConfigPath +
          "', because it does not exist.",
      );
    }
  }

  /**
   * Create a new object and search where to find the grobid-home folder.
   *
   * We check if the system property GrobidPropertyKeys.PROP_GROBID_HOME
   * is set. If not set, the method will search for a folder named
   * grobid-home in the current project.
   *
   * Finally from the found grobid-home, the yaml config file is loaded and
   * the native and data resource paths are initialized.
   */
  constructor() {
    GrobidProperties.assignGrobidHomePath();
    GrobidProperties.loadGrobidConfigPath();
    GrobidProperties.setContextExecutionServer(false);

    try {
      const text = fs.readFileSync(GrobidProperties.GROBID_CONFIG_PATH as string, "utf-8");
      const parsed = parseYaml(text);
      GrobidProperties.grobidConfig = mapToGrobidConfig(parsed);
    } catch (exp) {
      if (exp instanceof GrobidPropertyException) throw exp;
      throw new GrobidPropertyException(
        "Cannot open GROBID config yaml file at location '" +
          path.resolve(GrobidProperties.GROBID_CONFIG_PATH as string) +
          "'",
        exp,
      );
    }

    //Map<String, String> configParametersViaEnvironment = getEnvironmentVariableOverrides(System.getenv());
    //this.setEnvironmentConfigParameter(configParametersViaEnvironment);

    this.initializeTmpPath();
    // TBD: tmp to be created
    GrobidProperties.loadPdfaltoPath();
    GrobidProperties.createModelMap();
  }

  /** Create a map between model names and associated parameters */
  private static createModelMap(): void {
    const models = GrobidProperties.grobidConfig?.grobid?.models;
    if (models === undefined) return;
    for (const modelParameter of models) {
      if (GrobidProperties.modelMap === null) GrobidProperties.modelMap = new Map();
      GrobidProperties.modelMap.set(modelParameter.name as string, modelParameter);
    }
  }

  /** Add a model with its parameter object in the model map */
  static addModel(modelParameter: ModelParameters): void {
    if (GrobidProperties.modelMap === null) GrobidProperties.modelMap = new Map();
    GrobidProperties.modelMap.set(modelParameter.name as string, modelParameter);
  }

  /** Create indicated tmp path if it does not exist */
  private initializeTmpPath(): void {
    const tmpDir = GrobidProperties.getTempPath();
    if (!fs.existsSync(tmpDir)) {
      try {
        fs.mkdirSync(tmpDir, { recursive: true });
      } catch {
        GrobidProperties.LOGGER.warn(
          "tmp does not exist and unable to create tmp directory: " + path.resolve(tmpDir),
        );
      }
    }
  }

  /** Return the distinct values of all the engines that are specified in the the model map */
  static getDistinctModels(): Set<GrobidCRFEngine> {
    const distinctModels = new Set<GrobidCRFEngine>();
    const mm = GrobidProperties.modelMap;
    if (mm === null) return distinctModels;
    for (const modelParameter of mm.values()) {
      if (modelParameter.engine == null) {
        // it should not happen normally
        continue;
      }
      const localEngine = GrobidCRFEngine.get(modelParameter.engine);
      if (!distinctModels.has(localEngine)) distinctModels.add(localEngine);
    }
    return distinctModels;
  }

  /** Returns the current version of GROBID */
  static getVersion(): string {
    if (GrobidProperties.VERSION !== null) return GrobidProperties.VERSION;
    if (GrobidProperties.VERSION === null) {
      GrobidProperties.VERSION = GrobidProperties.readFromSystemPropertyOrFromFile(
        "project.version",
        GrobidProperties.GROBID_VERSION_FILE,
      );
    }
    return GrobidProperties.VERSION;
  }

  static getRevision(): string {
    if (GrobidProperties.REVISION !== null) return GrobidProperties.REVISION;
    if (GrobidProperties.REVISION === null) {
      GrobidProperties.REVISION = GrobidProperties.readFromSystemPropertyOrFromFile(
        "gitRevision",
        GrobidProperties.GROBID_REVISION_FILE,
      );
    }
    return GrobidProperties.REVISION;
  }

  private static readFromSystemPropertyOrFromFile(
    systemPropertyName: string,
    filePath: string,
  ): string {
    let grobidVersion = GrobidProperties.UNKNOWN_VERSION_STR;
    const systemPropertyValue = getSystemProperty(systemPropertyName);
    if (systemPropertyValue !== null) {
      grobidVersion = systemPropertyValue;
    } else {
      try {
        // Upstream reads `getResourceAsStream("/grobid-version.txt")`. In the
        // JS port the same file is packaged under the module's directory at
        // `<dist|src>/<module>/<filePath>`. We try a couple of likely
        // locations and pick the first that exists.
        const here = path.dirname(urlMod.fileURLToPath(import.meta.url));
        const candidates = [
          path.resolve(here, "../../.." + filePath),
          path.resolve(here, "../.." + filePath),
          path.resolve(here, ".." + filePath),
          path.resolve(here + filePath),
        ];
        let grobidVersionTmp: string | null = null;
        for (const c of candidates) {
          if (fs.existsSync(c)) {
            grobidVersionTmp = fs.readFileSync(c, "utf-8");
            break;
          }
        }
        if (grobidVersionTmp !== null && !startsWithIgnoreCase(grobidVersionTmp, "${project_")) {
          grobidVersion = grobidVersionTmp;
        }
      } catch (e) {
        GrobidProperties.LOGGER.error("Cannot read the version from resources", e);
      }
    }
    return grobidVersion;
  }

  /** Returns the temprorary path of grobid */
  static getTempPath(): string {
    const cfg = GrobidProperties.grobidConfig?.grobid;
    if (cfg === undefined || cfg.temp == null) return os.tmpdir();
    if (!path.isAbsolute(cfg.temp)) {
      return path.join(GrobidProperties.grobidHome as string, cfg.temp);
    }
    return cfg.temp;
  }

  static setNativeLibraryPath(nativeLibPath: string): void {
    (GrobidProperties.grobidConfig!.grobid as GrobidParameters).nativelibrary = nativeLibPath;
  }

  /** Returns the path to the native libraries. */
  static getNativeLibraryPath(): string {
    return path.join(
      GrobidProperties.grobidHome as string,
      (GrobidProperties.grobidConfig!.grobid as GrobidParameters).nativelibrary,
    );
  }

  /**
   * Returns the installation path of DeLFT if set, null otherwise. It is required for using
   * a Deep Learning sequence labelling engine.
   */
  static getDeLFTPath(): string | null {
    const v = GrobidProperties.grobidConfig?.grobid?.delft?.install;
    return v === undefined ? null : v;
  }

  static getDeLFTFilePath(): string {
    let rawPath = GrobidProperties.grobidConfig?.grobid?.delft?.install as string;
    if (!fs.existsSync(path.resolve(rawPath))) {
      rawPath = "../" + rawPath;
    }
    return path.resolve(rawPath);
  }

  static getGluttonUrl(): string | null {
    const url = GrobidProperties.grobidConfig?.grobid?.consolidation?.glutton?.url;
    if (isEmpty(url)) return null;
    return url as string;
  }

  static setGluttonUrl(theUrl: string): void {
    const c = GrobidProperties.grobidConfig!.grobid!.consolidation!;
    if (c.glutton === undefined) c.glutton = new HostParameters();
    c.glutton.url = theUrl;
  }

  /** Returns the host for a proxy connection, given in the grobid config file. */
  static getProxyHost(): string | null {
    const host = GrobidProperties.grobidConfig?.grobid?.proxy?.host;
    if (host == null || trimToEmpty(host).length === 0) return null;
    return host;
  }

  /** Sets the host a proxy connection, given in the config file. */
  static setProxyHost(host: string): void {
    if (GrobidProperties.grobidConfig!.grobid!.proxy === undefined)
      GrobidProperties.grobidConfig!.grobid!.proxy = new HostParameters();
    GrobidProperties.grobidConfig!.grobid!.proxy.host = host;
    setSystemProperty("http.proxyHost", host);
    setSystemProperty("https.proxyHost", host);
  }

  /** Returns the port for a proxy connection, given in the grobid config file. */
  static getProxyPort(): number | undefined {
    return GrobidProperties.grobidConfig?.grobid?.proxy?.port;
  }

  /** Set the "mailto" parameter to be used in the crossref query. */
  static setCrossrefMailto(mailto: string): void {
    const c = GrobidProperties.grobidConfig!.grobid!.consolidation!;
    if (c.crossref === undefined) c.crossref = new CrossrefParameters();
    c.crossref.mailto = mailto;
  }

  /** Get the "mailto" parameter to be used in the crossref query and in User-Agent. */
  static getCrossrefMailto(): string | null {
    const m = GrobidProperties.grobidConfig?.grobid?.consolidation?.crossref?.mailto;
    if (m == null || m.trim().length === 0) return null;
    return m;
  }

  /** Set the Crossref Metadata Plus authorization token. */
  static setCrossrefToken(token: string): void {
    const c = GrobidProperties.grobidConfig!.grobid!.consolidation!;
    if (c.crossref === undefined) c.crossref = new CrossrefParameters();
    c.crossref.token = token;
  }

  /** Get the Crossref Metadata Plus authorization token. */
  static getCrossrefToken(): string | null {
    const t = GrobidProperties.grobidConfig?.grobid?.consolidation?.crossref?.token;
    if (t == null || t.trim().length === 0) return null;
    return t;
  }

  /** Sets the port for a proxy connection. */
  static setProxyPort(port: number): void {
    if (GrobidProperties.grobidConfig!.grobid!.proxy === undefined)
      GrobidProperties.grobidConfig!.grobid!.proxy = new HostParameters();
    GrobidProperties.grobidConfig!.grobid!.proxy.port = port;
    setSystemProperty("http.proxyPort", "" + port);
    setSystemProperty("https.proxyPort", "" + port);
  }

  static getPdfaltoMemoryLimitMb(): number | undefined {
    return GrobidProperties.grobidConfig?.grobid?.pdf?.pdfalto?.memoryLimitMb;
  }

  static getPdfaltoTimeoutS(): number | undefined {
    return GrobidProperties.grobidConfig?.grobid?.pdf?.pdfalto?.timeoutSec;
  }

  static getPdfaltoTimeoutMs(): number | undefined {
    const v = GrobidProperties.grobidConfig?.grobid?.pdf?.pdfalto?.timeoutSec;
    return v === undefined ? undefined : v * 1000;
  }

  /*public static Integer getNBThreads() {
        Integer nbThreadsConfig = Integer.valueOf(grobidConfig.grobid.wapiti.nbThreads);
        if (nbThreadsConfig.intValue() == 0) {
            return Integer.valueOf(Runtime.getRuntime().availableProcessors());
        }
        return nbThreadsConfig;
    }*/

  /** Returns the number of threads to be used when training with CRF Wapiti. */
  static getWapitiNbThreads(): number {
    const nbThreadsConfig = (GrobidProperties.grobidConfig?.grobid?.wapiti?.nbThreads as number) ?? 0;
    if (nbThreadsConfig === 0) {
      // In Java this is Runtime.getRuntime().availableProcessors(); in Node
      // os.cpus().length is the closest equivalent.
      return os.cpus().length;
    }
    return nbThreadsConfig;
  }

  /** PDF with more blocks will be skipped */
  static getPdfBlocksMax(): number | undefined {
    return GrobidProperties.grobidConfig?.grobid?.pdf?.blocksMax;
  }

  /** PDF with more tokens will be skipped */
  static getPdfTokensMax(): number | undefined {
    return GrobidProperties.grobidConfig?.grobid?.pdf?.tokensMax;
  }

  /*public static void setNBThreads(int nbThreads) {
        grobidConfig.grobid.wapiti.nbThreads = nbThreads;
    }*/
  static setWapitiNbThreads(nbThreads: number): void {
    if (GrobidProperties.grobidConfig!.grobid!.wapiti === undefined)
      GrobidProperties.grobidConfig!.grobid!.wapiti = new WapitiParameters();
    GrobidProperties.grobidConfig!.grobid!.wapiti.nbThreads = nbThreads;
  }

  static getLanguageDetectorFactory(): string {
    const factoryClassName = GrobidProperties.grobidConfig?.grobid?.languageDetectorFactory;
    if (isBlank(factoryClassName))
      throw new GrobidPropertyException(
        "Language detection is enabled but a factory class name is not provided",
      );
    return factoryClassName as string;
  }

  /*public static void setUseLanguageId(final String useLanguageId) { ... }*/

  static getSentenceDetectorFactory(): string {
    const factoryClassName = GrobidProperties.grobidConfig?.grobid?.sentenceDetectorFactory;
    if (isBlank(factoryClassName))
      throw new GrobidPropertyException(
        "Sentence detection is enabled but a factory class name is not provided",
      );
    return factoryClassName as string;
  }

  /** Returns the path to the home folder of pdf to xml converter. */
  static loadPdfaltoPath(): void {
    GrobidProperties.LOGGER.debug("loading pdfalto command path");
    const pathName = GrobidProperties.grobidConfig?.grobid?.pdf?.pdfalto?.path;
    let pdfalto = path.join(GrobidProperties.grobidHome as string, pathName as string);
    if (!fs.existsSync(pdfalto)) {
      throw new GrobidPropertyException(
        "Path to pdfalto doesn't exists. Please set the path to pdfalto in the config file",
      );
    }
    pdfalto = path.join(pdfalto, Utilities.getOsNameAndArch() as string);
    GrobidProperties.pathToPdfalto = pdfalto;
    GrobidProperties.LOGGER.debug("pdfalto executable home directory set to " + path.resolve(pdfalto));
  }

  /** Returns the path to the home folder of pdfalto program. */
  static getPdfaltoPath(): string | null {
    return GrobidProperties.pathToPdfalto;
  }

  static getGrobidModelParameters(modelName: string): ModelParameters | null {
    if (GrobidProperties.modelMap === null) return null;
    let param = GrobidProperties.modelMap.get(modelName) ?? null;
    // if we have a flavor of the model, we can fall back to the configuration
    // of the parent model
    let fallBackModelName = modelName;
    while (param === null) {
      GrobidProperties.LOGGER.debug("No configuration parameter defined for model " + modelName);
      const ind = fallBackModelName.lastIndexOf("-");
      if (ind !== -1) {
        fallBackModelName = modelName.substring(0, ind);
      } else {
        return null;
      }
      param = GrobidProperties.modelMap.get(fallBackModelName) ?? null;
    }
    return param;
  }

  static getGrobidEngineName(modelName: string): string | null {
    const param = GrobidProperties.getGrobidModelParameters(modelName);
    if (param === null) return null;
    return param.engine ?? null;
  }

  static getGrobidEngine(modelName: string): GrobidCRFEngine | null;
  static getGrobidEngine(model: GrobidModel): GrobidCRFEngine | null;
  static getGrobidEngine(arg: string | GrobidModel): GrobidCRFEngine | null {
    if (typeof arg === "string") {
      const engineName = GrobidProperties.getGrobidEngineName(arg);
      if (engineName === null) return null;
      return GrobidCRFEngine.get(engineName);
    }
    return GrobidProperties.getGrobidEngine(arg.getModelName());
  }

  static getModelPath(model: GrobidModel): string | null;
  static getModelPath(): string;
  static getModelPath(model?: GrobidModel): string | null {
    if (model === undefined) {
      return path.join(GrobidProperties.getGrobidHome() as string, GrobidProperties.FOLDER_NAME_MODELS);
    }
    if (GrobidProperties.modelMap === null || GrobidProperties.modelMap.get(model.getModelName()) === undefined) {
      // model is either:
      // - a flavor without config, but that should fallback to the parent model config
      //   if no specific config exists. If it is the case, the model path is infered
      //   from the flavor model name
      // - a normal model not specified in the config, so returning null
      if (GrobidProperties.getGrobidModelParameters(model.getModelName()) === null) {
        return null;
      }
    }
    const extension = (GrobidProperties.getGrobidEngine(model) as GrobidCRFEngine).getExt();
    return path.join(
      GrobidProperties.getGrobidHome() as string,
      GrobidProperties.FOLDER_NAME_MODELS,
      model.getFolderName(),
      GrobidProperties.FILE_NAME_MODEL + "." + extension,
    );
  }

  static getTemplatePath(resourcesDir: string, model: GrobidModel): string | null {
    const param = GrobidProperties.getGrobidModelParameters(model.getModelName());
    if (param === null) return null;

    let theFile = path.join(
      resourcesDir,
      "dataset/" + model.getFolderName() + "/crfpp-templates/" + model.getTemplateName(),
    );
    if (!fs.existsSync(theFile)) {
      theFile = path.join(
        "resources/dataset/" + model.getFolderName() + "/crfpp-templates/" + model.getTemplateName(),
      );
    }
    return theFile;
  }

  static getEvalCorpusPath(resourcesDir: string, model: GrobidModel): string {
    let theFile = path.join(resourcesDir, "dataset/" + model.getFolderName() + "/evaluation/");
    if (!fs.existsSync(theFile)) {
      theFile = path.join("resources/dataset/" + model.getFolderName() + "/evaluation/");
    }
    return theFile;
  }

  static getCorpusPath(resourcesDir: string, model: GrobidModel): string {
    let theFile = path.join(resourcesDir, "dataset/" + model.getFolderName() + "/corpus");
    if (!fs.existsSync(theFile)) {
      theFile = path.join("resources/dataset/" + model.getFolderName() + "/corpus");
    }
    return theFile;
  }

  static getLexiconPath(): string {
    return path.resolve(path.join(GrobidProperties.getGrobidHome() as string, "lexicon"));
  }

  static getLanguageDetectionResourcePath(): string {
    return path.join(GrobidProperties.getGrobidHome() as string, "language-detection");
  }

  /** Returns the maximum parallel connections allowed in the pool. */
  static getMaxConcurrency(): number {
    return (GrobidProperties.grobidConfig?.grobid?.concurrency as number) ?? 0;
  }

  /** Returns maximum time to wait before timeout when the pool is full. */
  static getPoolMaxWait(): number {
    return ((GrobidProperties.grobidConfig?.grobid?.poolMaxWait as number) ?? 0) * 1000;
  }

  /** Returns the consolidation service to be used. */
  getConsolidationService(): GrobidConsolidationService {
    return GrobidProperties.getConsolidationService();
  }

  static getConsolidationService(): GrobidConsolidationService {
    if (GrobidProperties.grobidConfig!.grobid!.consolidation === undefined) {
      GrobidProperties.grobidConfig!.grobid!.consolidation = new ConsolidationParameters();
    }
    if (GrobidProperties.grobidConfig!.grobid!.consolidation.service == null) {
      GrobidProperties.grobidConfig!.grobid!.consolidation.service = "crossref";
    }
    return GrobidConsolidationService.get(
      GrobidProperties.grobidConfig!.grobid!.consolidation.service,
    );
  }

  /** Set which consolidation service to use */
  static setConsolidationService(service: string): void {
    if (GrobidProperties.grobidConfig!.grobid!.consolidation === undefined)
      GrobidProperties.grobidConfig!.grobid!.consolidation = new ConsolidationParameters();
    GrobidProperties.grobidConfig!.grobid!.consolidation.service = service;
  }

  /** Get the Crossref timeout in seconds for consolidation service requests. */
  static getCrossrefConsolidationTimeout(): number {
    if (GrobidProperties.grobidConfig?.grobid?.consolidation?.crossref == null) {
      GrobidProperties.LOGGER.warn(
        "Crossref consolidation configuration is missing. Using default timeout of 60 seconds.",
      );
      return 60;
    }
    return GrobidProperties.grobidConfig.grobid.consolidation.crossref.timeoutSec;
  }

  /**
   * Get the minimum interval between consecutive CrossRef API request submissions (in milliseconds).
   * Returns -1 (auto-compute from tier) by default. A positive value overrides the tier-based rate.
   */
  static getCrossrefMinRequestInterval(): number {
    if (GrobidProperties.grobidConfig?.grobid?.consolidation?.crossref == null) return -1;
    return GrobidProperties.grobidConfig.grobid.consolidation.crossref.minRequestIntervalMs;
  }

  /** Get the Glutton timeout in seconds for consolidation service requests. */
  static getGluttonConsolidationTimeout(): number {
    if (GrobidProperties.grobidConfig?.grobid?.consolidation?.glutton == null) {
      GrobidProperties.LOGGER.warn(
        "Biblio-glutton consolidation configuration is missing. Using default timeout of 60 seconds.",
      );
      return 60;
    }
    return GrobidProperties.grobidConfig.grobid.consolidation.glutton.timeoutSec;
  }

  /**
   * Get whether post-validation is enabled for CrossRef consolidation results.
   * When true, GROBID will validate CrossRef results against the source metadata.
   */
  static getCrossrefPostValidation(): boolean {
    if (GrobidProperties.grobidConfig?.grobid?.consolidation?.crossref == null) return true;
    return GrobidProperties.grobidConfig.grobid.consolidation.crossref.postValidation;
  }

  /** Returns if the execution context is stand alone or server. */
  static isContextExecutionServer(): boolean {
    return GrobidProperties.contextExecutionServer;
  }

  /** Set if the execution context is stand alone or server. */
  static setContextExecutionServer(state: boolean): void {
    GrobidProperties.contextExecutionServer = state;
  }

  static getPythonVirtualEnv(): string | null {
    return GrobidProperties.grobidConfig?.grobid?.delft?.pythonVirtualEnv ?? null;
  }

  static setPythonVirtualEnv(pythonVirtualEnv: string): void {
    if (GrobidProperties.grobidConfig!.grobid!.delft === undefined)
      GrobidProperties.grobidConfig!.grobid!.delft = new DelftParameters();
    GrobidProperties.grobidConfig!.grobid!.delft.pythonVirtualEnv = pythonVirtualEnv;
  }

  static getWindow(model: GrobidModel): number {
    const parameters = GrobidProperties.getGrobidModelParameters(model.getModelName());
    if (parameters !== null && parameters.wapiti != null) return parameters.wapiti.window;
    return 20;
  }

  static getEpsilon(model: GrobidModel): number {
    const parameters = GrobidProperties.getGrobidModelParameters(model.getModelName());
    if (parameters !== null && parameters.wapiti != null) return parameters.wapiti.epsilon;
    return 0.00001;
  }

  static getNbMaxIterations(model: GrobidModel): number {
    const parameters = GrobidProperties.getGrobidModelParameters(model.getModelName());
    if (parameters !== null && parameters.wapiti != null) return parameters.wapiti.nbMaxIterations;
    return 2000;
  }

  static useELMo(modelName: string): boolean {
    const param = GrobidProperties.getGrobidModelParameters(modelName);
    if (param === null) {
      GrobidProperties.LOGGER.debug("No configuration parameter defined for model " + modelName);
      return false;
    }
    const delftParam = param.delft;
    if (delftParam == null) {
      GrobidProperties.LOGGER.debug(
        "No configuration parameter defined for DeLFT engine for model " + modelName,
      );
      return false;
    }
    return (param.delft as DelftModelParameters).useELMo;
  }

  static getDelftArchitecture(modelName: string): string | null;
  static getDelftArchitecture(model: GrobidModel): string | null;
  static getDelftArchitecture(arg: string | GrobidModel): string | null {
    if (typeof arg !== "string") {
      return GrobidProperties.getDelftArchitecture(arg.getModelName());
    }
    const modelName = arg;
    const param = GrobidProperties.getGrobidModelParameters(modelName);
    if (param === null) {
      GrobidProperties.LOGGER.debug("No configuration parameter defined for model " + modelName);
      return null;
    }
    const delftParam = param.delft;
    if (delftParam == null) {
      GrobidProperties.LOGGER.debug(
        "No configuration parameter defined for DeLFT engine for model " + modelName,
      );
      return null;
    }
    return (param.delft as DelftModelParameters).architecture ?? null;
  }

  static getDelftEmbeddingsName(modelName: string): string | null {
    const param = GrobidProperties.getGrobidModelParameters(modelName);
    if (param === null) {
      GrobidProperties.LOGGER.debug("No configuration parameter defined for model " + modelName);
      return null;
    }
    const delftParam = param.delft;
    if (delftParam == null) {
      GrobidProperties.LOGGER.debug(
        "No configuration parameter defined for DeLFT engine for model " + modelName,
      );
      return null;
    }
    return (param.delft as DelftModelParameters).embeddings_name ?? null;
  }

  static getDelftTranformer(modelName: string): string | null {
    const param = GrobidProperties.getGrobidModelParameters(modelName);
    if (param === null) {
      GrobidProperties.LOGGER.debug("No configuration parameter defined for model " + modelName);
      return null;
    }
    const delftParam = param.delft;
    if (delftParam == null) {
      GrobidProperties.LOGGER.debug(
        "No configuration parameter defined for DeLFT engine for model " + modelName,
      );
      return null;
    }
    return (param.delft as DelftModelParameters).transformer ?? null;
  }

  /** Return -1 if not set in the configuration and the default DeLFT value will be used in this case. */
  static getDelftTrainingMaxSequenceLength(modelName: string): number {
    const param = GrobidProperties.getGrobidModelParameters(modelName);
    if (param === null) {
      GrobidProperties.LOGGER.debug("No configuration parameter defined for model " + modelName);
      return -1;
    }
    const delftParam = param.delft;
    if (delftParam == null) {
      GrobidProperties.LOGGER.debug(
        "No configuration parameter defined for DeLFT engine for model " + modelName,
      );
      return -1;
    }
    const delftParamSet = (param.delft as DelftModelParameters).training;
    if (delftParamSet == null) {
      GrobidProperties.LOGGER.debug(
        "No training configuration parameter defined for DeLFT engine for model " + modelName,
      );
      return -1;
    }

    return (param.delft as DelftModelParameters).training!.max_sequence_length;
  }

  /** Return -1 if not set in the configuration and the default DeLFT value will be used in this case. */
  static getDelftRuntimeMaxSequenceLength(modelName: string): number {
    const param = GrobidProperties.getGrobidModelParameters(modelName);
    if (param === null) {
      GrobidProperties.LOGGER.debug("No configuration parameter defined for model " + modelName);
      return -1;
    }
    const delftParam = param.delft;
    if (delftParam == null) {
      GrobidProperties.LOGGER.debug(
        "No configuration parameter defined for DeLFT engine for model " + modelName,
      );
      return -1;
    }
    const delftParamSet = (param.delft as DelftModelParameters).runtime;
    if (delftParamSet == null) {
      GrobidProperties.LOGGER.debug(
        "No runtime configuration parameter defined for DeLFT engine for model " + modelName,
      );
      return -1;
    }
    return (param.delft as DelftModelParameters).runtime!.max_sequence_length;
  }

  /** Return -1 if not set in the configuration and the default DeLFT value will be used in this case. */
  static getDelftTrainingBatchSize(modelName: string): number {
    const param = GrobidProperties.getGrobidModelParameters(modelName);
    if (param === null) {
      GrobidProperties.LOGGER.debug("No configuration parameter defined for model " + modelName);
      return -1;
    }
    const delftParam = param.delft;
    if (delftParam == null) {
      GrobidProperties.LOGGER.debug(
        "No configuration parameter defined for DeLFT engine for model " + modelName,
      );
      return -1;
    }
    const delftParamSet = (param.delft as DelftModelParameters).training;
    if (delftParamSet == null) {
      GrobidProperties.LOGGER.debug(
        "No training configuration parameter defined for DeLFT engine for model " + modelName,
      );
      return -1;
    }
    return (param.delft as DelftModelParameters).training!.batch_size;
  }

  /** Return -1 if not set in the configuration and the default DeLFT value will be used in this case. */
  static getDelftRuntimeBatchSize(modelName: string): number {
    const param = GrobidProperties.getGrobidModelParameters(modelName);
    if (param === null) {
      GrobidProperties.LOGGER.debug("No configuration parameter defined for model " + modelName);
      return -1;
    }
    const delftParam = param.delft;
    if (delftParam == null) {
      GrobidProperties.LOGGER.debug(
        "No configuration parameter defined for DeLFT engine for model " + modelName,
      );
      return -1;
    }
    const delftParamSet = (param.delft as DelftModelParameters).runtime;
    if (delftParamSet == null) {
      GrobidProperties.LOGGER.debug(
        "No runtime configuration parameter defined for DeLFT engine for model " + modelName,
      );
      return -1;
    }
    return (param.delft as DelftModelParameters).runtime!.batch_size;
  }

  /*protected static Map<String, String> getEnvironmentVariableOverrides(Map<String, String> environmentVariablesMap) {
        EnvironmentVariableProperties envParameters = new EnvironmentVariableProperties(environmentVariablesMap, "(grobid__).+");
        return envParameters.getConfigParameters();
    }*/
}
