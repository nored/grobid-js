// Port of org.grobid.core.engines.LicenseClassifier.
// Upstream: grobid-core/src/main/java/org/grobid/core/engines/LicenseClassifier.java
//
// Adaptations:
// - Apache `CollectionUtils.isEmpty(list)` → JS `list == null || list.length === 0`.
// - Apache `StringUtils.isEmpty(s)` → `s == null || s === ""`.
// - Jackson `ObjectMapper.readTree(json)` → `JSON.parse(json)` returning a
//   plain JS object. The `findPath(name)` semantics are emulated by a small
//   `findPath` helper that mirrors Jackson's behaviour (recursive search by
//   field name, returning a missing-node marker if not found).
// - Java `JsonNode.isMissingNode()` → `node === MISSING_NODE` sentinel.
// - The double-checked locking idiom is collapsed to a single null check; JS
//   is single-threaded and the synchronized blocks are no-ops.
// - `CopyrightsOwner.valueOf(s.toUpperCase())` and `License.valueOf(s)` are
//   ported via explicit `nameToEnum` lookups on the ported enum constants.
// - `JsonProcessingException` from Jackson is mapped to any thrown `Error`
//   inside the try block.

import { CopyrightsLicense, CopyrightsOwner, License } from "../data/copyrights-license.js";
import { DeLFTClassifierModel } from "../jni/de-lft-classifier-model.js";
import { GrobidProperties } from "../utilities/grobid-properties.js";
import { getLogger } from "../utilities/logger.js";

const LOGGER = getLogger("LicenseClassifier");

// Mirrors Jackson's missing-node sentinel.
const MISSING_NODE = Symbol("MissingNode");
type JsonNode = unknown;

// Mirrors Jackson `JsonNode.findPath(fieldName)`: recursively walk the
// node tree looking for the first occurrence of a field with the given
// name; returns MISSING_NODE if not found.
function findPath(node: JsonNode, fieldName: string): JsonNode {
  if (node === null || node === undefined) return MISSING_NODE;
  if (typeof node !== "object") return MISSING_NODE;
  if (Array.isArray(node)) {
    for (const item of node) {
      const r = findPath(item, fieldName);
      if (r !== MISSING_NODE) return r;
    }
    return MISSING_NODE;
  }
  const obj = node as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(obj, fieldName)) {
    return obj[fieldName];
  }
  for (const key of Object.keys(obj)) {
    const r = findPath(obj[key], fieldName);
    if (r !== MISSING_NODE) return r;
  }
  return MISSING_NODE;
}

function isMissingNode(node: JsonNode): boolean {
  return node === MISSING_NODE;
}

function nodeElements(node: JsonNode): JsonNode[] {
  if (node === null || node === undefined) return [];
  if (Array.isArray(node)) return node as JsonNode[];
  if (typeof node === "object") return Object.values(node as Record<string, unknown>);
  return [];
}

function doubleValue(node: JsonNode): number {
  if (typeof node === "number") return node;
  if (typeof node === "string") {
    const v = Number(node);
    return isNaN(v) ? 0.0 : v;
  }
  return 0.0;
}

function copyrightsOwnerFromName(name: string): CopyrightsOwner | null {
  // Java enum `CopyrightsOwner.valueOf(name)` matches the enum CONSTANT_NAME.
  // Upstream Java enum names are: PUBLISHER, AUTHORS, UNDECIDED.
  switch (name) {
    case "PUBLISHER":
      return CopyrightsOwner.PUBLISHER;
    case "AUTHORS":
      return CopyrightsOwner.AUTHORS;
    case "UNDECIDED":
      return CopyrightsOwner.UNDECIDED;
    default:
      return null;
  }
}

