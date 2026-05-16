// Port of org.grobid.core.tokenization.TaggingTokenClusteror.
// Upstream: grobid-core/src/main/java/org/grobid/core/tokenization/TaggingTokenClusteror.java
//
// Adaptations:
// - Guava `PeekingIterator` is replicated as a small wrapper class with the
//   same `hasNext`/`next`/`peek` API.
// - The `Predicate` inner classes are exposed as standalone classes with an
//   `apply(c)` method; `LabelTypeExcludePredicate` keeps the variadic-array
//   constructor via JS rest params.

import type { GrobidModel } from "../grobid-model.js";
import type { TaggingLabel } from "../engines/label/tagging-label.js";
import type { LayoutToken } from "../layout/layout-token.js";
import { LabeledTokensContainer } from "./labeled-tokens-container.js";
import { TaggingTokenCluster } from "./tagging-token-cluster.js";
import { TaggingTokenSynchronizer } from "./tagging-token-synchronizer.js";

/**
 * Cluster tokens by label
 */
export class TaggingTokenClusteror {
  private readonly taggingTokenSynchronizer: TaggingTokenSynchronizer;

  static LabelTypePredicate: typeof LabelTypePredicate;
  static LabelTypeExcludePredicate: typeof LabelTypeExcludePredicate;

  constructor(grobidModel: GrobidModel, result: string, tokenizations: LayoutToken[]);
  constructor(
    grobidModel: GrobidModel,
    result: string,
    tokenizations: LayoutToken[],
    computerFeatureBlock: boolean,
  );
  constructor(
    grobidModel: GrobidModel,
    result: string,
    tokenizations: LayoutToken[],
    computerFeatureBlock?: boolean,
  ) {
    if (computerFeatureBlock === undefined) {
      this.taggingTokenSynchronizer = new TaggingTokenSynchronizer(grobidModel, result, tokenizations);
    } else {
      this.taggingTokenSynchronizer = new TaggingTokenSynchronizer(
        grobidModel,
        result,
        tokenizations,
        computerFeatureBlock,
      );
    }
  }

  cluster(): TaggingTokenCluster[] {
    const result: TaggingTokenCluster[] = [];

    const it = new PeekingIterator<LabeledTokensContainer | null>(this.taggingTokenSynchronizer);
    if (!it.hasNext() || it.peek() === null) {
      return [];
    }

    // a boolean is introduced to indicate the start of the sequence in the case the label
    // has no beginning indicator (e.g. I-)
    let begin = true;
    let curCluster: TaggingTokenCluster = new TaggingTokenCluster(
      (it.peek() as LabeledTokensContainer).getTaggingLabel(),
    );
    while (it.hasNext()) {
      const cont = it.next();
      if (cont === null) {
        // this should not happen, but for the sake of paranoia, we skip
        continue;
      }
      if (begin || cont.isBeginning() || cont.getTaggingLabel() !== curCluster.getTaggingLabel()) {
        curCluster = new TaggingTokenCluster(cont.getTaggingLabel());
        result.push(curCluster);
      }
      curCluster.addLabeledTokensContainer(cont);
      if (begin) begin = false;
    }

    return result;
  }
}

export class LabelTypePredicate {
  private label: TaggingLabel;

  constructor(label: TaggingLabel) {
    this.label = label;
  }

  apply(taggingTokenCluster: TaggingTokenCluster): boolean {
    return taggingTokenCluster.getTaggingLabel() === this.label;
  }
}

export class LabelTypeExcludePredicate {
  private labels: TaggingLabel[];

  constructor(...labels: TaggingLabel[]) {
    this.labels = labels;
  }

  apply(taggingTokenCluster: TaggingTokenCluster): boolean {
    for (const label of this.labels) {
      if (taggingTokenCluster.getTaggingLabel() === label) {
        return false;
      }
    }
    return true;
  }
}

// Inner-class aliases preserved for upstream call sites.
TaggingTokenClusteror.LabelTypePredicate = LabelTypePredicate;
TaggingTokenClusteror.LabelTypeExcludePredicate = LabelTypeExcludePredicate;

/**
 * Replicates Guava's `PeekingIterator<T>` for a Java-style `Iterator` with
 * `hasNext()` / `next()` returning a JS `IteratorResult`. Mirrors:
 *   - peek():   look at the next element without advancing
 *   - next():   return the next element (advancing the cursor)
 *   - hasNext(): whether another element is available
 */
class PeekingIterator<T> {
  private source: Iterator<T>;
  private hasCached: boolean = false;
  private cached: T | null = null;
  private exhausted: boolean = false;

  constructor(source: Iterator<T>) {
    this.source = source;
  }

  private fill(): void {
    if (this.hasCached || this.exhausted) return;
    const r = this.source.next();
    if (r.done) {
      this.exhausted = true;
      return;
    }
    this.cached = r.value;
    this.hasCached = true;
  }

  hasNext(): boolean {
    this.fill();
    return this.hasCached;
  }

  peek(): T | null {
    this.fill();
    if (!this.hasCached) return null;
    return this.cached;
  }

  next(): T | null {
    this.fill();
    if (!this.hasCached) return null;
    const v = this.cached;
    this.hasCached = false;
    this.cached = null;
    return v;
  }
}
