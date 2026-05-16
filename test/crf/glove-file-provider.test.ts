// End-to-end test for the Glove vocab-restricted dump pipeline:
//   1. Build a tiny synthetic Glove file (3 tokens × 4-d vectors).
//   2. Build a tiny synthetic GROBID-style XML corpus referencing two of
//      those tokens (plus an OOV token to verify it's silently dropped).
//   3. Run `scripts/extract-glove-vocab.py` against them.
//   4. Load the result with GloveFileProvider and verify per-token lookups
//      return the expected vectors (or zeros for OOV).

import { describe, it, expect } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { GloveFileProvider } from "../../src/grobid/engines/tagging/glove-file-provider.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "../..");
const venvPython = path.join(projectRoot, ".venv/bin/python");
const haveVenv = existsSync(venvPython);
const skipIfNoVenv = haveVenv ? describe : describe.skip;

skipIfNoVenv("Glove extraction + GloveFileProvider", () => {
  it("extracts vocab-restricted dump and loads it round-trip", () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "glove-test-"));
    try {
      // 1. Synthetic Glove file: 3 known tokens × 4-d vectors. We use
      // dim=4 to keep the binary file tiny; the extraction script
      // accepts --dim-check.
      const gloveLines = [
        "alpha 1.0 0.0 0.0 0.0",
        "beta 0.0 1.0 0.0 0.0",
        "gamma 0.5 0.5 0.0 0.0",
        // A multi-word line (Glove 840B has these); our extractor skips
        // them when their column count doesn't match the established dim.
        "this is multi token x x x x",
      ];
      const glovePath = path.join(tmp, "mini-glove.txt");
      writeFileSync(glovePath, gloveLines.join("\n") + "\n", "utf8");

      // 2. Synthetic XML corpus referencing alpha+beta (matches) and
      // delta (OOV → not in Glove → silently dropped from output).
      const corpusDir = path.join(tmp, "corpus");
      const fs = require("node:fs") as typeof import("node:fs");
      fs.mkdirSync(corpusDir, { recursive: true });
      writeFileSync(
        path.join(corpusDir, "doc1.xml"),
        "<root><title>alpha beta</title><other>delta</other></root>",
        "utf8",
      );
      writeFileSync(
        path.join(corpusDir, "doc2.xml"),
        "<root><body>beta gamma alpha</body></root>",
        "utf8",
      );

      const outDir = path.join(tmp, "out");

      // 3. Run extraction.
      const res = spawnSync(
        venvPython,
        [
          "scripts/extract-glove-vocab.py",
          "--glove",
          glovePath,
          "--corpus",
          corpusDir,
          "--out",
          outDir,
          "--dim-check",
          "4",
          "--report",
        ],
        {
          cwd: projectRoot,
          encoding: "utf8",
        },
      );
      if (res.status !== 0) {
        // eslint-disable-next-line no-console
        console.error("extract stdout:", res.stdout);
        // eslint-disable-next-line no-console
        console.error("extract stderr:", res.stderr);
      }
      expect(res.status, `extract-glove-vocab.py exited ${res.status}: ${res.stderr}`).toBe(0);

      const vocabPath = path.join(outDir, "glove-vocab.txt");
      const vectorsPath = path.join(outDir, "glove-vectors.bin");
      expect(existsSync(vocabPath)).toBe(true);
      expect(existsSync(vectorsPath)).toBe(true);

      // 4. Load and verify.
      const prov = new GloveFileProvider(vocabPath, vectorsPath);
      expect(prov.dim).toBe(4);
      // Expect 3 hits: alpha, beta, gamma. delta was in the corpus but
      // not in Glove → dropped.
      expect(prov.size).toBe(3);

      // Known tokens return their exact vectors.
      const alpha = Array.from(prov.lookup("alpha"));
      expect(alpha).toEqual([1, 0, 0, 0]);

      const beta = Array.from(prov.lookup("beta"));
      expect(beta).toEqual([0, 1, 0, 0]);

      const gamma = Array.from(prov.lookup("gamma"));
      expect(gamma).toEqual([0.5, 0.5, 0, 0]);

      // OOV → all zeros.
      const oov = Array.from(prov.lookup("delta"));
      expect(oov).toEqual([0, 0, 0, 0]);
      const oov2 = Array.from(prov.lookup("not-in-any-source"));
      expect(oov2).toEqual([0, 0, 0, 0]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 60_000);
});
