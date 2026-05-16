// Port of org.grobid.core.analyzers.GrobidFilterDeleteSpaceBetweenSameAlphabet.
// Upstream: grobid-core/src/main/java/org/grobid/core/analyzers/GrobidFilterDeleteSpaceBetweenSameAlphabet.java
//
// Author (upstream): Bruno Pouliquen @ WIPO
//
// Apache Lucene `TokenFilter` that concatenates adjacent tokens of the same
// alphabet (used to recombine PDF-extracted character-by-character glyphs that
// were split by whitespace). The internal logic — the cascading conditional
// concatenation rules in `incrementToken` — is portable verbatim.
//
// Lucene's `TokenStream` / `TokenFilter` infrastructure has no equivalent in
// our JS tree. We declare the minimal interface surface used here (the four
// attribute interfaces and `TokenStream`/`TokenFilter` shape) so the file
// typechecks. Concrete wiring is supplied at runtime by whichever Lucene-
// equivalent we end up bundling. This is the same adaptation pattern as the
// `ReTokenizer` plug-in surface in `grobid-analyzer.ts`.

// ─── Minimal Lucene-equivalent interface surface ─────────────────────────────

export interface CharTermAttribute {
  buffer(): string;          // upstream returns char[]; we return the string
  length(): number;
  toString(): string;
  setEmpty(): CharTermAttribute;
  append(s: string): CharTermAttribute;
}

export interface TypeAttribute {
  type(): string;
  setType(type: string): void;
}

export interface OffsetAttribute {
  startOffset(): number;
  endOffset(): number;
  setOffset(start: number, end: number): void;
}

export interface PositionIncrementAttribute {
  getPositionIncrement(): number;
  setPositionIncrement(inc: number): void;
}

export interface TokenStream {
  incrementToken(): boolean;
  reset(): void;
}

/**
 * Mirrors upstream's Lucene `TokenFilter` abstract base. Provides an `input`
 * stream and an `addAttribute` hook that yields the concrete attribute
 * instance bound to the stream. Concrete wiring must be plugged in by the
 * caller.
 */
export abstract class TokenFilter implements TokenStream {
  protected input: TokenStream;

  protected constructor(input: TokenStream) {
    this.input = input;
  }

  abstract incrementToken(): boolean;

  reset(): void {
    this.input.reset();
  }

  /**
   * Upstream `addAttribute(Class<T>)` returns a shared attribute instance
   * bound to this stream. Concrete subclasses don't override this; the host
   * Lucene impl (or an equivalent shim) supplies it.
   */
  protected abstract addAttribute<T>(clazz: unknown): T;
}

// ─── Ported class ────────────────────────────────────────────────────────────

export class GrobidFilterDeleteSpaceBetweenSameAlphabet extends TokenFilter {
  private termAttr: CharTermAttribute;
  private typeAttr: TypeAttribute;
  private posAttr: PositionIncrementAttribute;
  private offsetAttr: OffsetAttribute;

  private previousBuffer: string | null;
  private previousBufferLength: number = 0;
  private previousType: string | null = null;
  private previousStartOffset: number = 0;
  private previousEndOffset: number = 0;
  private previousPosIncr: number = 0;

  // Marker objects used as `Class<?>` arguments in upstream `addAttribute(...)`
  // calls. The host attribute-source impl is expected to discriminate on these
  // tokens. They are no-op values for typechecking purposes.
  static readonly CharTermAttributeClass = Symbol("CharTermAttribute");
  static readonly TypeAttributeClass = Symbol("TypeAttribute");
  static readonly OffsetAttributeClass = Symbol("OffsetAttribute");
  static readonly PositionIncrementAttributeClass = Symbol("PositionIncrementAttribute");

  constructor(input: TokenStream) {
    super(input);
    this.termAttr = this.addAttribute<CharTermAttribute>(
      GrobidFilterDeleteSpaceBetweenSameAlphabet.CharTermAttributeClass,
    );
    this.typeAttr = this.addAttribute<TypeAttribute>(
      GrobidFilterDeleteSpaceBetweenSameAlphabet.TypeAttributeClass,
    );
    this.offsetAttr = this.addAttribute<OffsetAttribute>(
      GrobidFilterDeleteSpaceBetweenSameAlphabet.OffsetAttributeClass,
    );
    this.posAttr = this.addAttribute<PositionIncrementAttribute>(
      GrobidFilterDeleteSpaceBetweenSameAlphabet.PositionIncrementAttributeClass,
    );
    this.previousBuffer = null;
  }

  /**
   * Concrete subclasses can't supply `addAttribute` themselves in TS the way
   * Lucene does it in Java (mixin via `AttributeSource`). We expose a setter
   * for the host runtime; the default throws to make missing wiring obvious.
   */
  protected override addAttribute<T>(_clazz: unknown): T {
    throw new Error(
      "GrobidFilterDeleteSpaceBetweenSameAlphabet.addAttribute: no Lucene attribute source bound. " +
        "Override this method (or subclass) before instantiation.",
    );
  }

