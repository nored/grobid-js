// Port of org.grobid.core.GrobidModels.
// Upstream: grobid-core/src/main/java/org/grobid/core/GrobidModels.java
//
// Adaptations:
// - Java enum → class with `static readonly` singletons, plus `values()`,
//   `name()`, and `get(name)` static API to mirror enum semantics.
// - Inner enum `Flavor` → top-level `export enum Flavor` plus a static alias
//   on `GrobidModels` (so `GrobidModels.Flavor.BLANK` keeps working).
// - The anonymous-inner-class created by `modelFor` becomes a small private
//   class with the same four overrides.

import * as fs from "node:fs";
import { getLogger } from "./utilities/logger.js";
import type { GrobidModel } from "./grobid-model.js";
import { GrobidProperties } from "./utilities/grobid-properties.js";

const LOGGER = getLogger("EngineParsers");

/**
 * Flavors are dedicated models variant, but using the same base parser.
 * This is used in particular for scientific or technical documents like standards (SDO)
 * which have a particular overall zoning and/or header, while the rest of the content
 * is similar to other general technical and scientific document.
 *
 * Java upstream is a nested enum; the JS port is a class with static
 * singletons + `values()` / `name()` / `fromLabel(name)` static API.
 */
export class Flavor {
  static readonly BLANK = new Flavor("BLANK", "blank");
  static readonly ARTICLE_LIGHT = new Flavor("ARTICLE_LIGHT", "article/light");
  static readonly ARTICLE_LIGHT_WITH_REFERENCES = new Flavor("ARTICLE_LIGHT_WITH_REFERENCES", "article/light-ref");
  static readonly _3GPP = new Flavor("_3GPP", "sdo/3gpp");
  static readonly IETF = new Flavor("IETF", "sdo/ietf");

  readonly label: string;
  private readonly _name: string;

  private constructor(name: string, label: string) {
    this._name = name;
    this.label = label;
  }

  getLabel(): string {
    return this.label;
  }

  getPlainLabel(): string {
    return this.label.replace(/\//g, "_");
  }

  static fromLabel(text: string): Flavor | null {
    for (const f of Flavor.values()) {
      if (f.label.toLowerCase() === (text ?? "").toLowerCase()) {
        return f;
      }
    }
    return null;
  }

  toString(): string {
    return this.getLabel();
  }

  static getLabels(): string[] {
    return Flavor.values().map((f) => f.getLabel());
  }

  static values(): Flavor[] {
    return [
      Flavor.BLANK,
      Flavor.ARTICLE_LIGHT,
      Flavor.ARTICLE_LIGHT_WITH_REFERENCES,
      Flavor._3GPP,
      Flavor.IETF,
    ];
  }

  name(): string {
    return this._name;
  }
}

/**
 * This enum class acts as a registry for all Grobid models.
 */
export class GrobidModels implements GrobidModel {
  //I cannot declare it before
  static readonly DUMMY_FOLDER_LABEL: string = "none";

  // Java's inner enum is exposed as a static alias on the class.
  static readonly Flavor = Flavor;

