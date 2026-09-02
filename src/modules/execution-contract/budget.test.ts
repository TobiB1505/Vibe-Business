import { describe, expect, it } from "vitest";
import { creditsToUnits } from "@/modules/credits/units";
import { RETAIL_OPERATION_KINDS, retailChargeFor } from "@/modules/credits/retail";
import { EXECUTION_PRICING_CLASSES } from "@/modules/economy/execution-class";
import { AGENT_SANDBOX_LIFETIME_MS } from "@/modules/coding-agent/budget";
import { EXECUTION_BUDGET_POLICIES, checkBudgetBinding, resolveExecutionBudget } from "./budget";
import { admitExecutionSpec } from "./service";
import { resolveStepExecution } from "./resolver";
import { resolveExecutionValidation } from "./validation-requirements";
import { buildExecutionSpec } from "./spec";
import {
  FIXTURE_PLAN,
  fakeBudgetPolicy,
  fakePlanContext,
  fakePlanStep,
  fakeRepositoryBinding,
  fakeResolveInput,
  fakeSnapshot,
  fakeWriteScope,
} from "./test-support";

/**
 * Budget binding (EXECUTION CORE-3 §24, §25, §26, §49).
 */

const FIXTURE_BUDGET = resolveExecutionBudget("standard", new Date("2026-08-18T00:00:00.000Z"), [
  fakeBudgetPolicy(),
])!;

function agenticSpec(budget = FIXTURE_BUDGET) {
  const step = fakePlanStep();
  const resolution = resolveStepExecution(
    fakeResolveInput({ step, plan: fakePlanContext([step]) }),
  );

  return {
    resolution,
    spec: buildExecutionSpec({
      resolution,
      step,
      plan: { ...FIXTURE_PLAN, assumptions: [...FIXTURE_PLAN.assumptions] },
      projectId: "project-1",
      repository: fakeRepositoryBinding(),
      approvedDecisions: [],
      validation: resolveExecutionValidation(fakeSnapshot()),
      budget,
      credit: { quoteId: "quote-1", maxAuthorizedCredits: budget.maxCredits },
      writeScope: fakeWriteScope(),
      createdAt: "2026-08-18T12:00:00.000Z",
    }),
  };
}

describe("budget policy — the production numbers and where they came from (§25)", () => {
  it("ships exactly one approved policy, and none before it took effect", () => {
    expect(EXECUTION_BUDGET_POLICIES.map((policy) => policy.version)).toEqual(["launch-v1-budget"]);
    // §25 forbade arbitrary production numbers, and for three sprints the
    // honest answer was an empty registry. `launch-v1-budget` is dated, so the
    // period in which no policy existed is still resolvable as exactly that.
    expect(resolveExecutionBudget("standard", new Date("2026-08-18T00:00:00.000Z"))).toBeNull();
  });

  it("defines every execution pricing class, so none can resolve undefined", () => {
    // A missing class would resolve `undefined` at exactly the moment money
    // moves — an `ExecutionBudget` whose every field is undefined, passed
    // straight into `checkBudgetBinding`.
    for (const policy of EXECUTION_BUDGET_POLICIES) {
      expect(Object.keys(policy.budgetsByClass).sort()).toEqual(
        [...EXECUTION_PRICING_CLASSES].sort(),
      );
    }
  });

  it("matches the retail policy, which prices the same operation per class", () => {
    // The two must agree: a Credit ceiling with no customer price behind it
    // would be a number nobody approved, and `checkBudgetBinding` would refuse
    // every run of that class for what looks like a billing fault.
    expect(RETAIL_OPERATION_KINDS).toContain("agent_execution");

    const at = new Date("2026-09-01T00:00:00.000Z");
    for (const pricingClass of EXECUTION_PRICING_CLASSES) {
      const price = retailChargeFor("agent_execution", at, { pricingClass });
      expect(price.kind === "charge" && price.creditUnits).toBe(
        resolveExecutionBudget(pricingClass, at)!.maxCredits,
      );
    }
  });

  it("keeps every wall-clock ceiling inside the sandbox's own lifetime", () => {
    // A budget that outlived its workspace would have the VM reclaimed with the
    // harness still working and the run still paid for.
    for (const pricingClass of EXECUTION_PRICING_CLASSES) {
      const budget = resolveExecutionBudget(pricingClass, new Date("2026-09-01T00:00:00.000Z"))!;
      expect(budget.maxWallClockMs).toBeLessThan(AGENT_SANDBOX_LIFETIME_MS);
      expect(budget.maxSandboxMs).toBeLessThan(budget.maxWallClockMs);
    }
  });

  it("resolves a fixture policy on the same half-open interval convention", () => {
    const policies = [
      {
        ...fakeBudgetPolicy(),
        effectiveFrom: "2026-01-01T00:00:00.000Z",
        effectiveTo: "2026-06-01T00:00:00.000Z",
      },
    ];

    expect(
      resolveExecutionBudget("standard", new Date("2026-01-01T00:00:00.000Z"), policies),
    ).not.toBeNull();
    expect(
      resolveExecutionBudget("standard", new Date("2026-06-01T00:00:00.000Z"), policies),
    ).toBeNull();
  });
});

