// Node-side public entry point. Wraps the upstream-faithful Engine in
// `src/grobid/` and exposes a small `Grobid.processPdf(pdfPath)` surface
// that returns a TEI-XML string.
//
// Upstream GROBID expects a `GROBID_HOME` directory with a fixed layout:
//
//   <GROBID_HOME>/
//     config/grobid.yaml             — Jackson YAML config, parsed by GrobidProperties
//     models/<folderName>/model.wapiti — one per CRF model (folder name from GrobidModels)
//     lexicon/<category>/...         — gazetteers / dictionaries read lazily by Lexicon
//     pdfalto/<os-arch>/pdfalto       — pdfalto binary (os-arch from Utilities.getOsNameAndArch)
//
// We don't force the caller to maintain that exact layout. Instead, on the
// first `processPdf` call this module scaffolds a tmpdir-based GROBID_HOME
// using symlinks pointing at:
//   - the resolved CRF models directory (asset-distribution or user override)
//   - the resolved lexicon directory (asset-distribution or user override)
//   - the resolved pdfalto binary (asset-distribution or user override)
// and writes a minimal `grobid.yaml` listing every Wapiti model with its
// engine. After that, `GrobidProperties.setGrobidHome(...)` is called,
// `Lexicon.getInstance()` is warmed up, and `new Engine(true)` loads the
// CRF tagger for each parser via `parsers.initAll()`.
//
// The scaffold is cached per `Grobid` instance and persists for the
// lifetime of the process — subsequent `processPdf` calls reuse it.

import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  resolveLexiconDir,
  resolveModelsDir,
  type DownloadProgress,
  type ResolveOptions,
} from "./asset-distribution.js";
import { resolvePdfaltoBinary, type PdfaltoBinaryOptions } from "./pdfalto-binary.js";
import { Engine } from "../grobid/engines/engine.js";
import {
  GrobidAnalysisConfig,
  GrobidAnalysisConfigBuilder,
} from "../grobid/engines/config/grobid-analysis-config.js";
import { GrobidProperties } from "../grobid/utilities/grobid-properties.js";
import { Lexicon } from "../grobid/lexicon/lexicon.js";
import { Utilities } from "../grobid/utilities/utilities.js";
import { getLogger } from "../grobid/utilities/logger.js";
import { setPage1CleanupEnabled } from "../grobid/document/page1-cleanup.js";
import { registerBidLSTMModel } from "../grobid/engines/tagging/bidlstm-crf-features-tagger.js";
import { TaggerFactory } from "../grobid/engines/tagging/tagger-factory.js";
import { registerDefaultDetectors } from "./default-detectors.js";
import { applyFallbackMetadata } from "./arxiv-fallback.js";
import { Document } from "../grobid/document/document.js";
import {
  detectScriptFromTokens,
  hintLanguageForScript,
  NON_LATIN_SCRIPTS,
  type Script,
} from "../grobid/utilities/script-detector.js";
import {
  getNonLatinVlmExtractor,
  type VlmHeaderExtraction,
} from "../grobid/utilities/non-latin-vlm-extractor.js";

const LOGGER = getLogger("Grobid");

/**
 * Convert the SDK's `boolean | "always" | 0..3 | undefined` consolidation
 * knob into upstream GROBID's integer consolidation level. Mirrors the
 * Java HTTP-API parsing in {@code AbstractFullTextRestProcessGeneric}
 * which accepts `consolidateHeader=true|false|0|1|2|3`.
 */
function consolidateLevel(
  value: boolean | "always" | 0 | 1 | 2 | 3 | undefined,
): number {
  if (value === undefined || value === false || value === 0) return 0;
  if (value === true || value === 1) return 1;
  if (value === 2) return 2;
  if (value === 3 || value === "always") return 3;
  return 0;
}

/** Public surface mirrors the upstream `Engine` knobs we expose at the SDK level. */
/**
 * Per-model BidLSTM_CRF_FEATURES configuration. When supplied for a model
 * (e.g. `"header"`), TaggerFactory dispatches that model to the
 * ONNX-backed BiLSTM tagger instead of Wapiti. Other models stay on
 * Wapiti unless they're also listed here.
 *
 * `modelDir` must contain the artifacts produced by
 * `scripts/convert-bidlstm-crf-features.py` (model.onnx, crf-transitions.bin,
 * crf-left/right-boundary.bin, vocab-char.json, vocab-tag.json,
 * vocab-features.json, model-config.json).
 *
 * `glove` resolves each input token to a 300-d Glove vector. For real
 * inference quality, use `GloveFileProvider` pointed at a vocab-restricted
 * dump produced by `scripts/extract-glove-vocab.py`. `ZeroGloveProvider`
 * is acceptable for smoke tests but produces garbage labels.
 */
export interface BidLSTMModelOption {
  modelDir: string;
  glove: import("../grobid/engines/tagging/bidlstm-crf-features-tagger.js").GloveProvider;
}

