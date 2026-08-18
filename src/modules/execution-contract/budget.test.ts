import { describe, expect, it } from "vitest";
import { creditsToUnits } from "@/modules/credits/units";
import { RETAIL_OPERATION_KINDS } from "@/modules/credits/retail";
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

const FIXTURE_BUDGET = resolveExecutionBudget(new Date("2026-08-18T00:00:00.000Z"), [
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

describe("budget policy — no production numbers exist yet (§25)", () => {
  it("ships no approved policy", () => {
    expect(EXECUTION_BUDGET_POLICIES).toEqual([]);
    expect(resolveExecutionBudget(new Date("2026-08-18T00:00:00.000Z"))).toBeNull();
  });

  it("matches the retail policy, which prices no agentic operation either", () => {
    // The two must agree: a Credit ceiling with no customer price behind it
    // would be a number nobody approved.
    expect(RETAIL_OPERATION_KINDS).not.toContain("agentic_execution");
  });

  it("resolves a fixture policy on the same half-open interval convention", () => {
    const policies = [
      { ...fakeBudgetPolicy(), effectiveFrom: "2026-01-01T00:00:00.000Z", effectiveTo: "2026-06-01T00:00:00.000Z" },
    ];

    expect(resolveExecutionBudget(new Date("2026-01-01T00:00:00.000Z"), policies)).not.toBeNull();
    expect(resolveExecutionBudget(new Date("2026-06-01T00:00:00.000Z"), policies)).toBeNull();
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
