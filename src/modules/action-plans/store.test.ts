import { describe, expect, it } from "vitest";
import { FakeDatabase, fakeSupabase } from "@/modules/operations/test-support";
import {
  ACTION_PLANNER_CONTRACT_VERSION,
  ACTION_PLANNER_VERSION,
  ACTION_PLAN_SCHEMA_VERSION,
  type ActionPlan,
} from "./schema";
import {
  completeActionPlanRun,
  computeActionPlanInputHash,
  createActionPlanRun,
  failActionPlanRun,
  findReusableActionPlan,
  getLatestCompletedActionPlan,
} from "./store";
import { FAKE_PLAN_EVIDENCE_IDS, fakeRepositorySnapshotFor, fakeWirePlan } from "./test-support";
import { validateActionPlanOutput } from "./validate";

/**
 * Persistence, idempotency and history (CORE-2b §51, §53, §54, §86, §87).
 *
 * The in-flight unique index is modelled in the fake database, so the
 * idempotency test proves the guarantee Postgres actually provides rather than
 * the application's own pre-check.
 */

const IDENTITY = {
  auditId: "audit-1",
  auditInputHash: "a".repeat(64),
  opportunitySetId: "set-1",
  opportunityId: "1-positioning-narrow-your-first-customer",
  conclusionKey: "blocker-1",
  productProfileId: "profile-1",
  founderIntentHash: "b".repeat(64),
  findingIds: [],
  evidencePackVersion: "business-evidence.v3",
  contractVersion: ACTION_PLANNER_CONTRACT_VERSION,
  plannerVersion: ACTION_PLANNER_VERSION,
  promptVersion: "action-planner-prompt-v1",
  rubricVersion: "action-planner-rubric-v1",
  schemaVersion: ACTION_PLAN_SCHEMA_VERSION,
  provider: "anthropic",
  model: "claude-sonnet-5",
};

function runParams(inputHash: string) {
  return {
    projectId: "project-1",
    businessAuditId: IDENTITY.auditId,
    opportunitySetId: IDENTITY.opportunitySetId,
    opportunityId: IDENTITY.opportunityId,
    inputHash,
    rootProblem: "The business has not decided who its first customer is.",
    sourceConclusionKey: IDENTITY.conclusionKey,
    sourceConclusionLineage: "direct" as const,
    lenses: ["audience" as const],
    productProfileId: IDENTITY.productProfileId,
    founderIntentHash: IDENTITY.founderIntentHash,
    findingIds: [],
    schemaVersion: IDENTITY.schemaVersion,
    contractVersion: IDENTITY.contractVersion,
    plannerVersion: IDENTITY.plannerVersion,
    promptVersion: IDENTITY.promptVersion,
    rubricVersion: IDENTITY.rubricVersion,
    evidencePackVersion: IDENTITY.evidencePackVersion,
    provider: IDENTITY.provider,
    model: IDENTITY.model,
  };
}

function builtPlan(wire: Parameters<typeof fakeWirePlan>[0] = {}): ActionPlan {
  const validation = validateActionPlanOutput(fakeWirePlan(wire), FAKE_PLAN_EVIDENCE_IDS, {
    repository: fakeRepositorySnapshotFor(),
  });
  if (!validation.ok) throw new Error("fixture did not validate");

  return {
    schemaVersion: ACTION_PLAN_SCHEMA_VERSION,
    stepSchemaVersion: "business-action-plan-step.v2",
    contractVersion: ACTION_PLANNER_CONTRACT_VERSION,
    plannerVersion: ACTION_PLANNER_VERSION,
    promptVersion: IDENTITY.promptVersion,
    rubricVersion: IDENTITY.rubricVersion,
    evidencePackVersion: IDENTITY.evidencePackVersion,
    provider: "anthropic",
    model: "claude-sonnet-5",
    goal: validation.result.goal,
    whyNow: validation.result.whyNow,
    expectedOutcome: validation.result.expectedOutcome,
    addressesRootProblem: validation.result.addressesRootProblem,
    assumptions: validation.result.assumptions,
    steps: validation.result.steps,
    validationNotes: validation.result.notes,
    generatedAt: "2026-08-17T10:00:00.000Z",
  };
}

describe("computeActionPlanInputHash", () => {
  it("is stable for identical inputs", () => {
    expect(computeActionPlanInputHash(IDENTITY)).toBe(computeActionPlanInputHash(IDENTITY));
  });

  /** §53 — planning a different Move is a different plan, never a reuse. */
  it("changes when the Move changes", () => {
    expect(computeActionPlanInputHash({ ...IDENTITY, opportunityId: "2-seo-foundations" })).not.toBe(
      computeActionPlanInputHash(IDENTITY),
    );
  });

  /** §89, §90 — telling Vibe something new about the business changes the plan. */
  it("changes when the founder intent changes", () => {
    expect(
      computeActionPlanInputHash({ ...IDENTITY, founderIntentHash: "c".repeat(64) }),
    ).not.toBe(computeActionPlanInputHash(IDENTITY));
  });

  it("changes when the product profile changes", () => {
    expect(computeActionPlanInputHash({ ...IDENTITY, productProfileId: "profile-2" })).not.toBe(
      computeActionPlanInputHash(IDENTITY),
    );
  });

  /** §41 — a contract bump means a stored plan is no longer this contract's answer. */
  it("changes when the planner contract changes", () => {
    expect(
      computeActionPlanInputHash({ ...IDENTITY, contractVersion: "action-planner-contract-v1" }),
    ).not.toBe(computeActionPlanInputHash(IDENTITY));
  });
});

