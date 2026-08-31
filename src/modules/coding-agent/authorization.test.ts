import { describe, expect, it } from "vitest";
import {
  CORE4_DOGFOOD_BUDGET_POLICY,
  EXECUTION_BUDGET_POLICIES,
  EXECUTION_DOGFOOD_BUDGET_POLICIES,
  resolveExecutionBudget,
} from "@/modules/execution-contract/budget";
import { compileExecutionPolicy } from "@/modules/execution-contract/policy";
import { RETAIL_OPERATION_KINDS, retailChargeFor } from "@/modules/credits/retail";
import { CREDIT_VALUE_NANO_USD } from "@/modules/credits/margin-guard";
import { EXECUTION_PRICING_CLASSES } from "@/modules/economy/execution-class";
import { internalChargeFor, INTERNAL_OPERATION_KINDS } from "@/modules/credits/internal";
import { creditsToUnits } from "@/modules/credits/units";
import {
  internalDogfoodProjectIds,
  isAgenticExecutionAuthorized,
  resolveAgentEconomics,
} from "./authorization";
import {
  CORE4_DOGFOOD_DISCOVERY,
  checkBudgetMatchesScope,
  deriveAgentLimits,
} from "./budget";

/**
 * Who may run an agent, and on whose economics
 * (EXECUTION CORE-4 §17, §18, §55).
 *
 * §18 is unusually specific, and these tests are that paragraph as assertions:
 *
 * > designated dev/test billing account only · not reachable by normal customer
 * > paths · clearly marked non-production · no production Agent rate card ·
 * > no arbitrary free unlimited execution · hard spending ceiling
 */

const AT = new Date("2026-08-19T00:00:00.000Z");
/** Inside `launch-v1-budget`. */
const LAUNCH = new Date("2026-09-01T00:00:00.000Z");

/**
 * §18 said: do not activate a customer-facing production Agent price without a
 * measured cost behind it. CLAUDE.md rule 78 says the same thing and is still
 * in force.
 *
 * `launch-v1` satisfied it rather than repealed it — sixteen delivered dogfood
 * runs are the measurement — so these tests changed from "nothing is priced" to
 * "the price and the ceiling agree, and the two books stay apart". The
 * separation §18 was protecting is the part that must not move, and it is what
 * the rest of this file now asserts.
 */
describe("the production Agent price is activated, and bound to its ceiling", () => {
  it("ships exactly one production budget policy", () => {
    expect(EXECUTION_BUDGET_POLICIES.map((policy) => policy.version)).toEqual([
      "launch-v1-budget",
    ]);
  });

  it("still refuses when no policy is in force at the instant asked", () => {
    // The refusal path §18 relied on is intact: it is now reached by a date
    // outside every policy's interval rather than by an empty registry, and
    // admission still turns it into `agentic_pricing_not_configured`.
    expect(resolveExecutionBudget("standard", new Date("2026-01-01T00:00:00.000Z"))).toBeNull();
  });

  it("prices Agentic Execution in the customer book, per class", () => {
    expect(RETAIL_OPERATION_KINDS).toContain("agent_execution");
    // The internal ceiling never becomes a customer price. It is a different
    // book and a different kind, and no customer path can name it.
    expect(RETAIL_OPERATION_KINDS).not.toContain("agent_execution_dogfood");
  });

  it("charges exactly what the production budget authorizes, class for class", () => {
    // The two numbers must agree or `checkBudgetBinding` refuses admission for
    // a configuration mistake rather than for a real shortfall. This is the
    // same invariant the dogfood test below asserts, applied to the book a
    // customer is actually charged from.
    for (const pricingClass of EXECUTION_PRICING_CLASSES) {
      const budget = resolveExecutionBudget(pricingClass, LAUNCH)!;
      const price = retailChargeFor("agent_execution", LAUNCH, { pricingClass });

      expect(price.kind).toBe("charge");
      expect(price.kind === "charge" && price.creditUnits).toBe(budget.maxCredits);
    }
  });

  it("leaves headroom between what a run may cost Vibe and what it earns", () => {
    // `maxProviderSpendUsd` is Vibe's stop on its own invoice, and it must sit
    // below the revenue the class price produces or a run at the ceiling would
    // be delivered at a loss. Checked as a relationship rather than as two
    // pinned numbers, so the assertion survives a repricing.
    for (const pricingClass of EXECUTION_PRICING_CLASSES) {
      const budget = resolveExecutionBudget(pricingClass, LAUNCH)!;
      const revenueUsd = (budget.maxCredits / 1_000) * (CREDIT_VALUE_NANO_USD / 1e9);

      expect(budget.maxProviderSpendUsd).toBeLessThan(revenueUsd * 0.55);
    }
  });

  it("keeps the dogfood ceiling in its own book", () => {
    expect(INTERNAL_OPERATION_KINDS).toEqual(["agent_execution_dogfood"]);
    expect(internalChargeFor("agent_execution_dogfood", AT)?.policyVersion).toBe(
      "internal-dogfood-v1",
    );
  });

  /**
   * The same invariant, in the internal book. Unchanged by `launch-v1`, and
   * asserted separately on purpose: the dogfood ceiling and the customer price
   * are two books, and a test that checked only one would let them merge.
   */
  it("reserves exactly the ceiling the dogfood budget authorizes", () => {
    const reserved = internalChargeFor("agent_execution_dogfood", AT);
    expect(reserved?.creditUnits).toBe(CORE4_DOGFOOD_BUDGET_POLICY.budgetsByClass.standard.maxCredits);
  });
});

