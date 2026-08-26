import { describe, expect, it } from "vitest";
import { FakeDatabase, fakeSupabase } from "@/modules/operations/test-support";
import { listAgentStepCompletionEvidence } from "./completion-store";

const PROJECT_ID = "project-1";
const PLAN_ID = "plan-1";

function seedCompletionChain(
  db: FakeDatabase,
  overrides: {
    executionOrigin?: "planner" | "dogfood_fixture";
    runStatus?: string;
    eventType?: string | null;
    validationStatus?: string;
    changedFilesVerified?: boolean;
  } = {},
): void {
  db.seed("execution_specs", {
    id: "spec-1",
    project_id: PROJECT_ID,
    action_plan_id: PLAN_ID,
    step_key: "1-build",
    step_order: 1,
  });
  db.seed("agent_execution_runs", {
    id: "run-1",
    project_id: PROJECT_ID,
    execution_spec_id: "spec-1",
    execution_origin: overrides.executionOrigin ?? "planner",
    status: overrides.runStatus ?? "succeeded",
    prepared_change_id: "change-1",
  });
  if (overrides.eventType !== null) {
    db.seed("agent_execution_events", {
      id: "event-1",
      project_id: PROJECT_ID,
      agent_execution_run_id: "run-1",
      type: overrides.eventType ?? "change_verified",
    });
  }
  db.seed("validation_runs", {
    id: "validation-1",
    project_id: PROJECT_ID,
    prepared_change_id: "change-1",
    status: overrides.validationStatus ?? "passed",
    source_integrity: {
      changedFilesVerified: overrides.changedFilesVerified ?? true,
    },
  });
}

describe("Agent Action Plan completion evidence store", () => {
  it("returns the complete canonical evidence chain", async () => {
    const db = new FakeDatabase();
    seedCompletionChain(db);

    await expect(
      listAgentStepCompletionEvidence(fakeSupabase(db), {
        projectId: PROJECT_ID,
        actionPlanId: PLAN_ID,
      }),
    ).resolves.toEqual([
      {
        executionSpecId: "spec-1",
        agentExecutionRunId: "run-1",
        preparedChangeId: "change-1",
        validationRunId: "validation-1",
        stepKey: "1-build",
        stepOrder: 1,
      },
    ]);
  });

  it.each([
    ["missing Vibe verification", { eventType: null }],
    ["failed execution", { runStatus: "failed" }],
    ["failed independent validation", { validationStatus: "failed" }],
    ["unverified changed files", { changedFilesVerified: false }],
    ["dogfood fixture", { executionOrigin: "dogfood_fixture" as const }],
  ])("fails closed for %s", async (_label, overrides) => {
    const db = new FakeDatabase();
    seedCompletionChain(db, overrides);

    await expect(
      listAgentStepCompletionEvidence(fakeSupabase(db), {
        projectId: PROJECT_ID,
        actionPlanId: PLAN_ID,
      }),
    ).resolves.toEqual([]);
  });

  it("never reads evidence from another plan", async () => {
    const db = new FakeDatabase();
    seedCompletionChain(db);

    await expect(
      listAgentStepCompletionEvidence(fakeSupabase(db), {
        projectId: PROJECT_ID,
        actionPlanId: "plan-2",
      }),
    ).resolves.toEqual([]);
  });
});