export interface GrobidOptions {
  /**
   * Path to a GROBID models directory (matching upstream's
   * `<grobid-home>/models/` layout: `<modelsDir>/<folderName>/model.wapiti`).
   * When omitted, Grobid auto-downloads the required model files from the
   * pinned upstream commit into `~/.cache/grobid-js/models/v<grobid-version>/`
   * on first use and reuses them on subsequent runs.
   */
  modelsDir?: string;
  /**
   * Path to a GROBID lexicon directory (matching `<grobid-home>/lexicon/`
   * layout). When omitted, Grobid auto-downloads the essential lexicon files
   * from the pinned upstream commit into `~/.cache/grobid-js/lexicon/`.
   * Set to `null` to skip the symlink (Lexicon will still try to read its
   * files but the scaffolded `<grobid-home>/lexicon/` will not exist —
   * upstream-equivalent behaviour for a missing lexicon).
   */
  lexiconDir?: string | null;
  /** Options for the pdfalto binary resolver (explicit path, version, etc.). */
  pdfaltoOptions?: PdfaltoBinaryOptions;
  /** Options for the asset auto-downloader (cache dir, offline mode, progress). */
  assetOptions?: ResolveOptions;
  /** Convenience: callback fired during model/lexicon auto-download. */
  onAssetProgress?: (p: DownloadProgress) => void;
  /**
   * Override the GROBID_HOME scaffold root. By default a freshly-created tmp
   * directory under `os.tmpdir()` is used. Set this to a stable path if you
   * want the scaffold to persist across runs (e.g. a Docker volume mount).
   */
  grobidHomeDir?: string;
  /**
   * Builder hook for the `GrobidAnalysisConfig` passed to `Engine.fullTextToTEI`.
   * The default builder mirrors upstream's `GrobidAnalysisConfig.defaultInstance()`
   * (no consolidation, no raw affiliations, etc.) but enables PDF-coordinate
   * emission on the canonical set of TEI elements upstream's CLI/web service
   * also enables by default (see `DEFAULT_TEI_COORDINATE_ELEMENTS`). Use this
   * hook to override consolidation, raw affiliations, or pass a custom coords
   * list via `.generateTeiCoordinates([...])`.
   */
  configureAnalysis?: (b: GrobidAnalysisConfigBuilder) => GrobidAnalysisConfigBuilder;
  /**
   * Override the list of TEI elements that receive `coords="page,x,y,w,h"`
   * attributes in the emitted TEI. Defaults to {@link DEFAULT_TEI_COORDINATE_ELEMENTS}
   * which matches the element list upstream GROBID's reference build uses.
   * Pass `null` to disable coordinate emission entirely, or pass an explicit
   * array of element names to opt in to a different subset.
   */
  generateTeiCoordinates?: string[] | null;
  /**
   * Whether to emit a `<note type="raw_affiliation">…</note>` carry-through of
   * the printed affiliation text inside each `<affiliation>` block (when the
   * underlying `Affiliation` carries a captured raw string). Mirrors upstream's
   * HTTP-API `includeRawAffiliations=1` flag (also passed by the reference
   * benchmark build alongside `consolidateHeader=0`). Defaults to `true` to
   * match the reference invocation; set to `false` to suppress the extra note
   * (the parsed `<orgName>`/`<address>` substructure is unaffected either way).
   */
  includeRawAffiliations?: boolean;
  /**
   * Whether to consolidate the extracted HEADER against CrossRef / biblio-glutton.
   *   - `false` (default): no consolidation, identical to upstream's `consolidateHeader=0`.
   *   - `true` or `1`: consolidate-and-correct (overwrite CRF fields with the
   *     canonical CrossRef record).
   *   - `2`: consolidate-and-inject-identifiers-only (DOI / arXiv / etc.).
   *   - `"always"` or `3`: like `1` but also injects when the CRF DOI is empty.
   *
   * Maps onto `GrobidAnalysisConfig.consolidateHeader(level)`. Best-effort:
   * any network / rate-limit error logs a warning and falls back to the
   * un-consolidated CRF output. Independent of `configureAnalysis` — if both
   * are passed, the user hook runs second and wins.
   */
  consolidateHeader?: boolean | "always" | 0 | 1 | 2 | 3;
  /**
   * Whether to consolidate each extracted CITATION (reference) against
   * CrossRef / biblio-glutton. Same semantics as {@link consolidateHeader};
   * defaults to `false`. Maps onto `GrobidAnalysisConfig.consolidateCitations(level)`.
   */
  consolidateCitations?: boolean | "always" | 0 | 1 | 2 | 3;
  /**
   * After TEI emission, post-process the document by looking up the paper's
   * arXiv ID (and falling back to DOI / CrossRef) and replacing the CRF-extracted
   * title / authors / abstract with the canonical metadata when meaningfully
   * different. Defaults to `true` — for any preprint the API-canonical fields
   * strictly improve quality. The lookup is best-effort: network errors fall
   * through to the CRF output. Results are cached on disk under
   * `<XDG_CACHE_HOME or ~/.cache>/grobid-js/metadata/`.
   *
   * Set to `false` to suppress the lookup entirely (for tests, offline runs,
   * or privacy-sensitive deployments).
   */
  fallbackMetadata?: boolean;
  /**
   * Run the page-1 cleanup pre-processor that detects archive cover sheets
   * (Leeds Beckett, Edinburgh Research Explorer, Radboud Repository, NRC
   * Publications Archive, Research Square, eScholarship, CentAUR, …) and
   * preprint banners (IEEE / ACM / Wiley / Springer pre-print disclaimers,
   * arXiv vertical watermarks, ISSN+URL/DOI journal banners) on page 1 and
   * strips them before segmentation. JS-port-only — has no upstream
   * counterpart. Defaults to `true` because the heuristic is intentionally
   * conservative (2+ markers required) and corpus benchmarks show it strictly
   * improves header extraction on the ~12 papers with these cover artifacts.
   * Set to `false` to disable.
   */
  page1Cleanup?: boolean;
  /**
   * How to handle papers whose dominant body script is non-Latin (Cyrillic,
   * Greek, CJK, Arabic, Hebrew, Devanagari, Thai). GROBID's CRFs are
   * English-trained; on non-Latin documents the upstream pipeline produces
   * degraded headers (the first word of the abstract often gets labelled as
   * an author, e.g. "Вступ Використання" on a Ukrainian paper) and pollutes
   * the reference list. This knob picks the routing strategy:
   *
   *   - `"tag"` (default, alias `"auto"`): keep CRF output as-is, but emit a
   *     `<note type="language" script="cyrillic">` (or similar) in the
   *     TEI header so consumers can flag it. Latin-script papers are
   *     untouched — byte-identical output to the previous build.
   *
   *   - `"skip-header"`: drop the CRF-extracted header on non-Latin papers.
   *     The teiHeader keeps only an empty `<fileDesc>` + the script note;
   *     `<text>` (body / references) is emitted as usual. Useful for
   *     pipelines that consolidate metadata downstream via DOI / arXiv
   *     lookup and don't want noisy author guesses muddying the output.
   *
   *   - `"fallback-vlm"`: invoke the registered `NonLatinVlmExtractor` (see
   *     `setNonLatinVlmExtractor`) to recover the title / authors / abstract
   *     from page 1. The default extractor throws — consumers MUST register
   *     a real implementation (e.g. one that calls Claude or Gemini Vision)
   *     before selecting this option. On extractor error, the CRF output is
   *     kept (with a `<note type="language">` flagging the script).
   *
   * Latin-script papers (`detectScript` ⇒ `"latin"`) are never routed
   * through any of these paths regardless of the setting: output stays
   * byte-identical to before, so we don't regress on the 95%+ majority.
   */
  nonLatinHandling?: "auto" | "tag" | "skip-header" | "fallback-vlm";
  /**
   * Opt-in BidLSTM_CRF_FEATURES (DL) engine for one or more models. Keys
   * are upstream GROBID model names (e.g. `"header"`, `"citation"`,
   * `"reference-segmenter"`). Models not listed continue to use Wapiti.
   *
   * To enable header DL inference, for example:
   * ```ts
   * new Grobid({
   *   bidlstmModels: {
   *     header: {
   *       modelDir: "fixtures/models/dl/header-BidLSTM_CRF_FEATURES",
   *       glove: new GloveFileProvider(vocabPath, vectorsPath),
   *     },
   *   },
   * });
   * ```
   *
   * Requires `onnxruntime-node` (an optional peer dep) and the artifacts
   * produced by `scripts/convert-bidlstm-crf-features.py` +
   * `scripts/extract-glove-vocab.py` in `modelDir`.
   */
  bidlstmModels?: Record<string, BidLSTMModelOption>;
}