describe("§18 — reachable only from an internal allowlist", () => {
  it("authorizes nobody when the allowlist is unset", () => {
    expect(internalDogfoodProjectIds({})).toEqual([]);
    expect(resolveAgentEconomics({ projectId: "project-1", pricingClass: "standard", at: AT, env: {} })).toBeNull();
    expect(isAgenticExecutionAuthorized({ projectId: "project-1", at: AT, env: {} })).toBe(false);
  });

  it("authorizes nobody when the allowlist is empty", () => {
    const env = { VIBE_INTERNAL_AGENT_DOGFOOD_PROJECT_IDS: "  ,  , " };
    expect(internalDogfoodProjectIds(env)).toEqual([]);
    expect(resolveAgentEconomics({ projectId: "project-1", pricingClass: "standard", at: AT, env })).toBeNull();
  });

  it("authorizes exactly the listed projects and nobody else", () => {
    const env = { VIBE_INTERNAL_AGENT_DOGFOOD_PROJECT_IDS: "project-1, project-2" };

    expect(resolveAgentEconomics({ projectId: "project-1", pricingClass: "standard", at: AT, env })).not.toBeNull();
    expect(resolveAgentEconomics({ projectId: "project-2", pricingClass: "standard", at: AT, env })).not.toBeNull();
    // A customer project, which is every project that is not on the list.
    expect(resolveAgentEconomics({ projectId: "project-3", pricingClass: "standard", at: AT, env })).toBeNull();
  });

  it("marks the dogfood economics non-production, explicitly", () => {
    const economics = resolveAgentEconomics({
      projectId: "project-1",
      pricingClass: "standard",
      at: AT,
      env: { VIBE_INTERNAL_AGENT_DOGFOOD_PROJECT_IDS: "project-1" },
    });

    expect(economics?.nonProduction).toBe(true);
    expect(economics?.disclosure).toContain("No production Agent Credit price is activated");
    expect(economics?.budget.budgetPolicyVersion).toBe("core4-dogfood-budget-v1");
  });
});

