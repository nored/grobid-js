import { describe, it, expect } from "vitest";
import {
  detectScript,
  classifyChar,
  hintLanguageForScript,
  NON_LATIN_SCRIPTS,
  MIN_NON_LATIN_COUNT,
} from "../../src/grobid/utilities/script-detector.js";

describe("script-detector", () => {
  it("classifies pure ASCII English as latin", () => {
    expect(detectScript("Hello world, this is a Latin paper.")).toBe("latin");
  });

  it("classifies a Russian sample as cyrillic", () => {
    const text =
      "Кибербезопасность биометрических хранилищ на спортивных объектах и необратимость утечек";
    expect(detectScript(text)).toBe("cyrillic");
  });

  it("classifies a Ukrainian sample as cyrillic", () => {
    const text =
      "ДОСЛІДЖЕННЯ МЕТОДІВ ТА ЗАСОБІВ ПІДВИЩЕННЯ БЕЗПЕКИ ПРОТОКОЛУ GIT LFS";
    expect(detectScript(text)).toBe("cyrillic");
  });

  it("classifies a Greek sample as greek", () => {
    const text = "Καλημέρα κόσμε αυτή είναι μια Ελληνική εργασία περί επιστήμης.";
    expect(detectScript(text)).toBe("greek");
  });

  it("classifies an Arabic sample as arabic", () => {
    const text = "مرحبا بالعالم هذه ورقة علمية مكتوبة باللغة العربية تماما";
    expect(detectScript(text)).toBe("arabic");
  });

  it("classifies CJK Chinese as cjk", () => {
    const text = "你好世界这是一篇关于计算机科学的中文论文研究人工智能的发展";
    expect(detectScript(text)).toBe("cjk");
  });

  it("classifies CJK Japanese (hiragana/katakana) as cjk", () => {
    const text = "これは日本語の論文ですコンピュータサイエンスについての研究です";
    expect(detectScript(text)).toBe("cjk");
  });

  it("classifies Hebrew as hebrew", () => {
    const text = "שלום עולם זהו מאמר אקדמי בעברית על מדעי המחשב";
    expect(detectScript(text)).toBe("hebrew");
  });

  it("does NOT flip Latin to non-Latin on a single stray non-Latin character", () => {
    // A single Greek letter in an otherwise-Latin formula.
    const text = "The variable α is bounded by f(x). Theorem 2 shows convergence everywhere.";
    expect(detectScript(text)).toBe("latin");
  });

  it("requires at least MIN_NON_LATIN_COUNT non-Latin chars to flip", () => {
    // Below threshold — should stay Latin.
    const justUnder = "abcdefgh" + "αβγδ"; // 8 latin + 4 greek
    expect(detectScript(justUnder)).toBe("latin");
    // Meet the threshold — should flip.
    const meetingThreshold = "ab" + "αβγδεζηθ"; // 2 latin + 8 greek
    expect(detectScript(meetingThreshold)).toBe("greek");
    expect(MIN_NON_LATIN_COUNT).toBe(8);
  });

  it("classifies digits and punctuation as 'unknown' (ignored from voting)", () => {
    expect(classifyChar("5")).toBe("unknown");
    expect(classifyChar(".")).toBe("unknown");
    expect(classifyChar(" ")).toBe("unknown");
  });

  it("returns latin on empty input", () => {
    expect(detectScript("")).toBe("latin");
  });

  it("returns latin when the document is only numbers / punctuation", () => {
    expect(detectScript("123.456 - 789, 0.42! (.)")).toBe("latin");
  });

  it("hints a plausible BCP-47 lang for each non-Latin script", () => {
    for (const s of NON_LATIN_SCRIPTS) {
      const hint = hintLanguageForScript(s);
      expect(hint).not.toBeNull();
      expect(typeof hint).toBe("string");
    }
    expect(hintLanguageForScript("latin")).toBeNull();
    expect(hintLanguageForScript("unknown")).toBeNull();
  });
});