describe("createActionPlanRun", () => {
  /**
   * §54, §87 — the double submission.
   *
   * Two simultaneous requests, one index. The second loses at the database,
   * which is the only place it can be made to lose reliably, and no second paid
   * call is ever reached.
   */
  it("refuses a second in-flight run for the same inputs", async () => {
    const db = new FakeDatabase();
    const supabase = fakeSupabase(db);
    const hash = computeActionPlanInputHash(IDENTITY);

    const first = await createActionPlanRun(supabase, runParams(hash));
    const second = await createActionPlanRun(supabase, runParams(hash));

    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: false, error: "already_running" });
  });

  it("permits a run for genuinely different inputs", async () => {
    const db = new FakeDatabase();
    const supabase = fakeSupabase(db);

    const first = await createActionPlanRun(supabase, runParams(computeActionPlanInputHash(IDENTITY)));
    const second = await createActionPlanRun(
      supabase,
      runParams(computeActionPlanInputHash({ ...IDENTITY, opportunityId: "2-seo-foundations" })),
    );

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
  });

  /** §55 — a failed run releases the identity, so a retry is possible. */
  it("frees the identity when a run fails", async () => {
    const db = new FakeDatabase();
    const supabase = fakeSupabase(db);
    const hash = computeActionPlanInputHash(IDENTITY);

    const first = await createActionPlanRun(supabase, runParams(hash));
    if (!first.ok) throw new Error("setup failed");
    await failActionPlanRun(supabase, first.planId, "provider_timeout");

    expect((await createActionPlanRun(supabase, runParams(hash))).ok).toBe(true);
  });
});

