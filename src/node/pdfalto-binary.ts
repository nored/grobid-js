// Platform-aware resolver for the pdfalto binary.
//
// We need pdfalto on disk to spawn it. Three resolution paths, in order:
//   1. `options.binaryPath` — an explicit path the caller provided.
//   2. `GROBID_PDFALTO_BIN` / `PDFALTO_BIN` env vars — a shipped binary,
//      typically baked into an Electron app's resource bundle.
//   3. Cached download — fetch the matching kermitt2/pdfalto release asset
//      into `~/.cache/grobid-js/pdfalto-<platform>-<arch>/v<version>/pdfalto`
//      and reuse it on subsequent runs.
//
// We auto-detect platform and architecture from process.platform / process.arch
// and map them to the asset names in pdfalto's GitHub Releases:
//
//     darwin × arm64 → pdfalto-bin-mac-arm64.zip
//     darwin × x64   → pdfalto-bin-mac-64.zip
//     linux  × x64   → pdfalto-bin-linux-64.zip
//     linux  × arm64 → pdfalto-bin-linux-arm64.zip
//
// Windows binaries are not published by upstream as of v0.6.0; on win32 the
// caller must provide a binary explicitly via env var or options.binaryPath
// (e.g. by pointing at the pdfalto.exe shipped inside grobid-home/pdf2xml/).

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { chmodSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface PdfaltoBinaryOptions {
  /** Explicit absolute path. Overrides every other resolution method. */
  binaryPath?: string;
  /** Override the kermitt2/pdfalto release version to download. Default: v0.6.0. */
  version?: string;
  /** Override the cache root directory. Default: ~/.cache/grobid-js/. */
  cacheDir?: string;
  /**
   * If true, do not attempt to download; only check the local sources.
   * Default: false. Set to true in CI or air-gapped environments.
   */
  offline?: boolean;
}

const DEFAULT_VERSION = "v0.6.0";

type Platform = "darwin" | "linux";
type Arch = "x64" | "arm64";

interface AssetSpec {
  zipName: string;
  /** Path of the executable INSIDE the unpacked zip. */
  innerPath: string[];
}

const ASSETS: Record<Platform, Record<Arch, AssetSpec>> = {
  darwin: {
    arm64: { zipName: "pdfalto-bin-mac-arm64.zip", innerPath: ["pdfalto", "mac", "arm64", "pdfalto"] },
    x64: { zipName: "pdfalto-bin-mac-64.zip", innerPath: ["pdfalto", "mac", "x86_64", "pdfalto"] },
  },
  linux: {
    arm64: { zipName: "pdfalto-bin-linux-arm64.zip", innerPath: ["pdfalto", "lin", "arm64", "pdfalto"] },
    x64: { zipName: "pdfalto-bin-linux-64.zip", innerPath: ["pdfalto", "lin", "x86_64", "pdfalto"] },
  },
};

/** Resolve a usable pdfalto binary path, downloading on first use if needed. */
export async function resolvePdfaltoBinary(opts: PdfaltoBinaryOptions = {}): Promise<string> {
  // 1. Explicit option.
  if (opts.binaryPath) {
    await assertExecutable(opts.binaryPath);
    return opts.binaryPath;
  }
  // 2. Environment override.
  const envPath = process.env["GROBID_PDFALTO_BIN"] ?? process.env["PDFALTO_BIN"];
  if (envPath && envPath.length > 0) {
    await assertExecutable(envPath);
    return envPath;
  }
  // 3. Cached download.
  const platform = process.platform;
  const arch = process.arch;
  if (platform !== "darwin" && platform !== "linux") {
    throw new Error(
      `Unsupported platform "${platform}" for automatic pdfalto download. ` +
        `Set GROBID_PDFALTO_BIN to a pdfalto executable.`,
    );
  }
  if (arch !== "x64" && arch !== "arm64") {
    throw new Error(
      `Unsupported architecture "${arch}" for automatic pdfalto download. ` +
        `Set GROBID_PDFALTO_BIN to a pdfalto executable.`,
    );
  }
  const version = opts.version ?? DEFAULT_VERSION;
  const cacheDir = opts.cacheDir ?? path.join(os.homedir(), ".cache", "grobid-js");
  const targetDir = path.join(cacheDir, `pdfalto-${platform}-${arch}`, version);
  const spec = ASSETS[platform][arch];
  const targetPath = path.join(targetDir, ...spec.innerPath);
  try {
    await stat(targetPath);
    return targetPath;
  } catch {
    // Need to download.
  }
  if (opts.offline) {
    throw new Error(
      `pdfalto not found at ${targetPath} and offline=true. ` +
        `Download ${spec.zipName} manually from kermitt2/pdfalto releases.`,
    );
  }
  await downloadAndExtract({ targetDir, spec, version });
  await assertExecutable(targetPath);
  return targetPath;
}

async function assertExecutable(p: string): Promise<void> {
  const s = await stat(p);
  if (!s.isFile()) throw new Error(`pdfalto path is not a file: ${p}`);
  // POSIX chmod is idempotent and cheap; skip on Windows.
  if (process.platform !== "win32") chmodSync(p, 0o755);
}

interface DownloadCtx {
  targetDir: string;
  spec: AssetSpec;
  version: string;
}

async function downloadAndExtract(ctx: DownloadCtx): Promise<void> {
  await mkdir(ctx.targetDir, { recursive: true });
  const url = `https://github.com/kermitt2/pdfalto/releases/download/${ctx.version}/${ctx.spec.zipName}`;
  const zipPath = path.join(ctx.targetDir, ctx.spec.zipName);
  const zipPathTmp = zipPath + ".tmp";
  // eslint-disable-next-line no-console
  console.log(`[grobid-js] Downloading pdfalto ${ctx.version} (${ctx.spec.zipName})...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`pdfalto download failed: ${res.status} ${res.statusText} (${url})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  await writeFile(zipPathTmp, bytes);
  await rename(zipPathTmp, zipPath);
  // Verify the download is a non-empty zip (PK header) before unzip.
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error(`downloaded asset is not a zip file: ${url}`);
  }
  await unzip(zipPath, ctx.targetDir);
}

/**
 * Minimal zip extractor for our specific use case (single executable file
 * inside a known directory structure). We use Node's built-in `unzip`
 * shell command if available, falling back to a JS extractor of stored
 * entries (pdfalto's zips are deflate-compressed, so we delegate to the
 * `node:zlib` inflateRaw helper).
 */
async function unzip(zipPath: string, destDir: string): Promise<void> {
  const data = await readFile(zipPath);
  await extractZipInflateRaw(data, destDir);
}

// ─────────────────────────── ZIP extractor ───────────────────────────────────
// Minimal central-directory reader good enough for the pdfalto release zips
// (Store + Deflate compression). Handles directories, regular files, and
// keeps Unix mode bits from external attributes.

async function extractZipInflateRaw(buf: Buffer, destDir: string): Promise<void> {
  const { inflateRawSync } = await import("node:zlib");
  // Find End of Central Directory record. Search backwards from end (max 64K trail).
  const eocdSig = 0x06054b50;
  let eocdOff = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === eocdSig) {
      eocdOff = i;
      break;
    }
  }
  if (eocdOff < 0) throw new Error("not a zip file: missing EOCD record");
  const totalEntries = buf.readUInt16LE(eocdOff + 10);
  const cdSize = buf.readUInt32LE(eocdOff + 12);
  const cdOffset = buf.readUInt32LE(eocdOff + 16);
  // Walk central directory.
  let p = cdOffset;
  const cdEnd = cdOffset + cdSize;
  for (let i = 0; i < totalEntries && p < cdEnd; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("bad central directory entry");
    const compMethod = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const externalAttr = buf.readUInt32LE(p + 38);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString("utf8");
    p += 46 + nameLen + extraLen + commentLen;
    // Read local file header to find data start.
    if (buf.readUInt32LE(localOff) !== 0x04034b50) throw new Error(`bad local header at ${localOff}`);
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const compressed = buf.slice(dataStart, dataStart + compSize);
    const isDir = name.endsWith("/");
    const fullDest = path.join(destDir, name);
    if (isDir) {
      await mkdir(fullDest, { recursive: true });
      continue;
    }
    await mkdir(path.dirname(fullDest), { recursive: true });
    let content: Buffer;
    if (compMethod === 0) content = compressed;
    else if (compMethod === 8) content = inflateRawSync(compressed);
    else throw new Error(`unsupported zip compression method ${compMethod} for entry ${name}`);
    await writeFile(fullDest, content);
    // Set mode bits from upper 16 bits of external attributes (Unix attrs).
    const mode = (externalAttr >>> 16) & 0o7777;
    if (mode !== 0 && process.platform !== "win32") {
      try {
        chmodSync(fullDest, mode);
      } catch {
        // ignore
      }
    }
  }
}

/** Verify a file's SHA-256 against a known value (defensive option). */
export async function sha256(p: string): Promise<string> {
  const hash = createHash("sha256");
  hash.update(await readFile(p));
  return hash.digest("hex");
}
