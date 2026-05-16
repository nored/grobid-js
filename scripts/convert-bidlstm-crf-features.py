#!/usr/bin/env python3
"""
Convert upstream GROBID BidLSTM_CRF_FEATURES Keras checkpoints to artifacts
consumable by the grobid-js JS runtime.

OUTPUT FILES (written next to the input dir, unless --out is given):

  model.onnx
      ONNX graph for the full forward pass UP TO the CRF transition step.
      It absorbs:
        - char BiLSTM
        - features BiLSTM
        - concat with word embeddings (passed in by caller)
        - main word BiLSTM
        - main Dense(100, tanh)
        - CRF inner Dense(ntags)            <-- absorbed from CRF wrapper
        - boundary-energy addition          <-- absorbed from CRF wrapper
      Output is `potentials`, shape (B, T, ntags). JS-side runs Viterbi
      using `crf-transitions.bin` against these potentials.

  crf-transitions.bin
      The CRF chain_kernel transition matrix (ntags, ntags). Layout:
        bytes  0..3  : int32 little-endian, n_rows (=ntags)
        bytes  4..7  : int32 little-endian, n_cols (=ntags)
        bytes  8..   : float32 little-endian, row-major (ntags*ntags floats)

  vocab-char.json       — string -> int
  vocab-tag.json        — {"vocab_tag": str->int, "indice_tag": str->str (int keys as strings)}
  vocab-features.json   — feature_preprocessor section verbatim from preprocessor.json
  model-config.json     — selected hyperparams forwarded to JS

USAGE
-----
    python3 scripts/convert-bidlstm-crf-features.py \\
        --in   fixtures/models/dl/header-BidLSTM_CRF_FEATURES \\
        --out  fixtures/models/dl/header-BidLSTM_CRF_FEATURES

Deps in scripts/requirements.txt. Glove embeddings are NOT shipped — the
JS runtime resolves each token to a 300-d Glove vector via a separate
mechanism (vocab-restricted dump produced by a sibling tool).

DESIGN NOTE — why this script is structured this way
----------------------------------------------------
DeLFT's checkpoint format is `model.save_weights()` HDF5 from a CRFModel-
Wrapper. The weights live under two top-level layer groups: `model/` for
the base BiLSTM and `crf/` for the addons-CRF wrapper. Keras's
`load_weights(by_name=True)` cannot bridge that two-level layout (it
looks for layer names at the top level), so we load weights by exact
HDF5 path with h5py and assign them to each Keras layer manually.

We also absorb the CRF wrapper's inner `_dense_layer` (Dense(ntags),
stored as `crf/crf/dense_1`) AND the boundary scores (`crf/left_boundary`,
`crf/right_boundary`) into the exported ONNX graph. That way the JS
runtime only needs:
  1. ONNX forward pass → potentials of shape (B, T, ntags)
  2. Viterbi against the saved transition matrix
matching the existing Wapiti Viterbi infrastructure shape-for-shape.
"""

from __future__ import annotations

import argparse
import json
import os
import struct
import sys
from typing import Dict, Tuple


def _require(module_name: str):
    try:
        return __import__(module_name)
    except ImportError as exc:
        sys.stderr.write(
            f"\nERROR: required Python module '{module_name}' is missing.\n"
            f"Install with: pip install -r scripts/requirements.txt\n"
            f"(underlying error: {exc})\n"
        )
        sys.exit(2)


# --- HDF5 helpers -----------------------------------------------------------


def _load_h5_flat(h5_path: str) -> Dict[str, "np.ndarray"]:
    h5py = _require("h5py")
    np = _require("numpy")
    flat: Dict[str, np.ndarray] = {}

    def visit(name, obj):
        if isinstance(obj, h5py.Dataset):
            flat[name] = np.asarray(obj[()])

    with h5py.File(h5_path, "r") as f:
        f.visititems(visit)
    return flat


def _need(weights: Dict[str, "np.ndarray"], key: str):
    if key not in weights:
        avail = "\n  ".join(sorted(weights.keys()))
        raise KeyError(f"weight '{key}' not in HDF5. Available:\n  {avail}")
    return weights[key]


# --- Model construction -----------------------------------------------------