function licenseFromName(name: string): License | null {
  // Upstream Java enum names: CC0, CCBY, CCBYNC, CCBYNCND, CCBYSA, CCBYNCSA,
  // CCBYND, COPYRIGHT, OTHER, UNDECIDED.
  switch (name) {
    case "CC0":
      return License.CC0;
    case "CCBY":
      return License.CCBY;
    case "CCBYNC":
      return License.CCBYNC;
    case "CCBYNCND":
      return License.CCBYNCND;
    case "CCBYSA":
      return License.CCBYSA;
    case "CCBYNCSA":
      return License.CCBYNCSA;
    case "CCBYND":
      return License.CCBYND;
    case "COPYRIGHT":
      return License.COPYRIGHT;
    case "OTHER":
      return License.OTHER;
    case "UNDECIDED":
      return License.UNDECIDED;
    default:
      return null;
  }
}

export class LicenseClassifier {
  // multi-class/multi-label classifier
  private classifierCopyrightsOwner: DeLFTClassifierModel;
  private classifierLicense: DeLFTClassifierModel;

  // binary classifiers to be added if used
  // NOTE: upstream `useBinary` field is declared/initialised but never read.
  // Preserved verbatim.
  private useBinary: boolean = false;

  // upstream `parser` field is declared but never assigned/read.
  // Preserved verbatim.
  private parser: unknown | null = null;

  private static instance: LicenseClassifier | null = null;

  static getInstance(): LicenseClassifier {
    if (LicenseClassifier.instance === null) {
      // synchronized (LicenseClassifier.class) {
      if (LicenseClassifier.instance === null) {
        LicenseClassifier.getNewInstance();
      }
      // }
    }
    return LicenseClassifier.instance!;
  }

  /** Create a new instance. */
  private static getNewInstance(): void {
    LicenseClassifier.instance = new LicenseClassifier();
  }

  private constructor() {
    // Upstream passes the possibly-null result of `getDelftArchitecture`
    // straight through to the constructor; we preserve that with a non-null
    // assertion (Java would NPE later if the architecture is required and
    // missing; TS would either get `null` cast to string or fail at the
    // call site, mirroring the upstream contract).
    this.classifierCopyrightsOwner = new DeLFTClassifierModel(
      "copyright",
      GrobidProperties.getDelftArchitecture("copyright") as string,
    );
    this.classifierLicense = new DeLFTClassifierModel(
      "license",
      GrobidProperties.getDelftArchitecture("license") as string,
    );
    // mark used to suppress unused-field lint; preserves the upstream fields.
    void this.useBinary;
    void this.parser;
  }

  /**
   * Classify a simple piece of text
   * @return list of predicted labels/scores pairs
   */
  classify(text: string): CopyrightsLicense | null;
  /**
   * Classify an array of texts
   * @return list of predicted labels/scores pairs for each text
   */
  classify(texts: string[]): CopyrightsLicense[] | null;
  classify(arg: string | string[]): CopyrightsLicense | CopyrightsLicense[] | null {
    if (typeof arg === "string") {
      if (arg == null || arg === "") return null;
      const texts: string[] = [];
      texts.push(arg);
      const result = this.classify(texts);
      return result === null ? null : result[0] ?? null;
    }
    const texts = arg;
    if (texts == null || texts.length === 0) return null;

    LOGGER.info("classify: " + texts.length);

    const copyrightOwnerAsJson: string = this.classifierCopyrightsOwner.classify(texts) as string;
    const licencesAsJson: string = this.classifierLicense.classify(texts) as string;

    return LicenseClassifier.extractResults(copyrightOwnerAsJson, licencesAsJson);
  }

