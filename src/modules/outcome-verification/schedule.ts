import { DEFAULT_OUTCOME_BUDGETS, type OutcomeBudgets } from "./budgets";

/**
 * The bounded observation schedule (Sprint 12A §17, §20, §42).
 *
 * ## Why a window exists at all
 *
 * Because a merge is not a deployment. Moving a default branch may trigger the
 * customer's own CI/CD, and that takes anywhere from twenty seconds to several
 * minutes — or never happens, because they deploy from a tag, or by hand, or not
 * at all. Treating the first missing endpoint as a final answer would report
 * "not observed" for a product that was mid-build, which is both wrong and the
 * kind of wrong a user cannot argue with.
 *
 * ## Why it is bounded, and bounded in the database
 *
 * The deadline is computed once, persisted on the row, and read back on every
 * attempt. It is not a variable in a workflow, and it is not recomputed from
 * `now()` — a replayed workflow that recomputed its own deadline would extend
 * the window every time the platform re-entered it, and a fifteen-minute
 * observation would quietly become an unbounded one (§42).
 *
 * ## Why it stops early
 *
 * The moment every expectation holds, there is nothing left to learn. Continuing
 * to poll a customer's production website to re-confirm something already true
 * is not diligence, it is traffic (§20).
 */

export type ObservationAttempt = {
  /** Zero-based attempt number, stable across replays. */
  index: number;
  /** Milliseconds after the window opened at which this attempt is due. */
  offsetMs: number;
  /** How long to sleep before it, given the previous attempt's offset. */
  sleepMs: number;
};

/**
 * The full attempt schedule, derived from the budgets.
 *
 * Pure, so the schedule a workflow follows is a unit test rather than a
 * property of a running deployment.
 */
export function observationSchedule(
  budgets: OutcomeBudgets = DEFAULT_OUTCOME_BUDGETS,
): ObservationAttempt[] {
  const offsets = [...budgets.attemptOffsetsMs]
    .filter((offset) => offset >= 0 && offset <= budgets.observationWindowMs)
    .sort((left, right) => left - right);

  return offsets.map((offsetMs, index) => ({
    index,
    offsetMs,
    sleepMs: index === 0 ? 0 : offsetMs - offsets[index - 1],
  }));
}

/**
 * When the window closes, given when it opened.
 *
 * Computed once at the start of the durable observation and persisted. Every
 * later decision reads the stored value, so no amount of replaying, retrying or
 * resuming can move it.
 */
export function windowDeadline(
  startedAt: Date,
  budgets: OutcomeBudgets = DEFAULT_OUTCOME_BUDGETS,
): Date {
  return new Date(startedAt.getTime() + budgets.observationWindowMs);
}

/**
 * Whether another observation may still be made.
 *
 * A missing deadline is treated as *expired*, not as unlimited. That direction
 * is deliberate: the failure mode of the safe reading is one observation fewer,
 * and the failure mode of the unsafe reading is a workflow polling somebody's
 * production website forever (§42).
 */
export function withinWindow(deadlineIso: string | null, now: Date): boolean {
  if (deadlineIso === null) return false;
  const deadline = Date.parse(deadlineIso);
  if (!Number.isFinite(deadline)) return false;
  return now.getTime() < deadline;
}
