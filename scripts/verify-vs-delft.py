#!/usr/bin/env python3
"""Run the SAME `003061v1.training.header` first-80-tokens prompt through
DeLFT's own Python code path and through our ONNX pipeline (+ Viterbi).
Compare per-token labels AND raw per-token potentials.

What we want to learn:
  - Does the upstream-shipped `model_weights.hdf5` produce the same wrong
    labels via DeLFT's own loader as it does via our reconstructed ONNX
    graph?
  - If yes → the shipped checkpoint is undertrained (or doesn't match what
    GROBID's Java side actually uses).
  - If no  → our topology reconstruction has a bug.

Approach:
  1. Construct `delft.sequenceLabelling.Sequence(model_name=…)`. The
     constructor reads `embedding-lmdb-path` and loads glove-840B via the
     local registry we point it at.
  2. Call `.load(dir_path="fixtures/models/dl/")` so DeLFT looks for
     `header-BidLSTM_CRF_FEATURES/{config,preprocessor,model_weights}`
     under that root.
  3. Read 80 tokens + features from the raw training file.
  4. Call `model.tag(...)` for labels AND grab raw potentials via
     `model.model(..., return_crf_internal=True)`.
  5. Run our ONNX graph + Python re-implementation of the JS Viterbi.
  6. Print label agreement + potentials max/mean abs diff.

SETUP — IMPORTANT
-----------------
DeLFT 0.4.x requires TF 2.17 + tf_keras 2.17 + tfa-nightly. Our
conversion script requires TF 2.14 + tf2onnx (which caps at TF 2.14).
The two stacks CONFLICT in the same venv. To run this script:

    # Save current venv state (TF 2.14 — for the convert script)
    .venv/bin/pip install --no-deps tensorflow==2.17.1 tf_keras==2.17.0 \\
        keras==3.10.0 tfa-nightly==0.23.0.dev20240415222534

    # Run this script
    .venv/bin/python scripts/verify-vs-delft.py ...

    # Restore venv state for `convert-bidlstm-crf-features.py`
    .venv/bin/pip install --no-deps --force-reinstall tensorflow-macos==2.14.1 \\
        keras==2.14.0 tf_keras==2.14.1 tensorflow-addons==0.23.0
    rm -rf .venv/lib/python3.10/site-packages/tensorflow-2.17.*.dist-info

DeLFT also needs the editable install:
    .venv/bin/pip install --no-deps -e /tmp/delft

and runtime deps (transformers==4.48.0, etc — see /tmp/delft/requirements.txt).

USAGE
-----
    .venv/bin/python scripts/verify-vs-delft.py \\
        --registry /tmp/delft-registry.json \\
        --root fixtures/models/dl \\
        --model header-BidLSTM_CRF_FEATURES \\
        --raw  ~/.cache/grobid-js/upstream/grobid/grobid-trainer/resources/dataset/header/corpus/raw/003061v1.training.header \\
        --limit 80 \\
        --out  /tmp/delft-pred.txt

Output:
  /tmp/delft-pred.txt              — DeLFT (token, label) lines
  /tmp/delft-pred.txt.compare      — TSV: idx, token, DeLFT, ONNX, agree
"""
from __future__ import annotations

import argparse
import json
import os
import sys


