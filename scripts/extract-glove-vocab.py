#!/usr/bin/env python3
"""
Build a vocab-restricted Glove dump for use with grobid-js's
BidLSTMCRFFeaturesTagger.

Why: the upstream BidLSTM_CRF_FEATURES model uses 300-d Glove 840B word
embeddings. The full Glove 840B file is ~5GB (≈2.2M vocab × 300 floats);
we cannot ship that with the JS runtime. Instead we extract a subset
covering only the tokens that appear in (a) GROBID's training corpus
for the model in question and (b) optional supplementary sources.

INPUTS
------
  --glove        Path to an uncompressed Glove word-vector file. Each
                 line is "TOKEN v1 v2 v3 ... vDIM" (space-separated).
                 Recommended: glove.840B.300d.txt (the file the upstream
                 GROBID model was trained against). Get it at
                   https://nlp.stanford.edu/projects/glove/
                 and gunzip.
  --corpus       (repeatable) Path to a directory of GROBID training-data
                 XML files. We walk each file's text content (tags
                 stripped, runs of whitespace split) and union the
                 resulting tokens.
  --tokens       (repeatable) Path to a plain-text file with one token
                 per line. Useful for hand-curated supplementary vocab
                 (e.g. top-100k common English tokens for OOV coverage).
  --out          Output directory. Writes:
                    glove-vocab.txt    — one token per line, in row order
                    glove-vectors.bin  — float32 LE matrix, header is
                                         int32 token_count, int32 dim;
                                         payload is token_count*dim floats
                                         row-major

  --max-vocab    Optional cap on output vocab size. Order of preference:
                 (1) corpus tokens, (2) --tokens tokens. Caller-supplied
                 vocab beyond the cap is silently dropped.
  --report       If set, print stats: total vocab seen, Glove hits, OOV.

Notes:
  - This script does NOT do DeLFT-equivalent normalization (e.g. it does
    not lower-case). DeLFT's GROBID tagger feeds raw tokens to Glove
    after upstream's tokenization, so matching Glove cases is required.
    If you want better hit-rate, generate the supplementary token list
    with the same casing.
  - The script streams Glove line-by-line; peak memory is the size of
    the requested subset, not the full 5GB Glove file.
"""

from __future__ import annotations

import argparse
import os
import re
import struct
import sys
import xml.etree.ElementTree as ET
from typing import Iterable, Set


_NUM_RE = re.compile(r"[0-9０-９]")


def _normalise_num(token: str) -> str:
    """Mirror of DeLFT's `_normalize_num`. Digits → "0"."""
    return _NUM_RE.sub("0", token)


def _iter_xml_tokens(xml_path: str) -> Iterable[str]:
    """Yield whitespace-separated tokens from all text nodes in an XML
    file, normalised the same way DeLFT does before Glove lookup
    (digits → "0"). Robust to malformed XML by falling back to a regex
    sweep.
    """
    try:
        tree = ET.parse(xml_path)
        for el in tree.iter():
            if el.text:
                for tok in el.text.split():
                    yield _normalise_num(tok)
            if el.tail:
                for tok in el.tail.split():
                    yield _normalise_num(tok)
    except ET.ParseError:
        # Some GROBID training files have un-escaped ampersands etc.
        # Fall back to a regex that strips tags.
        with open(xml_path, "r", encoding="utf-8", errors="replace") as f:
            data = f.read()
        text = re.sub(r"<[^>]+>", " ", data)
        for tok in text.split():
            yield _normalise_num(tok)


def _collect_corpus_vocab(corpus_dir: str) -> Set[str]:
    """Recursively walk a directory and union tokens from every .xml /
    .tei / .train file under it.
    """
    seen: Set[str] = set()
    file_count = 0
    for root, _, files in os.walk(corpus_dir):
        for fn in files:
            if not (fn.endswith(".xml") or fn.endswith(".tei") or fn.endswith(".train") or fn.endswith(".tei.xml")):
                continue
            p = os.path.join(root, fn)
            file_count += 1
            try:
                for tok in _iter_xml_tokens(p):
                    seen.add(tok)
            except Exception as exc:
                print(f"  warn: skipping {p}: {exc}", file=sys.stderr)
    print(f"  scanned {file_count} files under {corpus_dir}: {len(seen)} unique tokens")
    return seen


def _collect_token_list(token_file: str) -> Set[str]:
    out: Set[str] = set()
    with open(token_file, "r", encoding="utf-8") as f:
        for line in f:
            tok = line.rstrip("\n").rstrip("\r")
            if tok:
                out.add(tok)
    print(f"  loaded {len(out)} tokens from {token_file}")
    return out


