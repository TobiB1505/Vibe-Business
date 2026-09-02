import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { releaseOperationCredits, settleOperationCredits } from "@/modules/credits/operation-billing";
import { getPreparedChange } from "@/modules/execution/store";
import { findAgentRunByOperation } from "./store";

/**
 * When the customer's purchase actually exists (ADR 0073).
 *
 * ## The sentence this file is built from
 *
 * `credits/retail.ts`, explaining why validation, preview and review carry no
 * price of their own:
 *
 * > They are bundled into the agent price, and their measured cost is inside
 * > the $0.4282 above. **A customer bought a validated improvement, not a
 * > pipeline.**
 *
 * Vibe charged three seconds before validation started. Production run
 * `c462c083` settled 100 Credits at `00:31:35` and began validating at
 * `00:31:38`; had those checks failed, the customer would have paid in full for
 * a change Vibe itself would refuse to ship. The price says what is being sold,
 * and settlement has to wait for it.
 *
 * ## The rule, in one table
 *
 * ```
 * agent run succeeds                     hold stays held
 *   validation reused (already passed)   settle
 *   validation started / running         wait for the verdict
 *   validation could not start           release
 * validation passes                      settle
 * validation fails                       release
 * validation swept as stale              release
 * change discarded before a verdict      release
 * ```
 *
 * ## Why "could not start" releases rather than charges
 *
 * Because it cannot mean "this repository has no validation". A repository
 * whose changes cannot be independently validated never reaches a run at all —
 * `execution-contract/validation-requirements.ts` produces
 * `validation_not_supported` and eligibility refuses admission on it, precisely
 * so that an agent's own claim is never the only evidence. So a failure here is
 * something moving underneath a run that already started, which is Vibe's
 * fault, and CREDIT_ECONOMICS.md's approved failure policy absorbs it: *a
 * Vibe/system failure … is 0 charged, Vibe absorbs.*
 *
 * That also means no new pricing policy is invented here. Every branch resolves
 * to one of the two answers billing already had.
 *
 * ## Why a discard releases only before a verdict
 *
 * A validated improvement the founder chooses not to merge was still delivered,
 * and the price is for the improvement rather than for the merge. One that
 * never reached a verdict was not the thing that was sold.
 *
 * ## Idempotent by construction
 *
 * Neither branch decides whether the hold is still open. `settleOperationCredits`
 * returns the existing charge for a settled reservation, and
 * `releaseOperationCredits` refuses a reservation that is not `active` — so a
 * verdict that arrives twice, or a sweep racing a workflow, charges once and
 * releases once. The caller is told which happened rather than having to know.
 */

export const AGENT_HOLD_OUTCOMES = [
  /** The improvement was independently validated. This is what was sold. */
  "validated",
  /** No verdict will arrive, or the verdict was negative. */
  "unvalidated",
] as const;
export type AgentHoldOutcome = (typeof AGENT_HOLD_OUTCOMES)[number];

export type AgentHoldResolution =
  | { kind: "settled"; reservationId: string; alreadySettled: boolean }
  | { kind: "released"; reservationId: string }
  | { kind: "no_hold" }
  /** The reservation was already closed the other way. Reported, never retried. */
  | { kind: "already_closed"; reservationId: string; refusal: string }
  | { kind: "not_found" };

/**
 * Settles or releases the hold behind one prepared change.
 *
 * Reaches the reservation through persisted rows only — prepared change →
 * its operation → the agent run → `credit_reservation_id` — never through an
 * argument. Every caller here runs under the service-role client, which
 * bypasses RLS, so the ownership this filters on has to be the ownership the
 * database already recorded (rule 53).
 */
export async function resolveAgentHold(
  supabase: SupabaseClient,
  params: { projectId: string; preparedChangeId: string; outcome: AgentHoldOutcome },
): Promise<AgentHoldResolution> {
  const prepared = await getPreparedChange(supabase, {
    projectId: params.projectId,
    preparedChangeId: params.preparedChangeId,
  });
  if (!prepared) return { kind: "not_found" };

  const run = await findAgentRunByOperation(supabase, prepared.operationRunId);
  if (!run) return { kind: "not_found" };

  // A deterministic generator's change has no agent hold behind it, and a
  // dogfood run before holds existed has none either. Neither is an error.
  if (!run.creditReservationId) return { kind: "no_hold" };

  const reservationId = run.creditReservationId;

  if (params.outcome === "validated") {
    const settled = await settleOperationCredits(supabase, {
      reservationId,
      policyVersion: run.budgetPolicyVersion,
    });

    return settled.ok
      ? { kind: "settled", reservationId, alreadySettled: settled.alreadySettled }
      : { kind: "already_closed", reservationId, refusal: settled.refusal };
  }

  const released = await releaseOperationCredits(supabase, {
    reservationId,
    // Names the honest shape, and the same reason the failure path already
    // used: Vibe paid the provider, the customer did not pay Vibe. Internal
    // cost and customer price stay separate facts.
    reason: "abandoned_with_usage",
  });

  return released.ok
    ? { kind: "released", reservationId }
    : { kind: "already_closed", reservationId, refusal: released.refusal };
}
