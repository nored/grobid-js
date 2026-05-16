// Port of org.grobid.core.data.util.AuthorEmailAssigner.
// Upstream: grobid-core/src/main/java/org/grobid/core/data/util/AuthorEmailAssigner.java

import type { Person } from "../person.js";

/**
 * Strategy interface: embed emails into authors. Emails should be sanitized
 * before being passed in.
 */
export interface AuthorEmailAssigner {
  assign(authors: Person[] | null, emails: string[]): void;
}