def _scan_glove(glove_path: str, wanted: Set[str], dim_check: int = 300):
    """Stream Glove line-by-line; for each line whose first whitespace-
    delimited token is in `wanted`, yield (token, np.ndarray of dim).
    """
    import numpy as np

    dim_known: int | None = None
    seen = 0
    matches = 0
    with open(glove_path, "r", encoding="utf-8") as f:
        for line in f:
            seen += 1
            sp = line.rstrip("\n").split(" ")
            if len(sp) < 2:
                continue
            tok = sp[0]
            if tok not in wanted:
                continue
            vec_strs = sp[1:]
            if dim_known is None:
                dim_known = len(vec_strs)
                if dim_known != dim_check:
                    raise RuntimeError(
                        f"Glove dim mismatch: file has dim={dim_known}, "
                        f"--dim-check expected {dim_check}"
                    )
            elif len(vec_strs) != dim_known:
                # Some Glove files have multi-word tokens with internal spaces;
                # skip lines whose dim doesn't match.
                continue
            try:
                vec = np.asarray([float(v) for v in vec_strs], dtype=np.float32)
            except ValueError:
                continue
            matches += 1
            yield tok, vec
            if matches % 50_000 == 0:
                print(f"  ... matched {matches} / {len(wanted)} after {seen:,} lines")
    print(f"  total Glove lines read: {seen:,}; matches: {matches:,}")


def _write_outputs(
    out_dir: str,
    tokens: list,
    vectors,
    dim: int,
) -> None:
    import numpy as np

    os.makedirs(out_dir, exist_ok=True)
    vocab_path = os.path.join(out_dir, "glove-vocab.txt")
    with open(vocab_path, "w", encoding="utf-8") as f:
        for tok in tokens:
            f.write(tok)
            f.write("\n")
    print(f"  -> {vocab_path} ({os.path.getsize(vocab_path):,} bytes)")

    vec_path = os.path.join(out_dir, "glove-vectors.bin")
    arr = np.asarray(vectors, dtype=np.float32).reshape(len(tokens), dim)
    with open(vec_path, "wb") as f:
        f.write(struct.pack("<ii", len(tokens), dim))
        f.write(arr.tobytes(order="C"))
    print(f"  -> {vec_path} ({os.path.getsize(vec_path):,} bytes)")


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--glove", required=True)
    p.add_argument("--corpus", action="append", default=[])
    p.add_argument("--tokens", action="append", default=[])
    p.add_argument("--out", required=True)
    p.add_argument("--max-vocab", type=int, default=0)
    p.add_argument("--dim-check", type=int, default=300)
    p.add_argument("--report", action="store_true")
    args = p.parse_args(argv)

    if not args.corpus and not args.tokens:
        p.error("at least one of --corpus or --tokens is required")

    print(f"Building vocab-restricted Glove dump → {args.out}")

    # 1. Build the requested-vocabulary set, preserving priority order:
    #    (a) corpus tokens, then (b) supplementary token-list tokens.
    seen_corpus: Set[str] = set()
    for d in args.corpus:
        print(f"\nScanning corpus: {d}")
        seen_corpus.update(_collect_corpus_vocab(d))

    seen_extras: Set[str] = set()
    for tf in args.tokens:
        print(f"\nLoading tokens: {tf}")
        seen_extras.update(_collect_token_list(tf))

    wanted = seen_corpus | seen_extras
    print(f"\nTotal wanted vocab: {len(wanted)}  (corpus={len(seen_corpus)}, extras={len(seen_extras)})")

    # 2. Stream Glove, keep only wanted tokens.
    print(f"\nScanning Glove: {args.glove}")
    found_tokens: list = []
    found_vecs: list = []
    for tok, vec in _scan_glove(args.glove, wanted, dim_check=args.dim_check):
        found_tokens.append(tok)
        found_vecs.append(vec)

    # 3. Apply max-vocab cap, prioritising corpus tokens first.
    if args.max_vocab > 0 and len(found_tokens) > args.max_vocab:
        print(f"\nCapping output: {len(found_tokens)} -> {args.max_vocab}")
        # Stable-partition: corpus matches first, then extras.
        corpus_idxs = [i for i, t in enumerate(found_tokens) if t in seen_corpus]
        extras_idxs = [i for i, t in enumerate(found_tokens) if t not in seen_corpus]
        keep_idxs = (corpus_idxs + extras_idxs)[: args.max_vocab]
        keep_idxs_set = set(keep_idxs)
        found_tokens = [found_tokens[i] for i in keep_idxs]
        found_vecs = [found_vecs[i] for i in keep_idxs]
        _ = keep_idxs_set  # silence unused-warn

    # 4. Write outputs.
    print()
    _write_outputs(args.out, found_tokens, found_vecs, args.dim_check)

    if args.report:
        print()
        print(f"Stats:")
        print(f"  wanted vocab          : {len(wanted):,}")
        print(f"  glove hits            : {len(found_tokens):,}")
        oov = len(wanted) - len(found_tokens)
        print(f"  out-of-glove (OOV)    : {oov:,}")
        if len(wanted) > 0:
            print(f"  coverage              : {len(found_tokens) * 100 / len(wanted):.1f}%")
    return 0


if __name__ == "__main__":
    sys.exit(main())
