// Port of org.grobid.core.utilities.DataSetContextExtractor.
// Upstream: grobid-core/src/main/java/org/grobid/core/utilities/DataSetContextExtractor.java
//
// Extracting citation callout.
//
// PORTING NOTES:
//   - Guava's `Multimap<K, V>` is replaced by `Map<K, V[]>` with explicit append.
//     The ListMultimap MultimapBuilder.treeKeys().linkedListValues() means keys
//     are TreeMap-ordered (natural order) and values are insertion-ordered
//     LinkedLists. The TS port uses a Map<string, DataSetContext[]> and sorts
//     the keys on demand when consumers iterate (handled by the caller).
//   - Saxon `SequenceIterator` is replaced by the JS `Iterable<unknown>`
//     returned by XQueryProcessor.
//   - XQuery resource files: upstream loads `/xq/get-*-context-from-tei.xq`
//     via `Class.getResourceAsStream` once in a static initializer.
//     `XQueryProcessor.getQueryFromResources(name)` is the JS equivalent.
//     The static initializer is collapsed into a lazy getter pattern: the
//     four query strings are computed on first access.

import { DataSetContext } from "../data/data-set-context.js";
import { XQueryProcessor } from "./x-query-processor.js";

/**
 * Saxon `Item` interface (subset). Each query result element exposes a
 * `getStringValue()` returning the underlying string content.
 */
interface SaxonItem {
  getStringValue(): string;
}

/**
 * Saxon `SequenceIterator` (subset). The JS adapter must return an object
 * whose `next()` yields either the next `SaxonItem` or `null` at the end.
 */
interface SaxonSequenceIterator {
  next(): SaxonItem | null;
}

/**
 * Adapter: convert the `Iterable<unknown>` returned by `XQueryProcessor` into
 * a Saxon-style `next()` iterator. Each yielded value must support
 * `getStringValue(): string` (the saxon-js adapter is responsible for
 * wrapping its nodes accordingly).
 */
function toSequenceIterator(iter: Iterable<unknown>): SaxonSequenceIterator {
  const it = iter[Symbol.iterator]();
  return {
    next(): SaxonItem | null {
      const r = it.next();
      if (r.done) return null;
      const v = r.value as SaxonItem;
      if (v === null || v === undefined) return null;
      return v;
    },
  };
}

export class DataSetContextExtractor {
  static readonly REF_PATTERN: RegExp = /<ref>([\s\S]*)<\/ref>/;
  static readonly CUT_DEFAULT_LENGTH = 50;

  // Upstream uses a `static {}` initializer to read 4 XQuery files from
  // `/xq/` on the classpath. Module init in TS happens on first import; we
  // keep the eager-load semantics by caching after the first call.
  private static _CONTEXT_EXTRACTION_BIB_XQ: string | null = null;
  private static _CONTEXT_EXTRACTION_FORMULA_XQ: string | null = null;
  private static _CONTEXT_EXTRACTION_FIGURE_XQ: string | null = null;
  private static _CONTEXT_EXTRACTION_TABLE_XQ: string | null = null;

  private static getContextExtractionBibXq(): string {
    if (DataSetContextExtractor._CONTEXT_EXTRACTION_BIB_XQ === null) {
      try {
        DataSetContextExtractor._CONTEXT_EXTRACTION_BIB_XQ = XQueryProcessor.getQueryFromResources(
          "get-citation-context-from-tei.xq",
        );
      } catch (e) {
        throw new Error(String(e));
      }
    }
    return DataSetContextExtractor._CONTEXT_EXTRACTION_BIB_XQ;
  }

  private static getContextExtractionFormulaXq(): string {
    if (DataSetContextExtractor._CONTEXT_EXTRACTION_FORMULA_XQ === null) {
      try {
        DataSetContextExtractor._CONTEXT_EXTRACTION_FORMULA_XQ = XQueryProcessor.getQueryFromResources(
          "get-formula-context-from-tei.xq",
        );
      } catch (e) {
        throw new Error(String(e));
      }
    }
    return DataSetContextExtractor._CONTEXT_EXTRACTION_FORMULA_XQ;
  }

