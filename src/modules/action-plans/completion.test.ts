import { describe, expect, it } from "vitest";
import { fakePlanStep } from "@/modules/execution-contract/test-support";
import { completedStepsFromEvidence, type AgentStepCompletionEvidence } from "./completion";

function agentEvidence(overrides: Partial<AgentStepCompletionEvidence> = {}): AgentStepCompletionEvidence {
  return {
    executionSpecId: "spec-1",
    agentExecutionRunId: "run-1",
    preparedChangeId: "change-1",
    validationRunId: "validation-1",
    stepKey: "2-build",
    stepOrder: 2,
    ...overrides,
  };
}

describe("Action Plan completion authorities", () => {
  it("combines founder resolution and verified Agent evidence", () => {
    const founderStep = fakePlanStep({
      id: "1-model",
      order: 1,
      actor: "founder_decision",
      changeKind: "decision",
      executionSupport: "founder_decides",
      capability: null,
      founderInputRequirement: {
        kind: "decision",
        subjectKey: "revenue.model",
        question: "Which model should the business use?",
        whyNeeded: "The implementation needs one confirmed model.",
        responseType: "text",
        recommendation: null,
        alternatives: [],
        allowCustom: true,
      },
    });
    const agentStep = fakePlanStep({
      id: "2-build",
      order: 2,
      dependsOn: [1],
      executionSupport: "vibe_executes_now",
      capability: "nextjs_seo_foundations_v2",
    });

    const completed = completedStepsFromEvidence(
      [founderStep, agentStep],
      [
        {
          id: "resolution-1",
          kind: "decision",
          subjectKey: "revenue.model",
          resolvedStatement: "Use subscriptions.",
          supersededAt: null,
        },
      ],
      [agentEvidence()],
    );

    expect([...completed]).toEqual([1, 2]);
  });

  it("requires the evidence to match both the immutable step key and order", () => {
    const step = fakePlanStep({
      id: "2-build",
      order: 2,
      executionSupport: "vibe_executes_now",
      capability: "nextjs_seo_foundations_v2",
    });

    expect([...completedStepsFromEvidence([step], [], [agentEvidence({ stepOrder: 1 })])]).toEqual(
      [],
    );
    expect(
      [...completedStepsFromEvidence([step], [], [agentEvidence({ stepKey: "2-other" })])],
    ).toEqual([]);
  });

  it("never lets Agent evidence complete founder, unsupported, or external work", () => {
    const founder = fakePlanStep({
      id: "2-build",
      order: 2,
      actor: "founder_action",
      executionSupport: "founder_acts",
      capability: null,
    });
    const unsupported = fakePlanStep({ id: "2-build", order: 2 });
    const external = fakePlanStep({
      id: "2-build",
      order: 2,
      actor: "external_party",
      executionSupport: "external_dependency",
      capability: null,
    });

    for (const step of [founder, unsupported, external]) {
      expect([...completedStepsFromEvidence([step], [], [agentEvidence()])]).toEqual([]);
    }
  });
});
