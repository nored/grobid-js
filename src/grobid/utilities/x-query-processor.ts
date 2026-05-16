// Port of org.grobid.core.utilities.XQueryProcessor.
// Upstream: grobid-core/src/main/java/org/grobid/core/utilities/XQueryProcessor.java
//
// Upstream uses net.sf.saxon for in-process XQuery 1.0 evaluation. There is
// no comparable native JS engine in the standard library, so this class
// holds the XML content and exposes the API surface; the actual query
// evaluation is delegated to a pluggable engine.
//
// At the time of writing the only consumer of this class is
// `VectorGraphicBoxCalculator` (parsing pdfalto-emitted SVG fragments to
// compute vector-graphic bounding boxes). When that consumer is ported,
// either install a JS XQuery library (saxon-js) and wire it here, or
// replace those specific queries with hand-written XML walks.

import { readFileSync } from "node:fs";

/**
 * Pluggable XQuery engine. Set via `XQueryProcessor.setEngine(impl)` before
 * any consumer calls `getSequenceIterator`. The default engine throws.
 */
export interface XQueryEngine {
  evaluate(xmlContent: string, query: string): Iterable<unknown>;
}

let engine: XQueryEngine = {
  evaluate(): Iterable<unknown> {
    throw new Error(
      "XQueryProcessor: no XQuery engine installed. Call XQueryProcessor.setEngine(...) " +
        "to register one before evaluating queries.",
    );
  },
};

export class XQueryProcessor {
  private readonly xmlContent: string;

  /**
   * Load an XQuery from the `/xq/` classpath resource. In Java this looks
   * up the JAR-bundled resource; in the JS port the same files live in
   * `fixtures/xq/`. Callers must adapt the path.
   */
  static getQueryFromResources(name: string): string {
    // Best-effort: relative to repo `fixtures/xq/<name>`. Consumers that need
    // a different location should read the file themselves.
    return readFileSync(`fixtures/xq/${name}`, "utf-8");
  }

  /** Construct from either an XML file path or an in-memory XML string. */
  constructor(xmlOrFile: string, isFile: boolean = false) {
    this.xmlContent = isFile ? readFileSync(xmlOrFile, "utf-8") : xmlOrFile;
  }

  /** Install an XQuery evaluator (e.g. a saxon-js adapter). */
  static setEngine(impl: XQueryEngine): void {
    engine = impl;
  }

  /**
   * Run a query against the held XML content. Returns whatever the engine
   * yields — typically nodes or atomic values; consumers iterate.
   */
  getSequenceIterator(query: string): Iterable<unknown> {
    return engine.evaluate(this.xmlContent, query);
  }
}
