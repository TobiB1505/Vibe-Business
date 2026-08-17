import type { ActionPlanBlockReason } from "./service";
import type { ActionPlanStep, PlanProgress, PlanStalenessReason } from "./schema";

/**
 * The Action Plan presentation layer (ACTION PLANNER UI-1).
 *
 * Everything a screen needs to describe a plan in the founder's language,
 * kept separate from the components that render it — the same split
 * `opportunities/view.ts` already draws. Nothing here is a React component
 * and nothing here imports one, so this stays testable without a DOM and
 * reusable by both the `/moves` panel and onboarding's First Move summary.
 *
 * The rule this file exists to enforce: a component may render `StepActor`,
 * `ExecutionSupport` or a `PlanStalenessReason` only through a lookup here.
 * None of those enum values, and no internal id (conclusion key, capability
 * id, contract/planner version, provider or model), is ever interpolated
 * directly into JSX.
 */

/** Where a blocked notice's action should send the founder. */
export type ActionPlanBlockTarget = "business_audit" | "product_understanding" | "next_moves";

export type ActionPlanBlockNotice = {
  reason: ActionPlanBlockReason;
  actionLabel: string;
  target: ActionPlanBlockTarget;
};

const BLOCK_NOTICE_COPY: Record<
  ActionPlanBlockReason,
  { actionLabel: string; target: ActionPlanBlockTarget }
> = {
  audit_missing: { actionLabel: "Run a business audit", target: "business_audit" },
  audit_stale: { actionLabel: "Update your business audit", target: "business_audit" },
  product_profile_missing: {
    actionLabel: "Let Vibe understand your product",
    target: "product_understanding",
  },
  move_missing: { actionLabel: "Find your next moves", target: "next_moves" },
  move_stale: { actionLabel: "Refresh your next moves", target: "next_moves" },
  // The Move itself may be current; what failed is linking it back to a
  // business conclusion. The remedy is the same one that regenerates it.
  planner_source_unresolved: { actionLabel: "Refresh your next moves", target: "next_moves" },
};

/** A block never has no way out (mirrors `buildOpportunityBlockNotice`). */
export function buildActionPlanBlockNotice(
  reason: ActionPlanBlockReason | null,
): ActionPlanBlockNotice | null {
  if (reason === null) return null;
  const entry = BLOCK_NOTICE_COPY[reason];
  return { reason, actionLabel: entry.actionLabel, target: entry.target };
}

/**
 * Why a stored plan may no longer describe the current business, in the
 * founder's language rather than the domain's (§42).
 */
export const PLAN_STALENESS_LABELS: Record<PlanStalenessReason, string> = {
  audit_superseded: "Your business audit has changed since this plan was made.",
  move_superseded: "Your next moves have changed since this plan was made.",
  product_profile_changed: "Vibe's understanding of your product has changed since this plan was made.",
  founder_intent_changed: "What you told Vibe about your business has changed since this plan was made.",
  planner_contract_superseded: "Vibe's planning approach has improved since this plan was made.",
};

/** A short, plain-language summary of where the plan stands (§40). */
export const PLAN_PROGRESS_LABELS: Record<PlanProgress, string> = {
  ready: "Vibe can move this forward.",
  needs_founder: "The next step needs you.",
  blocked: "The next step is waiting on someone else.",
  finished: "Every step is done.",
};

/**
 * Where one step stands relative to the plan's single genuine entry point
 * (§38, §39 in the sequencing module this reads).
 *
 * `start_here` is never assigned by position — it is whichever step
 * `firstActionableStep` actually returned. `also_ready` exists because more
 * than one zero-dependency step can be true at once; only one is highlighted
 * as the plan's current entry point, but the others should not read as
 * blocked when they are not.
 */
export type StepDisplayState = "start_here" | "also_ready" | "waiting_on_steps" | "done";

export function stepDisplayState(
  step: ActionPlanStep,
  firstActionableOrder: number | null,
  completed: ReadonlySet<number> = new Set(),
): StepDisplayState {
  if (completed.has(step.order)) return "done";
  if (firstActionableOrder !== null && step.order === firstActionableOrder) return "start_here";
  if (step.dependsOn.length === 0) return "also_ready";
  return "waiting_on_steps";
}

/** The titles of a step's prerequisites, in plan order — never their raw order numbers alone. */
export function stepDependencyTitles(step: ActionPlanStep, allSteps: ActionPlanStep[]): string[] {
  const byOrder = new Map(allSteps.map((entry) => [entry.order, entry.title]));
  return step.dependsOn
    .map((order) => byOrder.get(order))
    .filter((title): title is string => Boolean(title));
}
