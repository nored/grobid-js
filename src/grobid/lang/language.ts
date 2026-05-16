// Port of org.grobid.core.lang.Language.
// Upstream: grobid-core/src/main/java/org/grobid/core/lang/Language.java
//
// Language recognition result. Mirrors the upstream `public final` Java class
// 1:1, including the public string constants, the two validating constructors,
// the language-family predicates and the JSON serializer.

import { GrobidException } from "../exceptions/grobid-exception.js";

/**
 * Language recognition result.
 */
export class Language {
  //common language constants (TBD use an external ISO_639-1 reference lib.)
  static readonly EN = "en";
  static readonly DE = "de";
  static readonly FR = "fr";
  static readonly IT = "it";
  static readonly ES = "es";
  static readonly JA = "ja";
  static readonly AR = "ar";
  static readonly ZH = "zh";
  static readonly RU = "ru";
  static readonly PT = "pt";
  static readonly UK = "uk";
  static readonly LN = "nl";
  static readonly PL = "pl";
  static readonly SV = "sv";
  static readonly KO = "ko";

  private lang: string | null = null;
  private conf: number = 0;
  // grobid-js extension: dominant Unicode script name (e.g. "cyrillic",
  // "greek", "cjk"). No upstream equivalent — populated by the script
  // detector when set on the document. Stays null on classic Latin papers
  // (so they serialize identically to upstream).
  private script: string | null = null;

  // Upstream has three constructors:
  //   Language()                         — default for jackson mapping
  //   Language(String langId)            — confidence defaults to 1.0
  //   Language(String langId, double confidence)
  // Collapsed into a single signature.
  constructor(langId?: string | null, confidence?: number) {
    if (langId === undefined) {
      // default construction for jackson mapping
      return;
    }

    if (langId === null) {
      throw new GrobidException("Language id cannot be null");
    }

    if ((langId.length !== 3 && langId.length !== 2 && (langId !== "sorb") &&
        (langId !== "zh-cn") && (langId !== "zh-tw")) || !(Language.isLetter(langId.charAt(0))
        && Language.isLetter(langId.charAt(1)))) {
      throw new GrobidException("Language id should consist of two or three letters, but was: " + langId);
    }

    this.lang = langId;
    this.conf = confidence !== undefined ? confidence : 1.0;
  }

  /**
   * Mirrors `java.lang.Character.isLetter(char)` for the BMP characters
   * actually seen here (always ASCII / common letters). We use the Unicode
   * Letter property which matches the Java semantic.
   */
  private static isLetter(c: string): boolean {
    if (c.length === 0) return false;
    return /\p{L}/u.test(c);
  }

  isChinese(): boolean {
    return "zh" === this.lang || "zh-cn" === this.lang || "zh-tw" === this.lang;
  }

  isJapaneses(): boolean {
    return "ja" === this.lang;
  }

  isKorean(): boolean {
    return "kr" === this.lang || "ko" === this.lang;
  }

  isArabic(): boolean {
    return "ar" === this.lang;
  }

  getLang(): string | null {
    return this.lang;
  }

  setLang(lang: string | null): void {
    this.lang = lang;
  }

  getConf(): number {
    return this.conf;
  }

  setConf(conf: number): void {
    this.conf = conf;
  }

  // grobid-js extension: dominant script accessor. Returns null when the
  // script is undetermined or Latin (we keep the field null in those cases
  // so byte-identical serialization with upstream is preserved).
  getScript(): string | null {
    return this.script;
  }

  setScript(script: string | null): void {
    this.script = script;
  }

  toString(): string {
    return this.lang + ";" + this.conf;
  }

  toJSON(): string {
    return "{\"lang\":\"" + this.lang + "\", \"conf\": " + this.conf + "}";
  }
}
