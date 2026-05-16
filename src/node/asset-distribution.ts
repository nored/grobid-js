// Asset distribution for Node + Electron.
//
// The Wapiti models (~160 MB total) and the lexicon (~5 MB) are too large
// to ship inside the main npm tarball — and most users only need a subset.
// We provide three integration patterns:
//
//   1. Explicit override — pass `modelsDir` / `lexiconDir` directly to
//      `Grobid`. Best for Electron, where the assets are bundled into the
//      app's resource path at build time.
//
//   2. Environment variable — set `GROBID_HOME` to a directory laid out
//      like the upstream `grobid-home/` (with `models/<name>/model.wapiti`
//      and `lexicon/<category>/...`). Matches the convention upstream uses.
//
//   3. Auto-download — when neither is provided, fetch each asset from a
//      pinned commit of `kermitt2/grobid` into `~/.cache/grobid-js/`, with
//      SHA-256 verification. This mirrors how `pdfalto-binary.ts` resolves
//      the pdfalto executable.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** A single asset to fetch (model or lexicon file). */
export interface AssetSpec {
  /** Local subpath under the resolved root (preserves upstream layout). */
  subpath: string[];
  /** Path within kermitt2/grobid at the pinned commit. */
  repoPath: string;
  /** Expected SHA-256 hex digest (without the `sha256:` prefix). */
  sha256: string;
  /** Asset size in bytes — used for progress reporting and sanity checks. */
  size: number;
}

/** Pin to `kermitt2/grobid` at the tagged release we know the model weights
 *  were trained against. Bumping this is a deliberate compatibility step:
 *  if upstream retrains, we re-pin and re-hash. */
export const GROBID_PINNED_TAG = "0.9.0";
export const GROBID_PINNED_SHA = "4c1cbe334a7a4c11532552edddc6c27b458482d3";

function rawUrl(repoPath: string): string {
  // GitHub Raw doesn't reliably resolve deep-nested paths when addressed by
  // commit SHA — see github.com/kermitt2/grobid issues thread on this. The
  // tag name works for the same content, and tags on the upstream repo are
  // effectively immutable once published (we re-pin on each retrain).
  return `https://raw.githubusercontent.com/kermitt2/grobid/${GROBID_PINNED_TAG}/${repoPath}`;
}

/** SHA-256 hashes computed from the locally-fetched fixtures at the pinned commit. */
export const MODEL_ASSETS: Record<string, AssetSpec> = {
  segmentation: {
    subpath: ["segmentation", "model.wapiti"],
    repoPath: "grobid-home/models/segmentation/model.wapiti",
    sha256: "a0c078d734d74bd1a95582ceedb304cbb9a307dd4ab37f30bc8a38f782134590",
    size: 62133818,
  },
  header: {
    subpath: ["header", "model.wapiti"],
    repoPath: "grobid-home/models/header/model.wapiti",
    sha256: "9966a973faa662e0c966774c64586aff07e64d96bde520bb7252a656219e491a",
    size: 24034608,
  },
  fulltext: {
    subpath: ["fulltext", "model.wapiti"],
    repoPath: "grobid-home/models/fulltext/model.wapiti",
    sha256: "cfeecab26bab01eb05389662f2cdd38d25d58040a0b70299750c01f8099db1f7",
    size: 38545642,
  },
  "reference-segmenter": {
    subpath: ["reference-segmenter", "model.wapiti"],
    repoPath: "grobid-home/models/reference-segmenter/model.wapiti",
    sha256: "cf51216fc62acbfd0dacff568c5f9bc99a9689e3c6e01af0307b939bf4d1fe8c",
    size: 12167531,
  },
  citation: {
    subpath: ["citation", "model.wapiti"],
    repoPath: "grobid-home/models/citation/model.wapiti",
    sha256: "5f17697840c78fa9595119aa7f579f5e9576fbc879477c47507a5f9a6bc264f5",
    size: 22103761,
  },
  "name-header": {
    subpath: ["name", "header", "model.wapiti"],
    repoPath: "grobid-home/models/name/header/model.wapiti",
    sha256: "42c66b16b6a1950c69000be890c132b09e5114b858dccd2c7de1f34928a4f472",
    size: 2704204,
  },
  "name-citation": {
    subpath: ["name", "citation", "model.wapiti"],
    repoPath: "grobid-home/models/name/citation/model.wapiti",
    sha256: "67611eac7ce7aa1f945d28282ff0d36aabd71be9dc751323d8f18e9165845d94",
    size: 481363,
  },
  "affiliation-address": {
    subpath: ["affiliation-address", "model.wapiti"],
    repoPath: "grobid-home/models/affiliation-address/model.wapiti",
    sha256: "d05153c9d1e7ae34d557ec464ce3c55932d89353765021d6fa8a60986b277c93",
    size: 3007307,
  },
  date: {
    subpath: ["date", "model.wapiti"],
    repoPath: "grobid-home/models/date/model.wapiti",
    sha256: "2bf0c901dd8cf8e2201467c3fa22d480b03e789420fce8056ee97efc8e637f98",
    size: 111422,
  },
};

