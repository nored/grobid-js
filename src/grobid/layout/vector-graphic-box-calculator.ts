// Port of org.grobid.core.layout.VectorGraphicBoxCalculator.
// Upstream: grobid-core/src/main/java/org/grobid/core/layout/VectorGraphicBoxCalculator.java
//
// Calculates the bounding boxes of vector graphic objects on each page by
// clustering the individual VECTOR-typed `GraphicObject` instances (one per
// PDF path drawing primitive) into rectangles using a flood-fill / box-merge
// strategy. The result is one merged `VECTOR_BOX` per cluster, keyed by page
// number.
//
// Upstream is fully synchronous. We keep the same.

import { Page } from "./page.js";
import { BoundingBox } from "./bounding-box.js";
import { GraphicObject } from "./graphic-object.js";
import { GraphicObjectType } from "./graphic-object-type.js";
import type { Document } from "../document/document.js";

/**
 * Upstream: org.grobid.core.layout.VectorGraphicBoxCalculator
 *
 * Note: each `GraphicObject` argument should be a vector primitive (i.e.
 * `getType() == VECTOR`). The bitmap graphics are handled separately by
 * `Document.glueImagesIfNecessary`.
 */
export class VectorGraphicBoxCalculator {
  // Upstream: `public static final int MINIMUM_VECTOR_BOX_AREA = 3000;`
  static readonly MINIMUM_VECTOR_BOX_AREA: number = 3000;

  // Upstream: `public static final int VEC_GRAPHICS_NEAR_DISTANCE_THRESHOLD = 5;`
  static readonly VEC_GRAPHICS_NEAR_DISTANCE_THRESHOLD: number = 5;

  /**
   * Upstream signature:
   *   public static Multimap<Integer, GraphicObject> calculate(Document document)
   *       throws IOException, XPathException
   *
   * We return a plain `Map<number, GraphicObject[]>` because we don't depend
   * on Guava. The caller in `Document.java` iterates `.values()` over the
   * Guava multimap; we expose an equivalent `.values()` shape via a small
   * adapter compatible with the upstream call sites.
   */
  static calculate(document: Document): VectorBoxMultimap {
    // Upstream code groups vector boxes by page, merges nearby boxes, and
    // filters by minimum area. The fundamental algorithm is:
    //   1. Build a per-page list of bounding boxes from each VECTOR
    //      GraphicObject in the document.
    //   2. Constrain each box to its page's main area (if present).
    //   3. Iteratively merge boxes within VEC_GRAPHICS_NEAR_DISTANCE_THRESHOLD.
    //   4. Drop merged boxes below MINIMUM_VECTOR_BOX_AREA.
    //   5. Emit one VECTOR_BOX GraphicObject per remaining merged box.

    const result = new VectorBoxMultimap();

    const pages: Page[] | null = document.getPages();
    if (pages === null) {
      return result;
    }

    const images = document.getImages();
    if (images === null) {
      return result;
    }

    // Group vector boxes by page.
    const boxesPerPage = new Map<number, BoundingBox[]>();
    for (const go of images) {
      if (go.getType() !== GraphicObjectType.VECTOR) continue;
      const bb = go.getBoundingBox();
      if (bb === null) continue;
      const page = bb.getPage();
      let list = boxesPerPage.get(page);
      if (list === undefined) {
        list = [];
        boxesPerPage.set(page, list);
      }
      list.push(bb);
    }

    // For each page, clip to main area, merge nearby, filter by area.
    for (const [pageNum, boxes] of boxesPerPage) {
      let pageMainArea: BoundingBox | null = null;
      // Page numbers in PDFs are 1-based; pages list is 0-indexed.
      if (pageNum - 1 >= 0 && pageNum - 1 < pages.length) {
        pageMainArea = pages[pageNum - 1]!.getMainArea();
      }

      const clipped: BoundingBox[] = [];
      for (const b of boxes) {
        if (pageMainArea !== null) {
          // Constrain to main area when available.
          const inter = pageMainArea.boundingBoxIntersection(b);
          if (inter !== null) clipped.push(inter);
        } else {
          clipped.push(b);
        }
      }

      const merged = VectorGraphicBoxCalculator.mergeBoxes(clipped);
      for (const m of merged) {
        if (m.area() < VectorGraphicBoxCalculator.MINIMUM_VECTOR_BOX_AREA) continue;
        const go = new GraphicObject(m, GraphicObjectType.VECTOR_BOX);
        result.put(pageNum, go);
      }
    }

    return result;
  }

  /**
   * Iteratively merges boxes that are within
   * `VEC_GRAPHICS_NEAR_DISTANCE_THRESHOLD` of each other or that overlap.
   * Upstream returns a List<BoundingBox>. All boxes are expected to be on
   * the same page.
   */
  static mergeBoxes(input: BoundingBox[]): BoundingBox[] {
    // Defensive: copy so we can mutate.
    const boxes: (BoundingBox | null)[] = input.slice();

    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < boxes.length; i++) {
        const a = boxes[i];
        if (a === null || a === undefined) continue;
        for (let j = i + 1; j < boxes.length; j++) {
          const b = boxes[j];
          if (b === null || b === undefined) continue;
          if (
            a.intersect(b) ||
            a.distanceTo(b) < VectorGraphicBoxCalculator.VEC_GRAPHICS_NEAR_DISTANCE_THRESHOLD
          ) {
            // Merge a and b. boundBox throws if pages differ — but mergeBoxes
            // is only ever called with same-page boxes (see calculate).
            boxes[i] = a.boundBox(b);
            boxes[j] = null;
            changed = true;
          }
        }
      }
    }

    const out: BoundingBox[] = [];
    for (const b of boxes) {
      if (b !== null && b !== undefined) out.push(b);
    }
    return out;
  }
}

/**
 * Minimal `Multimap<Integer, GraphicObject>` shim — exposes `.values()`,
 * `.keySet()`, `.put()`, `.get()` matching Guava semantics used by the rest
 * of the codebase (see Document.processAndCalculatePageMainAreas).
 */
export class VectorBoxMultimap {
  private readonly map: Map<number, GraphicObject[]> = new Map();

  put(key: number, value: GraphicObject): void {
    let list = this.map.get(key);
    if (list === undefined) {
      list = [];
      this.map.set(key, list);
    }
    list.push(value);
  }

  get(key: number): GraphicObject[] {
    return this.map.get(key) ?? [];
  }

  keySet(): Set<number> {
    return new Set(this.map.keys());
  }

  values(): GraphicObject[] {
    const out: GraphicObject[] = [];
    for (const list of this.map.values()) {
      for (const v of list) out.push(v);
    }
    return out;
  }

  size(): number {
    let total = 0;
    for (const list of this.map.values()) total += list.length;
    return total;
  }
}
