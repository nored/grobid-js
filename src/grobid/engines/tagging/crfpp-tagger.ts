// Port of org.grobid.core.engines.tagging.CRFPPTagger.
// Upstream: grobid-core/src/main/java/org/grobid/core/engines/tagging/CRFPPTagger.java
//
// Wraps the CRF++ tagger (org.chasen.crfpp.{Model,Tagger}) — used as one of
// the two CRF backends upstream. In the JS port the underlying CRF++
// implementation does not (yet) exist; `ModelMap.getModel(...)` returns
// whatever the JS CRF++ bridge will provide once that module is ported.
// This file mirrors upstream control flow exactly: feed rows, parse, then
// emit `x0\tx1\t...\ty` per token.

import { GrobidException } from "../../exceptions/grobid-exception.js";
import { GrobidExceptionStatus } from "../../exceptions/grobid-exception-status.js";
import { getLogger } from "../../utilities/logger.js";
import type { GenericTagger } from "./generic-tagger.js";
import type { GrobidModel } from "../../grobid-model.js";
import { ModelMap } from "../model-map.js";

/**
 * Surface of the CRF++ `Tagger` object used by upstream. The actual JS
 * implementation is supplied by `ModelMap.getModel(...).createTagger()`
 * once the CRF++/WASM bridge is in place.
 */
interface CrfppTagger {
  size(): number;
  xsize(): number;
  x(i: number, j: number): string;
  y2(i: number): string;
  clear(): void;
  parse(): boolean;
  what(): string;
  add(piece: string): boolean;
  delete(): void;
}

/** Surface of CRF++ `Model`. */
interface CrfppModel {
  createTagger(): CrfppTagger;
}

export class CRFPPTagger implements GenericTagger {
  static readonly LOGGER = getLogger("CRFPPTagger");
  private readonly model: CrfppModel;

  constructor(model: GrobidModel) {
    this.model = ModelMap.getModel(model) as CrfppModel;
  }

  label(data: Iterable<string>): Promise<string>;
  label(data: string): Promise<string>;
  label(data: Iterable<string> | string): Promise<string> {
    if (typeof data === "string") {
      // Upstream: `Splitter.on("\n").split(data)`. JS String.split with a
      // string separator returns an array, which is iterable.
      return this.label(data.split("\n"));
    }
    return Promise.resolve(this.getTaggerResult(data, null));
  }

  protected getTaggerResult(st: Iterable<string>, type: string | null): string {
    let tagger: CrfppTagger | null = null;
    let res: string[];
    try {
      tagger = this.feedTaggerAndParse(st);

      res = [];
      const size = tagger.size();
      const xsize = tagger.xsize();
      for (let i = 0; i < size; i++) {
        for (let j = 0; j < xsize; j++) {
          res.push(tagger.x(i, j));
          res.push("\t");
        }

        if (type !== null) {
          res.push(type);
          res.push("\t");
        }

        res.push(tagger.y2(i));
        res.push("\n");
      }
    } finally {
      if (tagger !== null) {
        tagger.delete();
      }
    }

    return res.join("");
  }

  close(): void {
    // no-op (matches upstream)
  }

  private feedTaggerAndParse(st: Iterable<string>): CrfppTagger {
    const tagger = this.getNewTagger();
    CRFPPTagger.feedTaggerAndParse(tagger, st);
    return tagger;
  }

  getNewTagger(): CrfppTagger {
    return this.model.createTagger();
  }

  static feedTaggerAndParse(tagger: CrfppTagger, st: Iterable<string>): void {
    tagger.clear();
    CRFPPTagger.feedTagger(tagger, st);
    if (!tagger.parse()) {
      throw new GrobidException("CRF++ tagging failed!", undefined, GrobidExceptionStatus.TAGGING_ERROR);
    }

    if (tagger.what().length !== 0) {
      CRFPPTagger.LOGGER.warn("CRF++ Tagger Warnings: " + tagger.what());
    }
  }

  private static feedTagger(tagger: CrfppTagger, st: Iterable<string>): void {
    for (const piece of st) {
      if (piece.trim().length === 0) {
        continue;
      }
      if (!tagger.add(piece)) {
        CRFPPTagger.LOGGER.warn("CRF++ Tagger Warnings: " + tagger.what());
        throw new GrobidException(
          "Cannot add a feature row: " + piece + "\n Reason: " + tagger.what(),
        );
      }
    }
  }
}