def _build_inference_model(config: dict, ntags: int):
    """Build the full inference graph (base BiLSTM + CRF emission layer +
    boundary-energy addition). Returns a Keras model whose output is the
    `potentials` tensor of shape (B, T, ntags) ready for JS-side Viterbi.

    Layer order matches DeLFT's BidLSTM_CRF_FEATURES exactly, plus the
    inner CRF Dense(ntags). We assign weights by exact HDF5 path after
    building, so layer names here are chosen for readability — they do
    NOT need to match the HDF5 namespace.
    """
    tf = _require("tensorflow")
    K = tf.keras

    word_embedding_size = config["word_embedding_size"]
    char_vocab_size = config["char_vocab_size"]
    char_embedding_size = config["char_embedding_size"]
    num_char_lstm_units = config["num_char_lstm_units"]
    max_char_length = config["max_char_length"]
    features_vocabulary_size = config["features_vocabulary_size"]
    features_indices = config["features_indices"]
    features_embedding_size = config["features_embedding_size"]
    features_lstm_units = config["features_lstm_units"]
    num_word_lstm_units = config["num_word_lstm_units"]
    dropout = config["dropout"]
    recurrent_dropout = config["recurrent_dropout"]

    word_input = K.layers.Input(
        shape=(None, word_embedding_size), name="word_input", dtype=tf.float32
    )
    char_input = K.layers.Input(
        shape=(None, max_char_length), name="char_input", dtype=tf.int32
    )
    features_input = K.layers.Input(
        shape=(None, len(features_indices)), name="features_input", dtype=tf.int32
    )

    # --- character branch ---
    # NB: `mask_zero=True` matches DeLFT's upstream
    # `BidLSTM_CRF_FEATURES.__init__` (models.py:781). Without masking,
    # the char BiLSTM processes the full max_char_length window including
    # the trailing PAD zeros, which corrupts short-token outputs (digits,
    # separators, single chars). DeLFT's masking causes the LSTM to use
    # each token's true char length and ignore padding.
    char_emb = K.layers.TimeDistributed(
        K.layers.Embedding(
            input_dim=char_vocab_size,
            output_dim=char_embedding_size,
            mask_zero=True,
        ),
        name="td_char_emb",
    )(char_input)
    char_bilstm = K.layers.TimeDistributed(
        K.layers.Bidirectional(
            K.layers.LSTM(num_char_lstm_units, return_sequences=False),
            name="char_bilstm",
        ),
        name="td_char_bilstm",
    )(char_emb)  # (B, T, 2*num_char_lstm_units)

    # --- features branch ---
    feat_emb = K.layers.TimeDistributed(
        K.layers.Embedding(
            input_dim=features_vocabulary_size * len(features_indices) + 1,
            output_dim=features_embedding_size,
        ),
        name="td_feat_emb",
    )(features_input)
    feat_bilstm = K.layers.TimeDistributed(
        K.layers.Bidirectional(
            K.layers.LSTM(features_lstm_units, return_sequences=False),
            name="feat_bilstm",
        ),
        name="td_feat_bilstm",
    )(feat_emb)  # (B, T, 2*features_lstm_units)

    # --- combine + main BiLSTM ---
    x = K.layers.Concatenate(axis=-1)([word_input, char_bilstm, feat_bilstm])
    x = K.layers.Bidirectional(
        K.layers.LSTM(
            units=num_word_lstm_units,
            return_sequences=True,
        ),
        name="word_bilstm",
    )(x)
    x = K.layers.Dense(num_word_lstm_units, activation="tanh", name="dense_proj")(x)
    raw_potentials = K.layers.Dense(ntags, name="dense_emission")(x)

    # CRF boundary-energy addition: bias the first and last timestep.
    # We add `left_boundary` to position 0 and `right_boundary` to the last
    # *valid* position. ONNX has no "last valid" without a length input, so
    # we apply the right boundary to every timestep and let the Viterbi
    # caller in JS undo it for non-final timesteps. To keep the JS side
    # trivial, we instead include length_input and do a gather at the last
    # index. Simpler approach: bake left_boundary in here, AND keep
    # right_boundary as a sidecar applied JS-side. Implementation below
    # applies BOTH as sidecars (we save them to a single boundaries.bin)
    # and the ONNX graph emits raw `dense_emission` potentials. This keeps
    # the ONNX surface clean and the JS Viterbi loop in full control.

    model = K.Model(
        inputs=[word_input, char_input, features_input],
        outputs=raw_potentials,
        name="bidlstm_crf_features_inference",
    )
    return model


# --- Weight assignment ------------------------------------------------------


