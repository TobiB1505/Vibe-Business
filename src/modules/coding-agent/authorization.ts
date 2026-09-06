import { resolveExecutionBudget, type ExecutionBudget } from "@/modules/execution-contract/budget";
import type { ExecutionPricingClass } from "@/modules/economy/execution-class";

/**
 * The economics that authorize agentic execution for one project.
 *
 * ## There is one book, and this file is no longer a door between two
 *
 * It used to be. CORE-4 §18 forbade activating a customer-facing Agent price
 * before a measured cost existed, so this file held two budget worlds and
 * chose between them by an operator-managed allowlist of project ids:
 *
 * ```
 * production      EXECUTION_BUDGET_POLICIES            empty — nothing resolved
 * internal        EXECUTION_DOGFOOD_BUDGET_POLICIES    allowlisted projects only
 * ```
 *
 * Both halves of that have since expired. `launch-v1` activated a measured
 * Agent price ([ADR 0061](../../../docs/decisions/0061-launch-v1-operation-rate-card.md), 150/200/350 Credits by execution pricing
 * class), so the production branch resolves for every project; and the
 * estimator that the dogfood existed to feed now reads real runs instead
 * ([ADR 0083](../../../docs/decisions/0083-the-estimator-reads-the-runs.md)). What was left was an allowlist that quietly kept the
 * agent from starting at all for everybody not named in it — see
 * [ADR 0092](../../../docs/decisions/0092-the-agent-runs-as-the-product.md).
 *
 * So: one book, the customer's. A project that can be priced can run an agent
 * and pays for it, and there is no second ceiling anybody can be moved onto.
 *
 * The `agentic_pricing_not_configured` refusal (Core-3 §24) is still reachable
 * — a date outside every policy's interval produces it — and is still the
 * correct answer when it happens.
 */

export type AgentEconomicPolicy = {
  budget: ExecutionBudget;
};

/**
 * The Credit ceiling one project's agent run is authorized against, or null.
 *
 * `pricingClass` comes from `classifyExecutionPricingClass` and must be the
 * same class the reservation was priced at. It is not optional and has no
 * default: see `resolveExecutionBudget` for why guessing a tier is unsafe in
 * both directions.
 */
export function resolveAgentEconomics(params: {
  projectId: string;
  pricingClass: ExecutionPricingClass;
  at?: Date;
  env?: Record<string, string | undefined>;
}): AgentEconomicPolicy | null {
  const budget = resolveExecutionBudget(params.pricingClass, params.at ?? new Date());
  return budget ? { budget } : null;
}

/**
 * Whether agentic execution is authorized at all, for the resolver's gate.
 *
 * Deliberately class-free, and the answer is total rather than a sample: an
 * `ExecutionBudgetPolicy` must define all three classes, so a policy that
 * authorizes one authorizes every one. `standard` is passed because a value is
 * required, not because the answer depends on it.
 *
 * A gate asks "could this project run an agent"; only a step that has actually
 * been classified asks "under which ceiling". Keeping the gate class-free is
 * what stops a caller inventing a class in order to answer a question that
 * never needed one.
 */
export function isAgenticExecutionAuthorized(params: {
  projectId: string;
  at?: Date;
  env?: Record<string, string | undefined>;
}): boolean {
  return resolveAgentEconomics({ ...params, pricingClass: "standard" }) !== null;
}
