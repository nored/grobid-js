// Port of org.grobid.core.utilities.BoundingBoxCalculator.
// Upstream: grobid-core/src/main/java/org/grobid/core/utilities/BoundingBoxCalculator.java

import { BoundingBox } from "../layout/bounding-box.js";
import type { LayoutToken } from "../layout/layout-token.js";

const EPS_X = 15;
const EPS_Y = 4;

/**
 * `LayoutTokensUtil.noCoords` is defined in the sibling module; we inline
 * it here to avoid the cycle.
 */
function noCoords(t: LayoutToken): boolean {
  return t.getPage() === -1 || t.getWidth() <= 0;
}

export class BoundingBoxCalculator {
  static calculateOneBox(tokens: Iterable<LayoutToken> | null, ignoreDifferentPageTokens = false): BoundingBox | null {
    if (tokens === null) return null;
    let b: BoundingBox | null = null;
    for (const t of tokens) {
      if (noCoords(t)) continue;
      const tBox = BoundingBox.fromLayoutToken(t);
      if (b === null) {
        b = tBox;
      } else if (ignoreDifferentPageTokens) {
        b = b.boundBoxExcludingAnotherPage(tBox);
      } else {
        b = b.boundBox(tBox);
      }
    }
    return b;
  }

  static calculate(tokens: LayoutToken[] | null): BoundingBox[] {
    const result: BoundingBox[] = [];
    if (tokens === null) return result;
    const filtered = tokens.filter(
      (t) => !(Math.abs(t.getWidth()) <= Number.MIN_VALUE || Math.abs(t.getHeight()) <= Number.MIN_VALUE),
    );
    if (filtered.length === 0) return result;
    const firstBox = BoundingBox.fromLayoutToken(filtered[0]!);
    result.push(firstBox);
    let lastBox = firstBox;
    for (let i = 1; i < filtered.length; i++) {
      const b = BoundingBox.fromLayoutToken(filtered[i]!);
      if (Math.abs(b.getWidth()) <= Number.MIN_VALUE || Math.abs(b.getHeight()) <= Number.MIN_VALUE) continue;
      if (BoundingBoxCalculator.near(lastBox, b)) {
        result[result.length - 1] = result[result.length - 1]!.boundBox(b);
      } else {
        result.push(b);
      }
      lastBox = b;
    }
    return result;
  }

  /** Same page, similar Y, b2 follows b1 on X within EPS_X of b1's right edge. */
  private static near(b1: BoundingBox, b2: BoundingBox): boolean {
    return (
      b1.getPage() === b2.getPage() &&
      Math.abs(b1.getY() - b2.getY()) < EPS_Y &&
      Math.abs(b1.getY2() - b2.getY2()) < EPS_Y &&
      b2.getX() - b1.getX2() < EPS_X &&
      b2.getX() >= b1.getX()
    );
  }
}