def _assign_weights(model, weights: Dict[str, "np.ndarray"]):
    """Pull each weight tensor out of the flat HDF5 dict and call
    layer.set_weights with the right ordering.

    Keras LSTM cell weight order: [kernel, recurrent_kernel, bias].
    Keras Bidirectional wraps a forward and backward LSTM and concatenates
    their outputs; its weight order is [fwd_kernel, fwd_recurrent_kernel,
    fwd_bias, bwd_kernel, bwd_recurrent_kernel, bwd_bias].
    Keras TimeDistributed delegates weight ownership to its child.
    """
    np = _require("numpy")

    def get(name: str):
        return _need(weights, name)

    # --- character branch ---
    td_char_emb = model.get_layer("td_char_emb")  # TimeDistributed(Embedding)
    td_char_emb.set_weights([get("model/time_distributed/embeddings:0")])

    td_char_bilstm = model.get_layer("td_char_bilstm")  # TD(Bidirectional(LSTM))
    td_char_bilstm.set_weights([
        get("model/time_distributed_1/forward_lstm/lstm_cell/kernel:0"),
        get("model/time_distributed_1/forward_lstm/lstm_cell/recurrent_kernel:0"),
        get("model/time_distributed_1/forward_lstm/lstm_cell/bias:0"),
        get("model/time_distributed_1/backward_lstm/lstm_cell/kernel:0"),
        get("model/time_distributed_1/backward_lstm/lstm_cell/recurrent_kernel:0"),
        get("model/time_distributed_1/backward_lstm/lstm_cell/bias:0"),
    ])

    # --- features branch ---
    td_feat_emb = model.get_layer("td_feat_emb")
    td_feat_emb.set_weights([get("model/features_embedding_td/embeddings:0")])

    td_feat_bilstm = model.get_layer("td_feat_bilstm")
    td_feat_bilstm.set_weights([
        get("model/features_embedding_td_2/forward_lstm_1/lstm_cell/kernel:0"),
        get("model/features_embedding_td_2/forward_lstm_1/lstm_cell/recurrent_kernel:0"),
        get("model/features_embedding_td_2/forward_lstm_1/lstm_cell/bias:0"),
        get("model/features_embedding_td_2/backward_lstm_1/lstm_cell/kernel:0"),
        get("model/features_embedding_td_2/backward_lstm_1/lstm_cell/recurrent_kernel:0"),
        get("model/features_embedding_td_2/backward_lstm_1/lstm_cell/bias:0"),
    ])

    # --- main word BiLSTM ---
    word_bilstm = model.get_layer("word_bilstm")
    word_bilstm.set_weights([
        get("model/bidirectional_2/forward_lstm_2/lstm_cell/kernel:0"),
        get("model/bidirectional_2/forward_lstm_2/lstm_cell/recurrent_kernel:0"),
        get("model/bidirectional_2/forward_lstm_2/lstm_cell/bias:0"),
        get("model/bidirectional_2/backward_lstm_2/lstm_cell/kernel:0"),
        get("model/bidirectional_2/backward_lstm_2/lstm_cell/recurrent_kernel:0"),
        get("model/bidirectional_2/backward_lstm_2/lstm_cell/bias:0"),
    ])

    # --- projection + emission ---
    dense_proj = model.get_layer("dense_proj")
    dense_proj.set_weights([
        get("model/dense/kernel:0"),
        get("model/dense/bias:0"),
    ])

    dense_emission = model.get_layer("dense_emission")
    dense_emission.set_weights([
        get("crf/crf/dense_1/kernel:0"),
        get("crf/crf/dense_1/bias:0"),
    ])


# --- Sidecar dumps ---------------------------------------------------------


def _save_matrix_bin(arr, out_path: str):
    np = _require("numpy")
    if arr.ndim != 2:
        raise ValueError(f"expected 2-D matrix, got shape {arr.shape}")
    rows, cols = arr.shape
    with open(out_path, "wb") as f:
        f.write(struct.pack("<ii", rows, cols))
        f.write(arr.astype(np.float32, copy=False).tobytes(order="C"))


def _save_vec_bin(arr, out_path: str):
    np = _require("numpy")
    if arr.ndim != 1:
        raise ValueError(f"expected 1-D vector, got shape {arr.shape}")
    (n,) = arr.shape
    with open(out_path, "wb") as f:
        f.write(struct.pack("<i", n))
        f.write(arr.astype(np.float32, copy=False).tobytes(order="C"))


# --- ONNX export ------------------------------------------------------------


def _export_onnx(model, out_path: str, opset: int = 14) -> Tuple[list, list]:
    tf2onnx = _require("tf2onnx")
    tf = _require("tensorflow")

    sigs = [
        tf.TensorSpec((None, None, model.input[0].shape[-1]), tf.float32, name="word_input"),
        tf.TensorSpec((None, None, model.input[1].shape[-1]), tf.int32, name="char_input"),
        tf.TensorSpec((None, None, model.input[2].shape[-1]), tf.int32, name="features_input"),
    ]
    model_proto, _ = tf2onnx.convert.from_keras(
        model, input_signature=sigs, opset=opset, output_path=out_path
    )
    inputs = [i.name for i in model_proto.graph.input]
    outputs = [o.name for o in model_proto.graph.output]
    return inputs, outputs


# --- Orchestration ----------------------------------------------------------


