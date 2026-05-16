// Port of org.grobid.core.utilities.matching.LuceneIndexMatcher.
// Upstream: grobid-core/src/main/java/org/grobid/core/utilities/matching/LuceneIndexMatcher.java
//
// Upstream uses an in-memory Apache Lucene index (`RAMDirectory` +
// `BooleanQuery` of `TermQuery`s with `minimumNumberShouldMatch`). We
// reproduce that surface with a hand-rolled inverted index that supports the
// same `BooleanQuery SHOULD` + `minimumNumberShouldMatch` semantics (TF-IDF
// scoring is sufficient because we only sort top-k results, and the
// `mustMatchPercentage` filter does the actual selection).

import type { Analyzer } from "./lucene-util.js";
import { EntityMatcherException } from "./entity-matcher-exception.js";
import { LuceneUtil, StandardAnalyzer } from "./lucene-util.js";

/**
 * Caller-supplied projection from the indexed/searched entity to a string
 * used as the indexed/searched text. Mirrors `com.google.common.base.Function`.
 */
export interface MatcherFunction<I, O> {
  apply(input: I): O | null;
}

interface IndexedDoc<T> {
  id: number;
  entity: T;
  tokens: string[];
  termFreq: Map<string, number>;
  length: number;
}

export class LuceneIndexMatcher<T, V> {
  private analyzer: Analyzer = new StandardAnalyzer(); // ClassicAnalyzer(Version.LUCENE_45) in upstream
  private static readonly ID_LUCENE_FIELD_NAME: string = "idField";
  public static readonly INDEXED_LUCENE_FIELD_NAME: string = "indexedField";

  private readonly indexedFieldSelector: MatcherFunction<T, unknown>;
  private readonly searchedFieldSelector: MatcherFunction<V, unknown>;

  // In-memory inverted index: term -> list of doc ids containing it
  private docs: IndexedDoc<T>[] = [];
  private postings: Map<string, number[]> = new Map();

  private cache: Map<number, T> = new Map();
  private debug: boolean = false;

  // -- settings
  private mustMatchPercentage: number = 0.9;
  private maxResults: number = 10;
  // -- settings

  public constructor(
    indexedFieldSelector: MatcherFunction<T, unknown>,
    searchedFieldSelector: MatcherFunction<V, unknown>,
  ) {
    this.indexedFieldSelector = indexedFieldSelector;
    this.searchedFieldSelector = searchedFieldSelector;
    void LuceneIndexMatcher.ID_LUCENE_FIELD_NAME;
  }

  public load(entities: Iterable<T>): void {
    this.close();

    this.docs = [];
    this.postings = new Map();
    this.cache.clear();
    let idCounter = 0;

    try {
      for (const entity of entities) {
        const indexedFieldObj = this.getIndexedObject(entity);
        if (indexedFieldObj === null) {
          continue;
        }

        this.cache.set(idCounter, entity);
        const text = String(indexedFieldObj);
        const tokens = LuceneUtil.tokenizeString(this.analyzer, text);
        const termFreq = new Map<string, number>();
        for (const t of tokens) {
          termFreq.set(t, (termFreq.get(t) ?? 0) + 1);
        }
        const doc: IndexedDoc<T> = {
          id: idCounter,
          entity,
          tokens,
          termFreq,
          length: tokens.length,
        };
        this.docs.push(doc);
        for (const term of termFreq.keys()) {
          if (!this.postings.has(term)) this.postings.set(term, []);
          this.postings.get(term)!.push(idCounter);
        }
        if (this.debug) {
          // System.out.println("Doc added: " + doc);
          // eslint-disable-next-line no-console
          console.log("Doc added: ", text);
        }
        idCounter++;
      }
    } catch (e) {
      throw new EntityMatcherException(
        "Cannot build a lucene index: " + (e instanceof Error ? e.message : String(e)),
        e,
      );
    }
  }

  public match(entity: V): T[] {
    try {
      const queryObj = this.getSearchedObject(entity);
      if (queryObj === null) {
        return [];
      }
      const luceneTokens = LuceneUtil.tokenizeString(
        this.analyzer,
        String(queryObj),
      );
      if (luceneTokens.length === 0) {
        return [];
      }
      const minShouldMatch = Math.floor(luceneTokens.length * this.mustMatchPercentage);

      // Compute, for every candidate document, how many of the query terms
      // matched. Filter by minShouldMatch (mirrors BooleanQuery's
      // setMinimumNumberShouldMatch).
      const matchCount: Map<number, number> = new Map();
      const score: Map<number, number> = new Map();
      for (const term of luceneTokens) {
        const docIds = this.postings.get(term);
        if (docIds === undefined) continue;
        const idf = Math.log(1 + this.docs.length / (1 + docIds.length));
        for (const docId of docIds) {
          matchCount.set(docId, (matchCount.get(docId) ?? 0) + 1);
          const tf = this.docs[docId]!.termFreq.get(term) ?? 0;
          score.set(docId, (score.get(docId) ?? 0) + tf * idf);
        }
      }

      // Order by score descending and pick up to maxResults.
      const candidates: { id: number; s: number }[] = [];
      for (const [id, count] of matchCount.entries()) {
        if (count >= minShouldMatch) {
          candidates.push({ id, s: score.get(id) ?? 0 });
        }
      }
      candidates.sort((a, b) => b.s - a.s);
      const top = candidates.slice(0, this.maxResults);
      const result: T[] = [];
      for (const c of top) {
        result.push(this.cache.get(c.id)!);
      }

      if (this.debug) {
        // eslint-disable-next-line no-console
        console.log("query terms:", luceneTokens, "minShouldMatch:", minShouldMatch);
      }

      return result;
    } catch (e) {
      throw new EntityMatcherException(
        "Error searching lucene Index: " + (e instanceof Error ? e.message : String(e)),
        e,
      );
    }
  }

  private getSearchedObject(entity: V): unknown {
    return this.searchedFieldSelector.apply(entity);
  }

  private getIndexedObject(entity: T): unknown {
    return this.indexedFieldSelector.apply(entity);
  }

  public setMustMatchPercentage(mustMatchPercentage: number): LuceneIndexMatcher<T, V> {
    this.mustMatchPercentage = mustMatchPercentage;
    return this;
  }

  public setMaxResults(maxResults: number): LuceneIndexMatcher<T, V> {
    this.maxResults = maxResults;
    return this;
  }

  public setAnalyzer(analyzer: Analyzer): LuceneIndexMatcher<T, V> {
    this.analyzer = analyzer;
    return this;
  }

  public setDebug(debug: boolean): void {
    this.debug = debug;
  }

  public close(): void {
    // No persistent reader to close in this in-memory implementation.
    this.docs = [];
    this.postings = new Map();
  }
}