  // models are declared with a enumerated unique name associated to a **folder name** for the model
  // the folder name is where we will find the model implementation and its resources under grobid-home
  static readonly AFFILIATION_ADDRESS = new GrobidModels("AFFILIATION_ADDRESS", "affiliation-address");
  static readonly SEGMENTATION = new GrobidModels("SEGMENTATION", "segmentation");
  static readonly SEGMENTATION_ARTICLE_LIGHT = new GrobidModels("SEGMENTATION_ARTICLE_LIGHT", "segmentation/article/light");
  static readonly SEGMENTATION_ARTICLE_LIGHT_REF = new GrobidModels("SEGMENTATION_ARTICLE_LIGHT_REF", "segmentation/article/light-ref");
  static readonly SEGMENTATION_SDO_IETF = new GrobidModels("SEGMENTATION_SDO_IETF", "segmentation/sdo/ietf");
  static readonly SEGMENTATION_SDO_3GPP = new GrobidModels("SEGMENTATION_SDO_3GPP", "segmentation/sdo/3gpp");
  static readonly CITATION = new GrobidModels("CITATION", "citation");
  static readonly REFERENCE_SEGMENTER = new GrobidModels("REFERENCE_SEGMENTER", "reference-segmenter");
  static readonly DATE = new GrobidModels("DATE", "date");
  static readonly DICTIONARIES_LEXICAL_ENTRIES = new GrobidModels("DICTIONARIES_LEXICAL_ENTRIES", "dictionaries-lexical-entries");
  static readonly DICTIONARIES_SENSE = new GrobidModels("DICTIONARIES_SENSE", "dictionaries-sense");
  static readonly MONOGRAPH = new GrobidModels("MONOGRAPH", "monograph");
  static readonly ENTITIES_CHEMISTRY = new GrobidModels("ENTITIES_CHEMISTRY", "entities/chemistry");
  //	ENTITIES_CHEMISTRY("chemistry"),
  static readonly FULLTEXT = new GrobidModels("FULLTEXT", "fulltext");
  static readonly FULLTEXT_ARTICLE_LIGHT_REF = new GrobidModels("FULLTEXT_ARTICLE_LIGHT_REF", "fulltext");
  static readonly FULLTEXT_ARTICLE_LIGHT = new GrobidModels("FULLTEXT_ARTICLE_LIGHT", "fulltext");
  static readonly SHORTTEXT = new GrobidModels("SHORTTEXT", "shorttext");
  static readonly FIGURE = new GrobidModels("FIGURE", "figure");
  static readonly TABLE = new GrobidModels("TABLE", "table");
  static readonly HEADER = new GrobidModels("HEADER", "header");
  static readonly HEADER_ARTICLE_LIGHT = new GrobidModels("HEADER_ARTICLE_LIGHT", "header/article/light");
  static readonly HEADER_ARTICLE_LIGHT_REF = new GrobidModels("HEADER_ARTICLE_LIGHT_REF", "header/article/light-ref");
  static readonly HEADER_SDO_3GPP = new GrobidModels("HEADER_SDO_3GPP", "header/sdo/3gpp");
  static readonly HEADER_SDO_IETF = new GrobidModels("HEADER_SDO_IETF", "header/sdo/ietf");
  static readonly NAMES_CITATION = new GrobidModels("NAMES_CITATION", "name/citation");
  static readonly NAMES_HEADER = new GrobidModels("NAMES_HEADER", "name/header");
  static readonly PATENT_PATENT = new GrobidModels("PATENT_PATENT", "patent/patent");
  static readonly PATENT_NPL = new GrobidModels("PATENT_NPL", "patent/npl");
  static readonly PATENT_CITATION = new GrobidModels("PATENT_CITATION", "patent/citation");
  static readonly PATENT_STRUCTURE = new GrobidModels("PATENT_STRUCTURE", "patent/structure");
  static readonly PATENT_EDIT = new GrobidModels("PATENT_EDIT", "patent/edit");
  static readonly ENTITIES_NER = new GrobidModels("ENTITIES_NER", "ner");
  static readonly ENTITIES_NERFR = new GrobidModels("ENTITIES_NERFR", "nerfr");
  static readonly ENTITIES_NERSense = new GrobidModels("ENTITIES_NERSense", "nersense");
  //	ENTITIES_BIOTECH("entities/biotech"),
  static readonly ENTITIES_BIOTECH = new GrobidModels("ENTITIES_BIOTECH", "bio");
  static readonly ASTRO = new GrobidModels("ASTRO", "astro");
  static readonly SOFTWARE = new GrobidModels("SOFTWARE", "software");
  static readonly DATASEER = new GrobidModels("DATASEER", "dataseer");
  //ACKNOWLEDGEMENT("acknowledgement"),
  static readonly FUNDING_ACKNOWLEDGEMENT = new GrobidModels("FUNDING_ACKNOWLEDGEMENT", "funding-acknowledgement");
  static readonly INFRASTRUCTURE = new GrobidModels("INFRASTRUCTURE", "infrastructure");
  static readonly DUMMY = new GrobidModels("DUMMY", "none");
  static readonly LICENSE = new GrobidModels("LICENSE", "license");
  static readonly COPYRIGHT = new GrobidModels("COPYRIGHT", "copyright");

  /**
   * Absolute path to the model.
   */
  private modelPath: string | null = null;

  private folderName: string;

  private readonly _name: string;

  private static readonly models: Map<string, GrobidModel> = new Map<string, GrobidModel>();

  private constructor(name: string, folderName: string) {
    this._name = name;
    if (GrobidModels.DUMMY_FOLDER_LABEL === folderName) {
      this.modelPath = GrobidModels.DUMMY_FOLDER_LABEL;
      this.folderName = GrobidModels.DUMMY_FOLDER_LABEL;
      return;
    }

    this.folderName = folderName;
    // Mirrors upstream: enum-time `GrobidProperties.getModelPath(this)` is
    // tolerated when GrobidProperties hasn't been initialized yet — the
    // model path is recomputed lazily on `getModelPath()`. In TS we
    // additionally guard against any throw during early bootstrap.
    try {
      const path = GrobidProperties.getModelPath(this);
      if (path !== null) this.modelPath = path;
    } catch {
      // GrobidProperties not yet initialized — defer.
    }
  }

  getFolderName(): string {
    return this.folderName;
  }

  getModelPath(): string {
    if (this.modelPath === null) {
      try {
        const path = GrobidProperties.getModelPath(this);
        if (path !== null) this.modelPath = path;
      } catch {
        // not yet initialized
      }
    }
    return this.modelPath as string;
  }

