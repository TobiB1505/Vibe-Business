import type { OperationView } from "@/modules/operations/view";

/**
 * When a run's screen still has something to wait for (Sprint 0053).
 *
 * ## Why this is its own module
 *
 * Because the answer is needed on both sides of the server boundary, and
 * `live-view.ts` is `server-only` — it reaches Supabase. The client component
 * that owns the poll cannot import from there, and the production build is
 * where that is enforced rather than in a test.
 *
 * So the decision lives here: pure, dependency-free, importable from anywhere,
 * and unit-tested rather than asserted by a screenshot. `live-view.ts`
 * re-exports it so server-side callers keep one obvious import.
 */

export type ValidationState = "not_started" | "queued" | "running" | "passed" | "failed";

/**
 * Whether the validation this run triggered has yet to answer.
 *
 * ## The defect this exists for
 *
 * The dogfood run page polled while `operationPollPhase(operation)` was
 * `"working"` — the *agent* operation's phase — and stopped the moment it went
 * terminal. But since Sprint 0048 the agent's success automatically enqueues a
 * validation, and that happens a few seconds *after* the agent finishes. In
 * production run `5ea8a9a0` the gap was six seconds: the agent succeeded at
 * 15:11:32.77 and the validation was created at 15:11:38.53.
 *
 * So the last reading the page ever took showed validation as `not_started`,
 * and it never asked again. Validation ran for six minutes and passed; the
 * screen said nothing had started. Nothing was broken except what a person
 * could see, which is the only part they had.
 *
 * ## Why it is bounded on the agent, not just on the validation state
 *
 * `not_started` is also the permanent, correct answer for a run that produced
 * no prepared change — nothing will ever enqueue a validation for it. Polling
 * on the validation state alone would spin forever on exactly the runs that
 * failed. So a validation is only worth waiting for once the agent has actually
 * succeeded and left a result behind.
 */
export function validationStillSettling(model: {
  operation: OperationView;
  validation: ValidationState;
}): boolean {
  if (model.validation === "passed" || model.validation === "failed") return false;

  // Only a completed run that produced something can have a validation coming.
  return model.operation.status === "completed" && model.operation.resultId !== null;
}
