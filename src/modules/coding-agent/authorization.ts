import {
  CORE4_DOGFOOD_BUDGET_POLICY,
  EXECUTION_DOGFOOD_BUDGET_POLICIES,
  resolveExecutionBudget,
  type ExecutionBudget,
} from "@/modules/execution-contract/budget";

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
 * production      EXECUTION_BUDGET_POLICIES            empty → nobody
 * internal        EXECUTION_DOGFOOD_BUDGET_POLICIES    allowlisted projects only
 * ```
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
 * Production first, so that the day an approved policy is added this function
 * starts returning it without anybody remembering to reorder these branches.
 * Today `EXECUTION_BUDGET_POLICIES` is empty, so the production branch never
 * fires and the honest answer for a customer project is `null` — which
 * admission turns into `agentic_pricing_not_configured` (Core-3 §24).
 */
export function resolveAgentEconomics(params: {
  projectId: string;
  at?: Date;
  env?: Record<string, string | undefined>;
}): AgentEconomicPolicy | null {
  const at = params.at ?? new Date();

  const production = resolveExecutionBudget(at);
  if (production) {
    return {
      budget: production,
      nonProduction: false,
      disclosure: "Approved production Agent economics.",
    };
  }

  if (!internalDogfoodProjectIds(params.env).includes(params.projectId)) return null;

  const dogfood = resolveExecutionBudget(at, EXECUTION_DOGFOOD_BUDGET_POLICIES);
  if (!dogfood) return null;

  return { budget: dogfood, nonProduction: true, disclosure: DOGFOOD_DISCLOSURE };
}

/** Whether agentic execution is authorized at all, for the resolver's gate. */
export function isAgenticExecutionAuthorized(params: {
  projectId: string;
  at?: Date;
  env?: Record<string, string | undefined>;
}): boolean {
  return resolveAgentEconomics(params) !== null;
}

/**
 * The dogfood policy, for the report and for tests.
 *
 * Exported so a report can name the exact ceilings the first run was bounded
 * by without reaching into the resolver and without duplicating the numbers.
 */
export { CORE4_DOGFOOD_BUDGET_POLICY };