/**
 * Default list of TEI elements that receive `coords="page,x,y,w,h"`
 * attributes in the emitted TEI. Mirrors the element list upstream GROBID's
 * reference build wires through `GrobidAnalysisConfig.generateTeiCoordinates`
 * — without it, every `<head>`, `<p>`, `<ref>`, `<figure>` etc. emits without
 * coordinates because `TEIFormatter.isGenerateTeiCoordinates(name)` defaults
 * to false on a fresh `GrobidAnalysisConfig`.
 */
export const DEFAULT_TEI_COORDINATE_ELEMENTS: readonly string[] = Object.freeze([
  "persName",
  "figure",
  "ref",
  "biblStruct",
  "formula",
  "head",
  "note",
  "title",
  "s",
  "p",
]);

/**
 * The full set of Wapiti CRF models GROBID's Engine pipeline can touch. We
 * emit a YAML entry for every one of them so that `GrobidProperties.getGrobidEngine(model)`
 * returns `WAPITI` for any parser the integration may instantiate.
 *
 * Folder names match `GrobidModels.<X>.getFolderName()`. The Engine.initAll
 * call constructs a parser per row here; missing model files surface as
 * per-parser warnings (the `EngineParsers.tryInit` wrapper swallows the throw
 * and logs the failure), not a hard error — same as upstream.
 */
