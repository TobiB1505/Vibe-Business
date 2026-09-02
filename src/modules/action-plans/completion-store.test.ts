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

/**
 * A run that delivered a chain (`build-chain-v1`).
 *
 * The claim being tested is exactly the one the sprint record has to be able to
 * make: one artifact, one validation, several steps. Not several validations,
 * and not a weaker requirement per step.
 */
describe("a run that delivered more than one step", () => {
  function seedChain(overrides: Parameters<typeof seedCompletionChain>[1] = {}) {
    const db = new FakeDatabase();
    seedCompletionChain(db, overrides);
    // The spec seeded above is the head; the chain names it and its successor.
    const spec = db.rows("execution_specs")[0];
    spec.chain_step_keys = ["1-build", "2-link"];
    spec.chain_step_orders = [1, 2];
    return db;
  }

  it("completes every member from the one execution", async () => {
    const evidence = await listAgentStepCompletionEvidence(fakeSupabase(seedChain()), {
      projectId: PROJECT_ID,
      actionPlanId: PLAN_ID,
    });

    expect(evidence.map((item) => [item.stepKey, item.stepOrder])).toEqual([
      ["1-build", 1],
      ["2-link", 2],
    ]);
  });

  it("gives every member the same four ids, because there is one of each", async () => {
    const evidence = await listAgentStepCompletionEvidence(fakeSupabase(seedChain()), {
      projectId: PROJECT_ID,
      actionPlanId: PLAN_ID,
    });

    const [first, second] = evidence;
    expect(second.executionSpecId).toBe(first.executionSpecId);
    expect(second.agentExecutionRunId).toBe(first.agentExecutionRunId);
    expect(second.preparedChangeId).toBe(first.preparedChangeId);
    expect(second.validationRunId).toBe(first.validationRunId);
  });

  /*
   * The four-record rule is per *run*, and a chain must not turn one weak
   * verdict into several. If validation did not verify the changed files, the
   * chain completes nothing — not its head, not its members.
   */
  it.each([
    ["missing Vibe verification", { eventType: null }],
    ["failed independent validation", { validationStatus: "failed" }],
    ["unverified changed files", { changedFilesVerified: false }],
  ])("completes no member at all when the run fails closed for %s", async (_label, overrides) => {
    await expect(
      listAgentStepCompletionEvidence(fakeSupabase(seedChain(overrides)), {
        projectId: PROJECT_ID,
        actionPlanId: PLAN_ID,
      }),
    ).resolves.toEqual([]);
  });
});
