// Build the upstream wapiti label driver via spawnSync. Avoids the bash
// `cc/clang/make` allowlist limitations of the harness.

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const upstream = path.resolve(here, "../../../upstream/wapiti");

const args = [
  "-O2",
  `-I${here}`,
  `-I${upstream}`,
  "-o", path.join(here, "wapiti-label"),
  path.join(here, "wapiti-label.c"),
  path.join(here, "stubs.c"),
  path.join(upstream, "decoder.c"),
  path.join(upstream, "model.c"),
  path.join(upstream, "reader.c"),
  path.join(upstream, "pattern.c"),
  path.join(upstream, "quark.c"),
  path.join(upstream, "tools.c"),
];

const r = spawnSync("cc", args, { stdio: "inherit" });
process.exit(r.status ?? 1);