describe("completing a run", () => {
  it("persists the steps and the plan, and reads them back whole", async () => {
    const db = new FakeDatabase();
    const supabase = fakeSupabase(db);
    const hash = computeActionPlanInputHash(IDENTITY);

    const created = await createActionPlanRun(supabase, runParams(hash));
    if (!created.ok) throw new Error("setup failed");

    const plan = builtPlan();
    await completeActionPlanRun(supabase, created.planId, plan, ["plan_inflation"]);

    // §86: the plan survives a reload with no provider call anywhere near it.
    const stored = await getLatestCompletedActionPlan(supabase, "project-1");

    expect(stored?.status).toBe("completed");
    expect(stored?.goal).toBe(plan.goal);
    expect(stored?.rootProblem).toBe("The business has not decided who its first customer is.");
    expect(stored?.stepCount).toBe(plan.steps.length);
    expect(stored?.validationFindings).toEqual(["plan_inflation"]);
    expect(stored?.steps.map((step) => step.order)).toEqual([1, 2, 3, 4]);
    expect(stored?.steps[1].executionSupport).toBe("founder_decides");
    expect(db.rows("project_founder_input_requests")).toHaveLength(1);
    expect(db.rows("project_founder_input_requests")[0]).toMatchObject({
      action_plan_id: created.planId,
      action_plan_step_key: plan.steps[1].id,
      subject_key: "audience.first_customer_segment",
      status: "open",
    });
  });

  /**
   * The persistence half of the whyNow round-trip (CORE-2b MINI
   * VERIFICATION §1.5).
   *
   * `validate.test.ts` proves the value survives normalization; this proves
   * it survives the write and the read after it. The `why_now` column is
   * plain `text` — no varchar bound, no second truncation waiting at the
   * database layer — so whatever left `validateActionPlanOutput` is exactly
   * what a founder reloading the plan would see.
   */
  it("persists realistic whyNow prose without a second truncation at the database", async () => {
    const db = new FakeDatabase();
    const supabase = fakeSupabase(db);
    const hash = computeActionPlanInputHash(IDENTITY);

    const realisticWhyNow =
      "The audit found no login, signup, or dashboard surface anywhere on the live site or in the repository, so the customer journey it derived stops at arrival on the homepage. The founder's stated priority is to get this launched, and launching cannot mean anything if the resort's own staff have no path from the homepage into the calendar and request tool — every other gap, including pricing, legal and acquisition, is downstream of this one and does not matter until it is closed.";
    expect(realisticWhyNow.length).toBeGreaterThan(400);

    const created = await createActionPlanRun(supabase, runParams(hash));
    if (!created.ok) throw new Error("setup failed");

    const plan = builtPlan({ whyNow: realisticWhyNow });
    expect(plan.whyNow).toBe(realisticWhyNow);

    await completeActionPlanRun(supabase, created.planId, plan, []);
    const stored = await getLatestCompletedActionPlan(supabase, "project-1");

    expect(stored?.whyNow).toBe(realisticWhyNow);
    expect(stored?.whyNow?.endsWith("…")).toBe(false);
  });

  /** §53, §86 — identical inputs find the stored answer instead of buying one. */
  it("finds a reusable plan for identical inputs", async () => {
    const db = new FakeDatabase();
    const supabase = fakeSupabase(db);
    const hash = computeActionPlanInputHash(IDENTITY);

    const created = await createActionPlanRun(supabase, runParams(hash));
    if (!created.ok) throw new Error("setup failed");
    await completeActionPlanRun(supabase, created.planId, builtPlan(), []);

    const reusable = await findReusableActionPlan(supabase, {
      projectId: "project-1",
      inputHash: hash,
    });
    expect(reusable?.id).toBe(created.planId);

    const other = await findReusableActionPlan(supabase, {
      projectId: "project-1",
      inputHash: computeActionPlanInputHash({ ...IDENTITY, opportunityId: "2-seo" }),
    });
    expect(other).toBeNull();
  });

  /**
   * §43, §44 — replanning supersedes, it does not destroy.
   *
   * The older plan keeps its steps and its provenance; a founder who acted on
   * it can still see what it said.
   */
  it("supersedes the previous plan rather than deleting it", async () => {
    const db = new FakeDatabase();
    const supabase = fakeSupabase(db);

    const first = await createActionPlanRun(supabase, runParams("1".repeat(64)));
    if (!first.ok) throw new Error("setup failed");
    await completeActionPlanRun(supabase, first.planId, builtPlan(), []);

    const second = await createActionPlanRun(supabase, runParams("2".repeat(64)));
    if (!second.ok) throw new Error("setup failed");
    await completeActionPlanRun(supabase, second.planId, builtPlan(), []);

    const rows = db.rows("action_plans");
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.id === first.planId)?.status).toBe("superseded");
    expect(rows.find((row) => row.id === second.planId)?.status).toBe("completed");
    // Nothing was deleted, including the older plan's steps.
    expect(
      db.rows("action_plan_steps").filter((row) => row.action_plan_id === first.planId).length,
    ).toBeGreaterThan(0);

    expect((await getLatestCompletedActionPlan(supabase, "project-1"))?.id).toBe(second.planId);
  });

  /**
   * §67, at the database rather than in the classifier.
   *
   * The application already guarantees this; the constraint is what makes a
   * bug in it fail loudly instead of persisting a step that claims Vibe can act
   * with nothing behind it.
   */
  it("refuses a step claiming execution with no capability", async () => {
    const db = new FakeDatabase();
    const supabase = fakeSupabase(db);

    const created = await createActionPlanRun(supabase, runParams("3".repeat(64)));
    if (!created.ok) throw new Error("setup failed");

    const plan = builtPlan();
    const corrupted: ActionPlan = {
      ...plan,
      steps: plan.steps.map((step, index) =>
        index === 0 ? { ...step, executionSupport: "vibe_executes_now" as const } : step,
      ),
    };

    await expect(completeActionPlanRun(supabase, created.planId, corrupted, [])).rejects.toThrow();
  });
});

/**
 * A new finding is a new planning problem (ADR 0092).
 *
 * Reuse is what makes this load-bearing: without the findings in the identity,
 * a founder who answered "billing is partially wired" and asked for a new plan
 * would be handed the plan written before they answered — the exact
 * indifference this change exists to end.
 */
describe("plan identity and the founder's findings", () => {
  const base = {
    auditId: "audit-1",
    auditInputHash: "a".repeat(64),
    opportunitySetId: "set-1",
    opportunityId: "opp-1",
    conclusionKey: "monetization.no_checkout",
    productProfileId: "profile-1",
    founderIntentHash: "b".repeat(64),
    findingIds: [] as readonly string[],
    evidencePackVersion: "business-evidence.v5",
    contractVersion: "c",
    plannerVersion: "p",
    promptVersion: "pr",
    rubricVersion: "r",
    schemaVersion: "s",
    provider: "anthropic",
    model: "m",
  };

  it("changes when a finding is recorded", () => {
    expect(computeActionPlanInputHash({ ...base, findingIds: ["f1"] })).not.toBe(
      computeActionPlanInputHash(base),
    );
  });

  it("changes again when a second one is", () => {
    expect(computeActionPlanInputHash({ ...base, findingIds: ["f1", "f2"] })).not.toBe(
      computeActionPlanInputHash({ ...base, findingIds: ["f1"] }),
    );
  });

  it("does not change with the order they are read in", () => {
    // Ids, sorted: the same findings are the same planning problem however the
    // rows came back.
    expect(computeActionPlanInputHash({ ...base, findingIds: ["f2", "f1"] })).toBe(
      computeActionPlanInputHash({ ...base, findingIds: ["f1", "f2"] })
    );
  });
});
