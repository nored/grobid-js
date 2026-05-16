// Port of org.grobid.core.utilities.crossref.CrossrefDeserializer.
// Upstream: grobid-core/src/main/java/org/grobid/core/utilities/crossref/CrossrefDeserializer.java
//
// Abstract deserializer to parse json response from crossref. Normalize
// results to a list of objects even if only one result is given.

/** Loose alias for a JSON value (object/array/primitive). */
export type JsonNode = unknown;

export abstract class CrossrefDeserializer<T> {
  public constructor() {
    // upstream wires Jackson's ObjectMapper + SimpleModule, irrelevant for our pure-JS parser
  }

  /**
   * Describe how to deserialize one json item from response
   */
  protected abstract deserializeOneItem(item: JsonNode): T | null;

  /**
   * Parse a json String, usually the response body. Give back a list of objects.
   */
  public parse(body: string): T[] {
    const tree = JSON.parse(body) as JsonNode;
    return this.deserializeTree(tree);
  }

  /**
   * Normalize results to get always an object list even if you fetch only one object.
   */
  protected normalizeResults(treeNode: JsonNode): JsonNode[] {
    const t = treeNode as Record<string, unknown> | null;
    const messageNode =
      t !== null && typeof t === "object" ? (t as Record<string, unknown>)["message"] : undefined;
    let results: JsonNode[] | null = null;

    if (
      messageNode === undefined ||
      messageNode === null ||
      typeof messageNode !== "object" ||
      Array.isArray(messageNode)
    ) {
      //throw new ClientProtocolException("No message found in json result.");
      // glutton
      results = [];
      results.push(treeNode);
    } else {
      const message = messageNode as Record<string, unknown>;
      const itemsNode = message["items"];

      if (itemsNode === undefined || itemsNode === null || !Array.isArray(itemsNode)) {
        results = [];
        results.push(message);
      } else {
        results = itemsNode as JsonNode[];
      }
    }

    return results;
  }

  /** Equivalent to Jackson's `deserialize(JsonParser, DeserializationContext)`. */
  public deserializeTree(treeNode: JsonNode): T[] {
    const res: T[] = [];
    const items = this.normalizeResults(treeNode);
    for (const item of items) {
      const one = this.deserializeOneItem(item);
      if (one !== null && one !== undefined) {
        res.push(one);
      }
    }
    return res;
  }
}
