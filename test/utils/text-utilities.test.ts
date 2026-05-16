import { describe, it, expect } from "vitest";
import {
  cleanAbstract,
  cleanField,
  cleanKeywords,
  cleanTitle,
  dehyphenize,
  filterLine,
  stripBibliographySectionKeyword,
} from "../../src/core/utils/text-utilities.js";
import { emptyLexicon } from "../../src/core/lexicon/index.js";

describe("filterLine", () => {
  it("rejects blanks and sentinel lines", () => {
    expect(filterLine("")).toBe(true);
    expect(filterLine("   ")).toBe(true);
    expect(filterLine("@PAGE 3")).toBe(true);
    expect(filterLine("@IMAGE foo.png")).toBe(true);
    expect(filterLine("Hello world")).toBe(false);
  });
});

describe("cleanField", () => {
  it("strips trailing punctuation", () => {
    expect(cleanField("Hello,", false)).toBe("Hello");
    expect(cleanField("  Hello.  ", false)).toBe("Hello");
  });
  it("strips leading runs of 2+ punctuation chars", () => {
    // Upstream's loop saves n as the LAST junk-char index, so substring(n)
    // keeps the char at that index — i.e. only multi-char leading runs
    // are actually trimmed. Single leading "," is left in place (faithful
    // to TextUtilities.cleanField).
    expect(cleanField(",,Hello", false)).toBe(",Hello");
  });
  it("preserves HTML entities ending in semicolon", () => {
    // The 4-char back-look at `;` finds the `&` of `&amp;` and stops the
    // trailing-trim loop — the whole entity stays intact.
    expect(cleanField("Smith &amp;", false)).toBe("Smith &amp;");
  });
  it("unwraps matched outer parens", () => {
    expect(cleanField("(Author)", false)).toBe("Author");
  });
  it("strips stopwords on either edge when requested", () => {
    expect(cleanField("the End of the road", true)).toBe("End of the road");
    expect(cleanField("Word and", true)).toBe("Word");
  });
});

describe("cleanTitle", () => {
  it("strips the trailing ' y' glyph artifact", () => {
    expect(cleanTitle("Quantum Effects in Solids y")).toBe("Quantum Effects in Solids");
  });
  it("returns null for empty input", () => {
    expect(cleanTitle("")).toBe(null);
    expect(cleanTitle(null)).toBe(null);
  });
});

describe("cleanAbstract", () => {
  it("strips a leading 'Abstract' keyword", () => {
    expect(cleanAbstract("Abstract We propose a new model.")).toBe("We propose a new model.");
  });
  it("handles small-caps 'A bstract' artifact from pdfalto", () => {
    expect(cleanAbstract("A bstract We propose ...")).toBe("We propose ...");
  });
  it("strips leading punctuation after the keyword", () => {
    expect(cleanAbstract("Abstract: The dominant ...")).toBe("The dominant ...");
    expect(cleanAbstract("Abstract — The dominant ...")).toBe("The dominant ...");
  });
});

describe("cleanKeywords", () => {
  it("strips 'Keywords' prefix and trailing dot", () => {
    expect(cleanKeywords("Keywords: NLP, machine translation.")).toBe("NLP, machine translation");
  });
  it("handles French 'mots clés'", () => {
    expect(cleanKeywords("Mots clés: TAL")).toBe("TAL");
  });
});

describe("dehyphenize", () => {
  it("joins simple 'word- word' hyphenations without a lexicon", () => {
    expect(dehyphenize("we pro- pose a model")).toBe("we propose a model");
  });
  it("leaves single-letter pieces alone", () => {
    expect(dehyphenize("a- bc")).toBe("a- bc");
  });
  it("uses the lexicon to validate joins when provided", () => {
    const lex = emptyLexicon();
    lex.dictionaryEN.add("propose");
    expect(dehyphenize("we pro- pose", lex)).toBe("we propose");
  });
});

describe("stripBibliographySectionKeyword", () => {
  it("removes 'References' leaking into the first reference's authors", () => {
    expect(stripBibliographySectionKeyword("References Jacob Devlin et al."))
      .toBe("Jacob Devlin et al.");
  });
  it("removes the small-caps 'R EFERENCES' glyph form", () => {
    expect(stripBibliographySectionKeyword("R EFERENCES Mahmoud Assran"))
      .toBe("Mahmoud Assran");
  });
  it("removes 'Bibliography' too", () => {
    expect(stripBibliographySectionKeyword("Bibliography 1. Author A."))
      .toBe("1. Author A.");
  });
  it("leaves the string alone when no heading word is present", () => {
    expect(stripBibliographySectionKeyword("Smith, A.")).toBe("Smith, A.");
  });
});