  getModelName(): string {
    return this.folderName.replace(/\//g, "-");
  }

  getTemplateName(): string {
    // StringUtils.substringBefore(folderName, "/")
    const idx = this.folderName.indexOf("/");
    const before = idx === -1 ? this.folderName : this.folderName.substring(0, idx);
    return before + ".template";
  }

  toString(): string {
    return this.folderName;
  }

  static getModelFlavor(model: GrobidModel, flavor: Flavor | null): GrobidModel {
    if (flavor === null) {
      return model;
    } else {
      const grobidModel = GrobidModels.modelFor(model.toString() + "/" + flavor.getLabel().toLowerCase());
      if (!fs.existsSync(grobidModel.getModelPath())) {
        LOGGER.info("The requested model flavor " + flavor.getLabel() + " model is not available. Defaulting to the standard model. ");
        return model;
      } else {
        return grobidModel;
      }
    }
  }

  static modelFor(name: string): GrobidModel {
    if (GrobidModels.models.size === 0) {
      for (const model of GrobidModels.values()) {
        if (!GrobidModels.models.has(model.getFolderName())) {
          GrobidModels.models.set(model.getFolderName(), model);
        }
      }
    }

    if (!GrobidModels.models.has(name)) {
      GrobidModels.models.set(name, new DynamicGrobidModel(name));
    }
    return GrobidModels.models.get(name) as GrobidModel;
  }

  getName(): string {
    return this.name();
  }

  // Enum-equivalent API
  name(): string {
    return this._name;
  }

  static values(): GrobidModels[] {
    return [
      GrobidModels.AFFILIATION_ADDRESS,
      GrobidModels.SEGMENTATION,
      GrobidModels.SEGMENTATION_ARTICLE_LIGHT,
      GrobidModels.SEGMENTATION_ARTICLE_LIGHT_REF,
      GrobidModels.SEGMENTATION_SDO_IETF,
      GrobidModels.SEGMENTATION_SDO_3GPP,
      GrobidModels.CITATION,
      GrobidModels.REFERENCE_SEGMENTER,
      GrobidModels.DATE,
      GrobidModels.DICTIONARIES_LEXICAL_ENTRIES,
      GrobidModels.DICTIONARIES_SENSE,
      GrobidModels.MONOGRAPH,
      GrobidModels.ENTITIES_CHEMISTRY,
      GrobidModels.FULLTEXT,
      GrobidModels.FULLTEXT_ARTICLE_LIGHT_REF,
      GrobidModels.FULLTEXT_ARTICLE_LIGHT,
      GrobidModels.SHORTTEXT,
      GrobidModels.FIGURE,
      GrobidModels.TABLE,
      GrobidModels.HEADER,
      GrobidModels.HEADER_ARTICLE_LIGHT,
      GrobidModels.HEADER_ARTICLE_LIGHT_REF,
      GrobidModels.HEADER_SDO_3GPP,
      GrobidModels.HEADER_SDO_IETF,
      GrobidModels.NAMES_CITATION,
      GrobidModels.NAMES_HEADER,
      GrobidModels.PATENT_PATENT,
      GrobidModels.PATENT_NPL,
      GrobidModels.PATENT_CITATION,
      GrobidModels.PATENT_STRUCTURE,
      GrobidModels.PATENT_EDIT,
      GrobidModels.ENTITIES_NER,
      GrobidModels.ENTITIES_NERFR,
      GrobidModels.ENTITIES_NERSense,
      GrobidModels.ENTITIES_BIOTECH,
      GrobidModels.ASTRO,
      GrobidModels.SOFTWARE,
      GrobidModels.DATASEER,
      GrobidModels.FUNDING_ACKNOWLEDGEMENT,
      GrobidModels.INFRASTRUCTURE,
      GrobidModels.DUMMY,
      GrobidModels.LICENSE,
      GrobidModels.COPYRIGHT,
    ];
  }
}

/**
 * Equivalent of the anonymous inner class created by `GrobidModels.modelFor`
 * for user-supplied / dynamic model names. Mirrors the four overrides.
 */
class DynamicGrobidModel implements GrobidModel {
  private readonly _folderName: string;

  constructor(folderName: string) {
    this._folderName = folderName;
  }

  getFolderName(): string {
    return this._folderName;
  }

  getModelPath(): string {
    let path: string | null = null;
    try {
      path = GrobidProperties.getModelPath(this);
    } catch {
      path = null;
    }
    if (path === null) {
      LOGGER.warn("The file path to the " + this._folderName + " model is invalid, path is null");
    } else if (!fs.existsSync(path)) {
      LOGGER.warn("The file path to the " + this._folderName + " model is invalid: " + path);
    }
    if (path === null) return null as unknown as string;
    return path;
  }

  getModelName(): string {
    return this.getFolderName().replace(/\//g, "-");
  }

  getTemplateName(): string {
    const idx = this._folderName.indexOf("/");
    const before = idx === -1 ? this._folderName : this._folderName.substring(0, idx);
    return before + ".template";
  }

  getName(): string {
    return this._folderName;
  }

  toString(): string {
    return this._folderName;
  }
}