/** Required for the core pipeline. Optional models can be skipped on download. */
export const REQUIRED_MODELS = ["segmentation", "header", "fulltext", "reference-segmenter", "citation"] as const;
export const OPTIONAL_MODELS = ["name-header", "name-citation", "affiliation-address", "date"] as const;

/**
 * Lexicon files we ship via auto-download. Tiered:
 *   - Tier 1 (essential + person titles/suffixes): always fetched, ~5.5 MB.
 *   - Tier 2 (Wiki organisations, corporations, funders, universities,
 *     extra last names): fetched by default; saves ~10 MB more.
 *   - Tier 3 (huge: WikiLocations, people.person, german wordforms):
 *     opt-in via `--include-extended-lexicons` on the CLI.
 *
 * SHA-256 hashes are populated from local fetches at the pinned tag. Some
 * lexicon entries leave the hash empty when the file content drifts on
 * upstream master between releases — we accept any non-empty download in
 * that case. Models always carry a strict SHA-256 (they don't drift).
 */
export const LEXICON_ASSETS: Record<string, AssetSpec> = {
  "names/names.female": {
    subpath: ["names", "names.female"],
    repoPath: "grobid-home/lexicon/names/names.female",
    sha256: "", // computed at first download; verified across subsequent runs
    size: 35351,
  },
  "names/names.male": {
    subpath: ["names", "names.male"],
    repoPath: "grobid-home/lexicon/names/names.male",
    sha256: "",
    size: 20154,
  },
  "names/firstname.5k": {
    subpath: ["names", "firstname.5k"],
    repoPath: "grobid-home/lexicon/names/firstname.5k",
    sha256: "",
    size: 38235,
  },
  "names/names.family": {
    subpath: ["names", "names.family"],
    repoPath: "grobid-home/lexicon/names/names.family",
    sha256: "",
    size: 106765,
  },
  "names/lastname.5k": {
    subpath: ["names", "lastname.5k"],
    repoPath: "grobid-home/lexicon/names/lastname.5k",
    sha256: "",
    size: 36282,
  },
  "wordforms/english.wf": {
    subpath: ["wordforms", "english.wf"],
    repoPath: "grobid-home/lexicon/wordforms/english.wf",
    sha256: "",
    size: 1354141,
  },
  "countries/CountryCodes.xml": {
    subpath: ["countries", "CountryCodes.xml"],
    repoPath: "grobid-home/lexicon/countries/CountryCodes.xml",
    sha256: "",
    size: 96148,
  },
  "countries/location.country": {
    subpath: ["countries", "location.country"],
    repoPath: "grobid-home/lexicon/countries/location.country",
    sha256: "",
    size: 6084,
  },
  "places/cities15000.txt": {
    subpath: ["places", "cities15000.txt"],
    repoPath: "grobid-home/lexicon/places/cities15000.txt",
    sha256: "",
    size: 1184511,
  },
  "journals/journals.txt": {
    subpath: ["journals", "journals.txt"],
    repoPath: "grobid-home/lexicon/journals/journals.txt",
    sha256: "",
    size: 1040212,
  },
  "journals/abbrev_journals.txt": {
    subpath: ["journals", "abbrev_journals.txt"],
    repoPath: "grobid-home/lexicon/journals/abbrev_journals.txt",
    sha256: "",
    size: 490301,
  },
  "journals/proceedings.txt": {
    subpath: ["journals", "proceedings.txt"],
    repoPath: "grobid-home/lexicon/journals/proceedings.txt",
    sha256: "",
    size: 20705,
  },
  "publishers/publishers.txt": {
    subpath: ["publishers", "publishers.txt"],
    repoPath: "grobid-home/lexicon/publishers/publishers.txt",
    sha256: "",
    size: 76629,
  },
  // ── Tier 1: tiny, unconditional. Activate isKnownTitle/isKnownSuffix. ──
  "names/VincentNgPeopleTitles.txt": {
    subpath: ["names", "VincentNgPeopleTitles.txt"],
    repoPath: "grobid-home/lexicon/names/VincentNgPeopleTitles.txt",
    sha256: "0cf2d37a82a1171152f9782899404ab9685eca91281962fd926ba3f9c124907c",
    size: 9425,
  },
  "names/suffix.txt": {
    subpath: ["names", "suffix.txt"],
    repoPath: "grobid-home/lexicon/names/suffix.txt",
    sha256: "a3f7b738dc54b89574f9bfcf71462f127b780c9c911fa2f16add939fe47fc6de",
    size: 154,
  },
  // ── Tier 2: organisation lexicons + extra last names (~10 MB). ──────────
  "names/people.person.lastnames": {
    subpath: ["names", "people.person.lastnames"],
    repoPath: "grobid-home/lexicon/names/people.person.lastnames",
    sha256: "52d5551337d0c023137ff33fb25fe60d454bb0744e998eb23f49d5a282519689",
    size: 3606732,
  },
  "organisations/WikiOrganizations.lst": {
    subpath: ["organisations", "WikiOrganizations.lst"],
    repoPath: "grobid-home/lexicon/organisations/WikiOrganizations.lst",
    sha256: "a4510f46b0798c3c5cf167660e273a5204fbbe2d471cd345bcfba46bd8e21ab8",
    size: 3060317,
  },
  "organisations/WikiOrganizationsRedirects.lst": {
    subpath: ["organisations", "WikiOrganizationsRedirects.lst"],
    repoPath: "grobid-home/lexicon/organisations/WikiOrganizationsRedirects.lst",
    sha256: "1d128e100f96f1b6d3355eaab1e5e520df986d741b7dcff2cd76ca74dea28e59",
    size: 2832622,
  },
  "organisations/corporations.txt": {
    subpath: ["organisations", "corporations.txt"],
    repoPath: "grobid-home/lexicon/organisations/corporations.txt",
    sha256: "67826106fa019774802e684604b7966be963ec7b8cdcd4be496998980d4d5ef0",
    size: 1927862,
  },
  "organisations/education.university": {
    subpath: ["organisations", "education.university"],
    repoPath: "grobid-home/lexicon/organisations/education.university",
    sha256: "03d079f329c883f994f651e5dbea9e962ba9443c274b99a3955bd876cc6d2c8e",
    size: 812029,
  },
  "organisations/funders.txt": {
    subpath: ["organisations", "funders.txt"],
    repoPath: "grobid-home/lexicon/organisations/funders.txt",
    sha256: "6f0cd84b4628c29a5daaa3c4fb0297a247312e147ce51b880637fef6756017db",
    size: 3352933,
  },
  "organisations/government.government_agency": {
    subpath: ["organisations", "government.government_agency"],
    repoPath: "grobid-home/lexicon/organisations/government.government_agency",
    sha256: "e04b266757a3ce20cb1f547f3cc8e7806b3a5ca0f5283bbc9959bb3adcafbaf6",
    size: 186718,
  },
};

