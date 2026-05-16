// Port of org.grobid.core.data.ChemicalEntity.
// Upstream: grobid-core/src/main/java/org/grobid/core/data/ChemicalEntity.java

import { OffsetPosition } from "../utilities/offset-position.js";

/**
 * Class for managing chemical entities.
 */
export class ChemicalEntity {
  // attribute
  rawName: string | null = null;
  inchi: string | null = null;
  smiles: string | null = null;

  offsets: OffsetPosition;

  constructor(raw?: string) {
    this.offsets = new OffsetPosition();
    if (raw !== undefined) {
      this.rawName = raw;
    }
  }

  getRawName(): string | null {
    return this.rawName;
  }

  getInchi(): string | null {
    return this.inchi;
  }

  getSmiles(): string | null {
    return this.smiles;
  }

  setRawName(raw: string | null): void {
    this.rawName = raw;
  }

  setInchi(inchi: string | null): void {
    this.inchi = inchi;
  }

  setSmiles(smiles: string | null): void {
    this.smiles = smiles;
  }

  setOffsetStart(start: number): void {
    this.offsets.start = start;
  }

  getOffsetStart(): number {
    return this.offsets.start;
  }

  setOffsetEnd(end: number): void {
    this.offsets.end = end;
  }

  getOffsetEnd(): number {
    return this.offsets.end;
  }

  toString(): string {
    // Mirrors upstream: rawName + "\t" + inchi + "\t" + smiles + "\t" + offsets.toString()
    return `${this.rawName}\t${this.inchi}\t${this.smiles}\t${this.offsets.toString()}`;
  }

  // TODO: CML encoding
}
