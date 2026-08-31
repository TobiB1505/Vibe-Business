import {
  CORE4_DOGFOOD_BUDGET_POLICY,
  EXECUTION_DOGFOOD_BUDGET_POLICIES,
  resolveExecutionBudget,
  type ExecutionBudget,
} from "@/modules/execution-contract/budget";
import type { ExecutionPricingClass } from "@/modules/economy/execution-class";

/**
 * Who may run an agent at all, and under whose economics (CORE-4 §18).
 *
 * ## The requirement, restated
 *
 * > NO production Agent retail price has been approved yet. Do NOT activate a
 * > customer-facing production Agent price. For Core-4 dogfood, create the
 * > smallest explicit INTERNAL/TEST-ONLY economic policy … designated dev/test
 * > billing account only, not reachable by normal customer paths, clearly
 * > marked non-production, hard spending ceiling.
 *
 * So there are two budget worlds and this file is the only door between them:
 *
 * ```
 * production      EXECUTION_BUDGET_POLICIES            launch-v1-budget, per class
 * internal        EXECUTION_DOGFOOD_BUDGET_POLICIES    allowlisted projects only
 * ```
 *
 * Both worlds still exist and the door between them is still this file. What
 * changed at `launch-v1` is only which side answers first: the production
 * branch now resolves for every project, so the allowlist stops being the only
 * way to run an agent and becomes what it always described itself as — a way to
 * run one under *internal, non-production* economics.
 *
 * ## Why an allowlist of project ids rather than a feature flag
 *
 * A flag is a boolean somebody can flip for everyone. An allowlist is a set
 * that has to *name* the thing it admits, which means the blast radius of a
 * mistake is one project rather than the customer base. It also makes the
 * dogfood self-documenting: the run that produced the first cost baseline can
 * be traced to the exact project that was permitted to produce it.
 *
 * Read from the environment rather than the database for the same reason the
 * Anthropic key is: it is an operator decision, not application state, and
 * nothing a customer can reach may write to it.
 */

const ALLOWLIST_ENV = "VIBE_INTERNAL_AGENT_DOGFOOD_PROJECT_IDS";

/**
 * The projects permitted to run the internal dogfood agent.
 *
 * Comma-separated project ids. Absent or empty means **nobody**, which is the
 * correct production default: an unset variable must never be the permissive
 * case for something that spends money.
 */
export function internalDogfoodProjectIds(
  env: Record<string, string | undefined> = process.env,
): readonly string[] {
  const raw = env[ALLOWLIST_ENV];
  if (!raw) return [];

  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export type AgentEconomicPolicy = {
  budget: ExecutionBudget;
  /**
   * True only for the internal dogfood policy.
   *
   * Carried on the resolved policy rather than inferred from the version
   * string, so every consumer — the spec, the run row, the report — states it
   * explicitly. §18 asks for "clearly marked non-production", and a marker that
   * has to be derived is a marker that gets dropped.
   */
  nonProduction: boolean;
  /** Why this is not a customer price. Rendered verbatim into the dogfood report. */
  disclosure: string;
};

const DOGFOOD_DISCLOSURE =
  "Internal CORE-4 dogfood economics. No production Agent Credit price is activated; " +
  "this ceiling exists to exercise reserve → spend → settle/release and to collect a " +
  "first real cost baseline.";

/**
 * The economics that authorize agentic execution for one project, or null.
 *
 * Production first, so that an approved policy is returned without anybody
 * remembering to reorder these branches. Since `launch-v1-budget` that branch
 * fires for every project; before it, `EXECUTION_BUDGET_POLICIES` was empty and
 * the honest answer for a customer project was `null`, which admission turns
 * into `agentic_pricing_not_configured` (Core-3 §24). That refusal is still
 * reachable — a date outside every policy's interval produces it — and is still
 * the correct answer when it happens.
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
  const at = params.at ?? new Date();

  const production = resolveExecutionBudget(params.pricingClass, at);
  if (production) {
    return {
      budget: production,
      nonProduction: false,
      disclosure: "Approved production Agent economics.",
    };
  }

  if (!internalDogfoodProjectIds(params.env).includes(params.projectId)) return null;

  const dogfood = resolveExecutionBudget(
    params.pricingClass,
    at,
    EXECUTION_DOGFOOD_BUDGET_POLICIES,
  );
  if (!dogfood) return null;

  return { budget: dogfood, nonProduction: true, disclosure: DOGFOOD_DISCLOSURE };
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

/**
 * The dogfood policy, for the report and for tests.
 *
 * Exported so a report can name the exact ceilings the first run was bounded
 * by without reaching into the resolver and without duplicating the numbers.
 */
export { CORE4_DOGFOOD_BUDGET_POLICY };
