import { describe, expect, it } from "vitest";
import { FakeDatabase, fakeSupabase } from "@/modules/operations/test-support";
import { resolveExecutionBudget } from "./budget";
import { resolveStepExecution } from "./resolver";
import { createExecutionSpec } from "./service";
import { buildExecutionSpec } from "./spec";
import { findExecutionSpecByIdentity, listExecutionSpecsForPlan } from "./store";
import { resolveExecutionValidation } from "./validation-requirements";
import {
  FIXTURE_OTHER_SHA,
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
 * Spec persistence (EXECUTION CORE-3 §10, §35, §47, §55).
 */

const BUDGET = resolveExecutionBudget(new Date("2026-08-18T00:00:00.000Z"), [fakeBudgetPolicy()])!;

function specFor(baseSha?: string) {
  const step = fakePlanStep();
  const resolution = resolveStepExecution(
    fakeResolveInput({ step, plan: fakePlanContext([step]) }),
  );

  return buildExecutionSpec({
    resolution,
    step,
    plan: { ...FIXTURE_PLAN, assumptions: [...FIXTURE_PLAN.assumptions] },
    projectId: "project-1",
    repository: fakeRepositoryBinding(baseSha ? { baseSha } : {}),
    approvedDecisions: [],
    validation: resolveExecutionValidation(fakeSnapshot()),
    budget: BUDGET,
    credit: { quoteId: "quote-1", maxAuthorizedCredits: BUDGET.maxCredits },
    writeScope: fakeWriteScope(),
    createdAt: "2026-08-18T12:00:00.000Z",
  });
}

function harness() {
  const db = new FakeDatabase();
  return { db, supabase: fakeSupabase(db) };
}

describe("createExecutionSpec (§35)", () => {
  it("stores the document and the columns read off it", async () => {
    const { db, supabase } = harness();
    const spec = specFor();

    const result = await createExecutionSpec(supabase, {
      resolution: resolveStepExecution(
        fakeResolveInput({ step: fakePlanStep(), plan: fakePlanContext([fakePlanStep()]) }),
      ),
      step: fakePlanStep(),
      plan: { ...FIXTURE_PLAN, assumptions: [...FIXTURE_PLAN.assumptions] },
      projectId: "project-1",
      repository: fakeRepositoryBinding(),
      approvedDecisions: [],
      validation: resolveExecutionValidation(fakeSnapshot()),
      budget: BUDGET,
      credit: { quoteId: "quote-1", maxAuthorizedCredits: BUDGET.maxCredits },
      writeScope: fakeWriteScope(),
      createdAt: "2026-08-18T12:00:00.000Z",
      userId: "user-1",
      repositoryConnectionId: "conn-1",
      creditQuoteId: "quote-1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.stored.specIdentity).toBe(spec.identity);
    expect(result.stored.mode).toBe("agentic");
    expect(result.stored.baseSha).toBe(spec.repository.baseSha);
    expect(result.stored.maxAuthorizedCredits).toBe(BUDGET.maxCredits);

    // The row's indexed columns are copied off the validated document, so they
    // cannot disagree with it (§54).
    const row = db.rows("execution_specs")[0];
    expect(row.mode).toBe("agentic");
    expect(row.base_sha).toBe(spec.repository.baseSha);
    expect(row.spec_identity).toBe(spec.identity);
  });

  it("records exactly one audit event, carrying identifiers and no objective text", async () => {
    const { db, supabase } = harness();
    const step = fakePlanStep();

    await createExecutionSpec(supabase, {
      resolution: resolveStepExecution(fakeResolveInput({ step, plan: fakePlanContext([step]) })),
      step,
      plan: { ...FIXTURE_PLAN, assumptions: [...FIXTURE_PLAN.assumptions] },
      projectId: "project-1",
      repository: fakeRepositoryBinding(),
      approvedDecisions: [],
      validation: resolveExecutionValidation(fakeSnapshot()),
      budget: BUDGET,
      credit: { quoteId: null, maxAuthorizedCredits: BUDGET.maxCredits },
      writeScope: fakeWriteScope(),
      createdAt: "2026-08-18T12:00:00.000Z",
      userId: "user-1",
      repositoryConnectionId: "conn-1",
    });

    const events = db.rows("audit_events");
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe("execution.spec_created");

    const serialized = JSON.stringify(events[0].metadata);
    expect(serialized).not.toContain(FIXTURE_PLAN.goal);
    expect(serialized).not.toContain("Ship the thing");
  });

  it("returns the existing spec instead of writing a second one for the same world", async () => {
    const { db, supabase } = harness();
    const step = fakePlanStep();
    const params = {
      resolution: resolveStepExecution(fakeResolveInput({ step, plan: fakePlanContext([step]) })),
      step,
      plan: { ...FIXTURE_PLAN, assumptions: [...FIXTURE_PLAN.assumptions] },
      projectId: "project-1",
      repository: fakeRepositoryBinding(),
      approvedDecisions: [],
      validation: resolveExecutionValidation(fakeSnapshot()),
      budget: BUDGET,
      credit: { quoteId: null, maxAuthorizedCredits: BUDGET.maxCredits },
      writeScope: fakeWriteScope(),
      createdAt: "2026-08-18T12:00:00.000Z",
      userId: "user-1",
      repositoryConnectionId: "conn-1",
    };

    const first = await createExecutionSpec(supabase, params);
    const second = await createExecutionSpec(supabase, params);

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(second.alreadyExisted).toBe(true);
    expect(second.stored.id).toBe(first.stored.id);
    expect(db.rows("execution_specs")).toHaveLength(1);
    // And exactly one audit event, not two.
    expect(db.rows("audit_events")).toHaveLength(1);
  });

  it("writes a second, distinct spec when the repository has moved (§10, §47)", async () => {
    const { db, supabase } = harness();
    const step = fakePlanStep();
    const base = {
      resolution: resolveStepExecution(fakeResolveInput({ step, plan: fakePlanContext([step]) })),
      step,
      plan: { ...FIXTURE_PLAN, assumptions: [...FIXTURE_PLAN.assumptions] },
      projectId: "project-1",
      approvedDecisions: [],
      validation: resolveExecutionValidation(fakeSnapshot()),
      budget: BUDGET,
      credit: { quoteId: null, maxAuthorizedCredits: BUDGET.maxCredits },
      writeScope: fakeWriteScope(),
      createdAt: "2026-08-18T12:00:00.000Z",
      userId: "user-1",
      repositoryConnectionId: "conn-1",
    };

    await createExecutionSpec(supabase, { ...base, repository: fakeRepositoryBinding() });
    await createExecutionSpec(supabase, {
      ...base,
      repository: fakeRepositoryBinding({ baseSha: FIXTURE_OTHER_SHA }),
    });

    const rows = db.rows("execution_specs");
    expect(rows).toHaveLength(2);
    // The historical spec still describes the commit it was built for. Nothing
    // rewrote it, because nothing can.
    expect(rows.map((row) => row.base_sha)).toEqual([
      specFor().repository.baseSha,
      FIXTURE_OTHER_SHA,
    ]);
  });
});

describe("reads are scoped to their project", () => {
  it("does not return another project's spec for the same identity", async () => {
    const { db, supabase } = harness();
    const spec = specFor();

    db.seed("execution_specs", {
      project_id: "someone-else",
      action_plan_id: "plan-1",
      spec_identity: spec.identity,
      mode: "agentic",
      execution_class: "application_code_change",
      capability: null,
    });

    const found = await findExecutionSpecByIdentity(supabase, {
      projectId: "project-1",
      specIdentity: spec.identity,
    });

    expect(found).toBeNull();
  });

  it("lists a plan's specs newest first", async () => {
    const { db, supabase } = harness();

    db.seed("execution_specs", {
      project_id: "project-1",
      action_plan_id: "plan-1",
      spec_identity: "a".repeat(64),
      mode: "agentic",
      execution_class: "application_code_change",
      capability: null,
      created_at: "2026-08-18T10:00:00.000Z",
    });
    db.seed("execution_specs", {
      project_id: "project-1",
      action_plan_id: "plan-1",
      spec_identity: "b".repeat(64),
      mode: "agentic",
      execution_class: "application_code_change",
      capability: null,
      created_at: "2026-08-18T12:00:00.000Z",
    });

    const specs = await listExecutionSpecsForPlan(supabase, {
      projectId: "project-1",
      actionPlanId: "plan-1",
    });

    expect(specs.map((entry) => entry.specIdentity)).toEqual(["b".repeat(64), "a".repeat(64)]);
  });
});
