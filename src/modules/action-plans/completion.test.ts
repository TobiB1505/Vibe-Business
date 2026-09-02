import { describe, expect, it } from "vitest";
import { fakePlanStep } from "@/modules/execution-contract/test-support";
import {
  completedStepsForExecutionRouting,
  completedStepsFromEvidence,
  type AgentStepCompletionEvidence,
  type FounderActionCompletionEvidence,
} from "./completion";

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

function founderActionEvidence(
  overrides: Partial<FounderActionCompletionEvidence> = {},
): FounderActionCompletionEvidence {
  return {
    attestationId: "attestation-1",
    attestedByUserId: "user-1",
    attestedAt: "2026-08-26T15:00:00.000Z",
    attestationVersion: "founder-action-attestation.v1",
    stepKey: "3-connect-stripe",
    stepOrder: 3,
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

  it("never lets Agent evidence complete founder or external work", () => {
    const founder = fakePlanStep({
      id: "2-build",
      order: 2,
      actor: "founder_action",
      executionSupport: "founder_acts",
      capability: null,
    });
    const external = fakePlanStep({
      id: "2-build",
      order: 2,
      actor: "external_party",
      executionSupport: "external_dependency",
      capability: null,
    });

    for (const step of [founder, external]) {
      expect([...completedStepsFromEvidence([step], [], [agentEvidence()])]).toEqual([]);
    }
  });

  /**
   * The case this file used to file under "unsupported", asserting nothing
   * completes it.
   *
   * `fakePlanStep`'s defaults are `not_yet_supported` with no capability *on
   * purpose* — the module's own comment says they are "the wrong answer on
   * purpose, so a test that passes cannot be passing because the resolver read
   * them". That is exactly the shape of every step the coding agent builds, so
   * the assertion was pinning the defect rather than a rule: an agent step that
   * ran, verified and validated could never be completed, and its successor was
   * blocked forever.
   */
  it("completes an agent-built step, whatever the Planner guessed about it", () => {
    const step = fakePlanStep({ id: "2-build", order: 2 });

    // The Planner's own fields, unchanged and still wrong — and no longer read.
    expect(step.executionSupport).toBe("not_yet_supported");
    expect(step.capability).toBeNull();

    expect([...completedStepsFromEvidence([step], [], [agentEvidence()])]).toEqual([2]);
  });

  it("still completes a deterministic capability step from the same evidence", () => {
    // No regression for the route that always worked: one authority, both
    // producers, and the difference between them stops mattering here.
    const step = fakePlanStep({
      id: "2-build",
      order: 2,
      executionSupport: "vibe_executes_now",
      capability: "nextjs_seo_foundations_v2",
    });

    expect([...completedStepsFromEvidence([step], [], [agentEvidence()])]).toEqual([2]);
  });

  it("completes a founder_action only from an attestation bound to its key and order", () => {
    const step = fakePlanStep({
      id: "3-connect-stripe",
      order: 3,
      actor: "founder_action",
      changeKind: "external_setup",
      executionSupport: "founder_acts",
      capability: null,
    });

    expect(
      [...completedStepsFromEvidence([step], [], [], [founderActionEvidence()])],
    ).toEqual([3]);
    expect(
      [
        ...completedStepsFromEvidence(
          [step],
          [],
          [],
          [founderActionEvidence({ stepKey: "3-other" })],
        ),
      ],
    ).toEqual([]);
    expect(
      [
        ...completedStepsFromEvidence(
          [step],
          [],
          [],
          [founderActionEvidence({ stepOrder: 2 })],
        ),
      ],
    ).toEqual([]);
  });

  it("never lets a founder attestation complete Agent or external-party work", () => {
    const agent = fakePlanStep({
      id: "3-connect-stripe",
      order: 3,
      executionSupport: "vibe_executes_now",
      capability: "nextjs_seo_foundations_v2",
    });
    const external = fakePlanStep({
      id: "3-connect-stripe",
      order: 3,
      actor: "external_party",
      executionSupport: "external_dependency",
      capability: null,
    });

    for (const step of [agent, external]) {
      expect(
        [...completedStepsFromEvidence([step], [], [], [founderActionEvidence()])],
      ).toEqual([]);
    }
  });
});

/**
 * "Done" and "the next one can start" are different questions.
 *
 * They were the same question for as long as nothing answered either, and that
 * is how a validated, merged step came to read as an unfinished prerequisite:
 * the router asked only for founder resolutions, so the successor of every
 * agent step was permanently blocked and the screen said an earlier step had to
 * finish first. These tests pin the two answers apart.
 */
describe("what a successor may be routed on top of", () => {
  const agentStep = fakePlanStep({
    id: "2-build",
    order: 2,
    executionSupport: "vibe_executes_now",
    capability: "nextjs_seo_foundations_v2",
  });

  it("counts an agent step whose change reached the default branch", () => {
    expect([
      ...completedStepsForExecutionRouting(
        [agentStep],
        [],
        [agentEvidence()],
        new Set(["change-1"]),
      ),
    ]).toEqual([2]);
  });

  /*
   * The whole reason this projection exists. A run is prepared against the
   * default branch, so starting the successor while the predecessor sits on an
   * unmerged branch hands the agent a tree without the work it must build on.
   */
  it("does not count one that is validated but not merged", () => {
    expect([
      ...completedStepsForExecutionRouting([agentStep], [], [agentEvidence()], new Set()),
    ]).toEqual([]);
  });

  it("still counts it as done for the plan, which asks the wider question", () => {
    // Same evidence, same step, different question — and the plan is right to
    // say the founder finished it while it waits for review (ADR 0054).
    expect([...completedStepsFromEvidence([agentStep], [], [agentEvidence()])]).toEqual([2]);
  });

  it("is unaffected for work that produces no commit", () => {
    // A founder attestation has no branch to be merged from, so the narrower
    // question has the same answer as the wider one.
    const founderActionStep = fakePlanStep({
      id: "3-connect-stripe",
      order: 3,
      actor: "founder_action",
      executionSupport: "founder_acts",
      capability: null,
    });

    expect([
      ...completedStepsForExecutionRouting(
        [founderActionStep],
        [],
        [],
        new Set(),
        [founderActionEvidence()],
      ),
    ]).toEqual([3]);
  });

  it("matches on the prepared change, not on the step", () => {
    // Two agent steps, one merged. Counting by step would complete both.
    const second = fakePlanStep({
      id: "3-link",
      order: 3,
      executionSupport: "vibe_executes_now",
      capability: "nextjs_seo_foundations_v2",
    });

    expect([
      ...completedStepsForExecutionRouting(
        [agentStep, second],
        [],
        [
          agentEvidence(),
          agentEvidence({ stepKey: "3-link", stepOrder: 3, preparedChangeId: "change-2" }),
        ],
        new Set(["change-1"]),
      ),
    ]).toEqual([2]);
  });
});
