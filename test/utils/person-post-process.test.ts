// Unit tests for the author-name post-processor.
//
// We exercise the standalone module `person-name-normalizer.ts` directly so
// the test doesn't drag Person's transitive import graph (Affiliation →
// Lexicon → Utilities → BiblioItem → ...) along — that graph has a
// circular-static-init landmine that is unrelated to this work.

import { describe, it, expect } from "vitest";
import {
  cleanNameComponent,
  normalizePersonName,
  normalizePersonNames,
  probeHonorific,
  type PersonNameFields,
} from "../../src/grobid/data/person-name-normalizer.js";

/** Minimal stand-in for Person — just the four fields the normalizer touches. */
class FakePerson implements PersonNameFields {
  firstName: string | null = null;
  middleName: string | null = null;
  lastName: string | null = null;
  title: string | null = null;
  getFirstName() { return this.firstName; }
  getMiddleName() { return this.middleName; }
  getLastName() { return this.lastName; }
  getTitle() { return this.title; }
  setFirstName(v: string | null) { this.firstName = v; }
  setMiddleName(v: string | null) { this.middleName = v; }
  setLastName(v: string | null) { this.lastName = v; }
  setTitle(v: string | null) { this.title = v; }
}

function mk(fields: { first?: string; middle?: string; last?: string; title?: string }): FakePerson {
  const p = new FakePerson();
  if (fields.first !== undefined) p.firstName = fields.first;
  if (fields.middle !== undefined) p.middleName = fields.middle;
  if (fields.last !== undefined) p.lastName = fields.last;
  if (fields.title !== undefined) p.title = fields.title;
  return p;
}

describe("cleanNameComponent — honorifics", () => {
  it("strips leading 'Mr.'", () => {
    expect(cleanNameComponent("Mr. Loganathan")).toBe("Loganathan");
  });

  it("strips leading 'Dr.'", () => {
    expect(cleanNameComponent("Dr. Rakesh")).toBe("Rakesh");
  });

  it("strips leading 'Prof' without trailing dot", () => {
    expect(cleanNameComponent("Prof John")).toBe("John");
  });

  it("strips long-form 'Professor'", () => {
    expect(cleanNameComponent("Professor Marie")).toBe("Marie");
  });

  it("strips chained honorifics 'Prof. Dr.'", () => {
    expect(cleanNameComponent("Prof. Dr. Hans")).toBe("Hans");
  });

  it("does NOT strip trailing 'Jr.' from a surname", () => {
    expect(cleanNameComponent("King Jr.")).toBe("King Jr.");
  });

  it("strips leading 'Jr.' (treated as honorific at lead)", () => {
    expect(cleanNameComponent("Jr. King")).toBe("King");
  });
});

describe("cleanNameComponent — footnote markers", () => {
  it("strips trailing digit", () => {
    expect(cleanNameComponent("Pandit1")).toBe("Pandit");
  });

  it("strips trailing multi-digit", () => {
    expect(cleanNameComponent("Schmidt12")).toBe("Schmidt");
  });

  it("strips trailing asterisk", () => {
    expect(cleanNameComponent("Fehske*")).toBe("Fehske");
  });

  it("strips trailing dagger", () => {
    expect(cleanNameComponent("Kobayashi†")).toBe("Kobayashi");
  });

  it("strips trailing double-dagger", () => {
    expect(cleanNameComponent("Tanaka‡")).toBe("Tanaka");
  });

  it("strips trailing section sign", () => {
    expect(cleanNameComponent("Pandit§")).toBe("Pandit");
  });

  it("strips trailing paragraph mark", () => {
    expect(cleanNameComponent("Pandit¶")).toBe("Pandit");
  });

  it("strips trailing plus and hash", () => {
    expect(cleanNameComponent("Pandit+")).toBe("Pandit");
    expect(cleanNameComponent("Pandit#")).toBe("Pandit");
  });

  it("strips mixed marker run 'Collaborators* †'", () => {
    expect(cleanNameComponent("Collaborators* †")).toBe("Collaborators");
  });
});

describe("cleanNameComponent — compound names preserved", () => {
  it("preserves 'van der Waals'", () => {
    expect(cleanNameComponent("van der Waals")).toBe("van der Waals");
  });
  it("preserves 'García-Márquez'", () => {
    expect(cleanNameComponent("García-Márquez")).toBe("García-Márquez");
  });
  it("preserves O'Brien", () => {
    expect(cleanNameComponent("O'Brien")).toBe("O'Brien");
  });
  it("preserves 'Müller-Lyer'", () => {
    expect(cleanNameComponent("Müller-Lyer")).toBe("Müller-Lyer");
  });
  it("preserves CJK '李 明'", () => {
    expect(cleanNameComponent("李 明")).toBe("李 明");
  });
  it("preserves compound + marker  'García-Márquez1' → 'García-Márquez'", () => {
    expect(cleanNameComponent("García-Márquez1")).toBe("García-Márquez");
  });
  it("preserves Cyrillic surname", () => {
    expect(cleanNameComponent("Кобылянський")).toBe("Кобылянський");
  });
});