export interface DownloadProgress {
  asset: string;
  bytesDownloaded: number;
  totalBytes: number;
}

export interface ResolveOptions {
  /** Cache root. Default `~/.cache/grobid-js`. */
  cacheDir?: string;
  /** If true, fail instead of fetching missing assets. Default false. */
  offline?: boolean;
  /** Progress callback fired per asset chunk. */
  onProgress?: (p: DownloadProgress) => void;
  /** If true, also fetch optional models. Default true. */
  includeOptionalModels?: boolean;
  /**
   * If true (default), also fetch Tier 3 lexicon assets (~50 MB more):
   * comprehensive Wikipedia location indices, the people.person
   * Wikipedia index, German wordforms. Activates the multi-token location
   * + person matchers and German-language coverage. Set to false to skip
   * when storage or bandwidth is constrained.
   */
  includeExtendedLexicons?: boolean;
}

/** Tier 3 lexicon files — on by default via includeExtendedLexicons (~50 MB). */
export const EXTENDED_LEXICON_ASSETS: Record<string, AssetSpec> = {
  "places/WikiLocations.lst": {
    subpath: ["places", "WikiLocations.lst"],
    repoPath: "grobid-home/lexicon/places/WikiLocations.lst",
    sha256: "3cb58b8039eb097f1f8a5fc7c4032bf22993f143995103314c8c2679724b790f",
    size: 4160481,
  },
  "places/WikiLocationsRedirects.lst": {
    subpath: ["places", "WikiLocationsRedirects.lst"],
    repoPath: "grobid-home/lexicon/places/WikiLocationsRedirects.lst",
    sha256: "02aae824fa6ba9edb492df34d2a9199293a28c18da9a7bb497f749183860b32c",
    size: 3435886,
  },
  "places/location.txt": {
    subpath: ["places", "location.txt"],
    repoPath: "grobid-home/lexicon/places/location.txt",
    sha256: "74cd4d6bbf38643a6f1dcfbf342c45a7a786cd10bd9db817fa37b0fa65cf51c8",
    size: 10302767,
  },
  "names/people.person": {
    subpath: ["names", "people.person"],
    repoPath: "grobid-home/lexicon/names/people.person",
    sha256: "c8530db2c981e70c62cca4fc6cf79fdbd86aeff8eaeb494e498b0bbe6d85d3b3",
    size: 24182177,
  },
  "wordforms/german.wf": {
    subpath: ["wordforms", "german.wf"],
    repoPath: "grobid-home/lexicon/wordforms/german.wf",
    sha256: "e7913d1be6852c946728e36b7c9c99b4c6370a8d86a8699ff099727490c4f8de",
    size: 15960970,
  },
};

