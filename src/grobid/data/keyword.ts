// Port of org.grobid.core.data.Keyword.
// Upstream: grobid-core/src/main/java/org/grobid/core/data/Keyword.java
//
// Class for representing a keyword extracted from a publication.

import { TextUtilities } from "../utilities/text-utilities.js";

/**
 * Class for representing a keyword extracted from a publication.
 */
export class Keyword {
  private keyword: string | null = null;
  private type: string | null = null;

  // Upstream has two constructors:
  //   Keyword(String key)
  //   Keyword(String key, String typ)
  // Collapsed into a single signature.
  constructor(key: string | null, typ?: string | null) {
    this.keyword = key;
    if (typ !== undefined) {
      this.type = typ;
    }
  }

  getKeyword(): string | null {
    return this.keyword;
  }

  setKeyword(key: string | null): void {
    this.keyword = key;
  }

  getType(): string | null {
    return this.type;
  }

  setType(typ: string | null): void {
    this.type = typ;
  }

  notNull(): boolean {
    if (this.keyword === null)
      return false;
    else
      return true;
  }

  toString(): string {
    let res = "";
    if (this.keyword !== null)
      res += this.keyword + " ";
    if (this.type !== null) {
      res += " (type:" + this.type + ")";
    }
    return res.trim();
  }

  toTEI(): string | null {
    if (this.keyword === null) {
      return null;
    }
    const res = "<term>" + TextUtilities.HTMLEncode(this.keyword) + "</term>";
    return res;
  }
}
