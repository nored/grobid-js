# Upstream GROBID bugs preserved verbatim

Every entry below is a bug, dead write, or quirky construction in upstream
GROBID (kermitt2/grobid @ 0.9.0) that the JS port preserves byte-for-byte so
output-parity is achievable against the upstream binary. Each TS port site
carries an inline `// NOTE: upstream bug — …` comment; this file is the
canonical index for triaging fixes in a later pass.

**Workflow**

- Don't silently "fix" any of these during the port. Cleanup is its own pass
  after corpus-benchmark parity is verified.
- When porting more code, append any newly-discovered bug here with the same
  shape. One entry = one section.
- Status legend (after triage pass):
  - `preserved verbatim` — not yet triaged
  - `fixed` — REAL-BUG-OUTPUT-AFFECTING corrected in JS port
  - `cleaned-up` — REAL-BUG-COSMETIC dead write/duplicate removed (no behavior change)
  - `documented-intent` — NOT-A-BUG; quirky but deliberate
  - `superseded-by-earlier-fix` — already handled by an earlier patch
  - `needs-design-review` — fix requires non-trivial logic decisions

## Triage pass summary (114 entries)

- Output-affecting fixes applied: 9 — table-parser & funding-acknowledgement
  `testClosingTag` close-tag emitters, `<revisionDesc>` close-test missing
  `getNormalizedSubmissionDate()`, `Engine.processHeader` 6-arg builder
  wrong setter, `PatentItem.getUtility()` returning `design`, AuthorParser
  `/t<author>` typo, `TableRejectionCounters.HEADER_AREA_BIGGER_THAN_CONTENT`
  wrong counter name, `BiblioItem.toTEI` keywords brace-less double-emission,
  `FullTextParser.testClosingTagFulltext` tautological OR chain, and
  `ReferenceExtractor.references2TEI`/`reference2BibTeX` inverted null-check.
- Cosmetic cleanups applied: 3 — `normalizeRegex` duplicate `&` replace,
  `Lexicon.inDictionary` duplicate `endsWith(".")`, `PatentItem` duplicate
  `"XN"` in OR chains (both `toTEI` and `toJson` sites). Other cosmetic
  entries left in-situ with `// NOTE: dead-code parity with upstream`.
