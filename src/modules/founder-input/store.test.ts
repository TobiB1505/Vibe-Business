import { describe, expect, it } from "vitest";
import { FakeDatabase, fakeSupabase } from "@/modules/operations/test-support";
import { fakePlanStep } from "@/modules/execution-contract/test-support";
import { raiseExecutionInterrupt } from "@/modules/coding-agent/store";
import { createPlannerFounderInputRequests } from "./store";

const requirement = {
  kind: "decision" as const,
  subjectKey: "monetization.pricing_model",
  question: "Which pricing model should the product use?",
  whyNeeded: "The implementation needs one confirmed model.",
  responseType: "single_select" as const,
  recommendation: {
    id: "subscription",
    label: "Subscription",
    value: "Use a monthly subscription model.",
    explanation: null,
  },
  alternatives: [],
  allowCustom: true,
};

const step = fakePlanStep({
  id: "choose-pricing-model",
  actor: "founder_decision",
  changeKind: "decision",
  founderInputRequirement: requirement,
});

describe("createPlannerFounderInputRequests", () => {
  it("does not ask again when an active project decision already exists", async () => {
    const db = new FakeDatabase();
    db.seed("project_founder_resolutions", {
      id: "resolution-1",
      project_id: "project-1",
      request_id: "request-old",
      input_kind: requirement.kind,
      subject_key: requirement.subjectKey,
      response_source: "recommendation",
      selected_option_id: "subscription",
      raw_answer: null,
      resolved_statement: "Use a monthly subscription model.",
      context_hash: "a".repeat(64),
      supersedes_resolution_id: null,
      superseded_at: null,
      created_at: "2026-08-25T00:00:00.000Z",
    });

    await createPlannerFounderInputRequests(fakeSupabase(db), {
      projectId: "project-1",
      planId: "plan-1",
      contextHash: "b".repeat(64),
      steps: [step],
    });

    expect(db.rows("project_founder_input_requests")).toEqual([]);
  });

  it("converges repeated generation on one canonical open request", async () => {
    const db = new FakeDatabase();
    const supabase = fakeSupabase(db);
    const params = {
      projectId: "project-1",
      planId: "plan-1",
      contextHash: "b".repeat(64),
      steps: [step],
    };

    await createPlannerFounderInputRequests(supabase, params);
    await createPlannerFounderInputRequests(supabase, params);

    expect(db.rows("project_founder_input_requests")).toHaveLength(1);
    expect(db.rows("project_founder_input_requests")[0]).toMatchObject({
      action_plan_step_key: "choose-pricing-model",
      subject_key: "monetization.pricing_model",
      status: "open",
    });
  });
});

describe("runtime founder-input request materialization", () => {
  it("converges two blocked attempts on one canonical open request", async () => {
    const db = new FakeDatabase();
    const supabase = fakeSupabase(db);
    for (const suffix of ["a", "b"]) {
      db.seed("execution_specs", {
        id: `spec-${suffix}`,
        project_id: "project-1",
        spec_identity: `${suffix}`.repeat(64),
      });
      db.seed("agent_execution_runs", {
        id: `run-${suffix}`,
        project_id: "project-1",
        user_id: "user-1",
        execution_spec_id: `spec-${suffix}`,
        status: "running",
      });
    }

    const interrupt = {
      type: "business_decision_required" as const,
      question: requirement.question,
      responseSchema: {
        kind: "single_choice" as const,
        options: [{ id: "subscription", label: "Subscription" }],
      },
      whyBlocked: "business_decision_required" as const,
      founderInputRequirement: requirement,
    };

    await raiseExecutionInterrupt(supabase, {
      projectId: "project-1",
      userId: "user-1",
      executionSpecId: "spec-a",
      agentExecutionRunId: "run-a",
      interrupt,
    });
    await raiseExecutionInterrupt(supabase, {
      projectId: "project-1",
      userId: "user-1",
      executionSpecId: "spec-b",
      agentExecutionRunId: "run-b",
      interrupt,
    });

    expect(db.rows("project_founder_input_requests")).toHaveLength(1);
    expect(db.rows("execution_interrupts")).toHaveLength(2);
    expect(new Set(db.rows("execution_interrupts").map((row) => row.founder_input_request_id)).size).toBe(
      1,
    );
  });
});
