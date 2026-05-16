#!/usr/bin/env node
// CLI: pre-fetch every required and optional asset into the cache.
//
// Useful for CI, Docker image builds, and Electron resource bundling. Each
// asset is downloaded into `~/.cache/grobid-js/` (or `--cache-dir`) and
// verified against the pinned SHA-256.

import { resolveLexiconDir, resolveModelsDir, type DownloadProgress } from "../asset-distribution.js";

interface CliOptions {
  cacheDir?: string;
  skipOptional?: boolean;
  skipLexicon?: boolean;
  skipModels?: boolean;
  /** Tier 3 lexicons are on by default. Set to false via --skip-extended-lexicons. */
  includeExtendedLexicons?: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const out: CliOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--cache-dir") {
      const next = argv[++i];
      if (next) out.cacheDir = next;
    } else if (a === "--skip-optional") out.skipOptional = true;
    else if (a === "--skip-lexicon") out.skipLexicon = true;
    else if (a === "--skip-models") out.skipModels = true;
    else if (a === "--include-extended-lexicons") out.includeExtendedLexicons = true;
    else if (a === "--skip-extended-lexicons") out.includeExtendedLexicons = false;
    else if (a === "--help" || a === "-h") {
      process.stdout.write(`grobid-js download-models
Pre-fetches every Wapiti model and lexicon asset into the cache directory.

Options:
  --cache-dir <path>     Override cache root (default: ~/.cache/grobid-js).
  --skip-optional        Don't download optional models (saves ~6 MB).
  --skip-lexicon         Don't download the lexicon (saves ~5 MB).
  --skip-models          Don't download models (only the lexicon).
  --skip-extended-lexicons
                         Skip Tier 3 lexicons (default: fetched, ~50 MB).
                         Tier 3 includes WikiLocations, location.txt,
                         people.person, and German wordforms.
  --include-extended-lexicons
                         Force-on Tier 3 (already the default; provided
                         for explicit CLI use in scripts).
  --help                 Show this help text.
`);
      process.exit(0);
    }
  }
  return out;
}

function formatBytes(n: number): string {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / (1024 * 1024)).toFixed(1) + " MB";
}

function renderProgressLine(p: DownloadProgress): void {
  const pct = p.totalBytes > 0 ? Math.floor((p.bytesDownloaded / p.totalBytes) * 100) : 0;
  process.stdout.write(`\r  ${p.asset.padEnd(28)} ${formatBytes(p.bytesDownloaded)} / ${formatBytes(p.totalBytes)} (${pct}%)`);
  if (p.bytesDownloaded >= p.totalBytes) process.stdout.write("\n");
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const resolveOpts = {
    ...(opts.cacheDir ? { cacheDir: opts.cacheDir } : {}),
    includeOptionalModels: !opts.skipOptional,
    // Tier 3 is on by default; respect an explicit --skip-extended-lexicons.
    includeExtendedLexicons: opts.includeExtendedLexicons !== false,
    onProgress: renderProgressLine,
  };
  if (!opts.skipModels) {
    process.stdout.write("Resolving CRF models...\n");
    const dir = await resolveModelsDir(resolveOpts);
    process.stdout.write(`Models ready at ${dir}\n`);
  }
  if (!opts.skipLexicon) {
    process.stdout.write("\nResolving lexicon...\n");
    const dir = await resolveLexiconDir(resolveOpts);
    process.stdout.write(`Lexicon ready at ${dir}\n`);
  }
}

main().catch((err) => {
  process.stderr.write(`grobid-js download-models failed: ${(err as Error).message}\n`);
  process.exit(1);
});
