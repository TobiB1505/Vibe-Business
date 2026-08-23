/**
 * The one-second window after sign-in where PostgREST rejects a valid token.
 *
 * ## The failure
 *
 * Supabase Auth issues an access token stamped `iat` (issued at) from *its*
 * clock. PostgREST validates that token against *its* clock, and it refuses a
 * token whose `iat` lies in the future — `401 {"code":"PGRST303","message":"JWT
 * issued at future"}`. Those two clocks are not the same clock. When they
 * disagree by even a second, every read made in the first second of a session
 * fails, because that is exactly when the token is younger than the
 * disagreement.
 *
 * The user-visible shape is unmistakable and was reported as such: sign in,
 * land on the error screen, reload, and the product is fine. Reloading "fixes"
 * it because by then the token is a few seconds old and the skew no longer
 * covers it. Production runtime errors show `PGRST303` on `/app`, `/app.rsc`
 * and `/app/projects/[projectId]/score`, and the Supabase edge log shows the
 * matching `401` on `billing_credit_accounts` in the same second as the
 * `POST /token` that created the session.
 *
 * ## Why a retry, and why here
 *
 * The skew is between two Supabase-operated services. There is no clock we own
 * in that comparison and no configuration Supabase exposes for it, so nothing
 * in this repository can prevent the first rejection — only decide what
 * happens next. Waiting a moment and asking again is what the user does by
 * hand, and it is the entire fix.
 *
 * It sits in the client's `fetch` rather than at any one call site because the
 * failure is not a property of a query. Every authenticated read made in that
 * window fails, so a retry attached to the credit-balance query would simply
 * move the error screen to whichever read the next screen happens to make
 * first.
 *
 * ## Why replaying the request is safe
 *
 * `PGRST303` is a refusal to *begin*: PostgREST rejects the token before it
 * opens a transaction, so nothing was written, nothing was charged, and the
 * response is proof of that. This is the narrow case rule 50 leaves open — it
 * is not a retry of an ambiguous or billable outcome, it is a retry of a
 * request that provably did not happen. Nothing else is retried here: any
 * other status, any other error code, and the response is returned untouched.
 *
 * ## How long to wait
 *
 * Guessing is avoidable. The rejected response carries the rejecting side's
 * own `Date` header, and the request carried the token whose `iat` was
 * refused, so their difference *is* the skew as the two servers see it — our
 * own clock, which belongs to neither of them, never enters the arithmetic.
 * Wait that difference plus a second of margin, clamp it, and try again.
 * When either value is missing, fall back to a fixed schedule rather than
 * inventing a number.
 */

/** PostgREST's code for "this token was issued in the future". */
export const JWT_ISSUED_AT_FUTURE_CODE = "PGRST303";

/** Attempts *after* the first. Two covers a skew of roughly two seconds. */
export const MAX_CLOCK_SKEW_RETRIES = 2;

/** Added to a measured skew, because `Date` has one-second granularity. */
const CLOCK_SKEW_BUFFER_MS = 1_000;

/** Bounds on any single wait — a page render is on the other end of this. */
const MIN_DELAY_MS = 250;
const MAX_DELAY_MS = 2_000;

/** Used when the response or the request did not carry a usable timestamp. */
const FALLBACK_DELAYS_MS = [600, 1_500] as const;

/** What a caller may observe about a retry, for logging. Carries no token. */
export type ClockSkewRetry = {
  attempt: number;
  delayMs: number;
  /** Seconds the two servers disagreed by, when both timestamps were read. */
  skewSeconds: number | null;
};

/**
 * Whether this response is PostgREST refusing a not-yet-valid token.
 *
 * The status is checked as well as the body so that a `PGRST303` appearing in
 * some other context — a column value, a logged message echoed back — cannot
 * turn an unrelated response into a retry.
 */
export function isJwtIssuedAtFuture(status: number, body: string): boolean {
  if (status !== 401) return false;
  if (!body.includes(JWT_ISSUED_AT_FUTURE_CODE)) return false;
  try {
    const parsed: unknown = JSON.parse(body);
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as { code?: unknown }).code === JWT_ISSUED_AT_FUTURE_CODE
    );
  } catch {
    return false;
  }
}

/**
 * The `iat` claim of a `Bearer` token, in seconds.
 *
 * Decoded, never verified — and it must stay that way. This value decides how
 * long to sleep and nothing else; it never becomes an identity, a permission
 * or a query parameter. Verification belongs to the server that rejected the
 * token, which is the one doing it.
 */
