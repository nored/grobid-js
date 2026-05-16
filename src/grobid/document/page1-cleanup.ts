// Page-1 cleanup pre-processor.
//
// JS-port addition (no upstream counterpart). The 169-paper corpus benchmark
// showed both upstream Java GROBID and grobid-js mis-classifying ~12 papers
// because page 1 is an archive cover sheet (Leeds Beckett, Edinburgh Research
// Explorer, Radboud, eScholarship, NRC Publications Archive, Research Square,
// CentAUR …) or a publisher-injected banner (IEEE preprint disclaimer, arXiv
// vertical watermark, ISSN/DOI journal header). The CRF segmenter then labels
// the cover sheet's bibliographic text as the paper's `<header>` zone, which
// poisons every downstream parser (header, affiliation, citation).
//
// This module runs after `Document.addTokenizedDocument` (which has populated
// `doc.blocks`, `doc.pages`, `doc.tokenizations`) but before
// `Segmentation.prepareDocument` runs feature extraction. It either:
//   1. drops every block on page 1 (archive-cover detection), promoting page 2
//      to the segmentation-visible "page 1"; or
//   2. drops specific top-of-page-1 blocks (preprint banner / journal banner)
//      or rotated arXiv watermark blocks, leaving the real header intact.
//
// Conservatism: archive-cover detection REQUIRES at least two independent
// markers (or one very strong marker plus the absence of an abstract-like
// paragraph). False positives — treating a real paper's page 1 as a cover
// sheet — would damage normal extraction, so the bar is intentionally high.
//
// Removed blocks are NOT discarded — they are kept on the `Document` via
// `doc.__droppedPage1Blocks` so downstream code that walks the original
// block list (figure / citation parsing) can still see them if needed.
// `doc.blocks` and `pages[i].blocks` are the segmentation-visible views.

import type { Block } from "../layout/block.js";
import type { LayoutToken } from "../layout/layout-token.js";
import type { Page } from "../layout/page.js";
import { getLogger } from "../utilities/logger.js";

/**
 * Structural subtype of the Document interface this module needs. Defined
 * locally (instead of `import type { Document }`) so that pulling in
 * page1-cleanup doesn't drag in Document.ts and its transitive imports of
 * Engine + every parser — which matters for testability and for keeping the
 * module's blast radius small.
 */
interface DocumentLike {
  getPages(): Page[] | null;
  getBlocks(): Block[];
  /**
   * Returns the underlying tokenization array. Mutable in place; the cleanup
   * splices removed-block tokens out so that token indices used by downstream
   * parsers (BasicStructureBuilder, FullTextParser.getDocIndexToken) remain
   * coherent after block removal.
   */
  getTokenizations(): LayoutToken[] | null;
}

const LOGGER = getLogger("Page1Cleanup");

/**
 * Strong archive-cover identifiers. Presence of one of these phrases is a
 * single strong marker; two markers (or one marker + missing abstract +
 * cover-sized page) trigger removal.
 */
