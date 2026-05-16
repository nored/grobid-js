// Port of org.grobid.core.data.util.ClassicAuthorEmailAssigner.
// Upstream: grobid-core/src/main/java/org/grobid/core/data/util/ClassicAuthorEmailAssigner.java

import type { Person } from "../person.js";
import { TextUtilities } from "../../utilities/text-utilities.js";
import type { AuthorEmailAssigner } from "./author-email-assigner.js";

export class ClassicAuthorEmailAssigner implements AuthorEmailAssigner {
  assign(fullAuthors: Person[] | null, emails: string[]): void {
    const winners: number[] = [];

    // if 1 email and 1 author, not too hard...
    if (fullAuthors != null) {
      if (emails.length === 1 && fullAuthors.length === 1) {
        fullAuthors[0]!.setEmail(emails[0]!);
      } else {
        // we asociate emails to the authors based on string proximity
        for (const mail of emails) {
          let maxDist = 1000;
          let best = -1;
          const ind = mail.indexOf("@");
          if (ind !== -1) {
            const nam = mail.substring(0, ind).toLowerCase();
            let k = 0;
            for (const aut of fullAuthors) {
              const kk = k;
              if (!winners.includes(kk)) {
                const emailVariants = TextUtilities.generateEmailVariants(aut.getFirstName(), aut.getLastName());

                for (let variant of emailVariants) {
                  variant = variant.toLowerCase();

                  const dist = TextUtilities.getLevenshteinDistance(nam, variant);
                  if (dist < maxDist) {
                    best = k;
                    maxDist = dist;
                  }
                }
              }
              k++;
            }

            // make sure that the best candidate found is not too far
            // Java: nam.length() / 2 — integer division
            if (best !== -1 && maxDist < Math.floor(nam.length / 2)) {
              const winner = fullAuthors[best]!;
              winner.setEmail(mail);
              winners.push(best);
            }
          }
        }
      }
    }
  }
}
