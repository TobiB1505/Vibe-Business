/**
 * Which product a founder was last working in.
 *
 * ## Why `/app` needs this at all
 *
 * `/app` is no longer a screen. It resolves to a product, and with more than
 * one connected the question "which" has to be answered by something. Ranking
 * by attention answers it correctly on the first visit and wrongly on every
 * one after: a founder who spent the morning in one product and comes back
 * does not want to be sent to a different one because it raised a decision
 * while they were away.
 *
 * ## Why a cookie, and what that costs
 *
 * A cookie is per browser, not per account: a new device, a private window or
 * cleared site data all fall back to the ranking. That is the honest trade for
 * needing no schema, no write on a hot path and no request of its own — and
 * the fallback is a correct screen rather than an error.
 *
 * A column on `projects` would survive devices. It also means a write on every
 * project open, and a write during a Server Component render happens on
 * *prefetch* too — so Next would record visits to products nobody opened. The
 * write would have to move to a client effect either way, which is exactly
 * what writes this cookie, minus the round trip and the migration.
 *
 * ## The cookie is a hint and never an authority
 *
 * Anyone can set it. `resolveLastVisited` therefore takes the ids the session
 * actually owns and returns a value only if the cookie names one of them —
 * so a forged cookie is indistinguishable from a missing one, and nothing
 * downstream has to re-check.
 */

/** Named once: the reader, the writer and a test all have to agree. */
export const LAST_VISITED_COOKIE = "vibe-last-project";

/** Half a year. Long enough to survive a holiday, short enough to expire. */
export const LAST_VISITED_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;

/**
 * The project to open, given what the cookie claims and what the account owns.
 *
 * `ordered` is the attention ranking, most urgent first — the answer when
 * there is no usable hint. Returns `null` only when the account has no
 * projects, which is a different screen entirely.
 */
export function resolveLastVisited(
  ordered: readonly { id: string }[],
  hint: string | null | undefined,
): string | null {
  if (ordered.length === 0) return null;
  if (hint && ordered.some((project) => project.id === hint)) return hint;
  return ordered[0].id;
}

/**
 * The cookie a browser should send back, as a `document.cookie` string.
 *
 * Built here rather than in the component so the attributes are asserted in a
 * unit test: a missing `path` scopes it to the project route it was written
 * from, and `/app` would then never see it — a bug that looks exactly like the
 * feature not existing.
 */
export function lastVisitedCookie(projectId: string): string {
  return [
    `${LAST_VISITED_COOKIE}=${encodeURIComponent(projectId)}`,
    "path=/",
    `max-age=${LAST_VISITED_MAX_AGE_SECONDS}`,
    "SameSite=Lax",
  ].join("; ");
}
