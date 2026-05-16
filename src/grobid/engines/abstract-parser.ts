// Port of org.grobid.core.engines.AbstractParser.
// Upstream: grobid-core/src/main/java/org/grobid/core/engines/AbstractParser.java
//
// Java implements `GenericTagger` (the sequence labelling interface) plus
// `java.io.Closeable`. The JS port keeps both surface methods (`label`,
// `close`) on the abstract base. The CRF / DL backend is resolved through
// the now-real `TaggerFactory`.

import { GrobidAnalyzer } from "../analyzers/grobid-analyzer.js";
import type { GrobidModel } from "../grobid-model.js";
import { getLogger } from "../utilities/logger.js";
import type { CntManager } from "../utilities/counters/cnt-manager.js";
import { CntManagerFactory } from "../utilities/counters/impl/cnt-manager-factory.js";
import type { GenericTagger } from "./tagging/generic-tagger.js";
import { TaggerFactory } from "./tagging/tagger-factory.js";
import type { GrobidCRFEngine } from "./tagging/grobid-crf-engine.js";

const LOGGER = getLogger("AbstractParser");

export abstract class AbstractParser implements GenericTagger {
  private genericTagger: GenericTagger;
  protected analyzer: GrobidAnalyzer = GrobidAnalyzer.getInstance();

  protected cntManager: CntManager = CntManagerFactory.getNoOpCntManager();

  protected constructor(model: GrobidModel);
  protected constructor(model: GrobidModel, cntManager: CntManager);
  protected constructor(model: GrobidModel, cntManager: CntManager, engine: GrobidCRFEngine);
  protected constructor(
    model: GrobidModel,
    cntManager: CntManager,
    engine: GrobidCRFEngine,
    architecture: string,
  );
  protected constructor(
    model: GrobidModel,
    cntManager?: CntManager,
    engine?: GrobidCRFEngine,
    architecture?: string,
  ) {
    if (cntManager === undefined) {
      this.cntManager = CntManagerFactory.getNoOpCntManager();
      this.genericTagger = TaggerFactory.getTagger(model);
      return;
    }
    this.cntManager = cntManager;
    if (engine === undefined) {
      this.genericTagger = TaggerFactory.getTagger(model);
    } else if (architecture === undefined) {
      this.genericTagger = TaggerFactory.getTagger(model, engine);
    } else {
      this.genericTagger = TaggerFactory.getTagger(model, engine, architecture);
    }
  }

  label(data: Iterable<string>): Promise<string>;
  label(data: string): Promise<string>;
  label(data: Iterable<string> | string): Promise<string> {
    if (typeof data === "string") {
      return this.genericTagger.label(data);
    }
    return this.genericTagger.label(data);
  }

  close(): void {
    try {
      this.genericTagger.close();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      LOGGER.warn("Cannot close the parser: " + msg);
      //no op
    }
  }
}
