import { describe, expect, it } from "vitest";
import { planStaleness, type PlanCurrencyFacts } from "./service";
import { ACTION_PLANNER_CONTRACT_VERSION } from "./schema";
import type { StoredActionPlan } from "./store";

/**
 * Plan staleness (CORE-2b §42, §88, §89, §90).
 *
 * A pure function over five observed facts, which is why it can be tested
 * without a database. That shape is deliberate: staleness is a comparison, not
 * a heuristic, and every reason it can give is something that demonstrably
 * moved rather than something that merely got old.
 *
 * What none of these tests do is refresh anything. A stale plan stays visible
 * and stays stale until the user chooses to spend on a new one (Rule 60, §43).
 */

function storedPlan(overrides: Partial<StoredActionPlan> = {}): StoredActionPlan {
  return {
    id: "plan-1",
    projectId: "project-1",
    businessAuditId: "audit-1",
    opportunitySetId: "set-1",
    opportunityId: "1-positioning-narrow-your-first-customer",
    inputHash: "a".repeat(64),
    status: "completed",
    goal: "…",
    whyNow: "…",
    expectedOutcome: "…",
    addressesRootProblem: "…",
    assumptions: [],
    rootProblem: "The business has not decided who its first customer is.",
    lenses: ["audience"],
    stepCount: 4,
    validationNotes: [],
    validationFindings: [],
    failureCode: null,
    contractVersion: ACTION_PLANNER_CONTRACT_VERSION,
    plannerVersion: "action-planner-v1",
    promptVersion: "action-planner-prompt-v1",
    rubricVersion: "action-planner-rubric-v1",
    evidencePackVersion: "business-evidence.v3",
    provider: "anthropic",
    model: "claude-sonnet-5",
    productProfileId: "profile-1",
    founderIntentHash: "b".repeat(64),
    createdAt: "2026-08-17T10:00:00.000Z",
    completedAt: "2026-08-17T10:01:00.000Z",
    steps: [],
    ...overrides,
  };
}

const CURRENT: PlanCurrencyFacts = {
  latestAuditId: "audit-1",
  latestOpportunitySetId: "set-1",
  latestProductProfileId: "profile-1",
  latestFounderIntentHash: "b".repeat(64),
  currentContractVersion: ACTION_PLANNER_CONTRACT_VERSION,
};

describe("planStaleness", () => {
  it("finds nothing wrong with a current plan", () => {
    expect(planStaleness(storedPlan(), CURRENT)).toEqual([]);
  });

  /** §88 — a plan pointing at a superseded audit is never silently current. */
  it("reports a superseded audit", () => {
    expect(planStaleness(storedPlan(), { ...CURRENT, latestAuditId: "audit-2" })).toEqual([
      "audit_superseded",
    ]);
  });

  it("reports superseded Moves", () => {
    expect(planStaleness(storedPlan(), { ...CURRENT, latestOpportunitySetId: "set-2" })).toEqual([
      "move_superseded",
    ]);
  });

  /** §90 — a material product change. */
  it("reports a changed product profile", () => {
    expect(
      planStaleness(storedPlan(), { ...CURRENT, latestProductProfileId: "profile-2" }),
    ).toEqual(["product_profile_changed"]);
  });

  /** §89 — the founder told Vibe something new about the business. */
  it("reports changed founder intent", () => {
    expect(
      planStaleness(storedPlan(), { ...CURRENT, latestFounderIntentHash: "c".repeat(64) }),
    ).toEqual(["founder_intent_changed"]);
  });

  /** §41 — the planner itself moved on. */
  it("reports a superseded planner contract", () => {
    expect(
      planStaleness(storedPlan(), {
        ...CURRENT,
        currentContractVersion: "action-planner-contract-v2",
      }),
    ).toEqual(["planner_contract_superseded"]);
  });

  it("reports every reason that applies, not just the first", () => {
    const reasons = planStaleness(storedPlan(), {
      ...CURRENT,
      latestAuditId: "audit-2",
      latestOpportunitySetId: "set-2",
      latestFounderIntentHash: "c".repeat(64),
    });

    expect(reasons).toEqual(["audit_superseded", "move_superseded", "founder_intent_changed"]);
  });

  /**
   * §90's caveat, stated as a test: staleness keys on the profile *row*, which
   * is the audit's own reuse key. A re-analysis that produced an identical
   * understanding reuses the profile row and therefore does not invalidate the
   * plan — only a genuinely new understanding does.
   */
  it("does not invalidate a plan when the same profile is still current", () => {
    expect(
      planStaleness(storedPlan({ productProfileId: "profile-1" }), CURRENT),
    ).toEqual([]);
  });

  /**
   * A project whose audit or Moves cannot be read says nothing about staleness.
   *
   * Absence is not evidence that something moved, and reporting it as staleness
   * would put a "your plan is out of date" notice on a plan that is fine.
   */
  it("says nothing when a fact is unavailable", () => {
    expect(
      planStaleness(storedPlan(), {
        latestAuditId: null,
        latestOpportunitySetId: null,
        latestProductProfileId: null,
        latestFounderIntentHash: null,
        currentContractVersion: ACTION_PLANNER_CONTRACT_VERSION,
      }),
    ).toEqual([]);
  });
});
