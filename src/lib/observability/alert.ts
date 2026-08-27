/**
 * The signals that should reach a person (VB-012).
 *
 * ## What was wrong
 *
 * Every one of these conditions was already *detected*. Balance drift, a lot
 * whose materialized capacity disagrees with its allocation rows, an operation
 * nothing is carrying any more, a Stripe webhook that failed to process, a
 * burst of refusals at the agent gateway — each of them ends in a
 * `console.error` with a good message and the right context.
 *
 * On Vercel that is a line in a log stream nobody is watching. The detection
 * work was done and the result went nowhere, which is indistinguishable from
 * not detecting it at all.
 *
 * ## What this does, and what it deliberately does not
 *
 * It sends the same message and context to Sentry, so the condition becomes an
 * issue with a count and a first/last seen — something an alert rule can be
 * built on and something that pages by default on first occurrence.
 *
 * It does **not** introduce a scheduled reader. The other half of VB-012 and
 * VB-033 — a periodic sweep of the ledger for aggregate spend, and thresholds
 * on it — needs a background technology this product has not decided to have,
 * and [CLAUDE.md](../../../CLAUDE.md) rule 24 is explicit that adding one takes
 * an ADR rather than an import. This is the half that needs no new
 * infrastructure: the events already exist, they simply had no way out of the
 * process.
 *
 * ## Why the context is safe to send
 *
 * Everything here passes through `scrub.ts` on the way out, because
 * `beforeSend` applies to a captured message exactly as it does to an
 * exception. Call sites should still pass ids, counts and closed enums rather
 * than prose — the scrubber is the third layer, not the first.
 *
 * ## It never throws
 *
 * An alert is a report about something that already went wrong. Failing to
 * send one must not add a second failure on top of the first, so everything
 * here is wrapped and the local log happens first and unconditionally.
 */

export type AlertLevel = "error" | "warning";

/** Ids, counts, closed enums. Never prose, never a secret, never a body. */
export type AlertContext = Record<string, string | number | boolean | null | undefined>;

/**
 * Logs locally, then reports to Sentry.
 *
 * The local log is not a fallback — it is the primary record, and it happens
 * whether or not Sentry is configured, so a developer reading `vercel logs`
 * sees exactly what they saw before this existed.
 */
export async function alertOperator(
  message: string,
  context: AlertContext = {},
  level: AlertLevel = "error",
): Promise<void> {
  if (level === "warning") console.warn(message, context);
  else console.error(message, context);

  try {
    // Imported here rather than at module scope so that a unit test importing
    // a store does not pull in the Next.js Sentry SDK, and so a failure to
    // load it cannot break a request path.
    const Sentry = await import("@sentry/nextjs");
    Sentry.captureMessage(message, { level, extra: { ...context } });
  } catch {
    // Reporting the failure to report would be the third log line about one
    // event. The local log above already carries the actual condition.
  }
}