  protected static extractResults(
    copyrightOwnerAsJson: string,
    licencesAsJson: string,
  ): CopyrightsLicense[] {
    const results: CopyrightsLicense[] = [];

    // set resulting context classes to entity mentions
    try {
      const root_copyrights: JsonNode = JSON.parse(copyrightOwnerAsJson);
      const root_licenses: JsonNode = JSON.parse(licencesAsJson);

      // upstream `entityRank` is updated but never read aside from increment;
      // preserved verbatim.
      let entityRank = 0;
      const classificationsNodeCopyrights = findPath(root_copyrights, "classifications");
      const classificationsNodeLicenses = findPath(root_licenses, "classifications");
      if (
        classificationsNodeCopyrights !== null &&
        !isMissingNode(classificationsNodeCopyrights) &&
        classificationsNodeLicenses !== null &&
        !isMissingNode(classificationsNodeLicenses)
      ) {
        const ite1 = nodeElements(classificationsNodeCopyrights)[Symbol.iterator]();
        const ite2 = nodeElements(classificationsNodeLicenses)[Symbol.iterator]();
        let it1Curr = ite1.next();
        while (!it1Curr.done) {
          const result = new CopyrightsLicense();
          let classificationsNode: JsonNode = it1Curr.value;

          const owners: string[] = CopyrightsLicense.copyrightOwners;
          let scoreFields: number[] = [];

          for (const fieldOwners of owners) {
            const fieldNode = findPath(classificationsNode, fieldOwners);
            // NOTE: upstream dead local — `double scoreField = 0.0;` is
            // declared but immediately overwritten or unused if the node is
            // missing. Preserved verbatim.
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            let _scoreField = 0.0;
            if (fieldNode !== null && !isMissingNode(fieldNode)) {
              scoreFields.push(doubleValue(fieldNode));
            }
            void _scoreField;
          }

          let owner: CopyrightsOwner | null = null;
          let bestProb = 0.0;
          let scoreUndecided = 0.0;
          let rank = 0;
          for (const scoreField of scoreFields) {
            if (scoreField > 0.5 && scoreField > bestProb) {
              owner = copyrightsOwnerFromName(owners[rank]!.toUpperCase());
              bestProb = scoreField;
            }
            scoreUndecided = scoreField;
            rank++;
          }

          if (owner === null) {
            owner = CopyrightsOwner.UNDECIDED;
            bestProb = scoreUndecided;
          }

          // set best copyright owner with prob
          result.setCopyrightsOwner(owner);
          result.setCopyrightsOwnerProb(bestProb);

          const it2Curr = ite2.next();
          if (it2Curr.done) {
            // upstream uses `ite2.next()` unconditionally; preserve NPE-like
            // semantics by breaking out (which Java would also see, but with
            // a NoSuchElementException). Mirrors the implicit contract that
            // both iterators have equal length.
            break;
          }
          classificationsNode = it2Curr.value;

          bestProb = 0.0;
          const licenses: string[] = CopyrightsLicense.licenses;
          scoreFields = [];

          for (const fieldLicenses of licenses) {
            const fieldNode = findPath(classificationsNode, fieldLicenses);
            // NOTE: upstream dead local — same pattern as above.
            let _scoreField = 0.0;
            if (fieldNode !== null && !isMissingNode(fieldNode)) {
              scoreFields.push(doubleValue(fieldNode));
            }
            void _scoreField;
          }

          bestProb = 0.0;
          scoreUndecided = 0.0;
          let license: License | null = null;
          rank = 0;
          for (const scoreField of scoreFields) {
            if (scoreField > 0.5 && scoreField > bestProb) {
              let valueLicense = licenses[rank]!;
              valueLicense = valueLicense.split("-").join("");
              license = licenseFromName(valueLicense.toUpperCase());
              bestProb = scoreField;
            }
            scoreUndecided = scoreField;
            rank++;
          }

          if (license === null) {
            license = License.UNDECIDED;
            bestProb = scoreUndecided;
          }

          // get best license with prob
          result.setLicense(license);
          result.setLicenseProb(bestProb);

          results.push(result);
          entityRank++;
          it1Curr = ite1.next();
        }
        void entityRank;
      }
    } catch (e) {
      LOGGER.error("failed to parse JSON copyrights/licenses classification result", e);
    }

    return results;
  }
}