export function bearerTokenIssuedAt(authorizationHeader: string | null): number | null {
  if (!authorizationHeader?.startsWith("Bearer ")) return null;

  const segments = authorizationHeader.slice("Bearer ".length).split(".");
  if (segments.length !== 3) return null;

  try {
    const payload: unknown = JSON.parse(
      Buffer.from(segments[1], "base64url").toString("utf8"),
    );
    const issuedAt = (payload as { iat?: unknown } | null)?.iat;
    return typeof issuedAt === "number" && Number.isFinite(issuedAt) ? issuedAt : null;
  } catch {
    return null;
  }
}

/** The rejecting server's own clock, in seconds, from its `Date` header. */
export function serverDateSeconds(dateHeader: string | null): number | null {
  if (!dateHeader) return null;
  const parsed = Date.parse(dateHeader);
  return Number.isNaN(parsed) ? null : Math.floor(parsed / 1000);
}

/**
 * How long to wait before replaying the request.
 *
 * Both timestamps come from the two sides of the disagreement; neither comes
 * from this process. A skew that measures as zero or negative still waits the
 * minimum, because the rejection is evidence that the two disagree by more
 * than the `Date` header's one-second resolution can show.
 */
export function clockSkewDelayMs(params: {
  issuedAtSeconds: number | null;
  serverSeconds: number | null;
  attempt: number;
}): number {
  const { issuedAtSeconds, serverSeconds, attempt } = params;

  if (issuedAtSeconds === null || serverSeconds === null) {
    return FALLBACK_DELAYS_MS[Math.min(attempt, FALLBACK_DELAYS_MS.length - 1)];
  }

  const needed = (issuedAtSeconds - serverSeconds) * 1000 + CLOCK_SKEW_BUFFER_MS;
  return Math.min(Math.max(needed, MIN_DELAY_MS), MAX_DELAY_MS);
}

/**
 * A request may only be replayed when its body can be sent a second time.
 *
 * A `Request` object and a streaming body are both single-use: the first
 * attempt consumed them, and replaying would send an empty or half-read body —
 * which for a write would be far worse than the error we are avoiding.
 * `@supabase/ssr` sends a URL and a string body, so the safe case is the
 * normal one, and the conservative answer costs nothing.
 */
function isReplayable(input: RequestInfo | URL, init: RequestInit | undefined): boolean {
  if (typeof Request !== "undefined" && input instanceof Request) return false;
  const body = init?.body;
  return body === undefined || body === null || typeof body === "string";
}

/**
 * Wraps `fetch` so a token rejected for being too young is tried again.
 *
 * Everything else passes through untouched, including the original response
 * when the retries are exhausted — the caller still sees the real failure
 * rather than a swallowed one.
 */
export function withJwtClockSkewRetry(options?: {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (retry: ClockSkewRetry) => void;
}): typeof fetch {
  const fetchImpl = options?.fetch ?? globalThis.fetch;
  const sleep =
    options?.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const onRetry = options?.onRetry ?? reportClockSkewRetry;

  return async function fetchWithJwtClockSkewRetry(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    let response = await fetchImpl(input, init);

    for (let attempt = 0; attempt < MAX_CLOCK_SKEW_RETRIES; attempt++) {
      if (response.status !== 401) return response;

      // Cloned, so the body this function may end up returning is still
      // unread by the time it reaches the caller.
      const body = await response.clone().text();
      if (!isJwtIssuedAtFuture(response.status, body)) return response;
      if (!isReplayable(input, init)) return response;

      const issuedAtSeconds = bearerTokenIssuedAt(
        new Headers(init?.headers).get("authorization"),
      );
      const serverSeconds = serverDateSeconds(response.headers.get("date"));
      const delayMs = clockSkewDelayMs({ issuedAtSeconds, serverSeconds, attempt });

      onRetry({
        attempt: attempt + 1,
        delayMs,
        skewSeconds:
          issuedAtSeconds !== null && serverSeconds !== null
            ? issuedAtSeconds - serverSeconds
            : null,
      });

      await sleep(delayMs);
      response = await fetchImpl(input, init);
    }

    return response;
  };
}

/**
 * The default observer: one line per retry, so a skew that grows past what two
 * retries can absorb is visible before it becomes a support conversation
 * again. It records a duration and a difference — never the token, never the
 * URL, never who was signing in.
 */
function reportClockSkewRetry(retry: ClockSkewRetry): void {
  console.warn(
    "[supabase.clock-skew] PostgREST refused a freshly issued token; retrying.",
    {
      attempt: retry.attempt,
      delayMs: retry.delayMs,
      skewSeconds: retry.skewSeconds,
    },
  );
}