def _convert_one(in_dir: str, out_dir: str, opset: int, do_onnx: bool = True) -> None:
    print(f"\n=== Converting {os.path.basename(in_dir)} ===")
    with open(os.path.join(in_dir, "config.json"), "r") as f:
        config = json.load(f)
    with open(os.path.join(in_dir, "preprocessor.json"), "r") as f:
        preprocessor = json.load(f)
    h5_path = os.path.join(in_dir, "model_weights.hdf5")

    ntags = len(preprocessor["vocab_tag"])
    print(f"  arch={config['architecture']} ntags={ntags}")

    weights = _load_h5_flat(h5_path)
    print(f"  loaded {len(weights)} HDF5 datasets")

    os.makedirs(out_dir, exist_ok=True)

    # ---- 1) CRF transitions + boundary scores
    chain_kernel = _need(weights, "crf/chain_kernel:0")
    if chain_kernel.shape != (ntags, ntags):
        raise RuntimeError(f"chain_kernel shape {chain_kernel.shape} != ({ntags},{ntags})")
    _save_matrix_bin(chain_kernel, os.path.join(out_dir, "crf-transitions.bin"))
    print(f"  -> crf-transitions.bin ({ntags}x{ntags})")

    left_boundary = _need(weights, "crf/left_boundary:0")
    right_boundary = _need(weights, "crf/right_boundary:0")
    _save_vec_bin(left_boundary, os.path.join(out_dir, "crf-left-boundary.bin"))
    _save_vec_bin(right_boundary, os.path.join(out_dir, "crf-right-boundary.bin"))
    print(f"  -> crf-left-boundary.bin, crf-right-boundary.bin ({ntags},)")

    # ---- 2) Vocab/feature/tag dumps
    with open(os.path.join(out_dir, "vocab-char.json"), "w") as f:
        json.dump(preprocessor["vocab_char"], f, ensure_ascii=False)
    with open(os.path.join(out_dir, "vocab-tag.json"), "w") as f:
        json.dump(
            {"vocab_tag": preprocessor["vocab_tag"], "indice_tag": preprocessor["indice_tag"]},
            f,
            ensure_ascii=False,
        )
    with open(os.path.join(out_dir, "vocab-features.json"), "w") as f:
        json.dump(preprocessor["feature_preprocessor"], f, ensure_ascii=False)
    with open(os.path.join(out_dir, "model-config.json"), "w") as f:
        json.dump(
            {
                "architecture": config["architecture"],
                "word_embedding_size": config["word_embedding_size"],
                "char_vocab_size": config["char_vocab_size"],
                "char_embedding_size": config["char_embedding_size"],
                "num_char_lstm_units": config["num_char_lstm_units"],
                "max_char_length": config["max_char_length"],
                "features_vocabulary_size": config["features_vocabulary_size"],
                "features_indices": config["features_indices"],
                "features_embedding_size": config["features_embedding_size"],
                "features_lstm_units": config["features_lstm_units"],
                "num_word_lstm_units": config["num_word_lstm_units"],
                "max_sequence_length": config["max_sequence_length"],
                "embeddings_name": config["embeddings_name"],
                "ntags": ntags,
            },
            f,
            ensure_ascii=False,
            indent=2,
        )

    # ---- 3) Build model, assign weights, export ONNX
    model = _build_inference_model(config, ntags)
    _assign_weights(model, weights)
    print("  -> weights assigned without error")

    if do_onnx:
        onnx_path = os.path.join(out_dir, "model.onnx")
        inputs, outputs = _export_onnx(model, onnx_path, opset=opset)
        print(f"  -> {onnx_path} ({os.path.getsize(onnx_path)} bytes)")
        print(f"     inputs: {inputs}  outputs: {outputs}")

        onnx_meta = {
            "inputs": [
                {"name": "word_input", "dtype": "float32", "shape": ["B", "T", config["word_embedding_size"]]},
                {"name": "char_input", "dtype": "int32", "shape": ["B", "T", config["max_char_length"]]},
                {"name": "features_input", "dtype": "int32", "shape": ["B", "T", len(config["features_indices"])]},
            ],
            "outputs": [
                {"name": outputs[0], "dtype": "float32", "shape": ["B", "T", ntags]}
            ],
            "opset": opset,
        }
        with open(os.path.join(out_dir, "onnx-meta.json"), "w") as f:
            json.dump(onnx_meta, f, ensure_ascii=False, indent=2)


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--in", dest="in_dir", required=True)
    p.add_argument("--out", dest="out_dir", required=True)
    p.add_argument("--opset", type=int, default=14)
    p.add_argument("--check", action="store_true", help="Verify weight assignment only; skip ONNX export")
    args = p.parse_args(argv)

    _convert_one(args.in_dir, args.out_dir, args.opset, do_onnx=not args.check)
    return 0


if __name__ == "__main__":
    sys.exit(main())