describe("cleanNameComponent — degenerate", () => {
  it("returns null for null", () => {
    expect(cleanNameComponent(null)).toBeNull();
  });
  it("returns null when component reduces to nothing", () => {
    expect(cleanNameComponent("*")).toBeNull();
    expect(cleanNameComponent("Mr.")).toBeNull();
  });
  it("trims surrounding whitespace and stray punctuation", () => {
    expect(cleanNameComponent(" John ")).toBe("John");
    expect(cleanNameComponent(" Smith , ")).toBe("Smith");
  });
  it("collapses internal whitespace", () => {
    expect(cleanNameComponent("van  der  Waals")).toBe("van der Waals");
  });
});

describe("cleanNameComponent — idempotence", () => {
  it("two passes equals one (honorific + marker)", () => {
    const once = cleanNameComponent("Dr. Smith*");
    const twice = cleanNameComponent(once);
    expect(twice).toBe(once);
  });
  it("two passes equals one (compound)", () => {
    const once = cleanNameComponent("van der Waals*");
    const twice = cleanNameComponent(once);
    expect(twice).toBe(once);
    expect(once).toBe("van der Waals");
  });
});

describe("probeHonorific", () => {
  it("detects 'Dr.'", () => {
    expect(probeHonorific("Dr. Rakesh")).toBe("Dr.");
  });
  it("detects 'Prof'", () => {
    expect(probeHonorific("Prof John")).toBe("Prof");
  });
  it("returns null when no honorific present", () => {
    expect(probeHonorific("John")).toBeNull();
  });
  it("returns null for null", () => {
    expect(probeHonorific(null)).toBeNull();
  });
});

describe("normalizePersonName — Person-level", () => {
  it("strips 'Mr.' from firstName and stashes it in title", () => {
    const p = mk({ first: "Mr. Loganathan", last: "R" });
    normalizePersonName(p);
    expect(p.firstName).toBe("Loganathan");
    expect(p.lastName).toBe("R");
    expect(p.title).toBe("Mr.");
  });

  it("strips 'Dr.' from firstName", () => {
    const p = mk({ first: "Dr. Rakesh", last: "Pandit" });
    normalizePersonName(p);
    expect(p.firstName).toBe("Rakesh");
    expect(p.lastName).toBe("Pandit");
    expect(p.title).toBe("Dr.");
  });

  it("strips trailing digit from surname (Pandit1)", () => {
    const p = mk({ first: "Atharv", last: "Pandit1" });
    normalizePersonName(p);
    expect(p.firstName).toBe("Atharv");
    expect(p.lastName).toBe("Pandit");
  });

  it("strips trailing asterisk from surname (Fehske*)", () => {
    const p = mk({ first: "Holger", last: "Fehske*" });
    normalizePersonName(p);
    expect(p.lastName).toBe("Fehske");
  });

  it("strips trailing dagger from surname (Kobayashi†)", () => {
    const p = mk({ first: "Soichiro", last: "Kobayashi†" });
    normalizePersonName(p);
    expect(p.lastName).toBe("Kobayashi");
  });

  it("preserves an existing title rather than overwriting", () => {
    const p = mk({ first: "Dr. Foo", last: "Bar", title: "Sir" });
    normalizePersonName(p);
    expect(p.title).toBe("Sir");
    expect(p.firstName).toBe("Foo");
  });

  it("handles all-null fields", () => {
    const p = new FakePerson();
    expect(() => normalizePersonName(p)).not.toThrow();
    expect(p.firstName).toBeNull();
    expect(p.lastName).toBeNull();
  });

  it("is idempotent", () => {
    const p = mk({ first: "Dr. Rakesh", last: "Pandit1" });
    normalizePersonName(p);
    const f1 = p.firstName;
    const l1 = p.lastName;
    const t1 = p.title;
    normalizePersonName(p);
    expect(p.firstName).toBe(f1);
    expect(p.lastName).toBe(l1);
    expect(p.title).toBe(t1);
  });
});

describe("normalizePersonNames — list helper", () => {
  it("applies to each entry", () => {
    const persons = [
      mk({ first: "Atharv", last: "Pandit1" }),
      mk({ first: "Dr. Rakesh", last: "Pandit" }),
    ];
    normalizePersonNames(persons);
    expect(persons[0]!.lastName).toBe("Pandit");
    expect(persons[1]!.firstName).toBe("Rakesh");
    expect(persons[1]!.title).toBe("Dr.");
  });

  it("returns null unchanged", () => {
    expect(normalizePersonNames(null)).toBeNull();
  });
});