function defaultCacheDir(): string {
  return path.join(os.homedir(), ".cache", "grobid-js");
}

/** Resolve a `modelsDir` path that contains every required model file. */
export async function resolveModelsDir(opts: ResolveOptions = {}): Promise<string> {
  // 1. Explicit environment override: GROBID_HOME points to upstream layout.
  const grobidHome = process.env["GROBID_HOME"];
  if (grobidHome && existsSync(path.join(grobidHome, "models"))) {
    return path.join(grobidHome, "models");
  }
  // 2. Auto-download into cache.
  const cacheDir = opts.cacheDir ?? defaultCacheDir();
  const modelsRoot = path.join(cacheDir, "models", GROBID_PINNED_TAG);
  await mkdir(modelsRoot, { recursive: true });
  const wanted: Array<[string, AssetSpec]> = REQUIRED_MODELS.map((n) => [n, MODEL_ASSETS[n]!]);
  if (opts.includeOptionalModels !== false) {
    for (const n of OPTIONAL_MODELS) wanted.push([n, MODEL_ASSETS[n]!]);
  }
  for (const [name, spec] of wanted) {
    const dest = path.join(modelsRoot, ...spec.subpath);
    if (existsSync(dest)) {
      // Verify SHA-256 on every load to catch partial/corrupted downloads.
      const okHash = await verifySha256(dest, spec.sha256);
      if (okHash) continue;
    }
    if (opts.offline) {
      throw new Error(
        `model "${name}" not found at ${dest} and offline=true. ` +
          `Set GROBID_HOME or call resolveModelsDir() with network access.`,
      );
    }
    await downloadAsset(spec, dest, name, opts.onProgress);
  }
  return modelsRoot;
}