const YAML_MODEL_FOLDERS: readonly string[] = [
  "affiliation-address",
  "segmentation",
  "segmentation/article/light",
  "segmentation/article/light-ref",
  "segmentation/sdo/ietf",
  "segmentation/sdo/3gpp",
  "citation",
  "reference-segmenter",
  "date",
  "monograph",
  "fulltext",
  "shorttext",
  "figure",
  "table",
  "header",
  "header/article/light",
  "header/article/light-ref",
  "header/sdo/3gpp",
  "header/sdo/ietf",
  "name/citation",
  "name/header",
  "patent/patent",
  "patent/npl",
  "patent/citation",
  "patent/structure",
  "patent/edit",
  "funding-acknowledgement",
];

/**
 * Lazy-initialised public processor. Holds a singleton-style cache around
 * `Engine` and the GROBID_HOME scaffold so subsequent `processPdf` calls
 * skip the (slow) one-time model load.
 */
export class Grobid {
  private readonly options: GrobidOptions;
  private enginePromise: Promise<Engine> | null = null;

  constructor(options: GrobidOptions = {}) {
    this.options = options;
  }

  /**
   * Run `Engine.fullTextToTEIDoc` against a PDF on disk and return the resulting
   * TEI-XML string. The first call lazily resolves models, lexicon, and
   * pdfalto, scaffolds a GROBID_HOME under tmpdir, then constructs `Engine(true)`.
   * Subsequent calls reuse the same Engine instance.
   *
   * Post-processing:
   *   1. Non-Latin handling: if the document's dominant script is non-Latin
   *      (Cyrillic, Greek, CJK, Arabic, Hebrew, Devanagari, Thai), apply the
   *      strategy selected by `nonLatinHandling` (tag / skip-header /
   *      fallback-vlm). Latin-script papers skip this entirely.
   *   2. arXiv / DOI fallback metadata: best-effort canonical lookup that
   *      overrides the CRF title / authors / abstract when meaningfully
   *      different (gated by `fallbackMetadata`).
   */
  async processPdf(pdfPath: string): Promise<string> {
    const engine = await this.getEngine();
    const config = this.buildAnalysisConfig();
    // Use the Document-returning entry point so we can inspect the dominant
    // script after segmentation/header parsing. The string TEI is then read
    // from `doc.getTei()` exactly as the void overload would have produced.
    const doc: Document = await engine.fullTextToTEIDoc(pdfPath, null, null, config);
    let tei = doc.getTei() ?? "";
    // Apply non-Latin routing. Defaults to "tag" (alias "auto"): just inject
    // a <note type="language" script="..."> when the script is non-Latin,
    // leaving Latin papers byte-identical.
    tei = await this.applyNonLatinHandling(tei, doc, pdfPath);
    if (this.options.fallbackMetadata === false) return tei;
    // Default-on: the cost is one HTTP request to arxiv/doi.org for a
    // typical preprint and produces strictly canonical metadata. Failures
    // fall through silently to the CRF output.
    return applyFallbackMetadata(tei);
  }

  /**
   * Resolve the dominant script for `doc` (falling back to a fresh sample of
   * body tokens if header processing never set it) and dispatch to the
   * configured non-Latin strategy. Returns the (possibly rewritten) TEI.
   *
   * The handler is a pure post-process over the TEI string. Latin-script
   * documents return early with the input string untouched, so the legacy
   * regression suite continues to pass byte-identically.
   */
  private async applyNonLatinHandling(tei: string, doc: Document, pdfPath: string): Promise<string> {
    const mode = this.options.nonLatinHandling ?? "auto";
    // `auto` is just an alias for `tag` — the only routing we can do safely
    // without explicit consumer opt-in (skip-header drops data; fallback-vlm
    // needs a registered extractor). Picking aliasing over a separate mode
    // keeps the matrix small and avoids the "what does auto mean here?" trap.
    const effective = mode === "auto" ? "tag" : mode;
    const script = this.resolveDominantScript(doc);
    if (!NON_LATIN_SCRIPTS.has(script)) return tei; // Latin: bypass entirely.
    if (effective === "tag") {
      return injectLanguageNote(tei, script, null);
    }
    if (effective === "skip-header") {
      // Strip the CRF-derived <fileDesc> body (titleStmt + sourceDesc) and
      // replace it with a stub carrying just the script note. Body / back
      // (references, body text) are left intact — they tend to be readable
      // even on Cyrillic/CJK papers because they're literal-character output.
      return stripHeaderKeepStructure(tei, script);
    }
    if (effective === "fallback-vlm") {
      // Try the registered VLM extractor; on any failure, fall back to "tag".
      try {
        const extractor = getNonLatinVlmExtractor();
        const result = await extractor.extractHeader({
          pdfPath,
          script,
          langHint: hintLanguageForScript(script),
        });
        return injectLanguageNote(applyVlmHeaderOverride(tei, result), script, "vlm");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        LOGGER.warn(`Non-Latin VLM fallback failed (${script}, ${pdfPath}): ${msg}`);
        return injectLanguageNote(tei, script, null);
      }
    }
    return tei;
  }