  incrementToken(): boolean {
    if (this.previousBuffer !== null) {
      this.termAttr.setEmpty().append(this.previousBuffer);
      this.typeAttr.setType(this.previousType!);
      this.offsetAttr.setOffset(this.previousStartOffset, this.previousEndOffset);
      this.posAttr.setPositionIncrement(this.previousPosIncr);
      this.previousBuffer = null;
      return true;
    }

    if (!this.input.incrementToken()) { //#B
      return false; //#C
    }
    const buffer: string = this.termAttr.buffer();
    if (!this.isLatinChar(buffer.charAt(0))) return true;
    if (this.isDigit(buffer.charAt(0))) {
      //	if (!isNumeral(previousBuffer)) return true;
    }

    this.previousBuffer = this.termAttr.toString();
    this.previousBufferLength = this.termAttr.length();
    this.previousType = this.typeAttr.type();
    this.previousStartOffset = this.offsetAttr.startOffset();
    this.previousEndOffset = this.offsetAttr.endOffset();
    this.previousPosIncr = this.posAttr.getPositionIncrement();

    let cont: boolean = true;
    let currentBuffer: string | null = null;
    let currentBufferLength: number = 0;
    let currentType: string | null = null;
    let currentStartOffset: number = -1;
    let currentEndOffset: number = -1;
    let currentPosIncr: number = 0;
    while (cont && this.input.incrementToken()) {
      currentBuffer = this.termAttr.toString();
      currentBufferLength = this.termAttr.length();
      currentType = this.typeAttr.type();
      currentStartOffset = this.offsetAttr.startOffset();
      currentEndOffset = this.offsetAttr.endOffset();
      currentPosIncr = this.posAttr.getPositionIncrement();

      // Series of conditions to concatenate tokens:
      if ((
          buffer.charAt(0) === "." && this.isNumeral(this.previousBuffer) // 0 . => 0.
        ) || (
          this.isNumeral(currentBuffer) && this.isNumeral(this.previousBuffer) // 1 2 => 12
        ) || (
          this.previousBuffer!.endsWith(".") && this.isNumeral(this.previousBuffer)
            && this.isNumeral(currentBuffer) // 0. 1 => 0.1
        ) || (
          currentStartOffset >= this.previousEndOffset && this.isLatinChar(buffer.charAt(0))
            && currentType === this.previousType
            && (
              !(this.isNumeral(this.previousBuffer) && !this.isNumeral(currentBuffer))
            )
            && (!(this.isNumeral(currentBuffer) && !this.isNumeral(this.previousBuffer)))
          // a b => ab
        )

      ) {
        //current token has the same alphabet, we concatenate them
        const n: string = this.previousBuffer! + currentBuffer;
        this.previousBuffer = n;
        currentBuffer = null;
        this.previousEndOffset = currentEndOffset;
      } else {
        cont = false; break;
      }
    }

    this.termAttr.setEmpty().append(this.previousBuffer!);
    this.typeAttr.setType(this.previousType!);
    this.offsetAttr.setOffset(this.previousStartOffset, this.previousEndOffset);
    this.posAttr.setPositionIncrement(this.previousPosIncr);
    this.previousBuffer = null;

    if (currentBuffer !== null) {
      this.previousBuffer = currentBuffer;
      this.previousBufferLength = currentBufferLength;
      this.previousType = currentType;
      this.previousStartOffset = currentStartOffset;
      this.previousEndOffset = currentEndOffset;
      this.previousPosIncr = currentPosIncr;
    }
    return true;
  }

  private isDigit(c: string): boolean {
    const code = c.charCodeAt(0);
    return ((code >= 0x30 /* '0' */ && code <= 0x39 /* '9' */) || (code >= 0xFF10 && code <= 0xFF19));
  }

  private isLatinChar(c: string): boolean {
    const code = c.charCodeAt(0);
    return ((code >= 0x61 /* 'a' */ && code <= 0x7A /* 'z' */) || (code >= 0x41 /* 'A' */ && code <= 0x5A /* 'Z' */)
      || (code >= 0x30 /* '0' */ && code <= 0x39 /* '9' */) || (code >= 0xFF10 && code <= 0xFF19) || (code >= 0xFF01 && code <= 0xFF5E)
    );
  }

  private isNumeral(s: string | null): boolean {
    return (s !== null && s.length !== 0 && this.isDigit(s.charAt(0)));
  }

  override reset(): void {
    super.reset();
    this.previousBuffer = null;
    this.previousBufferLength = 0;
    this.previousType = null;
    this.previousStartOffset = 0;
    this.previousEndOffset = 0;
    this.previousPosIncr = 0;
  }
}
