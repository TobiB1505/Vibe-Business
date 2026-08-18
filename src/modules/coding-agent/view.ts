import {
  EXECUTION_ADMISSION_LABELS,
} from "@/modules/execution-contract/view";
import type { ExecutionAdmission } from "@/modules/execution-contract/schema";
import type { AgentStartRefusal } from "./service";
import type { PreflightRefusal } from "./preflight";

/**
 * Customer-safe copy for the coding-agent runtime (EXECUTION CORE-4 website gate, §5).
 *
 * The same rule `execution-contract/view.ts` states: a component may render a
 * `PreflightRefusal` or an `AgentStartRefusal` only through a lookup here.
 * Everything else Core-4 needs already has a home — activity events, interrupt
 * questions and operation stage/failure copy all live in `execution-contract/view.ts`
 * and `operations/{view,messages}.ts`, extended by Core-4 itself. These two
 * enums are the only gap: they exist to gate a website surface that did not
 * exist until now.
 */

export const PREFLIGHT_REFUSAL_LABELS: Record<PreflightRefusal, string> = {
  not_agentic: "This step isn't the kind of change Vibe's coding agent can attempt.",
  not_admissible: "Vibe couldn't confirm your code hasn't changed since it last looked.",
  risk_too_high: "This step is too sensitive for Vibe's coding agent to attempt.",
  validation_unsupported: "Vibe can't independently prove a change to this project builds.",
  not_authorized: "The coding agent isn't turned on for this project.",
  no_budget: "No spending limit is configured for this run.",
  budget_scope_mismatch: "The spending limit and the change limit disagree — refusing rather than guessing.",
  no_tool_grants: "Nothing was granted to work with, so there is nothing to run.",
  forbidden_grant: "The compiled policy names something it should never be allowed to.",
  user_decision_missing: "This step is waiting on a decision only you can make.",
};

export const AGENT_START_REFUSAL_LABELS: Record<AgentStartRefusal, string> = {
  project_not_found: "That project couldn't be found.",
  execution_spec_not_found: "That step's instructions couldn't be found — try again.",
  spec_not_agentic: "This step isn't the kind of change Vibe's coding agent can attempt.",
  agentic_execution_not_authorized: "The coding agent isn't turned on for this project.",
  insufficient_credits: "There aren't enough Credits to reserve for this run.",
  credit_reservation_insufficient: "The Credits held don't cover this run's spending limit.",
  execution_start_failed: "Vibe couldn't start the run — try again.",
  agent_start_failed: "Vibe couldn't start the run — try again.",
};

/**
 * Why a start attempt stopped before `startAgentExecution` was even reached.
 *
 * Separate from {@link AGENT_START_REFUSAL_LABELS} because these happen one
 * step earlier — while recording the instruction package the run would execute.
 * They were previously invisible: a refused insert was reported as "this isn't
 * the kind of change Vibe can attempt", on a screen that had just said the
 * opposite in the sentence above it.
 */
export const DOGFOOD_START_REFUSAL_LABELS = {
  not_eligible: "This step is no longer eligible — the page will show why above.",
  spec_not_persisted: "Vibe couldn't record what this run would do, so it didn't start one.",
  project_not_found: "That project couldn't be found.",
} as const;

/**
 * The refusal, said accurately.
 *
 * `not_admissible` is one preflight refusal standing in for nine different
 * admission answers — a moved HEAD, an unread HEAD, a stale snapshot, a
 * superseded plan, no approved price, and three Credit states. Rendering the
 * generic label for all of them tells a founder "your code changed since Vibe
 * last looked" when the truth might be that no Agent price exists, which is
 * both wrong and unactionable.
 *
 * `EXECUTION_ADMISSION_LABELS` already carries the honest sentence for each, so
 * this prefers it whenever the resolution knows which one applies. Every other
 * refusal keeps its own copy: those are about the *classification*, which
 * admission has nothing to say about.
 */
export function preflightRefusalLabel(
  refusal: PreflightRefusal,
  admission: ExecutionAdmission,
): string {
  if (refusal === "not_admissible" && !admission.admissible) {
    return EXECUTION_ADMISSION_LABELS[admission.refusal];
  }

  return PREFLIGHT_REFUSAL_LABELS[refusal];
}
