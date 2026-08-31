import type { ActionPlanStep } from "@/modules/action-plans/schema";
import {
  classifyExecutionPricingClass,
  type ExecutionPricingClass,
  type ExecutionPricingClassResolution,
} from "@/modules/economy/execution-class";
import { deriveExecutionSurfaceRequirement } from "@/modules/execution-context/surface";
import type { ExecutionRiskClass } from "./schema";

/**
 * One place that turns a plan step into its Execution Pricing Class
 * (`launch-v1`).
 *
 * ## Why this exists rather than each caller classifying for itself
 *
 * `classifyExecutionPricingClass` deliberately takes `surfaces` as an input
 * rather than deriving them, so that it never needs its own copy of the
 * evidence-namespace table. That is the right boundary for the classifier and
 * the wrong ergonomics for a caller: every caller then has to remember to call
 * `deriveExecutionSurfaceRequirement` first, with the same arguments, in the
 * same way. Three callers doing that by hand is three chances for one of them
 * to pass `[]` and quietly buy the cheapest tier.
 *
 * So the two-step join lives here, once, and the money paths call this.
 *
 * ## Why it is in `execution-contract/` and not in `economy/`
 *
 * `economy/` is a read-only analysis island: `isolation.test.ts` fails it for
 * importing `credits/`, `billing/`, `coding-agent/` or `operations/`, and its
 * README states that it prices nothing and activates nothing. That is still
 * true, and this file is what keeps it true — the classifier stays where it is,
 * pure and untouched, and the module that actually resolves budgets reaches
 * *into* it. The dependency runs execution-contract → economy, never back.
 *
 * ## What it does not decide
 *
 * A price. The class selects one of three approved budgets in `budget.ts` and
 * one of three approved Credit amounts in `credits/retail.ts`; both of those
 * are commercial policy, reviewed and effective-dated, and neither is here.
 */
export function resolveStepPricingClass(params: {
  step: Pick<ActionPlanStep, "changeKind" | "evidenceIds">;
  riskClass: ExecutionRiskClass;
}): ExecutionPricingClassResolution {
  const surfaceRequirement = deriveExecutionSurfaceRequirement({
    changeKind: params.step.changeKind,
    evidenceIds: params.step.evidenceIds,
  });

  return classifyExecutionPricingClass({
    riskClass: params.riskClass,
    changeKind: params.step.changeKind,
    evidenceIds: params.step.evidenceIds,
    surfaces: surfaceRequirement.surfaces,
  });
}

/**
 * The class a step is priced at, or null when it is not agent work at all.
 *
 * A convenience for the callers that only need the class and not the reason —
 * kept as a separate function so that a caller wanting to *explain* a price
 * still has {@link resolveStepPricingClass} and is not tempted to re-derive the
 * reason from the class, which is not recoverable.
 */
export function stepPricingClass(params: {
  step: Pick<ActionPlanStep, "changeKind" | "evidenceIds">;
  riskClass: ExecutionRiskClass;
}): ExecutionPricingClass | null {
  return resolveStepPricingClass(params).pricingClass;
}
