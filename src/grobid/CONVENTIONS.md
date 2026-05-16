# Java → TypeScript port conventions

This directory mirrors `kermitt2/grobid` `grobid-core` package layout
1:1 at tag `0.9.0`. Every Java class in the active scope (see
`PORT-INVENTORY.md`) has exactly one TypeScript file.

## File and class naming

- `org/grobid/core/engines/HeaderParser.java` → `src/grobid/engines/header-parser.ts`
- Class name preserved verbatim inside the file:
  ```ts
  export class HeaderParser extends AbstractParser { … }
  ```
- Static helpers stay as static methods on the class, not standalone functions.
- Inner classes → exported separately from the same file, name preserved.
- Constants on Java classes → `static readonly` fields.

## Java → TS type mapping

| Java | TypeScript |
|---|---|
| `String` | `string` |
| `int` / `long` / `double` / `float` | `number` |
| `boolean` | `boolean` |
| `byte[]` / `int[]` | `Uint8Array` / `number[]` (context-dependent) |
| `List<T>` / `ArrayList<T>` | `T[]` (mutable) or `readonly T[]` (read-only views) |
| `Map<K, V>` / `HashMap` | `Map<K, V>` |
| `Set<T>` / `HashSet` | `Set<T>` |
| `SortedMap` / `TreeMap` | `Map<K, V>` with explicit sorting on access |
| `Optional<T>` | `T | undefined` |
| `null` (object) | `undefined` (default) — use `null` only when distinguishing from "not set" |
| `enum X { A, B }` | `enum X { A, B }` or string union (`"A" | "B"`) |
| `Class<? extends X>` | `new(...args: any[]) => X` |

## Method signatures

- Method names: keep camelCase verbatim (`getDocumentPart`, `processingHeaderSection`).
- Overloads: collapse into a single signature with `?` / `|` types, OR use TS overload signatures when the bodies materially differ.
- `throws` clauses → just `throw new Error(...)` (TS has no checked exceptions).
- Static factories: keep as static methods, return shape preserved.

## Async

Upstream is fully synchronous. **Default: keep methods synchronous in TS too.**
The only async boundaries are:
- File I/O at the entry points (handled in `src/node/`, not in `src/grobid/`).
- CrossRef HTTP calls (`utilities/Consolidation.java`) — port as async.
- pdfalto invocation (in `src/node/load-pdf-alto.ts`, outside `src/grobid/`).

If a Java method only does in-memory work, its TS port is sync.

## Logging

Java uses `slf4j` + `org.slf4j.Logger`. TS uses a small logger shim
(`src/grobid/utilities/logger.ts`) wrapping `console`:

```ts
const log = getLogger("HeaderParser");
log.debug("..."); log.info("..."); log.warn("..."); log.error("...");
```

Mirror upstream's log level (preserve `LOGGER.debug` → `log.debug`).

## Exceptions

- `org.grobid.core.exceptions.GrobidException` → `class GrobidException extends Error`.
- Other exception types each get their own subclass in `src/grobid/exceptions/`.
- Don't introduce TS-style `Result<T, E>` returns; preserve throw/catch.

## Dependency injection

Upstream uses Spring/Guice in some places. We don't. Where upstream
injects a singleton, our port:
- Either constructs the dependency directly in the consumer's constructor
  (when there's exactly one production impl), or
- Accepts it as a constructor arg (when callers may swap).

Lazy singletons (e.g., `Lexicon.getInstance()`) stay as singleton methods
returning a module-level instance.

## XML / regex / collections

- Java `Pattern.compile(re)` + `Matcher` → cache a JS `RegExp` at module top-level.
- `StringBuilder` / `StringBuffer` → array of strings + `.join("")` (idiomatic JS).
- SAX parsers (`org.xml.sax.helpers.DefaultHandler`) — see `src/grobid/sax/` for the JS port of the SAX abstraction; use `sax` package or hand-rolled equivalent.
- `org.apache.commons.lang3` helpers — port the specific method used inline, no commons dep.

## File I/O

Java `File` / `FileReader` / `FileWriter` belong in `src/node/`. The
ports in `src/grobid/` operate on strings / buffers / arrays passed in.

## Tests

- One vitest test file per ported file: `test/grobid/<sub>/<name>.test.ts`.
- Where upstream has JUnit tests under `grobid-core/src/test/`, port the
  test fixtures and expectations 1:1.
