// Port of org.grobid.core.data.Note.
// Upstream: grobid-core/src/main/java/org/grobid/core/data/Note.java

import type { LayoutToken } from "../layout/layout-token.js";
import { KeyGen } from "../utilities/key-gen.js";

/** Inner enum NoteType, hoisted to top-level. */
export enum NoteType {
  FOOT = "FOOT",
  MARGIN = "MARGIN",
}

export class Note {
  // Re-expose nested enum.
  static readonly NoteType = NoteType;

  private identifier: string;
  private label: string | null = null;
  private tokens: LayoutToken[] | null = null;
  private text: string | null = null;
  private offsetStartInPage = 0;
  private ignored = false;
  private noteType: NoteType | null = null;

  // Upstream has four constructors. We collapse them into a single signature
  // with optional positional args.
  constructor(
    label?: string | null,
    tokens?: LayoutToken[] | null,
    textOrNoteType?: string | NoteType | null,
    offsetStartInPageOrNoteType?: number | NoteType,
    noteType?: NoteType,
  ) {
    this.identifier = KeyGen.getKey().substring(0, 7);

    if (label === undefined) {
      // no-arg constructor
      return;
    }

    this.label = label ?? null;
    this.tokens = tokens ?? null;

    // Disambiguate the remaining overloads.
    if (typeof textOrNoteType === "string") {
      // Note(label, tokens, text, ...) variants
      this.text = textOrNoteType;
      if (typeof offsetStartInPageOrNoteType === "number") {
        this.offsetStartInPage = offsetStartInPageOrNoteType;
        if (noteType !== undefined) this.noteType = noteType;
      } else if (offsetStartInPageOrNoteType !== undefined) {
        // Note(label, tokens, text, noteType)
        this.noteType = offsetStartInPageOrNoteType;
      }
    } else if (textOrNoteType !== undefined && textOrNoteType !== null) {
      // Note(label, tokens, noteType)
      this.noteType = textOrNoteType;
    }
  }

  getIdentifier(): string {
    return this.identifier;
  }

  setIdentifier(identifier: string): void {
    this.identifier = identifier;
  }

  getOffsetStartInPage(): number {
    return this.offsetStartInPage;
  }

  setOffsetStartInPage(offsetStartInPage: number): void {
    this.offsetStartInPage = offsetStartInPage;
  }

  getPageNumber(): number {
    // Mirror Apache CollectionUtils.isNotEmpty
    if (this.tokens != null && this.tokens.length > 0) {
      return this.tokens[0]!.getPage();
    } else {
      return -1;
    }
  }

  getText(): string | null {
    return this.text;
  }

  setText(text: string | null): void {
    this.text = text;
  }

  getTokens(): LayoutToken[] | null {
    return this.tokens;
  }

  setTokens(tokens: LayoutToken[] | null): void {
    this.tokens = tokens;
  }

  getLabel(): string | null {
    return this.label;
  }

  setLabel(label: string | null): void {
    this.label = label;
  }

  getOffsetEndInPage(): number {
    // Upstream: getLast(tokens).getOffset() — Guava throws NoSuchElementException
    // when tokens is empty; we preserve that contract.
    if (this.tokens == null || this.tokens.length === 0) {
      throw new Error("Note.getOffsetEndInPage: tokens is empty");
    }
    return this.tokens[this.tokens.length - 1]!.getOffset();
  }

  isIgnored(): boolean {
    return this.ignored;
  }

  setIgnored(ignored: boolean): void {
    this.ignored = ignored;
  }

  getNoteType(): NoteType | null {
    return this.noteType;
  }

  setNoteType(noteType: NoteType | null): void {
    this.noteType = noteType;
  }

  getNoteTypeName(): string | null {
    // Mirrors StringUtils.lowerCase(noteType.name()): null-safe.
    if (this.noteType == null) return null;
    return String(this.noteType).toLowerCase();
  }
}