describe("budget binding (§49)", () => {
  it("refuses when no budget policy authorizes the work", () => {
    expect(
      checkBudgetBinding({
        budget: null,
        reservation: { id: "res-1", status: "active", reservedCredits: creditsToUnits(500) },
      }),
    ).toEqual({ ok: false, refusal: "agentic_pricing_not_configured" });
  });

  it("refuses without a reservation", () => {
    expect(checkBudgetBinding({ budget: FIXTURE_BUDGET, reservation: null })).toEqual({
      ok: false,
      refusal: "credit_reservation_required",
    });
  });

  it("refuses a reservation that no longer holds Credits", () => {
    expect(
      checkBudgetBinding({
        budget: FIXTURE_BUDGET,
        reservation: { id: "res-1", status: "released", reservedCredits: creditsToUnits(500) },
      }),
    ).toEqual({ ok: false, refusal: "credit_reservation_not_active" });
  });

  it("refuses a reservation that does not cover the authorized maximum (§26)", () => {
    expect(
      checkBudgetBinding({
        budget: FIXTURE_BUDGET,
        reservation: { id: "res-1", status: "active", reservedCredits: creditsToUnits(199) },
      }),
    ).toEqual({ ok: false, refusal: "credit_reservation_insufficient" });
  });

  it("admits a reservation that covers the whole ceiling", () => {
    expect(
      checkBudgetBinding({
        budget: FIXTURE_BUDGET,
        reservation: { id: "res-1", status: "active", reservedCredits: creditsToUnits(200) },
      }),
    ).toEqual({ ok: true });
  });
});

describe("spec admission (§24, §49)", () => {
  it("refuses an agent-ready spec with no reservation bound", () => {
    const { spec, resolution } = agenticSpec();

    expect(
      admitExecutionSpec({ spec, resolution, budget: FIXTURE_BUDGET, reservation: null }),
    ).toEqual({ admissible: false, refusal: "credit_reservation_required" });
  });

  it("admits an agent-ready spec with an authorized reservation", () => {
    const { spec, resolution } = agenticSpec();

    expect(
      admitExecutionSpec({
        spec,
        resolution,
        budget: FIXTURE_BUDGET,
        reservation: { id: "res-1", status: "active", reservedCredits: creditsToUnits(200) },
      }),
    ).toEqual({ admissible: true });
  });

  it("lets the resolution's live-state refusal win over an otherwise valid reservation", () => {
    const { spec, resolution } = agenticSpec();
    const stale = {
      ...resolution,
      admission: { admissible: false as const, refusal: "repository_head_moved" as const },
    };

    expect(
      admitExecutionSpec({
        spec,
        resolution: stale,
        budget: FIXTURE_BUDGET,
        reservation: { id: "res-1", status: "active", reservedCredits: creditsToUnits(9999) },
      }),
    ).toEqual({ admissible: false, refusal: "repository_head_moved" });
  });
});
