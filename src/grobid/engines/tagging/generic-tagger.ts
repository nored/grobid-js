// Port of org.grobid.core.engines.tagging.GenericTagger.
// Upstream: grobid-core/src/main/java/org/grobid/core/engines/tagging/GenericTagger.java
//
// Java extends `java.io.Closeable`; JS has no Closeable interface,
// so `close()` is declared directly on this interface. Implementations
// may throw, mirroring Java's `throws IOException`.
//
// DIVERGENCE FROM UPSTREAM: `label(...)` returns `Promise<string>`
// instead of `String` so that DL backends (onnxruntime-node is
// async-only) can plug in without forcing a synchronous bridge.
// Wapiti / CRFPP taggers are synchronous internally but return a
// resolved Promise to satisfy the interface — overhead is one
// microtask per call.

export interface GenericTagger {
  label(data: Iterable<string>): Promise<string>;
  label(data: string): Promise<string>;
  close(): void;
}