def read_first_n_tokens(raw_path: str, limit: int):
    """Read tokens + per-token feature lists.

    UPSTREAM SHAPE QUIRK: the trained model expects 22 features
    (features_indices = [9..30]). DeLFT's reader does
    `pieces[1:-1]` (drop token + presumed-label). Our raw training file
    has 32 cols (no label), so [1:-1] yields 30 features (indices 0..29)
    — only 21 of the 22 expected indices are present, the model rejects
    the (T, 21) input as "incompatible with expected (None, None, 22)".

    The Java/GROBID training pipeline must have appended a label column,
    yielding 33 cols → slice = 31 features → all 22 indices present. To
    mirror that and keep the comparison apples-to-apples with the JS
    pipeline (which always allocates 22 slots and leaves index 30 = 0),
    we append a dummy "0" column to each raw row BEFORE the [1:-1]
    slice. The slice then drops our dummy, yielding 30 real features +
    we manually pad with a 22nd zero entry by appending a "0" to each
    feature row to make the per-token feature list have 22 entries —
    matching the JS encoder's behaviour (feature index 30 always 0).
    """
    tokens = []
    features = []
    with open(raw_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            pieces = line.split()
            tokens.append(pieces[0])
            # Strategy: feed DeLFT what the JS pipeline feeds the ONNX
            # graph. JS allocates 22 feature slots but the LAST slot
            # (features_indices[21]=30) is always 0 because the JS
            # encoder skips columns past `cols.length-2` (mirroring
            # DeLFT's [1:-1] training-time slice that drops a trailing
            # label column our raw file doesn't have).
            #
            # To make DeLFT produce the same 22-element vector with
            # slot 21 = 0, we pass it a 31-element feature row where
            # the 31st (index 30 after dropping token) is a sentinel
            # value NOT present in features_map_to_index[30]. DeLFT's
            # transform_features then maps it to 0, just like JS.
            #
            # If we instead passed pieces[1:] verbatim, DeLFT would
            # see column 30 = "0" which IS in features_map_to_index[30]
            # (value 253). That's the training-time semantic — better
            # but not what JS produces. We use a sentinel here so the
            # comparison isolates topology, not feature-encoding bug.
            if os.environ.get("DELFT_FEATURES_MODE") == "training-correct":
                # Pass pieces[1:] — DeLFT slot 21 maps to features_map_to_index[30]["0"] = 253.
                # That matches what was likely used at training time.
                features.append(list(pieces[1:]))
            else:
                # Default: match JS pipeline's behaviour where slot 21 is always 0.
                features.append(list(pieces[1:-1]) + ["__SENTINEL__"])
            if len(tokens) >= limit:
                break
    return tokens, features


def main(argv=None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--root", required=True, help="Parent dir containing <model>/")
    p.add_argument("--model", required=True, help="Model dir name, e.g. header-BidLSTM_CRF_FEATURES")
    p.add_argument("--raw", required=True, help="Raw feature file (training-format)")
    p.add_argument("--limit", type=int, default=80)
    p.add_argument("--out", default="/tmp/delft-pred.txt")
    p.add_argument("--registry", default=None, help="Path to delft resource registry json (alt. to DELFT_REGISTRY_PATH env)")
    p.add_argument(
        "--training-correct-features",
        action="store_true",
        help="Pass DeLFT the full pieces[1:] (31 features) so slot 21 = features_map_to_index[30]['0']. "
        "Default mirrors JS pipeline (sentinel → slot 21 = 0).",
    )
    args = p.parse_args(argv)

    # Wire registry path: prefer --registry arg, fall back to env.
    if args.registry:
        os.environ["DELFT_REGISTRY_PATH"] = args.registry
    if args.training_correct_features:
        os.environ["DELFT_FEATURES_MODE"] = "training-correct"
    reg = os.environ.get("DELFT_REGISTRY_PATH")
    if not reg:
        sys.stderr.write("ERROR: DELFT_REGISTRY_PATH not set (and --registry not passed)\n")
        return 2
    if not os.path.isfile(reg):
        sys.stderr.write(f"ERROR: DELFT_REGISTRY_PATH does not exist: {reg}\n")
        return 2

    # Import after env is wired up
    from delft.sequenceLabelling import Sequence  # noqa: E402

    tokens, features = read_first_n_tokens(args.raw, args.limit)
    if not tokens:
        sys.stderr.write("ERROR: no tokens read from raw file\n")
        return 2
    print(f"Read {len(tokens)} tokens from {args.raw}")
    print(f"First token: {tokens[0]!r}, feature count: {len(features[0])}")

    # Construct Sequence — it will load glove embeddings.
    # The model_name passed here is overridden by config.json on .load(),
    # but it's needed for the constructor to find the dir.
    seq = Sequence(model_name=args.model)
    seq.load(dir_path=args.root + "/")

    # tag a single sentence (DeLFT applies the dummy-second-sequence dirty
    # fix internally for single-sentence batches with use_crf=True)
    print("Running DeLFT tag()...")
    tagged = seq.tag([list(tokens)], output_format="tags", features=[features])
    # tagged is list of list of (token, label)
    print(f"Got {len(tagged)} tagged sequence(s); first has {len(tagged[0])} tokens")

    with open(args.out, "w", encoding="utf-8") as fout:
        for tok, label in tagged[0]:
            fout.write(f"{tok}\t{label}\n")
    print(f"Wrote {args.out}")

    # also print a short sample
    print("\nFirst 15 DeLFT predictions:")
    for tok, label in tagged[0][:15]:
        print(f"  {tok:20s}  {label}")

    # ---------------- Compare raw potentials ----------------
    print("\n=== Extracting DeLFT raw potentials (pre-Viterbi) ===")
    delft_potentials = extract_delft_potentials(seq, tokens, features)
    if delft_potentials is not None:
        print(f"  DeLFT potentials shape: {delft_potentials.shape}")

    # ---------------- Compare to our ONNX pipeline (+ JS Viterbi) ----------------
    print("\n=== Running our ONNX pipeline (+ Viterbi) for comparison ===")
    onnx_labels, onnx_potentials = run_onnx_with_viterbi(args.root, args.model, tokens, features)
    if delft_potentials is not None and onnx_potentials is not None:
        import numpy as np
        # Trim DeLFT to T tokens (the dummy 2nd sentence is dropped by tag_() already)
        dp = delft_potentials[: onnx_potentials.shape[0]]
        diff = np.abs(dp - onnx_potentials)
        print(f"  potentials diff: max={diff.max():.4g}  mean={diff.mean():.4g}")
        # Per-token argmax agreement on RAW potentials (before Viterbi)
        dp_argmax = dp.argmax(axis=-1)
        op_argmax = onnx_potentials.argmax(axis=-1)
        agree_pot = int((dp_argmax == op_argmax).sum())
        print(f"  argmax-of-potentials agreement: {agree_pot}/{len(dp_argmax)}")
    print(f"Got {len(onnx_labels)} ONNX labels")

    # Align and compute disagreement
    n = min(len(tagged[0]), len(onnx_labels))
    agree = 0
    disagreements = []
    for i in range(n):
        tok, delft_label = tagged[0][i]
        onnx_label = onnx_labels[i]
        if delft_label == onnx_label:
            agree += 1
        else:
            disagreements.append((i, tok, delft_label, onnx_label))

    print(f"\nPer-token agreement: {agree}/{n} = {100.0*agree/n:.1f}%")
    print(f"Disagreements: {len(disagreements)}")
    if disagreements:
        print("\nFirst disagreements (idx, token, DeLFT, ONNX):")
        for i, tok, dl, ol in disagreements[:15]:
            print(f"  [{i:3d}]  {tok[:20]:20s}  DeLFT={dl:22s}  ONNX={ol}")

    # Dump combined per-token output
    combined_path = args.out + ".compare"
    with open(combined_path, "w", encoding="utf-8") as fout:
        fout.write("# idx\ttoken\tDeLFT\tONNX\tagree\n")
        for i in range(n):
            tok, delft_label = tagged[0][i]
            onnx_label = onnx_labels[i]
            ok = "Y" if delft_label == onnx_label else "N"
            fout.write(f"{i}\t{tok}\t{delft_label}\t{onnx_label}\t{ok}\n")
    print(f"\nWrote per-token comparison to {combined_path}")

    return 0


def extract_delft_potentials(seq, tokens, features):
    """Run a DeLFT prediction with `return_crf_internal=True` to grab the
    raw potentials tensor (B, T, ntags) before Viterbi/boundary energy
    rewriting. Returns the first sequence's potentials as numpy (T, ntags)
    or None if extraction fails.
    """
    try:
        import numpy as np
        # Build inputs using DeLFT's own generator
        gen_cls = seq.model.get_generator()
        # Need a dummy 2nd sequence to avoid the single-sequence CRF bug
        x = [list(tokens), list(tokens)]
        f = [list(features), list(features)]
        gen = gen_cls(
            x,
            None,
            batch_size=2,
            preprocessor=seq.p,
            bert_preprocessor=None,
            char_embed_size=seq.model_config.char_embedding_size,
            max_sequence_length=seq.model_config.max_sequence_length,
            embeddings=seq.embeddings,
            tokenize=False,
            shuffle=False,
            features=f,
            output_input_offsets=True,
            use_chain_crf=False,
        )
        inputs = gen[0][0]
        # Call the model with return_crf_internal=True to get potentials
        (potentials, sequence_length, kernel), _ = seq.model.model(inputs, training=False, return_crf_internal=True)
        return potentials.numpy()[0]  # first batch element → (T, ntags)
    except Exception as e:
        print(f"  could not extract DeLFT potentials: {e}")
        return None


def run_onnx_with_viterbi(root: str, model_name: str, tokens, features_per_token):
    """Replicate the JS bidlstm-crf-features-tagger.ts pipeline in Python:
    encode (word, char, features) tensors, run ONNX, then apply our
    custom Viterbi with the saved transition matrix + boundary biases.

    Returns a list of GROBID-format labels (e.g. "I-<title>", "<other>")
    matching what the JS tagger emits — including the
    `iobToGrobidLabel` translation.
    """
    import struct
    import re as _re
    import numpy as np
    import onnxruntime as ort

    model_dir = os.path.join(root, model_name)
    with open(os.path.join(model_dir, "model-config.json")) as f:
        cfg = json.load(f)
    with open(os.path.join(model_dir, "vocab-char.json")) as f:
        vocab_char = json.load(f)
    with open(os.path.join(model_dir, "vocab-tag.json")) as f:
        tag_vocab = json.load(f)
    with open(os.path.join(model_dir, "vocab-features.json")) as f:
        feat_pre = json.load(f)
    indice_tag = tag_vocab["indice_tag"]

    T = len(tokens)
    D = cfg["word_embedding_size"]
    L = cfg["max_char_length"]
    feature_columns = cfg["features_indices"]  # [9..30]
    N = len(feature_columns)  # 22

    # ---- word_input via vocab-restricted glove ----
    word_in = np.zeros((1, T, D), dtype=np.float32)
    vocab_path = os.path.join(model_dir, "glove-vocab.txt")
    vectors_path = os.path.join(model_dir, "glove-vectors.bin")
    if os.path.exists(vocab_path) and os.path.exists(vectors_path):
        with open(vocab_path, encoding="utf-8") as f:
            glove_tokens = [l.rstrip("\n") for l in f.readlines() if l.rstrip("\n")]
        with open(vectors_path, "rb") as f:
            hdr = f.read(8)
            tc, dim_chk = struct.unpack("<ii", hdr)
            if dim_chk != D:
                raise SystemExit(f"glove dim {dim_chk} != model D={D}")
            buf = f.read()
        mat = np.frombuffer(buf, dtype="<f4").reshape(tc, dim_chk)
        idx = {t: i for i, t in enumerate(glove_tokens)}
        num_re = _re.compile(r"[0-9０-９]")
        hits = 0
        for t in range(T):
            tok = tokens[t]
            normalised = num_re.sub("0", tok)
            i = idx.get(normalised)
            if i is not None:
                word_in[0, t, :] = mat[i]
                hits += 1
        print(f"  ONNX: glove hits {hits}/{T}")

    # ---- char_input ----
    unk = vocab_char.get("<UNK>", 1)
    char_in = np.zeros((1, T, L), dtype=np.int32)
    for t in range(T):
        tok = tokens[t]
        for i, c in enumerate(tok[:L]):
            char_in[0, t, i] = vocab_char.get(c, unk)

    # ---- features_input — replicate JS encoder logic exactly ----
    feat_map = feat_pre["features_map_to_index"]
    feat_in = np.zeros((1, T, N), dtype=np.int32)
    for t in range(T):
        # Our features_per_token[t] is the [1:-1] slice (30 entries) +
        # appended sentinel — but the JS pipeline reads from the raw
        # row, NOT the [1:-1] slice. To replicate JS exactly, we need
        # the raw row. Reconstruct it: token + features_per_token[t][:-1]
        # gives back the original [1:-1] slice. JS code uses cols[colIdx+1]
        # where colIdx in [9..30], so rawCol = 10..31. For rawCol > 30
        # (only colIdx=30 → rawCol=31) it's skipped.
        # Equivalently: for i in 0..20 (colIdx=9..29): feat_in[t, i] = map[colIdx].get(slice_feat[colIdx-1])
        # because JS reads cols[colIdx+1] which corresponds to slice index colIdx (since slice drops cols[0]).
        # Wait — slice is pieces[1:-1]. JS reads cols[colIdx+1] = cols[10..31] for colIdx 9..30.
        # cols[10] = first feature value (= slice[9] since slice[0]=cols[1]).
        # Hmm slice indexing: slice[i] = pieces[i+1]. So cols[colIdx+1] = pieces[colIdx+1] = slice[colIdx].
        # So slot i in feat_in = map[colIdx].get(slice[colIdx]) where colIdx = features_columns[i].
        slice_feat = features_per_token[t][:-1]  # drop the sentinel we appended → original [1:-1] slice
        for i in range(N):
            colIdx = feature_columns[i]
            if colIdx >= len(slice_feat):
                continue  # JS would skip this (last index → padding)
            raw_val = slice_feat[colIdx]
            col_map = feat_map.get(str(colIdx))
            if col_map and raw_val in col_map:
                feat_in[0, t, i] = col_map[raw_val]

    # ---- Run ONNX ----
    sess = ort.InferenceSession(os.path.join(model_dir, "model.onnx"), providers=["CPUExecutionProvider"])
    out = sess.run(None, {"word_input": word_in, "char_input": char_in, "features_input": feat_in})[0]
    potentials = out[0]  # (T, ntags)
    ntags = potentials.shape[-1]

    # ---- Viterbi (replicate neural-crf-viterbi.ts) ----
    # load transitions + boundary biases
    def _read_mat(p):
        with open(p, "rb") as f:
            rows, cols = struct.unpack("<ii", f.read(8))
            data = np.frombuffer(f.read(), dtype="<f4").reshape(rows, cols)
        return data

    def _read_vec(p):
        with open(p, "rb") as f:
            (n_,) = struct.unpack("<i", f.read(4))
            data = np.frombuffer(f.read(), dtype="<f4")
        return data

    transitions = _read_mat(os.path.join(model_dir, "crf-transitions.bin"))
    left_b = _read_vec(os.path.join(model_dir, "crf-left-boundary.bin"))
    right_b = _read_vec(os.path.join(model_dir, "crf-right-boundary.bin"))

    # standard Viterbi
    alpha = np.full((T, ntags), -np.inf, dtype=np.float64)
    back = np.zeros((T, ntags), dtype=np.int64)
    alpha[0] = potentials[0] + left_b
    for t in range(1, T):
        # alpha[t, y] = max_yp ( alpha[t-1, yp] + trans[yp, y] ) + pot[t, y]
        scores = alpha[t - 1, :, None] + transitions  # (ntags, ntags)
        best_yp = np.argmax(scores, axis=0)
        alpha[t] = scores[best_yp, np.arange(ntags)] + potentials[t]
        back[t] = best_yp
    alpha[T - 1] = alpha[T - 1] + right_b
    best_last = int(np.argmax(alpha[T - 1]))
    labels = [0] * T
    labels[T - 1] = best_last
    for t in range(T - 1, 0, -1):
        labels[t - 1] = int(back[t, labels[t]])

    # We keep IOB2 labels (DeLFT's native output) for a clean comparison.
    # The JS-side translation to GROBID format ("I-" → continuation,
    # "B-X" → "I-X" prefix, "O" → "<other>") is JS pipeline business —
    # at the model-output level both should agree token-by-token in IOB2.
    out_labels = [indice_tag[str(y)] for y in labels]
    return out_labels, potentials


if __name__ == "__main__":
    sys.exit(main())
