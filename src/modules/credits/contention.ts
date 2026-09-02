/**
 * The compare-and-swap retry primitive, shared by every contended money write.
 *
 * ## Why this file exists
 *
 * PostgREST cannot express a column-relative update — there is no way to say
 * `set reserved_credits = reserved_credits + $1` through it. So every writer of
 * a materialized money column reads the value, writes the new one, and guards
 * the write with `eq(<column>, <the value it read>)`: a compare-and-swap. A
 * lost swap is contention, not refusal, so it is retried against a fresh read
 * after a short jittered delay.
 *
 * That shape appeared independently in `store.ts` (accounts) and `lot-store.ts`
 * (grant lots), and the two copies were byte-identical — same jitter formula,
 * same attempt count under two different names. The rationale, however, existed
 * in only one of them, so anyone tuning the other saw a bare `10` with no
 * recorded reason. Splitting a constant from the incident that chose it is how
 * a hard-won number gets casually reverted.
 *
 * ## What this does not do
 *
 * It bounds *liveness*, never safety. Overspending is prevented by the swap
 * itself and, beneath it, by the database CHECK constraints — a caller that
 * retried zero times, or a thousand, could never take a hold the account cannot
 * cover. What the attempt count and the backoff decide is only whether a
 * genuinely fundable request is *told* it is fundable.
 *
 * And it does not decide what exhaustion means. That is the caller's, because
 * the answer differs: a contended admission may honestly refuse, while a
 * contended materialization after a committed ledger entry may not — see
 * `store.ts` and the `MaterializationError` it raises.
 */

/**
 * How many times a contended money write is re-attempted before giving up.
 *
 * Found too low at 3 by the PR #46 merge-verification stress test: 20 truly
 * concurrent 100-credit requests against an exact 1000-credit balance should
 * admit exactly 10, and with no backoff between immediate retries, only 8 did
 * — 12 callers were told `insufficient_credits` while 200 credits of their own
 * genuine, fundable demand sat unclaimed. That is not a safety violation
 * (nothing overspent, nothing double-reserved), but it is a liveness defect
 * with a customer-facing consequence: a caller who *did* have enough Credits
 * was told they did not.
 *
 * Ten attempts, combined with the jittered backoff below, was verified against
 * the same live-database scenario that found the bug: 20 concurrent requests
 * against an exact 1000-credit balance now admit exactly 10, repeatably.
 *
 * Worst case is bounded: ten attempts at up to 15 ms × attempt number is at
 * most ~825 ms of backoff before a caller is answered.
 */
export const CONTENTION_ATTEMPTS = 10;

/**
 * Jittered delay before a retry, in milliseconds.
 *
 * The bug this exists to fix was not "too few attempts" alone — it was
 * immediate, unstaggered retries against the same contended row, which lets
 * many callers keep colliding with each other in near lockstep. A small random
 * delay that grows with the attempt number desynchronizes them, the same
 * reasoning behind backoff in any compare-and-swap loop.
 */
export function retryDelayMs(attempt: number): number {
  return Math.round(Math.random() * 15 * (attempt + 1));
}
