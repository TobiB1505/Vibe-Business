import "server-only";

import { alertOperator } from "@/lib/observability/alert";

/**
 * Why a Deep Scan could not start, said somewhere a person can read it.
 *
 * ## What was wrong
 *
 * Every failure point in the sandbox browser is a bare `catch` returning one
 * of two opaque codes, and the panel renders both as *"Deep Scan couldn't
 * start. Try again in a moment."* That sentence is correct for a customer and
 * it is the whole record: the first real Deep Scan failed after 3.8 seconds,
 * the hold was released exactly as designed, and **nothing anywhere said
 * why** — no log line, no Sentry issue, no row. Six distinct causes, one
 * sentence, and no way to tell them apart from outside the VM.
 *
 * ADR 0076 was explicit that none of this had run in a real Vercel sandbox.
 * What it did not carry was any way to learn what happened the first time it
 * did.
 *
 * ## What this is
 *
 * A named step, an error description, and `alertOperator` — which already logs
 * locally and reports to Sentry, scrubbed, and never throws. The customer-facing
 * message is deliberately unchanged: a provider's error text belongs to the
 * operator, not to the person waiting for a browser.
 *
 * The step name is the point. `image_build_command` and `session_ready_timeout`
 * are different problems with different fixes, and telling them apart is the
 * difference between a diagnosis and another guess.
 */

/** Where a browser session gave up. One value per `catch` that used to be silent. */
export type BrowserFailureStep =
  /** `Sandbox.create` refused the build VM. */
  | "image_build_create"
  /** A build command exited non-zero — Chromium download, `ws` install, link. */
  | "image_build_command"
  /** Writing a Vibe-authored program into the build failed. */
  | "image_build_write"
  /** `snapshot()` or the row insert threw. */
  | "image_build_snapshot"
  /** `Sandbox.create` refused the session VM. */
  | "session_create"
  /** Chromium or the guard would not start. */
  | "session_start_programs"
  /** The guard never wrote its ready file inside the ceiling. */
  | "session_ready_timeout"
  /** The provider would not route the guard's port. */
  | "session_public_origin";

/**
 * An error as a short string, never an object and never a stack.
 *
 * A provider error can carry a request body, and a body can carry a token.
 * `scrub.ts` is the last line of defence rather than the first, so what leaves
 * here is a message and a name — bounded, because a provider that answers with
 * a page of HTML must not turn one failure into a megabyte of log.
 */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    const name = error.name || "Error";
    return `${name}: ${error.message}`.slice(0, 300);
  }
  if (typeof error === "string") return error.slice(0, 300);
  return "non-error thrown";
}

/**
 * Reports a step that failed, and returns nothing.
 *
 * Deliberately fire-and-forget: this is called on a path that is already
 * failing and is about to return a typed refusal, and making the customer wait
 * on a Sentry round-trip to be told no would be the wrong trade. `alertOperator`
 * never throws, so an unawaited rejection is not reachable — the `catch` is
 * belt and braces.
 */
export function reportBrowserFailure(
  step: BrowserFailureStep,
  context: Record<string, string | number | boolean | null | undefined> = {},
): void {
  void alertOperator("deep scan: the browser session could not start", {
    step,
    ...context,
  }).catch(() => undefined);
}