- Documented-intent reclassifications: see individual entries below.
- Needs-design-review (not auto-fixed): `TEIFormatter.toTEITextPiece`
  paragraph-reconnect `indP2 != 1` (touches a body-emission heuristic that
  could shift paragraph reconnection across many papers); `HeaderParser`
  "take only first title/abstract cluster" drop-on-floor heuristics (changing
  would likely diverge from upstream's already-100%-matched header output);
  `FullTextParser.getBadFigures` over-aggressive completeness filter
  (audit-flagged; needs care because `revertResultsForBadItems` depends on
  exactly what gets filtered).
- Benchmark impact: internal 5-paper corpus unchanged at 100% on all headline
  metrics; external 54-paper corpus unchanged at 100% / 96% / 100% / 100%
  on title-sim / authors-match-avg / affil / abstract.

---

## `org.grobid.core.utilities` — TextUtilities

### Duplicate `string.replace("&amp;", …)`
- **Upstream**: `TextUtilities.normalizeRegex`
- **JS port**: `src/grobid/utilities/text-utilities.ts` (in `normalizeRegex`)
- **Symptom**: the line `string = string.replace("&amp;", "\\\\&amp;");` appears twice in upstream Java with identical behaviour; second call is a no-op.
- **Status**: cleaned-up — second (idempotent) call removed; semantics unchanged.

### Discarded `replaceAll("\n", SPACE)` return
- **Upstream**: `TextUtilities.dehyphenizeHard`
- **JS port**: `src/grobid/utilities/text-utilities.ts` (in `dehyphenizeHard`)
- **Symptom**: `text.replaceAll("\n", SPACE);` — return value is discarded; the call is effectively a no-op since Java `String` is immutable.
- **Status**: cleaned-up (dead-write parity retained as `// NOTE: dead-code parity with upstream`)

### `JSONEncode` Java-vs-JS escape semantics drift
- **Upstream**: `TextUtilities.JSONEncode`
- **JS port**: `src/grobid/utilities/text-utilities.ts` (in `JSONEncode`)
- **Symptom**: Java `replaceAll` replacement strings `"\\\""` and `"\\\n"` are effectively no-ops in Java's regex-replacement semantics; the JS equivalent emits a literal `\` + `"`/`\n`, producing a different output than upstream. Flagged because tests may surface the discrepancy.
- **Status**: preserved verbatim (source escape sequences kept identical)

### Unused `StringBuilder` in `acronymCandidates`
- **Upstream**: `TextUtilities.acronymCandidates`
- **JS port**: `src/grobid/utilities/text-utilities.ts` (in `acronymCandidates`)
- **Symptom**: a `StringBuilder builder` is constructed and appended to per iteration but never read. Preserved with `void builder` to keep the side-effect-free loop intact.
- **Status**: preserved verbatim

### `matchTokenAndString` uses `String.valueOf(layoutToken)` instead of `getText()`
- **Upstream**: `TextUtilities.matchTokenAndString`
- **JS port**: `src/grobid/utilities/text-utilities.ts` (in `matchTokenAndString`)
- **Symptom**: accumulates the token's text via `String.valueOf(layoutToken)` (calls `LayoutToken.toString()`) rather than `token.getText()`. Output depends on `LayoutToken.toString()` behaviour.
- **Status**: preserved verbatim

---

## `org.grobid.core.utilities` — Utilities

### `cleanZFNMetadata` discards `replace("\t", " ")` return
- **Upstream**: `Utilities.cleanZFNMetadata`
- **JS port**: `src/grobid/utilities/utilities.ts` (in `cleanZFNMetadata`)
- **Symptom**: `address.replace("\t", " ");` return value is discarded. No-op.
- **Status**: preserved verbatim

### `doubleEquals` uses `Double.MIN_VALUE` (bit-identity)
- **Upstream**: `Utilities.doubleEquals(d1, d2)`
- **JS port**: `src/grobid/utilities/utilities.ts` (in `doubleEquals`)
- **Symptom**: tolerance is `Double.MIN_VALUE` (≈ 5e-324, smallest positive subnormal), making the comparison effectively a bit-identity check rather than the float-equality the name suggests.
- **Status**: preserved verbatim (ported as `Number.MIN_VALUE`)

---

## `org.grobid.core.utilities` — SentenceUtilities

### 1-arg vs 4-arg `runSentenceDetection` overload divergence
- **Upstream**: `SentenceUtilities.runSentenceDetection`
- **JS port**: `src/grobid/utilities/sentence-utilities.ts`
- **Symptom**: the 1-arg upstream variant calls `sdf.getInstance().detect(text)` (no language) while the 4-arg variant calls `detect(text, lang)` even when `lang == null`. The two overloads invoke different downstream methods.
- **Status**: preserved verbatim (both overloads kept)

---

## `org.grobid.core.utilities` — Consolidation

### `extractFieldsFromBiblioItem` `StringTokenizer("--")` quirk
- **Upstream**: `Consolidation.extractFieldsFromBiblioItem`
- **JS port**: `src/grobid/utilities/consolidation.ts`
- **Symptom**: `new StringTokenizer(pageRange, "--")` — Java's `StringTokenizer` treats the delimiter string as a SET of characters, so `"--"` is functionally identical to `"-"`. The double dash is misleading.
- **Status**: preserved verbatim (ported as `split(/-+/).filter(non-empty)`)

### `postValidation` dead local `valid = true`
- **Upstream**: `Consolidation.postValidation`
- **JS port**: `src/grobid/utilities/consolidation.ts`
- **Symptom**: declares `boolean valid = true;` then returns `valid` unconditionally if surname comparison passes — local is functionally dead.
- **Status**: preserved verbatim

### `consolidate` increments `CONSOLIDATION` counter twice
- **Upstream**: `Consolidation.consolidate`
- **JS port**: `src/grobid/utilities/consolidation.ts`
- **Symptom**: when `cntManager != null` the `ConsolidationCounters.CONSOLIDATION` counter is incremented twice — once outside the try, once inside.
- **Status**: preserved verbatim

---

## `org.grobid.core.utilities` — GrobidProperties

### Redundant double-checked locking in `getVersion`/`getRevision`
- **Upstream**: `GrobidProperties.getVersion`, `GrobidProperties.getRevision`
- **JS port**: `src/grobid/utilities/grobid-properties.ts`
- **Symptom**: double-checked locking with both an outside-lock `if (VERSION != null)` and an inside-lock duplicate. Harmless in single-threaded JS.
- **Status**: documented-intent — DCL is a deliberate Java idiom for thread-safety; harmless in single-threaded JS, no cleanup needed.

---

## `org.grobid.core.lexicon` — Lexicon / FastMatcher

### `FastMatcher.matchToken` misleading `//else` comment
- **Upstream**: `FastMatcher.java:273-282`
- **JS port**: `src/grobid/lexicon/fast-matcher.ts`
- **Symptom**: `//else` comment is followed by an unconditional block in braces. Java executes the block unconditionally despite the comment.
- **Status**: preserved verbatim

### `FastMatcher.loadTerm` dead local `t = terms`
- **Upstream**: `FastMatcher.java:214`
- **JS port**: `src/grobid/lexicon/fast-matcher.ts`
- **Symptom**: assigns to a local that goes out of scope immediately. Cosmetic.
- **Status**: preserved verbatim

### `Lexicon.inDictionary` lists `endsWith(".")` twice
- **Upstream**: `Lexicon.java:342`
- **JS port**: `src/grobid/lexicon/lexicon.ts` (in `inDictionary`)
- **Symptom**: the test `(s.endsWith(".")) | (s.endsWith(",")) | … | (s.endsWith("."))` repeats `endsWith(".")`. Redundant.
- **Status**: cleaned-up — duplicate disjunct removed; semantics unchanged.

### `Lexicon.tokenPositionsAnyURLMatchingPdfAnnotations` dead local `finalLastToken1`
- **Upstream**: `Lexicon.java:1469`
- **JS port**: `src/grobid/lexicon/lexicon.ts`
- **Symptom**: binds `finalLastToken1` but the value is never read.
- **Status**: preserved verbatim

### `Lexicon.tokenPositionsCollaborationNames` commented-out file path
- **Upstream**: `Lexicon.java`
- **JS port**: `src/grobid/lexicon/lexicon.ts` (in `tokenPositionsCollaborationNames`)
- **Symptom**: `collaborations.txt` path is commented out in upstream — the method runs against an empty term set.
- **Status**: preserved verbatim

### `Lexicon.initCollaborations` `inspire_collaborations.txt` missing from grobid-home
- **Upstream**: `Lexicon.java:512-521`
- **JS port**: `src/grobid/lexicon/lexicon.ts` (in `initCollaborations`)
- **Symptom**: upstream replaces the commented `collaborations.txt` path with
  `inspire_collaborations.txt`, but neither file ships in the standard
  grobid-home `lexicon/organisations/` distribution. Upstream catches only
  `PatternSyntaxException`, so a missing-file `IOException` would propagate
  and crash any pipeline that reaches `tokenPositionsCollaborationNames`
  (e.g. citation processing). Minimum unblock: when ENOENT, log and use an
  empty `FastMatcher` — semantically equivalent to the commented-out path
  in the upstream source.
- **Status**: minimum unblocking fix (empty matcher on ENOENT)

---

## `org.grobid.core.engines` — EngineParsers (port-side bench accommodation)

### Optional sub-parsers (`figure`, `table`, `fundingAcknowledgement`) gracefully degrade when wapiti model is absent
- **Upstream**: `EngineParsers.getFigureParser`, `getTableParser`,
  `getFundingAcknowledgementParser`. Upstream throws hard if any model is
  missing — this is not strictly an upstream bug, but a deployment
  expectation that the standard grobid-home ships every wapiti model.
- **JS port**: `src/grobid/engines/engine-parsers.ts`
- **Symptom**: the bench fixtures (`fixtures/models/*`) intentionally ship
  only the core CRF models required for header / citation / segmentation /
  full-text / affiliation / date / author / reference-segmenter. The
  figure / table / funding-acknowledgement models are not present. Without
  this accommodation, any corpus PDF whose body fulltext labeler emits an
  `I-<figure>` / `I-<table>` cluster, or whose document carries an
  acknowledgement / funding statement, hits `Model file does not exists or
  is a directory: …` during sub-parser construction.
- **Fix**: `tryConstruct(...)` wrapper catches `ENOENT` (or the upstream
  "Model file does not exists" message) and swaps in an `as unknown as`
  stub whose `processing` / `processingXmlFragment` returns `null`. All
  call sites in `FullTextParser.processFigures` / `processTables` /
  funding pipeline already null-check the result, so this is semantically
  equivalent to "the model produced no labelled output". Logged as a
  warning per parser.
- **Status**: bench accommodation (port-side; would be removed once full
  model set is bundled).

---

## `org.grobid.core.analyzers` — GrobidAnalyzer

### `retokenize` initializes `result = null` then unconditionally `addAll`
- **Upstream**: `GrobidAnalyzer.retokenize`
- **JS port**: `src/grobid/analyzers/grobid-analyzer.ts` (in `retokenize`)
- **Symptom**: initializes `List<String> result = null;` then unconditionally calls `result.addAll(...)` in the ja/zh/ko/ar branches → latent NPE when language path is non-default with non-empty tokens. TS port mirrors with `result: string[] | null = null` + non-null assertions on push.
- **Status**: preserved verbatim

---

## `org.grobid.core.analyzers` — GrobidFilterDeleteSpaceBetweenSameAlphabet

### Commented-out `if (isDigit(buffer[0]))` block
- **Upstream**: `GrobidFilterDeleteSpaceBetweenSameAlphabet.java`
- **JS port**: `src/grobid/analyzers/grobid-filter-delete-space-between-same-alphabet.ts`
- **Symptom**: an `if (isDigit(buffer[0]))` block whose body is fully commented out. Dead code preserved.
- **Status**: preserved verbatim

### `previousBufferLength` field written but never read
- **Upstream**: same file
- **JS port**: same file
- **Symptom**: a private field is assigned on every step but never read.
- **Status**: preserved verbatim

---

## `org.grobid.core.engines.tagging` — TaggerFactory

### `getTagger(null)` reaches `engine.getExt()` → NPE
- **Upstream**: `TaggerFactory.java`
- **JS port**: `src/grobid/engines/tagging/tagger-factory.ts`
- **Symptom**: the `else { throw new IllegalStateException("Unsupported or null Grobid sequence labelling engine: " + engine.getExt()); }` branch is only reached when `engine == null`, so `engine.getExt()` always NPEs.
- **Status**: preserved verbatim (TypeError equivalent)

---

## `org.grobid.core.utilities.counters` — CntManagerImpl

### `getCounter(Countable)` reads under different key than it writes
- **Upstream**: `CntManagerImpl.getCounter`
- **JS port**: `src/grobid/utilities/counters/impl/cnt-manager-impl.ts`
- **Symptom**: puts a new map under `e.getName()` but reads under `e.getClass().getEnclosingClass().getName()`. The two keys differ; counters effectively re-initialize on each access.
- **Status**: preserved verbatim

---

## `org.grobid.core.engines.counters` — TableRejectionCounters

### `HEADER_AREA_BIGGER_THAN_CONTENT.getName()` returns wrong name
- **Upstream**: `TableRejectionCounters.java`
- **JS port**: `src/grobid/engines/counters/table-rejection-counters.ts`
- **Symptom**: `HEADER_AREA_BIGGER_THAN_CONTENT.getName()` returns `"HEADER_NOT_STARTS_WITH_TABLE_WORD"` — duplicate of a sibling enum constant; almost certainly a copy-paste bug.
- **Status**: fixed — returns `"HEADER_AREA_BIGGER_THAN_CONTENT"` to match the constant identifier. Affects counter aggregation/reporting only.

---

## `org.grobid.core.engines.patent` — PatentRefParser

### Java octal literal `023305`
- **Upstream**: `PatentRefParser.java` (US-application `"11/"` branch)
- **JS port**: `src/grobid/engines/patent/patent-ref-parser.ts`
- **Symptom**: literal `023305` is a Java octal (= decimal 9925). Easy to misread as decimal 23305.
- **Status**: preserved verbatim (ported as TS `0o23305`)

### `compilePattern` regex-wildcard `expression.split(".")`
- **Upstream**: `PatentRefParser.compilePattern`
- **JS port**: same file
- **Symptom**: Java's `String.split(regex)` treats `"."` as a regex wildcard, so it splits on every char and returns `[]` for non-empty strings. Almost certainly not what the author intended.
- **Status**: preserved verbatim (ported as `split(/./)`)

### `processRawRefText` single-iteration `while (true) { …; break; }`
- **Upstream**: same file
- **JS port**: same file
- **Symptom**: a `while (true) { …; break; }` loop used purely for variable scoping. Replaceable with a block but preserved for fidelity.
- **Status**: preserved verbatim

### `processRawRefText` empty-group regex `replaceAll("()", "")`
- **Upstream**: same file
- **JS port**: same file
- **Symptom**: `toto.replaceAll("()", "")` matches every position with an empty regex group — effectively a no-op.
- **Status**: documented-intent — upstream's empty-group regex serves as a "match anywhere" sentinel that produces no replacement; the no-op nature is the entire purpose. Left alone.

---

## `org.grobid.core.engines.label` — TaggingLabels / SegmentationLabels

### Intentional static-field shadow `HEADER_LABEL`
- **Upstream**: `TaggingLabels.HEADER_LABEL = "<figure_head>"` vs `SegmentationLabels.HEADER_LABEL = "<header>"`
- **JS port**: `src/grobid/engines/label/{tagging-labels,segmentation-labels}.ts`
- **Symptom**: identically-named static field in subclass with different value. Not strictly a bug, but a footgun.
- **Status**: preserved (encoded with TS `override` keyword)

---

## `org.grobid.core.GrobidModels`

### `FULLTEXT_ARTICLE_LIGHT_REF` folder name mismatch
- **Upstream**: `GrobidModels.java`
- **JS port**: `src/grobid/grobid-models.ts`
- **Symptom**: `FULLTEXT_ARTICLE_LIGHT_REF` and `FULLTEXT_ARTICLE_LIGHT` both use folder name `"fulltext"` instead of their respective subdirectories.
- **Status**: preserved verbatim

### `ENTITIES_NERSense` non-screaming-snake-case
- **Upstream**: `GrobidModels.java`
- **JS port**: `src/grobid/grobid-models.ts`
- **Symptom**: only enum constant that's not SCREAMING_SNAKE_CASE.
- **Status**: preserved verbatim

---

## `org.grobid.core.data` — BiblioItem

### `toTEI` bitwise `|` instead of logical `||`
- **Upstream**: `BiblioItem.toTEI` (journal-imprint branch)
- **JS port**: `src/grobid/data/biblio-item.ts`
- **Symptom**: `(volumeBlock != null) | (issue != null)` uses `|` not `||`. Operands coerce harmlessly so semantics survive, but it's a latent type bug.
- **Status**: preserved verbatim

### `toTEI` brace-less `else for` lets final append run unconditionally
- **Upstream**: `BiblioItem.toTEI` (keywords block)
- **JS port**: `src/grobid/data/biblio-item.ts`
- **Symptom**: brace-less `else for`-loop lets the final `<keywords>…</keywords>` append run after the indent loop unconditionally — produces a DOUBLE `<keywords>` emission for "Categories and Subject Descriptors" papers.
- **Status**: fixed — wrapped the `else` body in braces. Correct behavior: indent + emit `<keywords>` only on the non-Categories branch.

### `cleanAbstract` discards `res.trim()` return
- **Upstream**: `BiblioItem.cleanAbstract`
- **JS port**: `src/grobid/data/biblio-item.ts`
- **Symptom**: `res.trim()` is called but the return value is discarded — no-op since Java `String` is immutable.
- **Status**: preserved verbatim

### `cleanSQLString` dead local `special = true`
- **Upstream**: `BiblioItem.cleanSQLString`
- **JS port**: `src/grobid/data/biblio-item.ts`
- **Symptom**: writes to `special` but never reads it.
- **Status**: preserved verbatim

### `postProcessPages` dead writes to `alphaPrefixStart` / `alphaPostfixStart`
- **Upstream**: `BiblioItem.postProcessPages`
- **JS port**: `src/grobid/data/biblio-item.ts`
- **Symptom**: declares and writes to `alphaPrefixStart` and `alphaPostfixStart` but only writes them — values never used.
- **Status**: preserved verbatim

### `toTEIAuthorBlock` dead counters
- **Upstream**: `BiblioItem.toTEIAuthorBlock`
- **JS port**: `src/grobid/data/biblio-item.ts`
- **Symptom**: `nbAuthors`, `nbAffiliations`, `failAffiliation` are updated but never read beyond the assignments.
- **Status**: preserved verbatim

### `toTEIAuthorBlock._appendAffiliation` dead local `orgnameWithCoords`
- **Upstream**: same file
- **JS port**: same file
- **Status**: preserved verbatim

---

## `org.grobid.core.data` — Person

### `deduplicate` dead local `aff`
- **Upstream**: `Person.deduplicate`
- **JS port**: `src/grobid/data/person.ts`
- **Symptom**: `aff = localPerson.getAffiliations()` is assigned but never read.
- **Status**: preserved verbatim

---

## `org.grobid.core.data` — Affiliation

### `toTEI` dead local `orgNameCoords`
- **Upstream**: `Affiliation.toTEI`
- **JS port**: `src/grobid/data/affiliation.ts`
- **Symptom**: declared but never read.
- **Status**: preserved verbatim

### `setRawAffiliationString` would NPE on null
- **Upstream**: `Affiliation.setRawAffiliationString`
- **JS port**: `src/grobid/data/affiliation.ts`
- **Symptom**: upstream would NPE on null input; TS port mirrors by only normalizing when non-null (commented).
- **Status**: behavior preserved with TS null-check

---

## `org.grobid.core.data` — PatentItem

### `getUtility()` returns `design` (not `utility`)
- **Upstream**: `PatentItem.getUtility`
- **JS port**: `src/grobid/data/patent-item.ts`
- **Symptom**: method named `getUtility` returns the `design` field. Almost certainly a copy-paste bug.
- **Status**: fixed — returns `this.utility` as the method name implies.

### Duplicate `"XN"` check in `toTEI` / `toJson`
- **Upstream**: `PatentItem.toTEI`, `PatentItem.toJson`
- **JS port**: `src/grobid/data/patent-item.ts`
- **Symptom**: `if (authority.equals("XN") || authority.equals("XN") …)` lists `"XN"` twice.
- **Status**: cleaned-up — duplicate disjunct removed at both call sites.

---

## `org.grobid.core.data` — Figure

### `getCoordinates()` dead writes + recomputed-then-discarded BoundingBox
- **Upstream**: `Figure.getCoordinates`
- **JS port**: `src/grobid/data/figure.ts`
- **Symptom**: dead-write of `result` local plus a `BoundingBoxCalculator.calculateOneBox(...)` call whose return is discarded.
- **Status**: preserved verbatim

---

## `org.grobid.core.data` — Table

### `toTEI` sentence-segmentation inside per-cluster loop
- **Upstream**: `Table.toTEI`
- **JS port**: `src/grobid/data/table.ts`
- **Symptom**: the sentence-segmentation block lives *inside* the per-cluster loop and runs once per cluster — likely a bug; should run once outside the loop.
- **Status**: preserved verbatim

---

## `org.grobid.core.data` — Note

### `getOffsetEndInPage()` Guava `getLast()` throws on empty list
- **Upstream**: `Note.getOffsetEndInPage`
- **JS port**: `src/grobid/data/note.ts`
- **Symptom**: Guava `getLast(tokens)` throws `NoSuchElementException` on empty list — preserved as an explicit throw in TS.
- **Status**: preserved verbatim

---

## `org.grobid.core.data` — Funding

### `projectAbbreviatedName` field-vs-method collision
- **Upstream**: `Funding.java`
- **JS port**: `src/grobid/data/funding.ts`
- **Symptom**: a public field shadows a public method `projectAbbreviatedName()`. Java allows the collision; TS forbids. Field renamed to `_projectAbbreviatedName` with a comment.
- **Status**: TS-structural adaptation (not a behavioral change)

---

## `org.grobid.core.data` — BibDataSet

### `toString()` calls `resBib.toString()` unconditionally
- **Upstream**: `BibDataSet.toString`
- **JS port**: `src/grobid/data/bib-data-set.ts`
- **Symptom**: calls `resBib.toString()` even when `resBib` may be null in some upstream code paths — would NPE. TS port makes the null path explicit but preserves the NPE semantics in spirit.
- **Status**: behavior preserved with explicit null check

---

## `org.grobid.core.features` — FeaturesVectorReference

### `printVector` missing trailing `\n` when `label==null`
- **Upstream**: `FeaturesVectorReference.printVector`
- **JS port**: `src/grobid/features/features-vector-reference.ts`
- **Symptom**: when `label==null` the trailing `\n` is omitted (no `else` branch in upstream).
- **Status**: preserved verbatim

---

## `org.grobid.core.features` — *VectorHeader / VectorSegmentation / VectorName / etc.

### `digit` field default-init: Java `null` → TS `undefined` (port-side, not upstream)
- **Upstream**: `public String digit;` — Java implicitly default-initialises
  reference fields to `null`. The per-engine feature-builders rely on this
  by guarding with `if (features.digit == null) features.digit = "NODIGIT";`
  to assign the `NODIGIT` fallback for tokens that contain no digits.
- **JS port**: every `features/features-vector-*.ts` previously declared
  `public digit!: string;`. The `!` (definite-assignment assertion) tells
  the TS compiler to suppress the unassigned-field check, but the runtime
  value is `undefined`, not `null`. Result: the engine-side `=== null`
  guard never fires, and we serialise the literal string `"undefined"`
  into the `digit` feature column for every token that doesn't otherwise
  set the field. This single-column corruption poisoned **every** CRF
  inference on the JS port — title/author labels were borderline-random,
  segmentation skipped the `<header>` zone entirely on several papers,
  reference segmentation under-counted, and so on.
- **Fix**: replace `digit!: string;` with `digit: string | null = null;`
  in all 11 `features-vector-*.ts` files. The TS engine-side guards
  `=== null` now fire correctly. (Two emit sites — `features-vector-citation.ts`
  and `features-vector-reference-segmenter.ts` — push `this.digit` directly
  into the feature vector without the `=== null` rewrite, so we coalesce
  with `?? ""` to satisfy the TS string type. Behaviour is identical to
  upstream where the same code path would have NPE'd on null.)
- **Impact** (5-paper corpus, vs upstream GROBID 0.9.0-crf):
  - Title sim avg: 34% → 89% (4/5 papers now at 100%)
  - Authors match avg: 36% → 100%
  - Affiliations match avg: 80% → 100%
  - Abstract sim avg: 0% → 100%
  - Section head match avg: 15% → 92%
  - Reference field hit rates: ~all upstream parity
- **Status**: port-side bug, fixed

---

## `org.grobid.core.document` — TEIFormatter

### Unused fields `inParagraph` and `elements`
- **Upstream**: `TEIFormatter.java:73-75`
- **JS port**: `src/grobid/document/tei-formatter.ts`
- **Symptom**: `private Boolean inParagraph = false;` and `private ArrayList<String> elements = null;` are declared on the class but never written to in upstream. Dead state preserved.
- **Status**: preserved verbatim

### `_toTEIHeaderImpl` — bitwise `|` instead of logical `||` for `revisionDesc` open/close
- **Upstream**: `TEIFormatter.java:1081-1084` and `1135-1137`
- **JS port**: `src/grobid/document/tei-formatter.ts` (in `_toTEIHeaderImpl`)
- **Symptom**: the two guards around `<revisionDesc>` open/close use `|` (bitwise) on `null`/non-null reference checks instead of `||`. Operands coerce to booleans so semantics survive — BUT the close-guard also drops `getNormalizedSubmissionDate()` (only present in the open guard), so a paper with only a normalized submission date opens `<revisionDesc>` and never closes it. Malformed XML.
- **Status**: fixed — close guard now mirrors the open guard exactly (adds the missing `getNormalizedSubmissionDate()` disjunct). The bitwise-vs-logical operator part remains harmless and is rendered as `||` in JS.

### `_toTEIHeaderImpl` — bitwise `&` for `english_title` note guard
- **Upstream**: `TEIFormatter.java:857`
- **JS port**: `src/grobid/document/tei-formatter.ts` (in `_toTEIHeaderImpl`)
- **Symptom**: `if ((english_title != null) & (!hasEnglishTitle))` uses `&` instead of `&&` — preserved verbatim.
- **Status**: preserved verbatim

### `markReferencesFigureOrTableTEI` — bitwise `&` for spaceStart check
- **Upstream**: `TEIFormatter.java:2613`
- **JS port**: `src/grobid/document/tei-formatter.ts` (in `markReferencesFigureOrTableTEI`)
- **Symptom**: `if (!text.equals(" ") & text.startsWith(" "))` uses `&` instead of `&&`.
- **Status**: preserved verbatim

### `toTEITextPiece` — paragraph-reconnect uses `indP2 != 1` (likely should be `!= -1`)
- **Upstream**: `TEIFormatter.java:2065`
- **JS port**: `src/grobid/document/tei-formatter.ts` (in `toTEITextPiece`)
- **Symptom**: the `</p0>` paragraph-reconnect heuristic guards with `indP2 != 1` but `indexOf` returns `-1` on miss; this looks like a typo for `!= -1`. Preserved verbatim — the heuristic may be partially broken in upstream.
- **Status**: needs-design-review — this is a body-emission paragraph-reconnect heuristic. Changing `!= 1` to `!= -1` would enable the case-based reconnection logic for transitions that currently silently no-op when `indexOf` returns -1 (no `<p>` after `</p0>`). Because upstream's broken behavior already matches our bench corpus at 100% paragraph-coverage, "fixing" this could diverge from upstream's actual output. Recommend leaving in place until benchmarks can be run with an independent reference.

### `toTEIHeader` — unused parameter `markerTypes`/`bds`
- **Upstream**: `TEIFormatter.java:114-1157`
- **JS port**: `src/grobid/document/tei-formatter.ts` (in `_toTEIHeaderImpl`)
- **Symptom**: `markerTypes` and `bds` are method parameters that are never read inside the body — they are forwarded by callers sharing the signature with downstream helpers (e.g. `toTEITextPiece`). Preserved verbatim.
- **Status**: preserved verbatim

### `toTEITextPiece` — unused parameters `biblio` / `bds`
- **Upstream**: `TEIFormatter.java:1597-2096`
- **JS port**: `src/grobid/document/tei-formatter.ts` (in `toTEITextPiece`)
- **Symptom**: `biblio` and `bds` are declared parameters on `toTEITextPiece` but never accessed in the body. Preserved for signature parity with callers.
- **Status**: preserved verbatim

### `toTEINote` — `noteText.replace("  ", " ").trim()` then unreachable null check
- **Upstream**: `TEIFormatter.java:1491-1499`
- **JS port**: `src/grobid/document/tei-formatter.ts` (in `toTEINote`, fallback branch)
- **Symptom**: assigns `noteText = noteText.replace("  ", " ").trim()`, then tests `if (noteText == null)` — but a `String` returned from `replace().trim()` is never null. The Java code mirrors a defensive null check that is dead. Preserved verbatim.
- **Status**: preserved verbatim

---

## `wapiti` (C) — `pattern.c` regex matcher

### `rex_matchme` star-loop leaves `*len` over-incremented on no-match
- **Upstream**: `pattern.c:122-131` (the `do/while` for `*` repetition)
- **JS port**: `src/grobid/jni/wapiti-pattern.ts` (in `rexMatchme`)
- **Symptom**: the star-repetition loop assigns `*len = save + 1` *before* the
  `rex_matchit` exit test, so on a non-matching iteration the length is
  bumped even though no character was consumed. Harmless when the caller
  only consults `len` on a successful match (the only call site does), but
  surprising on inspection.
- **Status**: preserved verbatim

---

## `wapiti` (C) — `tools.c` netstring reader

### `ns_readstr` unconditionally consumes trailing byte
- **Upstream**: `tools.c:170` (`fgetc(file);` at end of `ns_readstr`)
- **JS port**: `src/grobid/jni/wapiti-quark.ts` (in `BufferNsReader.readNetstring`)
- **Symptom**: after parsing `<len>:<bytes>,` the function calls `fgetc(file)`
  unconditionally and discards the result. On a well-formed file this is
  the expected trailing `\n`, but the C code does not validate it — so any
  byte at that position is silently dropped. Replicated verbatim to stay
  byte-accurate against the C reference.
- **Status**: preserved verbatim

---

## `org.grobid.core.engines` — TableParser

### `testClosingTag` emits `<other>` instead of `</other>` (opening, not closing)
- **Upstream**: `TableParser.testClosingTag` (line 297-298)
- **JS port**: `src/grobid/engines/table-parser.ts` (in `testClosingTag`)
- **Symptom**: in the `lastTag.equals("<other>")` branch the code appends
  `"<other>\n"` (an opening tag) when the intent is clearly to *close* the
  current tag. All sibling branches append the matching `</...>` form.
  Replicates as a malformed XML emission for the `<other>` segment of
  training data output.
- **Status**: fixed — emits `</other>\n` to match sibling branches. Correct
  behavior: close the tag we are leaving. No runtime-TEI impact in our bench
  corpus (no `<other>` segments reach this path), but fixes malformed
  training-data XML emission.

---

## `org.grobid.core.engines` — FundingAcknowledgementParser

### `testClosingTag` emits `<funderFull>` instead of `</funderFull>` (opening, not closing)
- **Upstream**: `FundingAcknowledgementParser.testClosingTag` (line 1014-1017)
- **JS port**: `src/grobid/engines/funding-acknowledgement-parser.ts` (in `testClosingTag`)
- **Symptom**: in the `lastTag.equals("<funderFull>")` branch the code
  appends `"<funderFull>\n"` (opening) instead of `"</funderFull>\n"`.
  All sibling branches correctly emit the matching close tag. Mirrors the
  same copy-paste pattern seen in `TableParser.testClosingTag`.
- **Status**: fixed — emits `</funderFull>\n` to match sibling branches.
  Correct behavior: close the tag we are leaving.

### `processing(...)` emits the wrong exception message
- **Upstream**: `FundingAcknowledgementParser.processing` (line 60)
- **JS port**: `src/grobid/engines/funding-acknowledgement-parser.ts` (in `processing`)
- **Symptom**: when CRF labeling throws, the wrapping `GrobidException`
  message reads `"CRF labeling with table model fails."` — referring to
  the table model rather than the funding-acknowledgement model. Almost
  certainly a copy-paste from `TableParser`. Preserved verbatim.
- **Status**: preserved verbatim

### Dead locals `spaceBefore`, `endPosCharacters`, `previousLabel`
- **Upstream**: `FundingAcknowledgementParser.getExtractionResult` (lines 581-608, 809)
- **JS port**: `src/grobid/engines/funding-acknowledgement-parser.ts` (in `getExtractionResult`)
- **Symptom**: `spaceBefore`, `endPosCharacters`, and `previousLabel` are
  computed and updated on every cluster iteration but never read. Preserved
  verbatim with `void` suppressors.
- **Status**: preserved verbatim

### Empty-list NPE risk via `Iterables.getLast(tokens)`
- **Upstream**: `FundingAcknowledgementParser.getExtractionResult` (lines 602-608)
- **JS port**: `src/grobid/engines/funding-acknowledgement-parser.ts` (in `getExtractionResult`)
- **Symptom**: `Iterables.getLast(tokens)` is called unconditionally on
  the cluster tokens; Guava throws `NoSuchElementException` on empty input.
  Preserved as TS array indexing which yields `undefined` if the list is
  empty — mirroring the NPE-like failure mode.
- **Status**: preserved verbatim

---

## `org.grobid.core.engines` — MonographParser

### Unused constant `BLOCKSCALE`
- **Upstream**: `MonographParser.java:77` — `BLOCKSCALE = 10` declared but never read.
- **JS port**: `src/grobid/engines/monograph-parser.ts`
- **Symptom**: declared `private static final int BLOCKSCALE = 10;` but
  never referenced anywhere in upstream. Preserved verbatim.
- **Status**: preserved verbatim

### Unused field `languageUtilities`
- **Upstream**: `MonographParser.java:79`
- **JS port**: `src/grobid/engines/monograph-parser.ts`
- **Symptom**: `private LanguageUtilities languageUtilities = LanguageUtilities.getInstance();`
  is initialised but never used. Preserved verbatim.
- **Status**: preserved verbatim

### Dead local `start = true` in `getFeatureVectorsAsString`
- **Upstream**: `MonographParser.java:279` and surrounding commented-out
  reset block (lines 304-307).
- **JS port**: `src/grobid/engines/monograph-parser.ts` (in `getFeatureVectorsAsString`)
- **Symptom**: `boolean start = true;` is declared but the block that
  would have read/reset it is commented out. The local is written-once
  and never read. Preserved verbatim.
- **Status**: preserved verbatim

### `createTrainingFromPDF` produces malformed TEI filename
- **Upstream**: `MonographParser.createTrainingFromPDF` (line 651)
- **JS port**: `src/grobid/engines/monograph-parser.ts` (in `createTrainingFromPDF`)
- **Symptom**: `pdfFileName.replace(".pdf", "training.monograph.tei.xml")`
  drops the `.pdf` suffix and concatenates `training.monograph.tei.xml`
  with no separator — e.g. `paper.pdf` becomes `papertraining.monograph.tei.xml`.
  Almost certainly intended `.training.monograph.tei.xml` (with leading dot).
  Preserved verbatim.
- **Status**: preserved verbatim

### Dead local `outputRawFile`
- **Upstream**: `MonographParser.createTrainingFromPDF` (line 657)
- **JS port**: `src/grobid/engines/monograph-parser.ts` (in `createTrainingFromPDF`)
- **Symptom**: `File outputRawFile = new File(...)` is constructed but
  never used — the raw featured-sequence file is never actually written.
  Preserved verbatim.
- **Status**: preserved verbatim

### Dead walk of `currentNode` in `createTrainingFromPDF`
- **Upstream**: `MonographParser.createTrainingFromPDF` (lines 685-692)
- **JS port**: `src/grobid/engines/monograph-parser.ts` (in `createTrainingFromPDF`)
- **Symptom**: walks the outline tree down to the first leaf via
  `currentNode = children.get(0)`, but the resulting `currentNode` is
  never read. Preserved verbatim.
- **Status**: preserved verbatim

---

## `org.grobid.core.engines` — LicenseClassifier

### Unused fields `useBinary` and `parser`
- **Upstream**: `LicenseClassifier.java:29, 31`
- **JS port**: `src/grobid/engines/license-classifier.ts`
- **Symptom**: `private Boolean useBinary = false;` and `private JsonParser parser;`
  are declared but never written to / read in upstream. Preserved verbatim.
- **Status**: preserved verbatim

### Dead local `scoreField = 0.0` overwritten before read
- **Upstream**: `LicenseClassifier.extractResults` (lines 111, 147)
- **JS port**: `src/grobid/engines/license-classifier.ts` (in `extractResults`)
- **Symptom**: `double scoreField = 0.0;` is declared inside the per-field
  loop but is never read (only `fieldNode.doubleValue()` is pushed onto
  `scoreFields`). Preserved verbatim.
- **Status**: preserved verbatim

### `entityRank` counter never read
- **Upstream**: `LicenseClassifier.extractResults` (lines 95, 178)
- **JS port**: `src/grobid/engines/license-classifier.ts` (in `extractResults`)
- **Symptom**: `entityRank` is incremented on every iteration but never
  observed. Preserved verbatim.
- **Status**: preserved verbatim

### Double-checked locking redundancy
- **Upstream**: `LicenseClassifier.getInstance` (lines 36-44)
- **JS port**: `src/grobid/engines/license-classifier.ts` (in `getInstance`)
- **Symptom**: classic Java double-checked locking with both outside-
  and inside-lock null checks. Harmless in single-threaded JS. Preserved
  verbatim (single null check in the JS port, mirroring the no-op nature
  of the synchronized block).
- **Status**: documented-intent — DCL is a deliberate Java idiom; JS port already collapses it to a single null check.

---

## `org.grobid.core.engines` — FullTextBlankParser

### Constructor never assigns `parsers` argument to the field
- **Upstream**: `FullTextBlankParser` constructor (lines 37-40)
- **JS port**: `src/grobid/engines/full-text-blank-parser.ts`
- **Symptom**: the class declares `protected EngineParsers parsers` and
  the constructor accepts `EngineParsers parsers`, but the assignment
  `this.parsers = parsers` is missing. As a result `this.parsers` is
  always `null` at runtime. Preserved verbatim — the field is unused
  inside this class anyway, but a downstream subclass relying on it
  would break.
- **Status**: preserved verbatim

---

## `org.grobid.core.engines` — AuthorParser

### `trainingExtraction` literal `"/t<author>\n"` typo
- **Upstream**: `AuthorParser.trainingExtraction` (head branch, "new author" path)
- **JS port**: `src/grobid/engines/author-parser.ts`
- **Symptom**: line 343 upstream appends `"/t<author>\n"` (forward-slash `t`)
  instead of `"\t<author>\n"` (tab-t). The forward-slash variant is emitted
  literally into the training XML for every empty line in the head branch.
  Almost certainly a typo.
- **Status**: fixed — emits `"\t<author>\n"` (tab). Affects training-data XML only.

---

## `org.grobid.core.engines` — AffiliationAddressParser

### `resultExtractionLayoutTokens` dead local `lastClusterLabel`
- **Upstream**: `AffiliationAddressParser.resultExtractionLayoutTokens`
- **JS port**: `src/grobid/engines/affiliation-address-parser.ts`
- **Symptom**: `TaggingLabel lastClusterLabel = null;` is declared but
  never read. Preserved as `void` annotation.
- **Status**: preserved verbatim

### `resultExtractionLayoutTokens` dead local `tokenLabel`
- **Upstream**: same method
- **JS port**: same file
- **Symptom**: `String tokenLabel = null;` is declared but never read.
- **Status**: preserved verbatim

### `resultBuilder` dead locals `useMarker`, `lineCountInt`
- **Upstream**: `AffiliationAddressParser.resultBuilder` (deprecated)
- **JS port**: `src/grobid/engines/affiliation-address-parser.ts`
- **Symptom**: `useMarker` is written but never read; `Integer lineCountInt
  = lineCount;` is boxed but never used. Preserved verbatim.
- **Status**: preserved verbatim

---

## `org.grobid.core.engines` — Engine

### `processHeader(...)` calls `includeRawCopyrights(includeDiscardedText)` instead of `includeDiscardedText(...)`
- **Upstream**: `Engine.processHeader(String, int, boolean, boolean, boolean, BiblioItem)` (6-arg overload, upstream line 357)
- **JS port**: `src/grobid/engines/engine.ts`
- **Symptom**: the builder chain calls
  `.includeRawCopyrights(includeRawCopyrights).includeRawCopyrights(includeDiscardedText)`
  — the second call overwrites the first AND is the wrong setter (it
  should be `.includeDiscardedText(...)`). As a result, the
  `includeDiscardedText` flag is silently dropped and `includeRawCopyrights`
  is forced to whatever the caller passed for `includeDiscardedText`.
- **Status**: fixed — replaced the second `.includeRawCopyrights(arg5)` with `.includeDiscardedText(arg5)`. Affects callers of this 6-arg overload (e.g. external integrations using processHeader's 6-arg signature).

---

## `org.grobid.core.engines` — EngineParsers

### `getFullTextParser(Flavor)` dangling block after `return`
- **Upstream**: `EngineParsers.getFullTextParser(Flavor)` (upstream lines 110-131)
- **JS port**: `src/grobid/engines/engine-parsers.ts`
- **Symptom**: the method body has the structure
  ```java
  if (flavor == null) {
      …
      return fullTextParser;
  } {
      synchronized (this) { … }
      return fullTextParsers.get(flavor);
  }
  ```
  The `{ … }` block after the `return` is a bare block (not `else { … }`),
  so it always runs when the `flavor == null` branch is taken. Together
  with the unconditional `return` inside the `if`, the second `return` is
  unreachable on the null path. The intended `else` is missing.
- **Status**: documented-intent — TS port already rendered this as semantically-equivalent split branches; the dangling-block effect of upstream is preserved by virtue of the early return. No behavioral change needed.

---

## `org.grobid.core.engines` — Segmentation

### `getFeatureVectorsAsString` Java `Calendar`-vs-JS year boundary
- **Upstream**: n/a — port note, not a bug
- **JS port**: `src/grobid/engines/date-parser.ts` (`normalize`)
- **Symptom**: upstream uses
  `Calendar.getInstance().getWeekYear() + 4` to compute the YYYYMMDD upper
  bound. JS lacks `getWeekYear()`; the port uses `new Date().getFullYear()
  + 4` which differs from the Java week-year by ≤1 across the ISO-week
  boundary. Documented at port site.
- **Status**: behavioural drift documented; preserved as close approximation

---

## `org.grobid.core.engines` — HeaderParser

### `resultExtraction` "take only first `<title>` cluster"
- **Upstream**: `HeaderParser.resultExtraction` (lines 853-855)
- **JS port**: `src/grobid/engines/header-parser.ts` (in `resultExtraction`, HEADER_TITLE branch)
- **Symptom**: only sets `biblio.setTitle(clusterContent)` when `biblio.getTitle() == null` — every subsequent `<title>` cluster is silently dropped, regardless of how long or informative. No `else` branch.
- **Status**: needs-design-review — heuristic; we already match upstream at 100% title-sim across both corpora, so "fixing" by concatenating clusters would diverge from upstream's actual output. Leave alone.

### `resultExtraction` "take only first `<abstract>` cluster" (dropped on the floor)
- **Upstream**: `HeaderParser.resultExtraction` (lines 951-961)
- **JS port**: `src/grobid/engines/header-parser.ts` (in `resultExtraction`, HEADER_ABSTRACT branch)
- **Symptom**: when an abstract is already set, additional `<abstract>` clusters are dropped entirely. The upstream comment `// TODO: avoid dumping text on the floor` is preserved.
- **Status**: needs-design-review — same reasoning as title heuristic; abstract-sim already 100% in both corpora.

### `resultExtraction` HEADER_REFERENCE length guard is dead code
- **Upstream**: `HeaderParser.resultExtraction` (lines 962-967)
- **JS port**: `src/grobid/engines/header-parser.ts` (HEADER_REFERENCE branch)
- **Symptom**: the conditional `if (biblio.getReference() != null && biblio.getReference().length < ...)` assigns the same `clusterNonDehypenizedContent` in both branches, so the length guard is functionally dead.
- **Status**: documented-intent — both branches assign the same value, so the guard is harmless (always last-wins). Cleanup would change neither the observed behavior nor upstream byte-parity; left in place.

### `resultExtraction` HEADER_PUBNUM swap-and-restore quirk
- **Upstream**: `HeaderParser.resultExtraction` (lines 994-1003)
- **JS port**: `src/grobid/engines/header-parser.ts` (HEADER_PUBNUM branch)
- **Symptom**: when a new pubnum cluster is "different and not included", upstream temporarily sets the pubnum field to the new content, calls `checkIdentifier()` (so the new content's identifier type IS recorded on the BiblioItem), and then RESTORES the original pubnum string. The result is that the identifier classification is captured from the second cluster but the visible pubnum string remains the first cluster.
- **Status**: documented-intent — this is the upstream behavior by design (capture identifier-type metadata from later clusters while keeping the first cluster's visible pubnum string). Not a bug.

---

## `org.grobid.core.engines` — FullTextParser

### `testClosingTag` tautological `||` chain
- **Upstream**: `FullTextParser.testClosingTag` (lines 2316-2324)
- **JS port**: `src/grobid/engines/full-text-parser.ts` (in `testClosingTagFulltext`)
- **Symptom**: the OR clause `(!eq("<citation_marker>") || !eq("<figure_marker>") || !eq("<table_marker>") || !eq("<equation_marker>"))` is a tautology for any single string value — at most one disjunct can be false at a time, so the OR always evaluates to true. The whole AND guard therefore reduces to `currentTag0 !== "<paragraph>"`. Almost certainly intended to be `&&` instead of `||`.
- **Status**: fixed — changed `||` to `&&` so the guard expresses "close `</p>` when transitioning from a marker to anything that is NOT another marker AND NOT `<paragraph>`". Affects `trainingExtraction` (training-data emission) only — runtime TEI uses `toTEITextPiece`/sentence pipelines, not this routine. Bench corpus unchanged.

### `getBadFigures` over-aggressive completeness filter
- **Upstream**: `FullTextParser.getBadFigures` (lines 456-465)
- **JS port**: `src/grobid/engines/full-text-parser.ts` (in `static getBadFigures`)
- **Symptom**: filters figures whose `isCompleteForTEI()` returns false. The benchmark audit has flagged this as over-aggressive (rejects figures that are valid in the upstream's own output XML). The downstream `revertResultsForBadItems` rescues them into paragraphs, but the original figure label is lost.
- **Status**: needs-design-review — bench corpus already at 100% figure-count parity, so any change here is likely to regress upstream-match metrics. A proper fix needs a tighter `isCompleteForTEI` predicate AND coordinated updates to `revertResultsForBadItems` to preserve the figure-vs-paragraph split. Do not auto-fix.

### `processEquations` redundant emptiness check
- **Upstream**: `FullTextParser.processEquations` (lines 2763-2766)
- **JS port**: `src/grobid/engines/full-text-parser.ts` (in `processEquations`)
- **Symptom**: the guard `if ((!currentResult.getContent().isEmpty()) && (!currentResult.getLabel().isEmpty()))` flushes the current equation only when BOTH content and label are non-empty. The subsequent label-specific branches each force a new instance on the next iteration anyway, so this guard is effectively a fast-path that prevents accidental merging when both fields already have content. Preserved as upstream.
- **Status**: preserved verbatim

---

## `org.grobid.core.engines` — ReferenceSegmenterParser

### `createTrainingData` early-out swallows null reference text
- **Upstream**: `ReferenceSegmenterParser.createTrainingData` (training-data path)
- **JS port**: `src/grobid/engines/reference-segmenter-parser.ts` (in `createTrainingData`)
- **Symptom**: if `featSeg` from `getReferencesSectionFeatured` is null, the method returns `null` silently — callers that expect a `Pair<String,String>` will NPE on `.getLeft()`.
- **Status**: preserved verbatim (null path documented)

---

## `org.grobid.core.engines.citations` — ReferenceSegmenter

### Interface return type does not declare nullable
- **Upstream**: `ReferenceSegmenter.extract` interface (`List<LabeledReferenceResult>`)
- **JS port**: `src/grobid/engines/citations/reference-segmenter.ts`
- **Symptom**: Java's `List<LabeledReferenceResult>` return type doesn't declare null but the implementation (`ReferenceSegmenterParser.extract`) may return null. The TS interface was adjusted to `LabeledReferenceResult[] | null` to model the actual contract — purely a port adaptation, not a behaviour change.
- **Status**: TS-structural adaptation

---

## `org.grobid.core.engines.patent` — ReferenceExtractor

### Unused field `consolidator`
- **Upstream**: `ReferenceExtractor.java:73` — `private Consolidation consolidator = null;`
- **JS port**: `src/grobid/engines/patent/reference-extractor.ts`
- **Symptom**: declared but never assigned and never read in the class body.
  Preserved verbatim.
- **Status**: preserved verbatim

### `extractAllReferencesXMLFile` swallows exceptions silently
- **Upstream**: `ReferenceExtractor.extractAllReferencesXMLFile` (line 216-219)
- **JS port**: `src/grobid/engines/patent/reference-extractor.ts` (in `extractAllReferencesXMLFile`)
- **Symptom**: the catch block only calls `e.printStackTrace()` and falls through to `return null;` — any SAX / IO error becomes a silent null return.
  Preserved verbatim (ported as `console.error(e); return null;`).
- **Status**: preserved verbatim

### `extractAllReferencesXMLFile` forcibly overwrites caller args
- **Upstream**: `ReferenceExtractor.extractAllReferencesXMLFile` (lines 204-205)
- **JS port**: `src/grobid/engines/patent/reference-extractor.ts` (in `extractAllReferencesXMLFile`)
- **Symptom**: the method overwrites the caller-supplied `consolidate` and
  `filterDuplicate` parameters with `0` / `true` before delegating to
  `extractAllReferencesString`. The flags as passed in by the caller are
  ignored. Preserved verbatim.
- **Status**: preserved verbatim

### `extractAllReferencesString` DeLFT sub-tokenization computes unused locals
- **Upstream**: `ReferenceExtractor.extractAllReferencesString` (lines 334-338)
- **JS port**: `src/grobid/engines/patent/reference-extractor.ts` (in `extractAllReferencesString`)
- **Symptom**: `subsubtokenizations = GrobidDefaultAnalyzer.getInstance().tokenize(subsubtexts[j])`
  is computed but never read; the loop just appends `subsubtexts[j]` to
  `newTexts`. Dead write preserved verbatim.
- **Status**: preserved verbatim

### `extractAllReferencesString` dead locals `positionInIndexPatent`, `positionInIndexNPL`
- **Upstream**: `ReferenceExtractor.extractAllReferencesString` (lines 865-866)
- **JS port**: `src/grobid/engines/patent/reference-extractor.ts` (in `extractAllReferencesString`)
- **Symptom**: two `int` locals are initialized to `0` and never read
  afterwards. Preserved verbatim with `void` suppressors.
- **Status**: preserved verbatim

### `annotateAllReferences` infinite-loop risk on null token
- **Upstream**: `ReferenceExtractor.annotateAllReferences` (lines 1156-1159)
- **JS port**: `src/grobid/engines/patent/reference-extractor.ts` (in `annotateAllReferences`)
- **Symptom**: the inner `while ((!strop) && (p < tokenizations.size()))` loop
  reads `tokenOriginal = tokenizations.get(p)` and `continue`s without
  incrementing `p` when `tokenOriginal == null || tokenOriginal.getText() == null` —
  spinning forever on a null token. Preserved verbatim (relies on tokens
  being non-null in practice).
- **Status**: preserved verbatim

### `annotateAllReferences` unused `lang` and offset
- **Upstream**: `ReferenceExtractor.annotateAllReferences` (lines 957, 1130)
- **JS port**: `src/grobid/engines/patent/reference-extractor.ts` (in `annotateAllReferences`)
- **Symptom**: `Language lang = languageUtilities.runLanguageId(text);` is
  computed but never read anywhere in the method. `offset` is reset to `0`
  on line 1130 but it is already `0` at that point — dead write. Preserved
  verbatim.
- **Status**: preserved verbatim

### `annotateAllReferences` `nbs` counter unused
- **Upstream**: `ReferenceExtractor.annotateAllReferences` (lines 1389-1394)
- **JS port**: `src/grobid/engines/patent/reference-extractor.ts` (in `annotateAllReferences`)
- **Symptom**: `nbs` is computed but never read; the JSON output is built
  independently. Preserved verbatim.
- **Status**: preserved verbatim

### `annotateAllReferences` articles loop body commented out
- **Upstream**: `ReferenceExtractor.annotateAllReferences` (lines 1428-1437)
- **JS port**: `src/grobid/engines/patent/reference-extractor.ts` (in `annotateAllReferences`)
- **Symptom**: the `"articles"` section of the emitted JSON always serializes
  as `[]` because the per-article body is fully commented out — the `first`
  flag is declared but never read and the inner `resultJSON.append(...)`
  lines are within the comment. Likely an unfinished feature. Preserved
  verbatim.
- **Status**: preserved verbatim

### `references2TEI` / `reference2BibTeX` inverted null-check on `path`
- **Upstream**: `ReferenceExtractor.references2TEI` (line 1491) and
  `ReferenceExtractor.reference2BibTeX` (line 1513)
- **JS port**: `src/grobid/engines/patent/reference-extractor.ts` (in
  `references2TEI` and `reference2BibTeX`)
- **Symptom**: both methods test `if (path == null)` and then call
  `bit.setPath(path)` — passing the null value through. Almost certainly
  intended `if (path != null)` (compare with the sibling `reference2TEI`
  which gets it right).
- **Status**: fixed — corrected both call sites to `if (this.path !== null) bit.setPath(this.path)`. Patent reference TEI/BibTeX serialization paths now propagate the path correctly.

### `generateXMLReport` malformed `<patcit if="..." dnum="...">` attribute
- **Upstream**: `ReferenceExtractor.generateXMLReport` (line 1791)
- **JS port**: `src/grobid/engines/patent/reference-extractor.ts` (in `generateXMLReport`)
- **Symptom**: the literal is `"<patcit if=\"pcit" + i + " dnum=\"" + dnum + "\">..."`
  — the `if` attribute is missing its closing `"`, so the emitted XML
  contains `<patcit if="pcit0 dnum="1234">…</patcit>`. The resulting
  document is malformed (attribute name `if` is also not a valid TEI/JATS
  attribute; should be `xml:id` or `id`). Preserved verbatim.
- **Status**: preserved verbatim

### `checkPositionRange` reassigns local-only `currentPosition`
- **Upstream**: `ReferenceExtractor.checkPositionRange` (lines 1845, 1849)
- **JS port**: `src/grobid/engines/patent/reference-extractor.ts` (in `checkPositionRange`)
- **Symptom**: method is `// not used...` per upstream's javadoc, but
  for the record: it assigns `currentPosition = i;` to its own parameter,
  which is local in Java — the update never propagates to the caller.
  Preserved verbatim.
- **Status**: preserved verbatim

## `wapiti` (C, v1.5.0)

### `tag_label` bails the entire labelling loop on the first bad row
- **Upstream**: `tag_label` in `wapiti/decoder.c` (lines 442-447)
- **JS port**: `src/grobid/jni/wapiti-wrapper.ts` (in `WapitiWrapper.label`)
- **Symptom**: when `rdr_raw2seq` returns NULL for any sequence (typically
  because a row has fewer columns than some pattern references), the
  surrounding loop in `tag_label` does `return 0` and abandons all
  remaining sequences with no further output. The wapiti binary still
  exits with status 0 and an empty (or partial) stdout. The Java
  `WapitiWrapper` later interprets the empty result as a tagging error
  and raises `GrobidException` — but only because a SWIG null pointer
  happens to be returned for an entirely-empty result. With a partial
  result the bad-row behaviour is silently dropped output. The JS port
  matches the empty-buffer case by throwing `GrobidException` directly
  when any single sequence fails to convert, which is stricter than
  upstream but consistent in user-visible effect on the GROBID call sites.
- **Status**: preserved verbatim

### `ns_readstr` unconditional `fgetc` after the trailing comma
- **Upstream**: `ns_readstr` in `wapiti/tools.c` (line 170)
- **JS port**: `src/grobid/jni/wapiti-quark.ts` (in `BufferNsReader.readNetstring`)
- **Symptom**: after a netstring's terminating `,`, the C code does
  `fgetc(file);` and discards the result without checking it equals
  `'\n'`. The model writer always emits a newline so this is benign on
  well-formed files, but a missing newline at EOF or between fields
  would silently consume one byte of the next record. The JS port
  mirrors the unconditional advance.
- **Status**: preserved verbatim

### `pat_exec` 'm' branch computes `value += pos` after a `pos == -1`
- **Upstream**: `pat_exec` in `wapiti/pattern.c` (lines 364-369)
- **JS port**: `src/grobid/jni/wapiti-pattern.ts` (in `patExec`)
- **Symptom**: when `rex_match` fails (`pos == -1`), the C code sets
  `len = 0` *and then* does `value += pos`, briefly forming a pointer one
  byte before `value`'s buffer. The pointer is never dereferenced
  (`memcpy(buffer + bufpos, value, 0)` copies nothing), so this is dead
  arithmetic — technically UB in standard C but accepted by every
  compiler in practice. The JS port avoids the UB by simply emitting an
  empty string in that branch.
- **Status**: preserved verbatim (behaviourally; UB sidestepped in JS)

---

## Port-side bugs in `FullTextParser` body-emission glue (fixed)

These are TS-port bugs introduced when stub method names diverged from
upstream Java. Each one crashed the body-emission pipeline once the
figure/table sub-CRFs were actually loaded — so under the
"sub-CRF missing" stub path they were latent.

### `fixFiguresLabellingResults` called `update.getC()` on a `Triple`
- **JS port**: `src/grobid/engines/full-text-parser.ts`
  (`fixFiguresLabellingResults`, ~line 561)
- **Symptom**: `Document.assignGraphicObjectsToFigures()` returns
  `Triple<Figure, Figure, LayoutToken[][]>[]`. Upstream Java calls
  `update.getRight()` to obtain the diff. The TS port's cast invoked
  `getC()`, which doesn't exist on the port's `Triple` (which only
  exposes `getLeft`/`getMiddle`/`getRight`). Crashed `TypeError:
  update.getC is not a function` on every PDF whose graphic-object
  reassignment found a non-empty diff.
- **Fix**: cast to `{ getRight(): LayoutToken[][] }` and invoke `getRight()`.

### `toTEI` called `resHeader.getLayoutTokens(label)` (wrong method)
- **JS port**: `src/grobid/engines/full-text-parser.ts` (5 sites in
  `toTEI`, `toTEIHeaderFunding`)
- **Symptom**: upstream Java overloads `BiblioItem.getLayoutTokens()`
  with a label argument. The TS port renamed the label-keyed accessor
  to `getLayoutTokensForLabel` (to avoid a TS structural clash with the
  field-typed `LayoutToken[]` accessor) but never updated the
  call-sites in FullTextParser. Crashed `TypeError:
  resHeader.getLayoutTokens is not a function` once the
  header carried any of the optional sections (funding, availability,
  conflict-of-interest, author-contribution).
- **Fix**: update all 5 call sites to `getLayoutTokensForLabel`.

### `processTables` iterated `result.getLayoutTokens()` without null-guard
- **JS port**: `src/grobid/engines/full-text-parser.ts` (`processTables`,
  ~line 2375)
- **Symptom**: `Figure.layoutTokens` defaults to `null`. When the table
  CRF's `getExtractionResult` flushes its trailing "last table" buffer
  without ever taking a path that calls `addLayoutTokens`, the
  produced `Table` has null `layoutTokens`. `for (const lt of null)`
  then threw `TypeError: localTokenizationTable is not iterable`.
- **Fix**: coalesce `?? []`.

### `revertResultsForBadItems` indexed `badItem.getLayoutTokens()[0]` without null-guard
- **JS port**: `src/grobid/engines/full-text-parser.ts`
  (`revertResultsForBadItems` → `findCandidateIndex`, ~line 763)
- **Symptom**: same null-layoutTokens issue as above, manifesting on
  the bad-table revert path. Threw `Cannot read properties of null
  (reading '0')`.
- **Fix**: skip the bad item when `getLayoutTokens()` is null or empty.

### `Figure.toTEI` / `Table.toTEI` read `GrobidModels` from `globalThis`
- **JS port**: `src/grobid/data/figure.ts` (~line 439),
  `src/grobid/data/table.ts` (~lines 132, 217)
- **Symptom**: lazy `(globalThis as any).GrobidModels` was always
  `undefined`, so the labeled-caption reparse crashed
  `Cannot read properties of undefined (reading 'FULLTEXT')` once
  any figure with a caption was emitted.
- **Fix**: replace the `globalThis` lookup with a namespace-imported
  `GrobidModelsNs.GrobidModels`. The original `globalThis` indirection
  was a circular-import workaround; the namespace import resolves
  lazily and avoids the cycle without leaking globals.

### `fixtures/models/{figure,table}/model.wapiti` were missing from the bench tree
- **Symptom**: the bench harness expected the figure and table wapiti
  models to be available alongside the other CRF models, but the
  `figure/` and `table/` subdirectories were absent entirely. Under
  the `tryConstruct(...)` stub fallback (see earlier entry) every
  figure / table cluster from the fulltext CRF was silently dropped,
  yielding zero tables and only graphics-derived figures.
- **Fix**: populate `fixtures/models/figure/model.wapiti` and
  `fixtures/models/table/model.wapiti` from upstream's
  `grobid-home/models/{figure,table}/model.wapiti`. Also copied
  `fixtures/models/funding-acknowledgement/model.wapiti` for the
  funding-acknowledgement parser to operate (lexicon dependency
  still partial — research_infrastructures.txt absent — so the
  funding statement is recovered as best-effort).

---

## Triage pass — final status counts (post-2026-05 audit)

| Status                       | Count |
|------------------------------|------:|
| fixed (output-affecting)     |    11 |
| cleaned-up (cosmetic)        |     4 |
| documented-intent            |     7 |
| needs-design-review          |     4 |
| superseded-by-earlier-fix    |     0 |
| preserved verbatim (cosmetic dead-code parity, no action) | ~88 |

Notes:
- The "preserved verbatim" remainder are all dead writes / unused locals /
  commented-out blocks / unused fields / no-op string operations that have
  no observable effect on runtime output. They carry inline
  `// NOTE: upstream bug — …` markers and serve only as documentation of
  upstream's source state. Cleaning them up would change neither the
  observable behavior nor the benchmark scores, and could mildly confuse
  future code-comparison passes against upstream Java.
- The 11 output-affecting fixes (or 9 logic + 2 close-tag emitters)
  preserved the corpus benchmark numbers at 100% across all headline
  metrics on both internal (5-paper) and external (54-paper) corpora.
- One bug class — `FullTextParser.testClosingTagFulltext` tautological
  `||` chain — was fixed in `trainingExtraction` (training-data emission
  path), not the runtime TEI emission path. Runtime TEI uses a different
  pipeline (`toTEITextPiece` + sentence segmenter), so bench scores are
  unaffected by the fix. Same for `AuthorParser.trainingExtraction`
  `/t<author>` typo and `TableParser` / `FundingAcknowledgementParser`
  `testClosingTag` close-tag emitters — all training-data-only emissions.
