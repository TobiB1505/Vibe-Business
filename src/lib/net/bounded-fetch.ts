/**
 * A deadline, and a bounded retry, for calls to hosts **we** configured
 * (VB-031).
 *
 * ## What this is not
 *
 * It is not the safe-fetch boundary. Outbound HTTP to a *user-supplied*
 * destination goes through `src/modules/live-product-intelligence/net/` and
 * nothing else — [CLAUDE.md](../../../CLAUDE.md) rule 35, [ADR
 * 0010](../../../docs/decisions/0010-safe-outbound-http-inspection.md) — because
 * there the destination is the threat. Here the destination is GitHub's API or
 * our own Supabase project: hosts named in configuration, never in a request.
 * The risk is the opposite one, and much duller. They can hang.
 *
 * ## Why a hang is worse than a failure
 *
 * `fetch` has no default timeout. A connection that is accepted and then goes
 * quiet occupies the caller until something else gives up — and in this
 * application that "something else" is a Vercel Workflow step ceiling or a page
 * render, so one silent socket becomes a wedged operation or a blank screen.
 * A failure at fifteen seconds is a retry, a typed error and a page that says
 * so. A hang is none of those.
 *
 * ## Why the retry is only for safe methods
 *
 * A retry is a second request, and a second request to a method that changes
 * something is a second change. Rules 50 and 73 are explicit that an ambiguous
 * outcome on a consequential write is resolved by *reading*, never by trying
 * again — so nothing here retries anything but `GET` and `HEAD`, and the
 * decision is made from the method rather than from the caller's intent.
 *
 * It also retries only what could not have been a considered answer: a
 * transport failure, a timeout, or the three gateway statuses that mean an
 * intermediary gave up (`502`, `503`, `504`). Not `429` — retrying a rate
 * limit is how a rate limit becomes a ban. Not `500`, which is a server that
 * did reach a conclusion. Not any `4xx`, which will say the same thing again.
 */

/** Attempts after the first, for a safe method. */
export type BoundedFetchOptions = {
  /** Deadline for one attempt, not for the whole sequence. */
  timeoutMs: number;
  /** Extra attempts for `GET`/`HEAD` only. Zero disables retrying entirely. */
  retries?: number;
  /** Base for the backoff. The actual wait is uniform in `[0, base * 2^n]`. */
  backoffBaseMs?: number;
  /** Ceiling on any single wait, so a retry never dominates the deadline. */
  backoffMaxMs?: number;
  /** Observability hook. Carries no URL, header or body — only shape. */
  onRetry?: (info: { attempt: number; delayMs: number; reason: string }) => void;
  /** Injected so a test can be explicit about time rather than sleeping. */
  sleep?: (ms: number) => Promise<void>;
};

const SAFE_METHODS = new Set(["GET", "HEAD"]);
const RETRYABLE_STATUSES = new Set([502, 503, 504]);

const DEFAULT_BACKOFF_BASE_MS = 200;
const DEFAULT_BACKOFF_MAX_MS = 2_000;

function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  const fromInit = init?.method;
  if (fromInit) return fromInit.toUpperCase();
  if (typeof input === "object" && input !== null && "method" in input) {
    return String((input as Request).method).toUpperCase();
  }
  return "GET";
}

/**
 * Full jitter rather than a fixed schedule.
 *
 * Every caller that just lost a shared dependency retries at once otherwise,
 * and the retry storm is what keeps it down. Spreading the attempts uniformly
 * across the window is what makes the second attempt more likely to land than
 * the first.
 */
function backoffDelay(attempt: number, baseMs: number, maxMs: number): number {
  const ceiling = Math.min(baseMs * 2 ** attempt, maxMs);
  return Math.floor(Math.random() * ceiling);
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Wraps a `fetch` with a per-attempt deadline and, for safe methods, a bounded
 * jittered retry.
 *
 * The caller's own `AbortSignal` is preserved rather than replaced: a caller
 * that cancels still cancels, and the deadline is an additional reason to
 * stop, never a substitute for the one it passed.
 */
export function withBoundedFetch(
  options: BoundedFetchOptions,
  inner: typeof fetch = fetch,
): typeof fetch {
  const {
    timeoutMs,
    retries = 0,
    backoffBaseMs = DEFAULT_BACKOFF_BASE_MS,
    backoffMaxMs = DEFAULT_BACKOFF_MAX_MS,
    onRetry,
    sleep = defaultSleep,
  } = options;

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const attemptsAllowed = SAFE_METHODS.has(methodOf(input, init)) ? retries + 1 : 1;

    let lastError: unknown;

    for (let attempt = 0; attempt < attemptsAllowed; attempt += 1) {
      const deadline = AbortSignal.timeout(timeoutMs);
      const signal = init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline;

      try {
        const response = await inner(input, { ...init, signal });

        if (attempt + 1 < attemptsAllowed && RETRYABLE_STATUSES.has(response.status)) {
          const delayMs = backoffDelay(attempt, backoffBaseMs, backoffMaxMs);
          onRetry?.({ attempt: attempt + 1, delayMs, reason: `status_${response.status}` });
          await sleep(delayMs);
          continue;
        }

        return response;
      } catch (error) {
        // A caller that cancelled deliberately is not a transport failure, and
        // retrying it would ignore what it asked for.
        if (init?.signal?.aborted) throw error;

        lastError = error;
        if (attempt + 1 >= attemptsAllowed) break;

        const delayMs = backoffDelay(attempt, backoffBaseMs, backoffMaxMs);
        onRetry?.({ attempt: attempt + 1, delayMs, reason: "transport" });
        await sleep(delayMs);
      }
    }

    throw lastError ?? new Error("bounded fetch exhausted its attempts");
  };
}

/**
 * The deadlines, in one place.
 *
 * Both are far above what a healthy call takes and far below any step ceiling
 * or page budget they sit inside. They are chosen rather than measured, which
 * is the honest description: the point is that a bound exists, not that this
 * particular number is optimal.
 */
export const SUPABASE_REQUEST_TIMEOUT_MS = 15_000;
export const GITHUB_REQUEST_TIMEOUT_MS = 15_000;

/** Three attempts in the worst case, which stays under a minute with backoff. */
export const GITHUB_READ_RETRIES = 2;
