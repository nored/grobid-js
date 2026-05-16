// Port of org.grobid.core.exceptions.GrobidException.
// Upstream: grobid-core/src/main/java/org/grobid/core/exceptions/GrobidException.java

import { GrobidExceptionStatus } from "./grobid-exception-status.js";

/**
 * Faithful port of the upstream class hierarchy. JS doesn't carry the
 * Java RuntimeException distinction; all GrobidException subclasses extend
 * the native Error.
 *
 * Constructor overloads are collapsed into a single signature with optional
 * fields, matching upstream's set of `(message?, cause?, status?)` overloads.
 */
export class GrobidException extends Error {
  readonly status: GrobidExceptionStatus;
  override readonly cause: unknown;

  constructor(
    message?: string,
    cause?: unknown,
    status: GrobidExceptionStatus = GrobidExceptionStatus.GENERAL,
  ) {
    // If cause is itself a GrobidException, upstream propagates its status.
    let resolvedStatus = status;
    if (cause instanceof GrobidException) {
      resolvedStatus = cause.status;
    }
    super(message);
    this.name = "GrobidException";
    this.status = resolvedStatus;
    this.cause = cause;
  }

  /**
   * Mirrors upstream `getMessage()` override: `"[" + status + "] " + super.getMessage()`.
   * Java callers see the status prefix automatically; JS callers calling
   * `error.message` get the raw message, so this is exposed as a getter.
   */
  override get message(): string {
    const base = super.message ?? "";
    return this.status ? `[${this.status}] ${base}` : base;
  }

  getStatus(): GrobidExceptionStatus {
    return this.status;
  }
}