describe("§17 — the CORE-4 dogfood policy is conservative and complete", () => {
  const budget = CORE4_DOGFOOD_BUDGET_POLICY.budgetsByClass.standard;

  it("bounds every dimension §17 names", () => {
    // Agent turns, repair loops, wall clock, changed files, diff size, AI/provider
    // usage and sandbox duration — all present, all finite, all positive.
    for (const [name, value] of Object.entries({
      maxAgentTurns: budget.maxAgentTurns,
      maxRepairAttempts: budget.maxRepairAttempts,
      maxWallClockMs: budget.maxWallClockMs,
      maxSandboxMs: budget.maxSandboxMs,
      maxChangedFiles: budget.maxChangedFiles,
      maxChangedBytes: budget.maxChangedBytes,
      maxAiCalls: budget.maxAiCalls,
      maxProviderSpendUsd: budget.maxProviderSpendUsd,
      maxCredits: budget.maxCredits,
    })) {
      expect(Number.isFinite(value), name).toBe(true);
      expect(value, name).toBeGreaterThan(0);
    }
  });

  it("allows no network requests", () => {
    expect(budget.maxNetworkRequests).toBe(0);
  });

  /**
   * The agent must not outlive its own workspace. The sandbox's lifetime bound
   * is 15 minutes; a wall clock longer than that would mean a run whose
   * filesystem disappears mid-turn.
   */
  it("keeps the sandbox ceiling at or below the sandbox's own lifetime", () => {
    expect(budget.maxSandboxMs).toBeLessThanOrEqual(15 * 60 * 1000);
    expect(budget.maxWallClockMs).toBeGreaterThanOrEqual(budget.maxSandboxMs);
  });

  it("is a genuinely small first experiment", () => {
    expect(budget.maxChangedFiles).toBeLessThanOrEqual(10);
    expect(budget.maxChangedBytes).toBeLessThanOrEqual(100 * 1024);
    expect(budget.maxCredits).toBeLessThanOrEqual(creditsToUnits(200));
    expect(budget.maxProviderSpendUsd).toBeLessThanOrEqual(5);
  });

  it("is the only dogfood policy, and is not in the production array", () => {
    expect(EXECUTION_DOGFOOD_BUDGET_POLICIES).toEqual([CORE4_DOGFOOD_BUDGET_POLICY]);
    expect(EXECUTION_BUDGET_POLICIES).not.toContain(CORE4_DOGFOOD_BUDGET_POLICY);
  });
});

describe("budget and write scope must describe the same blast radius", () => {
  const budget = { budgetPolicyVersion: "x", ...CORE4_DOGFOOD_BUDGET_POLICY.budgetsByClass.standard };

  const policy = compileExecutionPolicy({
    mode: "agentic",
    executionClass: "application_code_change",
    riskClass: "moderate",
    writeScope: {
      discovery: { ...CORE4_DOGFOOD_DISCOVERY },
      mutation: {
        maxChangedFiles: budget.maxChangedFiles,
        maxChangedBytes: budget.maxChangedBytes,
        forbiddenPathClasses: [],
      },
    },
  });

  it("agrees when the scope is derived from the budget", () => {
    expect(checkBudgetMatchesScope({ budget, policy })).toEqual([]);
  });

  /**
   * A budget looser than the scope is the dangerous direction: a run would sail
   * past the ceiling it was meant to stop at and be rejected only after
   * spending the whole provider bill.
   */
  it("reports a disagreement rather than picking a winner at runtime", () => {
    const problems = checkBudgetMatchesScope({
      budget: { ...budget, maxChangedFiles: 999, maxChangedBytes: 1 },
      policy,
    });

    expect(problems).toHaveLength(2);
    expect(problems.join(" ")).toContain("maxChangedFiles");
    expect(problems.join(" ")).toContain("maxChangedBytes");
  });

  it("derives runtime counters from the spec, inventing nothing", () => {
    const limits = deriveAgentLimits({ budget, policy });

    expect(limits.maxTurns).toBe(budget.maxAgentTurns);
    // A repair is "run the check, see it fail, fix it, run it again", so three
    // repairs need four check runs.
    expect(limits.maxCheckRuns).toBe(budget.maxRepairAttempts + 1);
    expect(limits.maxChangedFiles).toBe(policy.writeScope.mutation.maxChangedFiles);
    expect(limits.maxFilesRead).toBe(policy.writeScope.discovery.maxFilesRead);
    expect(limits.maxProviderSpendUsd).toBe(budget.maxProviderSpendUsd);
    expect(limits.budgetPolicyVersion).toBe(budget.budgetPolicyVersion);
  });
});