  /**
   * Return the document's dominant script. Prefers the value set by
   * `HeaderParser` during language identification; falls back to a fresh
   * sample of the document's full tokenization stream when the header path
   * didn't run (empty header, scan-only PDFs, etc.). Always returns a value
   * — "latin" is the safe default that bypasses every non-Latin handler.
   */
  private resolveDominantScript(doc: Document): Script {
    const recorded = doc.getDominantScript();
    if (recorded !== null) return recorded as Script;
    // Fallback: sample the first ~200 chars of the tokenization stream. We
    // deliberately do NOT mutate `doc.dominantScript` here — this is a
    // post-process derived signal, not a property of the Document model.
    const tokens = doc.getTokenizations();
    return detectScriptFromTokens(tokens);
  }

  /** Lazily initialise the singleton Engine. Idempotent across concurrent callers. */
  private getEngine(): Promise<Engine> {
    if (this.enginePromise === null) {
      this.enginePromise = this.initEngine();
    }
    return this.enginePromise;
  }

  private async initEngine(): Promise<Engine> {
    // Register the JS-side default language + sentence detectors before any
    // parser is constructed (Segmentation's instance-member initializer
    // calls LanguageUtilities.getInstance(), which reads the FQCN from
    // GrobidProperties). Idempotent.
    const detectors = registerDefaultDetectors();
    void detectors;
    // Apply the page-1 cleanup toggle before the Engine boots. The default is
    // enabled (the heuristic is conservative and strictly improves the corpus
    // benchmark on papers with archive cover sheets / preprint banners).
    setPage1CleanupEnabled(this.options.page1Cleanup !== false);
    // Register any BidLSTM-backed models with the tagger registry BEFORE the
    // engine boots, so that AbstractParser → TaggerFactory.getTagger(model)
    // can construct a `BidLSTMCRFFeaturesTagger` for them via lookup. We also
    // pass the list down to `scaffoldGrobidHome` so the generated grobid.yaml
    // marks those models with `engine: bidlstm-crf-features` instead of wapiti.
    const bidlstmModels = this.options.bidlstmModels ?? {};
    for (const [modelName, opt] of Object.entries(bidlstmModels)) {
      registerBidLSTMModel(modelName, opt.modelDir, { glove: opt.glove });
    }
    const assetOptions: ResolveOptions = {
      ...(this.options.assetOptions ?? {}),
      ...(this.options.onAssetProgress ? { onProgress: this.options.onAssetProgress } : {}),
    };
    // Resolve the three asset locations in parallel — each is a network +
    // disk-bound operation and they're independent.
    const [modelsDir, lexiconDir, pdfaltoBin] = await Promise.all([
      this.options.modelsDir
        ? Promise.resolve(this.options.modelsDir)
        : resolveModelsDir(assetOptions),
      this.options.lexiconDir === null
        ? Promise.resolve<string | null>(null)
        : this.options.lexiconDir
          ? Promise.resolve<string | null>(this.options.lexiconDir)
          : resolveLexiconDir(assetOptions).then((p) => p),
      resolvePdfaltoBinary(this.options.pdfaltoOptions ?? {}),
    ]);

    const grobidHome = scaffoldGrobidHome({
      root: this.options.grobidHomeDir,
      modelsDir,
      lexiconDir,
      pdfaltoBin,
      bidlstmModelNames: new Set<string>(Object.keys(bidlstmModels)),
    });

    // Reset any previous singleton state so the Engine boots with our scaffold.
    // `GROBID_CONFIG_PATH` is a separate static cache that loadGrobidConfigPath
    // populates lazily; clear it too so `reset()` re-resolves the YAML under
    // the freshly-set home. (Important for test/parallel scenarios where
    // multiple Grobid instances might be constructed against different
    // scaffolds.)
    GrobidProperties.setGrobidHome(grobidHome);
    GrobidProperties.GROBID_CONFIG_PATH = null;
    GrobidProperties.reset();
    // The TaggerFactory cache is module-level static and would otherwise
    // sticky-hold the Wapiti tagger for header even when a subsequent
    // Grobid instance opts the header model into the BiLSTM engine.
    TaggerFactory.reset();
    // Warm up the lexicon so its dictionaries/gazetteers load before the
    // header/citation parsers fire feature columns that depend on them.
    Lexicon.getInstance();
    LOGGER.info(`Grobid initialised with GROBID_HOME=${grobidHome}`);
    return new Engine(true);
  }

