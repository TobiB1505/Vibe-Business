import type { ActionPlanStep } from "@/modules/action-plans/schema";
import {
  classifyExecutionPricingClass,
  type ExecutionPricingClass,
  type ExecutionPricingClassResolution,
} from "@/modules/economy/execution-class";
import { deriveExecutionSurfaceRequirement } from "@/modules/execution-context/surface";
import { riskExceeds, type ExecutionRiskClass } from "./schema";

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

/**
 * The class a whole build chain is priced at.
 *
 * ## The union, computed once
 *
 * Every member's evidence, deduplicated, with the surfaces derived **once over
 * that union** rather than as a union of per-step answers — one code path, one
 * `unrecognised` list. The risk class is the **maximum** over the members, not
 * the head's: `risk.ts` escalates on evidence families, so a member can be
 * `moderate` where the head is `low`, and taking the head's would be the "talk
 * a risky step down to a cheaper tier" move the classifier's escalate-first
 * order exists to prevent.
 *
 * ## Why a chain is never `small`, and never `standard` either
 *
 * `small` and `standard` allow the **same** blast radius — eight changed files
 * and 60 KB — and `budget.ts` says that is deliberate. Only `complex` widens,
 * to twelve and 90 KB, and only because it is the tier defined by spanning more
 * than one thing.
 *
 * A chain is by construction more than one planned delivery. Pricing two
 * deliveries under a single step's ceiling would not merely undercharge: it
 * would strand the run at `budget_exhausted` after the founder had paid for it.
 * So more than one member escalates to `complex`, and the escalation can only
 * ever raise the answer the classifier already gave.
 *
 * The consequence is stated rather than hidden: two `small` steps cost 300
 * Credits apart and 350 as a chain. Every other combination is cheaper chained
 * — two `standard` 400 → 350, three `small` 450 → 350 — and all of them collapse
 * three approvals into one.
 *
 * ## Why here
 *
 * Because this module exists so the derive-then-classify join lives in one
 * place. A second hand-rolled union somewhere else is exactly the failure the
 * comment above describes, with an extra way to disagree about money.
 */
export function resolveChainPricingClass(params: {
  members: readonly Pick<ActionPlanStep, "changeKind" | "evidenceIds">[];
  /** One risk class per member, in the same order. */
  riskClasses: readonly ExecutionRiskClass[];
}): ExecutionPricingClassResolution {
  const [head] = params.members;
  if (!head) throw new Error("resolveChainPricingClass: a chain always has a head");

  const riskClass = params.riskClasses.reduce<ExecutionRiskClass>(
    (highest, risk) => (riskExceeds(risk, highest) ? risk : highest),
    params.riskClasses[0] ?? "low",
  );

  if (params.members.length === 1) {
    // Provably identical to the single-step answer, so declining a chain prices
    // exactly as it does today. A test asserts it over a matrix.
    return resolveStepPricingClass({ step: head, riskClass });
  }

  /* Asserted rather than folded: chain rule 2 admits only product changes, and
     a future loosening should fail loudly here rather than quietly reprice. */
  for (const member of params.members) {
    if (member.changeKind !== head.changeKind) {
      throw new Error("resolveChainPricingClass: chain members must share one change kind");
    }
  }

  const evidenceIds = [...new Set(params.members.flatMap((member) => member.evidenceIds))];
  const union = { changeKind: head.changeKind, evidenceIds };

  const single = resolveStepPricingClass({ step: union, riskClass });

  // A non-mutating union has no class at all, and that stays true — escalating
  // it would price work that never executes.
  if (single.pricingClass === null) return single;

  return {
    pricingClass: "complex",
    reason: "chained_delivery",
    policyVersion: single.policyVersion,
  };
}