  private static getContextExtractionFigureXq(): string {
    if (DataSetContextExtractor._CONTEXT_EXTRACTION_FIGURE_XQ === null) {
      try {
        DataSetContextExtractor._CONTEXT_EXTRACTION_FIGURE_XQ = XQueryProcessor.getQueryFromResources(
          "get-figure-context-from-tei.xq",
        );
      } catch (e) {
        throw new Error(String(e));
      }
    }
    return DataSetContextExtractor._CONTEXT_EXTRACTION_FIGURE_XQ;
  }

  private static getContextExtractionTableXq(): string {
    if (DataSetContextExtractor._CONTEXT_EXTRACTION_TABLE_XQ === null) {
      try {
        DataSetContextExtractor._CONTEXT_EXTRACTION_TABLE_XQ = XQueryProcessor.getQueryFromResources(
          "get-table-context-from-tei.xq",
        );
      } catch (e) {
        throw new Error(String(e));
      }
    }
    return DataSetContextExtractor._CONTEXT_EXTRACTION_TABLE_XQ;
  }

  /**
   * Create a treekey'd ListMultimap. The TS port uses Map<string, V[]>;
   * callers iterate keys in sorted order via `[...map.keys()].sort()`.
   */
  static multimap<V>(): Map<string, V[]> {
    return new Map<string, V[]>();
  }

  /**
   * Helper: append to the Map<K, V[]> while preserving insertion order of
   * values (mimics LinkedList semantics).
   */
  private static _put<V>(map: Map<string, V[]>, key: string, value: V): void {
    const bucket = map.get(key);
    if (bucket === undefined) {
      map.set(key, [value]);
    } else {
      bucket.push(value);
    }
  }

  static cutContextSimple(cont: string): string {
    const m = DataSetContextExtractor.REF_PATTERN.exec(cont);
    if (m !== null) {
      const g = m[1]!;
      const index = m.index;
      return cont.substring(
        Math.max(0, index - DataSetContextExtractor.CUT_DEFAULT_LENGTH),
        Math.min(cont.length, index + g.length + DataSetContextExtractor.CUT_DEFAULT_LENGTH),
      );
    } else {
      throw new Error("Implementation error: no <ref> found in" + cont);
    }
  }

  static getCitationReferences(tei: string): Map<string, DataSetContext[]> {
    const xQueryProcessor = new XQueryProcessor(tei);

    const it = toSequenceIterator(
      xQueryProcessor.getSequenceIterator(DataSetContextExtractor.getContextExtractionBibXq()),
    );

    let item: SaxonItem | null;
    const contexts: Map<string, DataSetContext[]> = DataSetContextExtractor.multimap<DataSetContext>();

    while ((item = it.next()) !== null) {
      const val = item.getStringValue();
      const citationTeiId = it.next()!.getStringValue();
      const sectionName = it.next()!.getStringValue();
      const pos = Number.parseFloat(it.next()!.getStringValue());
      const coords = it.next()!.getStringValue();
      // Upstream tracks `sectionName` and `pos` only to consume the columns
      // returned by the XQuery; the values are not stored on the context.
      void sectionName;
      void pos;

      const pcc = new DataSetContext();
      const context = DataSetContextExtractor.cutContextSimple(val);

      pcc.setContext(DataSetContextExtractor.extractContextSentence(context));
      pcc.setDocumentCoords(coords);
      pcc.setTeiId(citationTeiId);

      DataSetContextExtractor._put(contexts, citationTeiId, pcc);
    }
    return contexts;
  }

