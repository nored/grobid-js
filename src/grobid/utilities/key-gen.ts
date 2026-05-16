// Port of org.grobid.core.utilities.KeyGen.
// Upstream: grobid-core/src/main/java/org/grobid/core/utilities/KeyGen.java

/**
 * Random key generator. Used by upstream to produce stable-ish IDs for
 * intermediate runtime artifacts (e.g., temp file names, internal token
 * groupings).
 */
export class KeyGen {
  /** Minimum length for a decent key. */
  static readonly MIN_LENGTH = 10;

  /**
   * Printable, memorable, won't-break-HTML/shell character set. I/L/O,
   * 0/1 deliberately excluded to avoid visual ambiguity — mirrors the
   * upstream `goodChar` table verbatim.
   */
  private static readonly GOOD_CHARS = [
    "a","b","c","d","e","f","g","h","j","k","m","n","p","q","r","s","t","u","v","w","x","y","z",
    "A","B","C","D","E","F","G","H","J","K","M","N","P","Q","R","S","T","U","V","W","X","Y","Z",
    "2","3","4","5","6","7","8","9",
  ];

  static getKey(): string {
    let out = "";
    for (let i = 0; i < KeyGen.MIN_LENGTH; i++) {
      out += KeyGen.GOOD_CHARS[Math.floor(Math.random() * KeyGen.GOOD_CHARS.length)];
    }
    return out;
  }
}
