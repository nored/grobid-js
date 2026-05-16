// Port of org.grobid.core.data.CopyrightsLicense.
// Upstream: grobid-core/src/main/java/org/grobid/core/data/CopyrightsLicense.java

/**
 * Class for representing information related to copyrights owner and file license.
 */

/** Inner enum CopyrightsOwner, hoisted to a top-level export. */
export enum CopyrightsOwner {
  PUBLISHER = "publisher",
  AUTHORS = "authors",
  UNDECIDED = "undecided",
}

export namespace CopyrightsOwner {
  export function getName(o: CopyrightsOwner): string {
    return o;
  }
}

/** Inner enum License, hoisted to a top-level export. */
export enum License {
  CC0 = "CC-0",
  CCBY = "CC-BY",
  CCBYNC = "CC-BY-NC",
  CCBYNCND = "CC-BY-NC-ND",
  CCBYSA = "CC-BY-SA",
  CCBYNCSA = "CC-BY-NC-SA",
  CCBYND = "CC-BY-ND",
  COPYRIGHT = "strict-copyrights",
  OTHER = "other",
  UNDECIDED = "undecided",
}

export namespace License {
  export function getName(l: License): string {
    return l;
  }
}

export class CopyrightsLicense {
  // Re-expose the nested enums as static members so callers can use
  // CopyrightsLicense.CopyrightsOwner.PUBLISHER like in upstream.
  static readonly CopyrightsOwner = CopyrightsOwner;
  static readonly License = License;

  static copyrightOwners: string[] = ["publisher", "authors", "undecided"];

  static licenses: string[] = [
    "CC-0",
    "CC-BY",
    "CC-BY-NC",
    "CC-BY-NC-ND",
    "CC-BY-SA",
    "CC-BY-NC-SA",
    "CC-BY-ND",
    "copyright",
    "other",
    "undecided",
  ];

  private copyrightsOwner!: CopyrightsOwner;
  private copyrightsOwnerProb!: number;
  private license!: License;
  private licenseProb!: number;

  getCopyrightsOwner(): CopyrightsOwner {
    return this.copyrightsOwner;
  }

  setCopyrightsOwner(owner: CopyrightsOwner): void {
    this.copyrightsOwner = owner;
  }

  getCopyrightsOwnerProb(): number {
    return this.copyrightsOwnerProb;
  }

  setCopyrightsOwnerProb(prob: number): void {
    this.copyrightsOwnerProb = prob;
  }

  getLicense(): License {
    return this.license;
  }

  setLicense(license: License): void {
    this.license = license;
  }

  getLicenseProb(): number {
    return this.licenseProb;
  }

  setLicenseProb(prob: number): void {
    this.licenseProb = prob;
  }
}