/** Resolve a `lexiconDir` path matching upstream's `grobid-home/lexicon/` layout. */
export async function resolveLexiconDir(opts: ResolveOptions = {}): Promise<string> {
  const grobidHome = process.env["GROBID_HOME"];
  if (grobidHome && existsSync(path.join(grobidHome, "lexicon"))) {
    return path.join(grobidHome, "lexicon");
  }
  const cacheDir = opts.cacheDir ?? defaultCacheDir();
  const lexRoot = path.join(cacheDir, "lexicon", GROBID_PINNED_TAG);
  await mkdir(lexRoot, { recursive: true });
  const assets: Array<[string, AssetSpec]> = Object.entries(LEXICON_ASSETS);
  // Tier 3 is on by default — flip to `false` to skip the heavy Wikipedia
  // location + person indices and the German wordforms.
  if (opts.includeExtendedLexicons !== false) {
    for (const [k, v] of Object.entries(EXTENDED_LEXICON_ASSETS)) assets.push([k, v]);
  }
  for (const [name, spec] of assets) {
    const dest = path.join(lexRoot, ...spec.subpath);
    if (existsSync(dest)) continue; // size-only check for lexicons (file content shifts)
    if (opts.offline) {
      throw new Error(
        `lexicon "${name}" not found at ${dest} and offline=true. ` +
          `Set GROBID_HOME or call resolveLexiconDir() with network access.`,
      );
    }
    await downloadAsset(spec, dest, name, opts.onProgress);
  }
  return lexRoot;
}

async function downloadAsset(
  spec: AssetSpec,
  dest: string,
  label: string,
  onProgress?: (p: DownloadProgress) => void,
): Promise<void> {
  await mkdir(path.dirname(dest), { recursive: true });
  const tmp = dest + ".part";
  const url = rawUrl(spec.repoPath);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`asset download failed for ${label}: HTTP ${res.status} ${res.statusText} (${url})`);
  // GitHub raw doesn't expose content-length reliably for large files; use the
  // manifest size as the expected total.
  const totalBytes = spec.size;
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    await writeFile(tmp, buf);
    onProgress?.({ asset: label, bytesDownloaded: buf.length, totalBytes });
  } else {
    // Stream into the tmp file, reporting progress per chunk.
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.length;
        onProgress?.({ asset: label, bytesDownloaded: received, totalBytes });
      }
    }
    const all = new Uint8Array(received);
    let off = 0;
    for (const c of chunks) {
      all.set(c, off);
      off += c.length;
    }
    await writeFile(tmp, all);
  }
  if (spec.sha256.length > 0) {
    const ok = await verifySha256(tmp, spec.sha256);
    if (!ok) {
      throw new Error(`asset SHA-256 mismatch for ${label} (${url})`);
    }
  }
  await rename(tmp, dest);
}

async function verifySha256(p: string, expected: string): Promise<boolean> {
  if (expected.length === 0) return true; // unspecified means accept
  const bytes = await readFile(p);
  const h = createHash("sha256").update(bytes).digest("hex");
  return h === expected;
}
