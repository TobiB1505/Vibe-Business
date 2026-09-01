import {
  EXECUTION_ADMISSION_LABELS,
  EXECUTION_REASON_LABELS,
} from "@/modules/execution-contract/view";
import type { ExecutionAdmission } from "@/modules/execution-contract/schema";
import type { AgentStartRefusal } from "./service";
import type { PreflightRefusal } from "./preflight";
import type { AgentStartRefusalDetail, DogfoodStepReason } from "./start-refusal";

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
  spec_not_persisted: "Vibe couldn't record what this run would do, so it didn't start one.",
  project_not_found: "That project couldn't be found.",
} as const;

/**
 * Why the chain stopped before a run could be described at all.
 *
 * These are the coarsest answers — the ones reached before there is a
 * resolution or a preflight to be more specific with. `not_agentic` and
 * `preflight_refused` have their own, better sentences below and only fall back
 * here when the finer answer was not established.
 */
export const DOGFOOD_STEP_REASON_LABELS: Record<DogfoodStepReason, string> = {
  not_dogfood_eligible: "The coding agent isn't turned on for this project.",
  no_action_plan: "There's no finished plan for Vibe to work from yet.",
  step_not_found: "That step isn't in your current plan any more.",
  repository_not_connected: "No code repository is connected to this project.",
  repository_snapshot_missing: "Vibe hasn't read your code yet.",
  plan_incomplete: "This plan is missing something Vibe needs before it can start work.",
  not_agentic: "This step isn't the kind of change Vibe's coding agent can attempt.",
  preflight_refused: "Vibe's own checks refused this run before it started.",
};

/**
 * The sentence for a refused start, at the finest grain that was established.
 *
 * The order is most-specific-first, and each stage is skipped when the chain
 * never reached it:
 *
 *  1. **Admission** — a moved default branch, a stale read, a superseded plan.
 *     These are what a founder can actually act on, and they are the reason
 *     this function exists: the run the founder pressed was refused because
 *     their repository had moved since Vibe last read it, and the screen said
 *     "no longer eligible".
 *  2. **Preflight** — Vibe's own gates on a step that classified fine.
 *  3. **Classification** — why the step is not agentic in the first place.
 *  4. **The stage that stopped** — coarse, and only when nothing finer exists.
 *
 * Admission comes before preflight deliberately: `not_admissible` is one
 * preflight refusal standing in for eleven admission answers, and rendering the
 * generic one tells a founder their code changed when the truth might be that
 * no Agent price exists.
 */
export function startRefusalLabel(detail: AgentStartRefusalDetail): string {
  // `preflightRefusalLabel` already prefers the admission sentence for
  // `not_admissible` and keeps its own for every other refusal, which is the
  // distinction this would otherwise have to re-make and could get wrong.
  if (detail.preflight) {
    return detail.admission
      ? preflightRefusalLabel(detail.preflight, detail.admission)
      : PREFLIGHT_REFUSAL_LABELS[detail.preflight];
  }

  if (detail.admission && !detail.admission.admissible) {
    return EXECUTION_ADMISSION_LABELS[detail.admission.refusal];
  }

  if (detail.reason === "not_agentic" && detail.resolutionReason) {
    return EXECUTION_REASON_LABELS[detail.resolutionReason];
  }

  return DOGFOOD_STEP_REASON_LABELS[detail.reason];
}

/** The one way forward a refused start can offer, when there is one. */
export type StartRefusalRecovery = {
  kind: "repository_read";
  label: string;
  /** Why the founder is the one pressing it. */
  note: string;
};

/**
 * The way forward, when a fresh read of the founder's code is it.
 *
 * Offered, never taken: a scan costs Credits, and Rule 60 is explicit that
 * blocked work explains what needs refreshing rather than spending on the
 * founder's behalf. So this returns copy and a kind — no URL, because a view
 * module has no business knowing what a route segment is called.
 *
 * Only for the refusals a re-read actually clears. A permanent refusal — this
 * step touches payments, the agent is not on for this project — gets nothing,
 * because offering a paid scan against a wall is worse than offering nothing.
 */
export function startRefusalRecovery(
  detail: AgentStartRefusalDetail,
): StartRefusalRecovery | null {
  const stale =
    detail.reason === "repository_snapshot_missing" ||
    (detail.admission !== undefined &&
      !detail.admission.admissible &&
      (detail.admission.refusal === "repository_head_moved" ||
        detail.admission.refusal === "repository_snapshot_stale"));

  if (!stale) return null;

  return {
    kind: "repository_read",
    label: "Re-read my code",
    note: "You start this — Vibe never re-reads your code on its own.",
  };
}

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