  /** Build the analysis config from the user's optional hook (or use defaults). */
  private buildAnalysisConfig(): GrobidAnalysisConfig {
    const builder = GrobidAnalysisConfig.builder();
    // Apply the coordinate-element defaults BEFORE the user hook so that a
    // caller using `.generateTeiCoordinates([...])` inside `configureAnalysis`
    // can still override our default. `generateTeiCoordinates: undefined`
    // means "use defaults"; an explicit `null` (or empty array) disables.
    const coordsOpt = this.options.generateTeiCoordinates;
    const coordsList: string[] | null =
      coordsOpt === undefined
        ? [...DEFAULT_TEI_COORDINATE_ELEMENTS]
        : coordsOpt === null
          ? null
          : [...coordsOpt];
    builder.generateTeiCoordinates(coordsList);
    // Mirror upstream's reference build, which invokes the HTTP API with
    // `includeRawAffiliations=1`. The flag only causes TEIFormatter to emit
    // the `<note type="raw_affiliation">` carry-through when the underlying
    // `Affiliation` has a captured raw string — otherwise it's a no-op.
    const rawAff = this.options.includeRawAffiliations;
    builder.includeRawAffiliations(rawAff === undefined ? true : rawAff);
    // Map the SDK-level boolean/string options onto upstream's integer level.
    // `false`/`undefined` → 0 (off, matches upstream default).
    // `true` / `1`        → 1 (consolidate-and-correct).
    // `2`                 → 2 (consolidate-and-inject-DOI-only).
    // `"always"` / `3`    → 3 (like 1 but also inject when DOI absent).
    builder.consolidateHeader(consolidateLevel(this.options.consolidateHeader));
    builder.consolidateCitations(consolidateLevel(this.options.consolidateCitations));
    const configured = this.options.configureAnalysis
      ? this.options.configureAnalysis(builder)
      : builder;
    return configured.build();
  }
}

/* ────────────────────────── GROBID_HOME scaffold ──────────────────────────── */

interface ScaffoldArgs {
  root: string | undefined;
  modelsDir: string;
  lexiconDir: string | null;
  pdfaltoBin: string;
  /** Set of model names that should be marked with the bidlstm-crf-features engine in grobid.yaml. */
  bidlstmModelNames?: ReadonlySet<string>;
}

/**
 * Create (or refresh) a GROBID_HOME-shaped directory tree at `args.root`
 * (default: a fresh `os.tmpdir()/grobid-js-home-*` directory). Populates:
 *   config/grobid.yaml      — minimal config listing every Wapiti model
 *   models                  — symlink to the resolved models directory
 *   lexicon                 — symlink to the resolved lexicon directory (if any)
 *   pdfalto/<os-arch>/pdfalto — symlink to the resolved pdfalto binary
 *
 * Returns the absolute scaffold path. Idempotent: re-running with the same
 * `root` does not throw on pre-existing symlinks (they're recreated to point
 * at the current asset locations).
 */
function scaffoldGrobidHome(args: ScaffoldArgs): string {
  const root = args.root
    ? path.resolve(args.root)
    : path.join(os.tmpdir(), `grobid-js-home-${process.pid}-${Date.now()}`);
  mkdirSync(root, { recursive: true });
  mkdirSync(path.join(root, "config"), { recursive: true });
  // The YAML's `temp: "./tmp"` resolves to `<root>/tmp`; pdfalto writes its
  // .lxml / annotation / outline outputs there.
  mkdirSync(path.join(root, "tmp"), { recursive: true });

  // pdfalto lives under `<home>/pdfalto/<getOsNameAndArch()>/pdfalto`. The
  // binary download lands at a different relative path (see pdfalto-binary.ts),
  // so we use a symlink to expose it at the canonical location upstream's
  // `DocumentSource.getPdfaltoCommand()` expects.
  const pdfaltoSubdir = Utilities.getOsNameAndArch();
  const pdfaltoTargetDir = path.join(root, "pdfalto", pdfaltoSubdir);
  mkdirSync(pdfaltoTargetDir, { recursive: true });
  const pdfaltoLink = path.join(pdfaltoTargetDir, "pdfalto");
  forceSymlink(args.pdfaltoBin, pdfaltoLink);

  // The asset-distribution layout for models is already
  // `<modelsDir>/<folderName>/model.wapiti`, matching upstream's
  // `<grobid-home>/models/<folderName>/model.wapiti`. Symlink the parent.
  const modelsLink = path.join(root, "models");
  forceSymlink(args.modelsDir, modelsLink);

  // Same for the lexicon root: the asset cache layout matches upstream's
  // `<grobid-home>/lexicon/<category>/...`.
  if (args.lexiconDir !== null) {
    const lexLink = path.join(root, "lexicon");
    forceSymlink(args.lexiconDir, lexLink);
  }

  // Write the YAML last — once it exists, GrobidProperties.getInstance() will
  // start picking it up. The default detectors FQCNs are registered via
  // `registerDefaultDetectors()` in `Grobid.initEngine()`.
  const detectors = registerDefaultDetectors();
  const yamlPath = path.join(root, "config", "grobid.yaml");
  writeFileSync(
    yamlPath,
    buildGrobidYaml({
      pdfaltoSubpath: "pdfalto",
      languageDetectorFqcn: detectors.languageFqcn,
      sentenceDetectorFqcn: detectors.sentenceFqcn,
      bidlstmModelNames: args.bidlstmModelNames ?? new Set<string>(),
    }),
    "utf-8",
  );
  return root;
}