  private static extractContextSentence(cont: string): string {
    const m = DataSetContextExtractor.REF_PATTERN.exec(cont);
    if (m !== null) {
      const g = m[1]!;
      // Java's Matcher.quoteReplacement escapes `\` and `$`; mirror that for the
      // JS String.replace replacement string semantics ($ groups).
      const safeG = g.replace(/\$/g, "$$$$");
      return cont.replace(new RegExp(DataSetContextExtractor.REF_PATTERN.source, "g"), safeG);
    } else {
      throw new Error("Implementation error: no <ref> found in" + cont);
    }
  }

  static getFormulaReferences(tei: string): Map<string, DataSetContext[]> {
    const xQueryProcessor = new XQueryProcessor(tei);

    const it = toSequenceIterator(
      xQueryProcessor.getSequenceIterator(DataSetContextExtractor.getContextExtractionFormulaXq()),
    );

    let item: SaxonItem | null;
    const contexts: Map<string, DataSetContext[]> = DataSetContextExtractor.multimap<DataSetContext>();

    while ((item = it.next()) !== null) {
      const val = item.getStringValue();
      const formulaTeiId = it.next()!.getStringValue();
      const sectionName = it.next()!.getStringValue();
      const pos = Number.parseFloat(it.next()!.getStringValue());
      const coords = it.next()!.getStringValue();
      void sectionName;
      void pos;

      const pcc = new DataSetContext();
      const context = DataSetContextExtractor.cutContextSimple(val);

      pcc.setContext(DataSetContextExtractor.extractContextSentence(context));
      pcc.setDocumentCoords(coords);
      pcc.setTeiId(formulaTeiId);

      DataSetContextExtractor._put(contexts, formulaTeiId, pcc);
    }
    return contexts;
  }

  static getFigureReferences(tei: string): Map<string, DataSetContext[]> {
    const xQueryProcessor = new XQueryProcessor(tei);

    const it = toSequenceIterator(
      xQueryProcessor.getSequenceIterator(DataSetContextExtractor.getContextExtractionFigureXq()),
    );

    let item: SaxonItem | null;
    const contexts: Map<string, DataSetContext[]> = DataSetContextExtractor.multimap<DataSetContext>();

    while ((item = it.next()) !== null) {
      const val = item.getStringValue();
      const figureTeiId = it.next()!.getStringValue();
      const sectionName = it.next()!.getStringValue();
      const pos = Number.parseFloat(it.next()!.getStringValue());
      const coords = it.next()!.getStringValue();
      void sectionName;
      void pos;

      const pcc = new DataSetContext();
      const context = DataSetContextExtractor.cutContextSimple(val);

      pcc.setContext(DataSetContextExtractor.extractContextSentence(context));
      pcc.setDocumentCoords(coords);
      pcc.setTeiId(figureTeiId);

      DataSetContextExtractor._put(contexts, figureTeiId, pcc);
    }
    return contexts;
  }

  static getTableReferences(tei: string): Map<string, DataSetContext[]> {
    const xQueryProcessor = new XQueryProcessor(tei);

    const it = toSequenceIterator(
      xQueryProcessor.getSequenceIterator(DataSetContextExtractor.getContextExtractionTableXq()),
    );

    let item: SaxonItem | null;
    const contexts: Map<string, DataSetContext[]> = DataSetContextExtractor.multimap<DataSetContext>();

    while ((item = it.next()) !== null) {
      const val = item.getStringValue();
      const tableTeiId = it.next()!.getStringValue();
      const sectionName = it.next()!.getStringValue();
      const pos = Number.parseFloat(it.next()!.getStringValue());
      const coords = it.next()!.getStringValue();
      void sectionName;
      void pos;

      const pcc = new DataSetContext();
      const context = DataSetContextExtractor.cutContextSimple(val);

      pcc.setContext(DataSetContextExtractor.extractContextSentence(context));
      pcc.setDocumentCoords(coords);
      pcc.setTeiId(tableTeiId);

      DataSetContextExtractor._put(contexts, tableTeiId, pcc);
    }
    return contexts;
  }
}
