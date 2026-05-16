// Port of org.grobid.core.utilities.SHA1.
// Upstream: grobid-core/src/main/java/org/grobid/core/utilities/SHA1.java

import { createHash } from "node:crypto";
import { getLogger } from "./logger.js";

const LOGGER = getLogger("SHA1");
const ERROR_WHILE_EXECUTING_SHA1 = "Error while executing sha1:";

export class SHA1 {
  /** SHA-1 hex digest of a UTF-8 string. */
  static getSHA1(pArg: string): string {
    try {
      return createHash("sha1").update(pArg, "utf8").digest("hex");
    } catch (exp) {
      LOGGER.error(ERROR_WHILE_EXECUTING_SHA1 + exp);
      return "";
    }
  }

  static byteToHex(hash: Uint8Array): string {
    let out = "";
    for (const b of hash) out += b.toString(16).padStart(2, "0");
    return out;
  }
}