/**
 * Replace any existing symlink (or empty directory) at `linkPath` with a
 * fresh symlink pointing at `target`. We deliberately use absolute targets
 * — relative symlinks would break when the scaffold root is later moved.
 *
 * On Windows, junctions are used implicitly by `fs.symlinkSync` when the
 * target is a directory (Node maps that case to a `'junction'` link type).
 */
function forceSymlink(target: string, linkPath: string): void {
  // Best-effort cleanup; non-existence is fine.
  try {
    if (existsSync(linkPath)) {
      // `rmSync(..., recursive: false)` handles both regular files and
      // symlinks. We do NOT recursively remove directories — that would
      // risk wiping a real models dir if the caller chose a non-tmp
      // `grobidHomeDir` location and pre-seeded it.
      rmSync(linkPath, { recursive: false, force: true });
    }
  } catch {
    // Fall through to symlink creation; any real error will resurface there.
  }
  // Use 'junction' on Windows for directory targets (safer than the default).
  const type = process.platform === "win32" ? "junction" : undefined;
  try {
    if (type) symlinkSync(target, linkPath, type);
    else symlinkSync(target, linkPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`failed to create symlink ${linkPath} -> ${target}: ${msg}`);
  }
}

/* ────────────────────── Non-Latin TEI post-processors ──────────────────────── */

/**
 * Inject (or top-up) a `<note type="language" script="..."[ source="..."]>`
 * inside the teiHeader, immediately before the closing `</teiHeader>` tag.
 * Idempotent in the common case: if a previous call already placed the same
 * note we don't duplicate it.
 *
 * The note is intentionally inserted at the end of `<teiHeader>` so we don't
 * collide with the structured `<fileDesc>` / `<encodingDesc>` / `<profileDesc>`
 * subtrees. It's also outside any element-specific @type="..." namespace
 * upstream uses for biblio notes — picking `type="language"` is a JS-port
 * convention with no upstream collision.
 */
function injectLanguageNote(tei: string, script: Script, source: string | null): string {
  // Already present? Don't duplicate.
  const marker = `<note type="language" script="${script}"`;
  if (tei.includes(marker)) return tei;
  const langHint = hintLanguageForScript(script);
  const attrs: string[] = [`type="language"`, `script="${script}"`];
  if (langHint !== null) attrs.push(`xml:lang="${langHint}"`);
  if (source !== null) attrs.push(`source="${source}"`);
  const note = `\t\t<note ${attrs.join(" ")}>Document detected as non-Latin (${script}); CRFs are English-trained and may produce degraded header extraction.</note>\n\t`;
  const close = "</teiHeader>";
  const idx = tei.indexOf(close);
  if (idx < 0) return tei; // no teiHeader → no-op
  return tei.slice(0, idx) + note + tei.slice(idx);
}

/**
 * Replace the CRF-extracted `<fileDesc>` body with a stub on `skip-header`
 * mode. We keep the `<encodingDesc>` and `<profileDesc>` (they're populated
 * with safe metadata: app info, optional abstract / keywords) — only the
 * `<titleStmt>` + `<publicationStmt>` + `<sourceDesc>` triplet inside
 * `<fileDesc>` gets dropped because that's where the CRF dumps unreliable
 * author / title guesses for non-Latin papers.
 *
 * Then we inject the language note via `injectLanguageNote`. The final TEI
 * is well-formed XML (a `<fileDesc>` with empty `<titleStmt><title/>` is
 * legal per the TEI schema).
 */
function stripHeaderKeepStructure(tei: string, script: Script): string {
  // Match the contents inside <fileDesc> ... </fileDesc> non-greedily.
  const replaced = tei.replace(
    /<fileDesc>[\s\S]*?<\/fileDesc>/,
    `<fileDesc>\n\t\t\t<titleStmt>\n\t\t\t\t<title level="a" type="main"/>\n\t\t\t</titleStmt>\n\t\t\t<publicationStmt>\n\t\t\t\t<publisher/>\n\t\t\t\t<availability status="unknown"><licence/></availability>\n\t\t\t</publicationStmt>\n\t\t\t<sourceDesc>\n\t\t\t\t<biblStruct status="extracted">\n\t\t\t\t\t<analytic/>\n\t\t\t\t\t<monogr><imprint><date/></imprint></monogr>\n\t\t\t\t</biblStruct>\n\t\t\t</sourceDesc>\n\t\t</fileDesc>`,
  );
  return injectLanguageNote(replaced, script, "skip-header");
}

/**
 * Override the CRF-extracted title / authors / abstract with the structured
 * payload returned by the VLM extractor (fallback-vlm mode). We rewrite the
 * `<title type="main">…</title>` inside `<titleStmt>` and the structured
 * author list inside `<sourceDesc>/<biblStruct>/<analytic>`, then update the
 * `<abstract>` block inside `<profileDesc>` when present.
 *
 * This is a surgical string-replace, not a full XML rewrite — the original
 * TEI is already well-formed and we only touch the three regions a VLM can
 * usefully recover on a non-Latin paper. Failure-mode: a non-matching regex
 * silently leaves the field as-is, so a partial extraction still improves
 * what it can.
 */
