#!/usr/bin/env python3
"""Verify the exported ONNX produces identical output to the TF graph
that was built from the same HDF5 weights.

We rebuild the inference model in TF, assign weights via the same
mapping the conversion script uses, run a fixed pseudo-random input
through it, then run the exact same input through onnxruntime against
the exported model.onnx. The two output arrays must be allclose at
~1e-4 (LSTM ops aren't bit-exact across runtimes).

Usage:
    .venv/bin/python scripts/verify-onnx-roundtrip.py \\
        --dir fixtures/models/dl/header-BidLSTM_CRF_FEATURES
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def main(argv=None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--dir", required=True)
    args = p.parse_args(argv)

    import numpy as np
    import tensorflow as tf
    import onnxruntime as ort

    # Import the converter so we reuse its model-build + weight-assign code
    import importlib.util

    converter_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "convert-bidlstm-crf-features.py")
    spec = importlib.util.spec_from_file_location("conv", converter_path)
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

    # Fixed pseudo-random input
    rng = np.random.default_rng(0)
    B = 1
    T = 12
    word_in = rng.standard_normal((B, T, config["word_embedding_size"])).astype(np.float32)
    char_in = rng.integers(0, config["char_vocab_size"], (B, T, config["max_char_length"]), dtype=np.int32)
    feat_in = rng.integers(0, config["features_vocabulary_size"] * len(config["features_indices"]) + 1, (B, T, len(config["features_indices"])), dtype=np.int32)

    tf_out = model.predict([word_in, char_in, feat_in], verbose=0)
    print(f"TF output shape: {tf_out.shape}")

    sess = ort.InferenceSession(os.path.join(args.dir, "model.onnx"), providers=["CPUExecutionProvider"])
    print("ONNX input names:", [i.name for i in sess.get_inputs()])
    print("ONNX output names:", [o.name for o in sess.get_outputs()])
    onnx_out = sess.run(None, {
        "word_input": word_in,
        "char_input": char_in,
        "features_input": feat_in,
    })[0]
    print(f"ONNX output shape: {onnx_out.shape}")

    diff = np.abs(tf_out - onnx_out)
    print(f"max abs diff: {diff.max():.6g}")
    print(f"mean abs diff: {diff.mean():.6g}")
    ok = np.allclose(tf_out, onnx_out, atol=1e-4, rtol=1e-4)
    print(f"allclose(atol=1e-4): {ok}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
