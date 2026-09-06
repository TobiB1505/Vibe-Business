import { describe, expect, it } from "vitest";
import {
  EXECUTION_BUDGET_POLICIES,
  LAUNCH_V1_BUDGET_POLICY,
  resolveExecutionBudget,
} from "@/modules/execution-contract/budget";
import { compileExecutionPolicy } from "@/modules/execution-contract/policy";
import { RETAIL_OPERATION_KINDS, retailChargeFor } from "@/modules/credits/retail";
import { CREDIT_VALUE_NANO_USD } from "@/modules/credits/margin-guard";
import { EXECUTION_PRICING_CLASSES } from "@/modules/economy/execution-class";
import { creditsToUnits } from "@/modules/credits/units";
import { isAgenticExecutionAuthorized, resolveAgentEconomics } from "./authorization";
import { AGENT_DISCOVERY_SCOPE, checkBudgetMatchesScope, deriveAgentLimits } from "./budget";

/**
 * Who may run an agent, and on whose economics
 * (EXECUTION CORE-4 §17, §18, §55).
 *
 * §18 was unusually specific, and this file used to be that paragraph as
 * assertions:
 *
 * > designated dev/test billing account only · not reachable by normal customer
 * > paths · clearly marked non-production · no production Agent rate card ·
 * > no arbitrary free unlimited execution · hard spending ceiling
 *
 * Everything there was conditional on one thing: no measured cost existed yet,
 * so no customer price could be activated. `launch-v1` produced the
 * measurement and the price, and [ADR 0092](../../../docs/decisions/0092-the-agent-runs-as-the-product.md) removed the second book the
 * paragraph existed to keep separate. What survives §18 is the half that was
 * never about the dogfood: **no arbitrary free unlimited execution, and a hard
 * spending ceiling.** That is what the rest of this file asserts, against the
 * only book there is.
 */

/** Inside `launch-v1-budget`. */
const LAUNCH = new Date("2026-09-01T00:00:00.000Z");

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
    // There is one book. The internal `agent_execution_dogfood` kind is gone
    // rather than hidden, so nothing can be charged out of a second ceiling.
    expect(RETAIL_OPERATION_KINDS).not.toContain("agent_execution_dogfood");
  });

  it("charges exactly what the production budget authorizes, class for class", () => {
    // The two numbers must agree or `checkBudgetBinding` refuses admission for
    // a configuration mistake rather than for a real shortfall.
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
});

/**
 * The allowlist is gone, and this is what that means (ADR 0092).
 *
 * It decided two different things at once and only ever described itself as
 * deciding one. As economics it said "do not bill this project"; as the gate in
 * `website-preflight.ts` it said "this project may not start an agent at all",
 * which is what actually held for every customer. Both are removed, so the
 * environment no longer has a say in either question.
 */
describe("no environment variable decides who may run an agent", () => {
  const ONCE_ALLOWLISTED = "project-1";
  const NEVER_ALLOWLISTED = "project-3";

  it("authorizes every project, with the environment saying nothing", () => {
    for (const projectId of [ONCE_ALLOWLISTED, NEVER_ALLOWLISTED]) {
      const economics = resolveAgentEconomics({
        projectId,
        pricingClass: "standard",
        at: LAUNCH,
        env: {},
      });

      expect(economics?.budget.budgetPolicyVersion).toBe("launch-v1-budget");
      expect(isAgenticExecutionAuthorized({ projectId, at: LAUNCH, env: {} })).toBe(true);
    }
  });

  it("gives the project that used to be exempt the same economics as everyone", () => {
    // The variable that used to name it is now an ordinary unread string.
    const exempt = resolveAgentEconomics({
      projectId: ONCE_ALLOWLISTED,
      pricingClass: "standard",
      at: LAUNCH,
      env: { VIBE_INTERNAL_AGENT_DOGFOOD_PROJECT_IDS: ONCE_ALLOWLISTED },
    });
    const customer = resolveAgentEconomics({
      projectId: NEVER_ALLOWLISTED,
      pricingClass: "standard",
      at: LAUNCH,
      env: {},
    });

    expect(exempt).toEqual(customer);
  });

  it("refuses everybody equally when no policy is in force", () => {
    const at = new Date("2026-01-01T00:00:00.000Z");
    expect(resolveAgentEconomics({ projectId: ONCE_ALLOWLISTED, pricingClass: "standard", at })).toBeNull();
    expect(isAgenticExecutionAuthorized({ projectId: ONCE_ALLOWLISTED, at })).toBe(false);
  });
});

describe("§17 — the production budget is conservative and complete", () => {
  const budget = LAUNCH_V1_BUDGET_POLICY.budgetsByClass.standard;

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

  /**
   * §18's surviving half, now that every customer can reach this.
   *
   * The dogfood ceiling was small because it was an experiment. This one is
   * small because a founder is paying for it and a runaway agent is their bill,
   * so the bound matters more than it did, not less.
   */
  it("is a genuinely bounded run", () => {
    expect(budget.maxChangedFiles).toBeLessThanOrEqual(10);
    expect(budget.maxChangedBytes).toBeLessThanOrEqual(100 * 1024);
    expect(budget.maxCredits).toBeLessThanOrEqual(creditsToUnits(350));
    expect(budget.maxProviderSpendUsd).toBeLessThanOrEqual(5);
  });
});

describe("budget and write scope must describe the same blast radius", () => {
  const budget = { budgetPolicyVersion: "x", ...LAUNCH_V1_BUDGET_POLICY.budgetsByClass.standard };

  const policy = compileExecutionPolicy({
    mode: "agentic",
    executionClass: "application_code_change",
    riskClass: "moderate",
    writeScope: {
      discovery: { ...AGENT_DISCOVERY_SCOPE },
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
