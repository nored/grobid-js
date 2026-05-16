# Wapiti decoder bit-parity harness

This directory contains a small C driver that links the upstream wapiti
sources from `upstream/wapiti/` into a label-only binary, plus Node scripts
that feed the same input through both the C binary and our JS port and
report any label divergences.

## Files

- `wapiti-label.c` — minimal `wapiti label -m MODEL < FEATURES > LABELS`
  driver. Reuses `decoder.c`, `model.c`, `reader.c`, `pattern.c`, `quark.c`,
  `tools.c` from `upstream/wapiti/` verbatim.
- `stubs.c`, `vmath.h`, `gradient.h`, `thread.h`, `options.h` — stubs for the
  upstream modules that the label path doesn't exercise (`xvm_*`, `grd_*`,
  `mth_*` and the full `opt_t` layout from `wapiti/options.h`).
- `build.mjs` — node-spawn wrapper around `cc` that compiles `wapiti-label`.

## Usage

```bash
# 1. Build the upstream label binary.
node test/bench/wapiti-build/build.mjs

# 2. Capture real feature inputs from the JS pipeline (writes
#    features-<model>-<i>.txt files into this directory).
node test/bench/wapiti-capture.mjs

# 3. Diff the JS port against upstream on a captured file.
node test/bench/wapiti-diff-real.mjs features-fulltext-1.txt
node test/bench/wapiti-diff-real.mjs features-segmentation-0.txt
# ...

# 3b. Or run the synthetic diff that generates short canned sequences.
node test/bench/wapiti-diff.mjs
```

## Status (last validated 2026-05-15)

Bit-identical labels with upstream on:

- `features-fulltext-0.txt`     — 362 tokens
- `features-fulltext-1.txt`     — 6240 tokens
- `features-segmentation-0.txt` — 1000 tokens
- `features-reference-segmenter-0.txt` — 1528 tokens
- Synthetic harness (`wapiti-diff.mjs`) — 129 tokens spanning ASCII +
  non-ASCII (Schäfer, Ω-function), parenthesised author citations,
  bracketed numeric citations, section headings, equations, tables.

Total compared: ~9.3k tokens, 0 divergences.
