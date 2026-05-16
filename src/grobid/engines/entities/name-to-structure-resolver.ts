// Port of org.grobid.core.engines.entities.NameToStructureResolver.
// Upstream: grobid-core/src/main/java/org/grobid/core/engines/entities/NameToStructureResolver.java

import { ChemicalEntity } from "../../data/chemical-entity.js";

/**
 * Chemical name-to-structure processing based on external Open Source libraries.
 *
 */
export class NameToStructureResolver {
  static process(name: string): ChemicalEntity {
    const result = new ChemicalEntity(name);
    //
    return result;
  }

  static depict(_structure: ChemicalEntity, _path: string): void {
    // upstream is intentionally empty
  }
}
