#!/usr/bin/env python3
"""Run a REAL header feature matrix through both the TF model (built from the
HDF5 weights via convert script's `_build_inference_model`) and through the
exported ONNX model. Compare predicted labels token-by-token.

If they agree, the ONNX export is faithful (conversion bug-free for the
TF→ONNX step). If they disagree, we have an export bug.

Usage:
  .venv/bin/python scripts/verify-onnx-real-input.py \\
      --dir fixtures/models/dl/header-BidLSTM_CRF_FEATURES \\
      --raw ~/.cache/grobid-js/upstream/grobid/grobid-trainer/resources/dataset/header/corpus/raw/003061v1.training.header
"""
import argparse
import json
import os
import struct
import sys


def main(argv=None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--dir", required=True)
    p.add_argument("--raw", required=True)
    p.add_argument("--limit", type=int, default=80)
    args = p.parse_args(argv)

    import numpy as np
    import tensorflow as tf
    import onnxruntime as ort
    import importlib.util

    spec = importlib.util.spec_from_file_location(
        "conv", os.path.join(os.path.dirname(os.path.abspath(__file__)), "convert-bidlstm-crf-features.py")
    )
    conv = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(conv)

    with open(os.path.join(args.dir, "config.json")) as f:
        config = json.load(f)
    with open(os.path.join(args.dir, "preprocessor.json")) as f:
        preprocessor = json.load(f)

    ntags = len(preprocessor["vocab_tag"])
    weights = conv._load_h5_flat(os.path.join(args.dir, "model_weights.hdf5"))

    model = conv._build_inference_model(config, ntags)
    conv._assign_weights(model, weights)

    # Read raw feature file
    with open(args.raw) as f:
        lines = [l for l in f.read().split("\n") if l.strip()]
    rows = [l.split() for l in lines[: args.limit]]
    T = len(rows)
    print(f"T={T}, first token: {rows[0][0]}")

    # Encode inputs the same way the JS tagger does
    D = config["word_embedding_size"]
    L = config["max_char_length"]
    feature_columns = config["features_indices"]  # e.g. [9, 10, ..., 30]
    N = len(feature_columns)

    # Word embeddings: load from the vocab-restricted Glove dump.
    vocab_path = os.path.join(args.dir, "glove-vocab.txt")
    vectors_path = os.path.join(args.dir, "glove-vectors.bin")
    word_in = np.zeros((1, T, D), dtype=np.float32)
    if os.path.exists(vocab_path) and os.path.exists(vectors_path):
        with open(vocab_path, encoding="utf-8") as f:
            tokens = [l.rstrip("\n") for l in f.readlines() if l.rstrip("\n")]
        with open(vectors_path, "rb") as f:
            hdr = f.read(8)
            tc, dim_chk = struct.unpack("<ii", hdr)
            if dim_chk != D:
                raise SystemExit(f"glove dim {dim_chk} != model D={D}")
            buf = f.read()
        mat = np.frombuffer(buf, dtype="<f4").reshape(tc, dim_chk)
        idx = {t: i for i, t in enumerate(tokens)}
        import re as _re
        num_re = _re.compile(r"[0-9０-９]")
        hits = 0
        for t in range(T):
            tok = rows[t][0]
            normalised = num_re.sub("0", tok)
            i = idx.get(normalised)
            if i is not None:
                word_in[0, t, :] = mat[i]
                hits += 1
        print(f"glove hits: {hits}/{T}")

    # Char input: char-vocab lookup, pad to max_char_length
    vocab_char = preprocessor["vocab_char"]
    unk = vocab_char.get("<UNK>", 1)
    char_in = np.zeros((1, T, L), dtype=np.int32)
    for t in range(T):
        tok = rows[t][0]
        for i, c in enumerate(tok[:L]):
            char_in[0, t, i] = vocab_char.get(c, unk)

    # Features input
    fp = preprocessor["feature_preprocessor"]
    feat_map = fp["features_map_to_index"]
    feat_in = np.zeros((1, T, N), dtype=np.int32)
    for t in range(T):
        cols = rows[t]
        for i, col_idx in enumerate(feature_columns):
            # DeLFT strips column 0 (token) before applying features_indices.
            actual = cols[col_idx + 1] if (col_idx + 1) < len(cols) else None
            if actual is None:
                continue
            col_map = feat_map.get(str(col_idx))
            if col_map and actual in col_map:
                feat_in[0, t, i] = col_map[actual]

    # Run TF model
    tf_out = model.predict([word_in, char_in, feat_in], verbose=0)

    # Run ONNX
    sess = ort.InferenceSession(os.path.join(args.dir, "model.onnx"), providers=["CPUExecutionProvider"])
    onnx_out = sess.run(None, {
        "word_input": word_in,
        "char_input": char_in,
        "features_input": feat_in,
    })[0]

    # Compare
    diff = np.abs(tf_out - onnx_out)
    print(f"max abs diff: {diff.max():.6g}")
    print(f"mean abs diff: {diff.mean():.6g}")
    print(f"allclose(1e-4): {np.allclose(tf_out, onnx_out, atol=1e-4)}")

    # Predicted labels (argmax) — both runtimes
    tf_pred = tf_out[0].argmax(axis=-1)
    onnx_pred = onnx_out[0].argmax(axis=-1)
    indice_tag = preprocessor["indice_tag"]

    print("\nTop predictions (token, TF argmax, ONNX argmax, agree?):")
    disagree = 0
    for t in range(T):
        tf_label = indice_tag[str(tf_pred[t])]
        onnx_label = indice_tag[str(onnx_pred[t])]
        agree = "✓" if tf_pred[t] == onnx_pred[t] else "✗"
        if tf_pred[t] != onnx_pred[t]:
            disagree += 1
        if t < 30 or tf_pred[t] != onnx_pred[t]:
            print(f"  {rows[t][0][:15]:15s}  TF={tf_label:20s}  ONNX={onnx_label:20s}  {agree}")
    print(f"\nTotal argmax disagreements: {disagree}/{T}")
    return 0 if disagree == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