const ARCHIVE_COVER_MARKERS: readonly { name: string; re: RegExp }[] = Object.freeze([
  { name: "Edinburgh Research Explorer", re: /Edinburgh Research Explorer/i },
  { name: "Edinburgh - Citation for published version", re: /Citation for (the )?published version/i },
  { name: "Leeds Beckett Repository", re: /Leeds Beckett (University|Repository)/i },
  { name: "CentAUR (Reading)", re: /CentAUR/ },
  { name: "Radboud Repository", re: /Radboud Repository|repository\.ubn\.ru\.nl/i },
  { name: "NRC Publications Archive", re: /NRC Publications Archive|Archives des publications du CNRC/i },
  { name: "Research Square preprint", re: /Research Square|researchsquare\.com|Posted Date/i },
  { name: "eScholarship / LBNL", re: /eScholarship|escholarship\.org|Lawrence Berkeley National Laboratory/i },
  { name: "HKUST Thesis Repository", re: /Hong Kong University of Science and Technology[\s\S]{0,200}(Thesis|Dissertation|Repository)/i },
  { name: "Generic 'This is the author's accepted manuscript'", re: /This is the (author'?s )?(accepted manuscript|peer reviewed version|post-?print)/i },
  { name: "Generic 'White Rose Research Online'", re: /White Rose Research Online/i },
  { name: "Generic 'This publication is available'", re: /This publication is available (from|at)/i },
  { name: "Citation: block", re: /\bCitation:\s*[A-Z]/ },
]);

/**
 * Top-of-page banner detectors. These remove individual blocks at the top of
 * page 1 (banners ride above the real header). Less risky than cover removal
 * because they only strip the matched block — the rest of page 1 is kept.
 */
const TOP_BANNER_MARKERS: readonly { name: string; re: RegExp }[] = Object.freeze([
  { name: "IEEE preprint disclaimer", re: /This article has been accepted for publication in/i },
  { name: "ACM / Elsevier preprint disclaimer", re: /This is the author'?s version of the work/i },
  { name: "Author manuscript / NIH PMC banner", re: /Author manuscript;? available in PMC/i },
  { name: "Springer postprint banner", re: /The final publication is available at link\.springer\.com/i },
  { name: "Wiley accepted-article banner", re: /This article has been accepted for publication and undergone full peer review/i },
]);

/** y-position threshold (PDF points) below which a block is considered "top of page". */
const TOP_BAND_PT = 110;
/** y-position threshold for journal banners that may sit slightly lower. */
const TOP_BANNER_PT = 150;

/** Result of running a cleanup pass. Logged + used to flag the document. */
export interface Page1CleanupResult {
  /** True if anything was removed. */
  modified: boolean;
  /** Human-readable list of fired cleanups (for logs). */
  firedRules: string[];
  /** Number of blocks dropped from page 1. */
  droppedBlocks: number;
  /** True if the entire page 1 was stripped (archive-cover case). */
  strippedEntirePage1: boolean;
}

let cleanupEnabled = true;

/**
 * Public toggle. Default: enabled. Disabling restores upstream-faithful
 * behaviour (no cleanup, no extra log output). Returns the previous value
 * so call sites can save/restore.
 */
export function setPage1CleanupEnabled(b: boolean): boolean {
  const prev = cleanupEnabled;
  cleanupEnabled = b;
  return prev;
}

/** Read-only accessor for tests / introspection. */
export function isPage1CleanupEnabled(): boolean {
  return cleanupEnabled;
}

/**
 * Carry-through type for blocks removed by a cleanup pass. Attached to the
 * Document as a hidden field (`__droppedPage1Blocks`) so that later passes —
 * figure / citation / appendix detection — can still see the original blocks
 * if they need to. Segmentation, header extraction, and reference parsing
 * walk only `doc.getBlocks()` and `page.getBlocks()`, which are the views we
 * shrink.
 */
export interface DroppedPage1Blocks {
  /** Why each block was removed (parallel to `blocks`). */
  reasons: string[];
  /** The removed Block objects, kept intact. */
  blocks: Block[];
}

/**
 * Augment Document with a hidden field for dropped blocks. We deliberately
 * use an underscore-prefixed name to make it clear this is a JS-port-only
 * addition that doesn't exist in upstream `Document.java`.
 */
type DocumentWithDropped = DocumentLike & { __droppedPage1Blocks?: DroppedPage1Blocks };

/**
 * Run page-1 cleanup on a tokenised document. Idempotent — if the global
 * toggle is disabled or the document has no page 1, returns immediately.
 *
 * @param doc A Document that has already been through `addTokenizedDocument`
 *            (so `blocks`, `pages`, `tokenizations` are populated).
 * @returns   A summary of what fired.
 */
export function applyPage1Cleanup(doc: DocumentLike): Page1CleanupResult {
  const empty: Page1CleanupResult = {
    modified: false,
    firedRules: [],
    droppedBlocks: 0,
    strippedEntirePage1: false,
  };

  if (!cleanupEnabled) return empty;

  const pages = doc.getPages();
  if (pages === null || pages.length === 0) return empty;
  const page1 = pages[0];
  if (page1 === undefined) return empty;
  const page1Blocks = page1.getBlocks();
  if (page1Blocks === null || page1Blocks.length === 0) return empty;

  // Don't run cleanup on single-page PDFs — if it really is a cover sheet
  // with no following content, removing it leaves nothing for downstream
  // parsers to chew on. Better to let upstream's normal flow take over.
  if (pages.length < 2) return empty;

  const firedRules: string[] = [];

  // 1. Archive-cover detection — looks at the entirety of page 1.
  const coverDetection = detectArchiveCover(page1, page1Blocks);
  if (coverDetection.isCover) {
    firedRules.push(`archive-cover: ${coverDetection.markers.join(", ")}`);
    const dropped = stripPage1Blocks(doc, page1, page1Blocks, coverDetection.markers.join(" + "));
    LOGGER.info(
      `[page1-cleanup] stripped entire page 1 (${dropped} blocks); markers: ${coverDetection.markers.join(", ")}`,
    );
    return {
      modified: true,
      firedRules,
      droppedBlocks: dropped,
      strippedEntirePage1: true,
    };
  }

  // 2. Top-banner / arXiv watermark stripping — leaves the rest of page 1 alone.
  const bannerBlocks = detectBannerBlocks(page1, page1Blocks);
  if (bannerBlocks.length > 0) {
    for (const b of bannerBlocks) {
      firedRules.push(`banner: ${b.reason}`);
    }
    const dropped = stripSpecificBlocks(
      doc,
      page1,
      page1Blocks,
      bannerBlocks.map((b) => b.block),
      bannerBlocks.map((b) => b.reason),
    );
    LOGGER.info(
      `[page1-cleanup] stripped ${dropped} top-of-page-1 banner block(s); rules: ${bannerBlocks
        .map((b) => b.reason)
        .join(", ")}`,
    );
    return {
      modified: true,
      firedRules,
      droppedBlocks: dropped,
      strippedEntirePage1: false,
    };
  }

  return empty;
}

/**
 * Decide whether page 1 looks like an archive cover sheet. Conservative —
 * requires either 2+ markers across the page OR a single high-confidence
 * marker (e.g. "NRC Publications Archive") combined with an absence of any
 * abstract-like long paragraph block on the same page.
 */
function detectArchiveCover(
  page1: Page,
  blocks: Block[],
): { isCover: boolean; markers: string[] } {
  // Concatenate page-1 text once for marker scanning.
  const pageText = blocks.map((b) => b.getText() ?? "").join("\n");
  const matched: string[] = [];
  for (const m of ARCHIVE_COVER_MARKERS) {
    if (m.re.test(pageText)) matched.push(m.name);
  }

  if (matched.length === 0) return { isCover: false, markers: [] };

  // Treat the document's first long paragraph as a proxy for an abstract.
  // Archive covers are mostly bibliographic stubs — no 200+ char paragraphs.
  const hasLongParagraph = blocks.some((b) => {
    const text = b.getText() ?? "";
    return text.trim().length >= 240;
  });

  // Two markers always trigger.
  if (matched.length >= 2) {
    return { isCover: true, markers: matched };
  }

  // Single marker triggers only when there's no abstract-like block on page 1.
  // This catches Radboud / Research Square / eScholarship covers where the
  // marker phrase is unambiguous and the page is otherwise bibliographic metadata.
  if (matched.length === 1 && !hasLongParagraph) {
    // Extra guard: the page must be visually sparse (few blocks). A real
    // paper's page 1 typically has many blocks (header + abstract + intro).
    if (blocks.length <= 25) {
      return { isCover: true, markers: matched };
    }
  }

  // Whole-page rotated text is a separate signal — eScholarship/UC covers
  // sometimes only carry the bibliographic boilerplate plus a vertical
  // watermark with the DOI. Caught above already if we matched a marker.
  void page1;
  return { isCover: false, markers: matched };
}

/** Block-level detection of preprint banners and arXiv watermarks. */
function detectBannerBlocks(
  page1: Page,
  blocks: Block[],
): { block: Block; reason: string }[] {
  const out: { block: Block; reason: string }[] = [];

  // arXiv vertical watermark — rotated tokens near the left margin matching
  // the canonical `arXiv:NNNN.NNNNN` pattern. The watermark appears as ONE
  // block; we detect by sampling the block text + checking rotated tokens.
  const arxivRe = /\barXiv:\s?\d{4}\.\d{4,6}/;
  for (const b of blocks) {
    const text = b.getText() ?? "";
    const tokens = b.getTokens() ?? [];
    const rotatedFraction = countRotated(tokens) / Math.max(1, tokens.length);
    if (arxivRe.test(text) && (rotatedFraction > 0.3 || b.getX() < 60)) {
      out.push({ block: b, reason: "arXiv watermark" });
      continue;
    }
    // Top-of-page banners.
    if (b.getY() <= TOP_BAND_PT) {
      for (const m of TOP_BANNER_MARKERS) {
        if (m.re.test(text)) {
          out.push({ block: b, reason: m.name });
          break;
        }
      }
    }
    // Journal banner: y near top, contains ISSN or DOI pattern AND a journal
    // URL. We require all three signals to avoid stripping real titles.
    if (b.getY() <= TOP_BANNER_PT) {
      const issn = /ISSN[: ]\s?\d{4}-\d{3}[\dxX]/.test(text);
      const doiBanner = /\bdoi(\.org)?[/:]/i.test(text) || /DOI:?\s*10\.\d{4,9}/.test(text);
      const url = /\bhttps?:\/\/[^\s]+/.test(text);
      if (issn && (doiBanner || url) && (b.getText() ?? "").trim().length < 220) {
        out.push({ block: b, reason: "journal banner (ISSN+URL/DOI)" });
      }
    }
  }
  void page1;
  // Dedupe (a single block could fire multiple rules above).
  const seen = new Set<Block>();
  return out.filter((r) => {
    if (seen.has(r.block)) return false;
    seen.add(r.block);
    return true;
  });
}

function countRotated(tokens: LayoutToken[]): number {
  let n = 0;
  for (const t of tokens) if (t.getRotation()) n++;
  return n;
}

/**
 * Remove every block on `page1` from both the page-local block list and the
 * document-global flat block list. Preserve the removed blocks on the
 * Document under `__droppedPage1Blocks` so downstream code can still see
 * them. Returns the number of blocks dropped.
 */
function stripPage1Blocks(doc: DocumentLike, page1: Page, page1Blocks: Block[], reason: string): number {
  return stripSpecificBlocks(
    doc,
    page1,
    page1Blocks,
    [...page1Blocks],
    page1Blocks.map(() => reason),
  );
}

/**
 * Remove a specific set of `Block` instances from page 1 and from the
 * document-global flat list, and re-thread token bookkeeping so the
 * remaining blocks' `startToken`/`endToken` and the remaining tokens'
 * `blockPtr` stay coherent with the shrunk arrays.
 *
 * Why we have to touch tokens too:
 * `BasicStructureBuilder.generalResultSegmentation` walks doc.blocks linearly
 * and computes `tokenBlockPos = currentLineEndPos - block.getStartToken()`.
 * `FullTextParser.getDocIndexToken` looks up `doc.getBlocks()[token.blockPtr]`.
 * Both invariants fail if blocks vanish while their tokens and token offsets
 * remain — DocumentPointer throws `tokenBlockPos >= 0`, and getDocIndexToken
 * dereferences `undefined`. We fix this by ALSO splicing the dropped blocks'
 * tokens out of `doc.tokenizations`, shifting every kept block's startToken/
 * endToken downward by the count of tokens removed before it, and reassigning
 * each kept token's blockPtr based on the new block array index.
 */
function stripSpecificBlocks(
  doc: DocumentLike,
  page1: Page,
  page1Blocks: Block[],
  toRemove: Block[],
  reasons: string[],
): number {
  if (toRemove.length === 0) return 0;
  const removeSet = new Set<Block>(toRemove);

  // 1. Compute the set of token indices to drop. Tokens are identified by
  //    block-membership: a token belongs to the block whose tokens array
  //    contains it.
  const tokenIndicesToDrop = new Set<number>();
  const tokenizations = doc.getTokenizations();
  if (tokenizations !== null) {
    for (const b of toRemove) {
      const bTokens = b.getTokens();
      if (bTokens === null) continue;
      // Token indices in tokenizations are [startToken, endToken). Use the
      // explicit endToken when set (SAX assigns it at TextBlock close);
      // otherwise fall back to startToken + tokens.length.
      const start = b.getStartToken();
      const end = b.getEndToken();
      // start === -1 means an Illustration-only block — no tokens. Skip.
      if (start === -1) continue;
      const realEnd = end === -1 ? start + bTokens.length : end;
      for (let i = start; i < realEnd; i++) tokenIndicesToDrop.add(i);
    }
  }

  // 2. Mutate the page's block list in place. Page.getBlocks() returns the
  //    live internal array, so splice updates the Page directly.
  for (let i = page1Blocks.length - 1; i >= 0; i--) {
    if (removeSet.has(page1Blocks[i] as Block)) {
      page1Blocks.splice(i, 1);
    }
  }

  // 3. Mutate the document-global block list.
  const docBlocks = doc.getBlocks();
  if (docBlocks !== null) {
    for (let i = docBlocks.length - 1; i >= 0; i--) {
      if (removeSet.has(docBlocks[i] as Block)) {
        docBlocks.splice(i, 1);
      }
    }
  }

  // 4. Splice the removed tokens out of tokenizations. We walk back-to-front
  //    so earlier indices remain valid while we splice. Per-index, also
  //    compute how many tokens with index < i are being removed — used in
  //    step 5 to shift kept blocks' startToken/endToken.
  if (tokenizations !== null && tokenIndicesToDrop.size > 0) {
    const sortedDescending = [...tokenIndicesToDrop].sort((a, b) => b - a);
    for (const idx of sortedDescending) {
      tokenizations.splice(idx, 1);
    }
  }

  // 5. Shift startToken/endToken of every remaining block downward by the
  //    count of dropped token indices < that block's startToken. (A single
  //    cover-page strip removes a contiguous prefix of tokens, but for
  //    banner-block stripping the removed set could be non-contiguous, so
  //    we do a per-block lookup for correctness.)
  if (docBlocks !== null && tokenIndicesToDrop.size > 0) {
    // Pre-build a sorted array of dropped indices for binary-search lookups.
    const droppedSorted = [...tokenIndicesToDrop].sort((a, b) => a - b);
    const countDroppedBefore = (n: number): number => {
      // Binary search for first dropped index >= n.
      let lo = 0;
      let hi = droppedSorted.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (droppedSorted[mid]! < n) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    };
    for (const b of docBlocks) {
      const oldStart = b.getStartToken();
      if (oldStart === -1) continue;
      const oldEnd = b.getEndToken();
      const shiftStart = countDroppedBefore(oldStart);
      b.setStartToken(oldStart - shiftStart);
      if (oldEnd !== -1) {
        // endToken is exclusive; subtract dropped indices strictly < oldEnd.
        const shiftEnd = countDroppedBefore(oldEnd);
        b.setEndToken(oldEnd - shiftEnd);
      }
    }
  }

  // 6. Reassign blockPtr on every kept token to its block's new index.
  //    Each kept block now exposes its tokens via getTokens(); walk the
  //    block array and mark every token.setBlockPtr(blockIdx).
  if (docBlocks !== null) {
    for (let blockIdx = 0; blockIdx < docBlocks.length; blockIdx++) {
      const bTokens = docBlocks[blockIdx]!.getTokens();
      if (bTokens === null) continue;
      for (const t of bTokens) t.setBlockPtr(blockIdx);
    }
  }

  // 7. Squirrel the dropped blocks away on the Document so they aren't lost.
  const withDropped = doc as DocumentWithDropped;
  if (withDropped.__droppedPage1Blocks === undefined) {
    withDropped.__droppedPage1Blocks = { reasons: [], blocks: [] };
  }
  withDropped.__droppedPage1Blocks.blocks.push(...toRemove);
  withDropped.__droppedPage1Blocks.reasons.push(...reasons);

  void page1;
  return toRemove.length;
}

/**
 * Test-only accessor for the dropped block list. Returns `null` when no
 * cleanup has run on the document.
 */
export function getDroppedPage1Blocks(doc: DocumentLike): DroppedPage1Blocks | null {
  const withDropped = doc as DocumentWithDropped;
  return withDropped.__droppedPage1Blocks ?? null;
}