function applyVlmHeaderOverride(tei: string, ext: VlmHeaderExtraction): string {
  let out = tei;
  if (ext.title !== undefined && ext.title.trim().length > 0) {
    out = out.replace(
      /(<title level="a" type="main"[^>]*>)([^<]*)(<\/title>)/,
      (_m, open: string, _body: string, close: string) =>
        open + escapeXml(ext.title!) + close,
    );
  }
  if (ext.authors !== undefined && ext.authors.length > 0) {
    // Build a fresh <author> block list, scoped to inside <analytic>. We
    // replace EVERY <author>...</author> region with the VLM list. Affiliations
    // are emitted as plain <note type="raw_affiliation"> entries when present
    // — leaving the structured <orgName>/<address> parsing to consumers.
    const authorBlocks: string[] = ext.authors.map((a) => {
      const persParts: string[] = [];
      if (a.forename !== undefined && a.forename.length > 0) {
        persParts.push(`<forename type="first">${escapeXml(a.forename)}</forename>`);
      }
      if (a.surname !== undefined && a.surname.length > 0) {
        persParts.push(`<surname>${escapeXml(a.surname)}</surname>`);
      }
      const persName = persParts.length > 0 ? `<persName>${persParts.join("")}</persName>` : "";
      const email = a.email !== undefined && a.email.length > 0
        ? `<email>${escapeXml(a.email)}</email>`
        : "";
      const aff = a.affiliation !== undefined && a.affiliation.length > 0
        ? `<affiliation><note type="raw_affiliation">${escapeXml(a.affiliation)}</note></affiliation>`
        : "";
      return `\t\t\t\t\t\t<author>${persName}${email}${aff}</author>`;
    });
    // First strip all existing <author>...</author> blocks inside <analytic>...</analytic>
    out = out.replace(/<analytic>[\s\S]*?<\/analytic>/, (analytic) => {
      const noAuthors = analytic.replace(/<author[\s\S]*?<\/author>\s*/g, "");
      // Insert the new author blocks right after <analytic>
      return noAuthors.replace(
        /<analytic>/,
        `<analytic>\n${authorBlocks.join("\n")}\n`,
      );
    });
  }
  if (ext.abstract !== undefined && ext.abstract.trim().length > 0) {
    out = out.replace(
      /<abstract>[\s\S]*?<\/abstract>/,
      `<abstract>\n<div xmlns="http://www.tei-c.org/ns/1.0"><p>${escapeXml(ext.abstract)}</p></div>\n\t\t\t</abstract>`,
    );
  }
  return out;
}

/** Minimal XML escape for the VLM override path. */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Build the minimal grobid.yaml the YAML reader in GrobidProperties expects. */
function buildGrobidYaml(args: {
  pdfaltoSubpath: string;
  languageDetectorFqcn: string;
  sentenceDetectorFqcn: string;
  bidlstmModelNames: ReadonlySet<string>;
}): string {
  // The `models:` entries make GrobidProperties.getGrobidEngine(model) return
  // a concrete engine for any model the parsers may construct; without them,
  // TaggerFactory raises "Unsupported or null Grobid sequence labelling
  // engine: null" on the first parser construction.
  //
  // Models in `bidlstmModelNames` are routed to the BiLSTM ONNX tagger;
  // everything else defaults to Wapiti.
  const modelEntries = YAML_MODEL_FOLDERS.map((folder) => {
    const name = folder.replace(/\//g, "-");
    // YAML engine name must match the case-insensitive `_name` field on
    // GrobidCRFEngine.values() — note underscores, not dashes.
    const engine = args.bidlstmModelNames.has(name) ? "bidlstm_crf_features" : "wapiti";
    return `    - name: ${name}\n      engine: ${engine}\n`;
  }).join("");
  return [
    "grobid:",
    `  grobidHome: "."`,
    `  temp: "./tmp"`,
    `  nativelibrary: "./lib"`,
    `  languageDetectorFactory: "${args.languageDetectorFqcn}"`,
    `  sentenceDetectorFactory: "${args.sentenceDetectorFqcn}"`,
    `  concurrency: 10`,
    `  poolMaxWait: 1`,
    `  pdf:`,
    `    blocksMax: 100000`,
    `    tokensMax: 1000000`,
    `    pdfalto:`,
    `      path: "${args.pdfaltoSubpath}"`,
    `      memoryLimitMb: 6096`,
    `      timeoutSec: 60`,
    `  consolidation:`,
    `    service: "crossref"`,
    `    crossref:`,
    `      mailto: ""`,
    `      token: ""`,
    `      timeoutSec: 60`,
    `      minRequestIntervalMs: -1`,
    `      postValidation: true`,
    `    glutton:`,
    `      url: ""`,
    `      timeoutSec: 60`,
    `  wapiti:`,
    `    nbThreads: 0`,
    `  models:`,
    modelEntries.trimEnd(),
    "",
  ].join("\n");
}
