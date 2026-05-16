// Port of `org.grobid.core.jni.WapitiWrapper`.
// Upstream: grobid-core/src/main/java/org/grobid/core/jni/WapitiWrapper.java
//
// In Java, this class is a thin SWIG-mediated bridge to the C wapiti
// decoder. We replace the JNI call with a direct invocation of the ported
// decoder/reader pipeline. The orchestration mirrors what `tag_label`
// (decoder.c:418-535) does for a single sequence: read raw rows, build
// `seq_t`, run Viterbi, format output rows.

import { readFileSync } from "node:fs";
import { GrobidException } from "../exceptions/grobid-exception.js";
import { GrobidExceptionStatus } from "../exceptions/grobid-exception-status.js";
import { tagViterbi } from "./wapiti-decoder.js";
import { rdrReadRaw } from "./wapiti-reader.js";
// `MdlT` is the in-memory model produced by `WapitiModel.loadModelFromBytes`.
// Type-only import on the type, value import (lazy) on the class to avoid a
// module-init cycle with `wapiti-model.ts`.
import { WapitiModel, type MdlT } from "./wapiti-model.js";

export class WapitiWrapper {
  /**
   * Port of `WapitiWrapper.label` (Java) — mirrors the SWIG-bound
   * `Wapiti.labelFromModel`, which itself drives `tag_label` (decoder.c).
   *
   * Returns the input text with an additional label column appended to each
   * row. Rows are separated by `\n`. A trailing `\n` separates sequences
   * (`tag_label` emits one after every sequence — we keep that fidelity).
   */
  static label(model: MdlT, data: string): string {
    // Upstream: `if (data.trim().isEmpty()) { System.err.println(...); return ""; }`.
    // The stack-trace print is a debugging aid; we forward to the logger
    // instead but keep the contract: return empty string on empty data.
    if (data.trim() === "") {
      // eslint-disable-next-line no-console
      console.error("Empty data is provided to Wapiti tagger");
      return "";
    }

    // The Java code calls into `Wapiti.labelFromModel`, which expects a
    // sequence terminated by a blank line. Some callers concatenate multiple
    // sequences with blank lines between them; we replicate `tag_label`'s
    // loop verbatim.
    const lbls = model.reader.lbl;
    const out: string[] = [];
    let cursor = data;
    while (cursor.length > 0) {
      const { raw, rest } = rdrReadRaw(cursor);
      if (raw === null) break;
      cursor = rest;
      const seq = model.reader.raw2seq(raw, false);
      if (seq === null) {
        // Upstream: `if (seq == NULL) { rdr_freeraw(raw); return 0; }`.
        // The Java JNI layer then sees a null return and raises the
        // GrobidException below. We preserve the chain.
        return WapitiWrapper.failed();
      }
      const T = seq.len;
      const { out: yhat } = tagViterbi(model, seq);
      for (let t = 0; t < T; t++) {
        // Upstream `tag_label` emits `raw->lines[t]\t<label>\n` when
        // `!mdl->opt->label`. GROBID never sets `opt.label`, so we always
        // emit the input row.
        const lbl = lbls.id2str(yhat[t]!);
        out.push(raw.lines[t]! + "\t" + lbl);
        out.push("\n");
      }
      out.push("\n");
    }
    const result = out.join("");
    if (result === "") {
      // Mirrors the JNI failure path: null return -> GrobidException.
      return WapitiWrapper.failed();
    }
    return result;
  }

  /**
   * Mirrors `Wapiti.labelFromModel` returning null. Upstream:
   *   throw new GrobidException("Wapiti tagging failed (null data returned) - "
   *      + "Possibly mismatch between grobid-home and grobid-core",
   *      GrobidExceptionStatus.TAGGING_ERROR);
   */
  private static failed(): never {
    throw new GrobidException(
      "Wapiti tagging failed (null data returned) - Possibly mismatch between grobid-home and grobid-core",
      undefined,
      GrobidExceptionStatus.TAGGING_ERROR,
    );
  }

  /**
   * Port of `WapitiWrapper.getModel(File)` and `getModel(File, boolean)`.
   * In the C bridge this calls `Wapiti.loadModel("label ... -m <file>")`. In
   * the JS port we cannot return a SWIG pointer — instead we return the
   * parsed `MdlT`. Callers (notably the Java `WapitiModel` constructor) use
   * this path to populate their `model` field; the same access pattern is
   * preserved in `WapitiModel.loadModelFromBytes`.
   */
  static getModel(modelFile: string, _checkLabels: boolean = false): MdlT {
    // Defer the actual load to `WapitiModel.loadModelFromBytes` to keep the
    // file-format logic in one place. The `WapitiModel` import is resolved
    // lazily by ESM (the symbol is only read inside this function body), so
    // the static cycle with `wapiti-model.ts` is safe.
    const bytes = readFileSync(modelFile);
    return WapitiModel.loadModelFromBytes(bytes);
  }
}
