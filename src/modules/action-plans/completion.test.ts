import { describe, expect, it } from "vitest";
import { fakePlanStep } from "@/modules/execution-contract/test-support";
import { firstActionableStep } from "./sequence";
import {
  completedStepsForExecutionRouting,
  completedStepsFromEvidence,
  isFounderAttestable,
  satisfiedStepsFromEvidence,
  absorptionByStepOrder,
  type AbsorbedStepSatisfaction,
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

function absorbedEvidence(
  overrides: Partial<AbsorbedStepSatisfaction> = {},
): AbsorbedStepSatisfaction {
  return {
    executionSpecId: "spec-1",
    agentExecutionRunId: "run-1",
    preparedChangeId: "change-1",
    validationRunId: "validation-1",
    stepKey: "1-analyse-the-market",
    stepOrder: 1,
    absorbedByStepKey: "2-build",
    absorbedByStepOrder: 2,
    ...overrides,
  };
}

/**
 * Absorbed is not completed, and the difference has to survive both ways.
 *
 * A step a successful run performed inside its own boundary needs nobody to do
 * it again — offering it as the plan's entry point would be asking a founder to
 * redo work the agent already did. But it was never carried out as a piece of
 * work in its own right, and recording it as completed would throw away the
 * answer to a question a founder can reasonably ask later: was this analysis
 * done on its own, or did it come free with a build?
 *
 * So there are two sets, and these tests pin down that neither leaks into the
 * other.
 */
describe("a step covered by the run that absorbed it", () => {
  const analysis = fakePlanStep({
    id: "1-analyse-the-market",
    order: 1,
    changeKind: "analysis",
    executionSupport: "vibe_prepares",
  });
  const build = fakePlanStep({ id: "2-build", order: 2, dependsOn: [1] });

  it("stays open while the absorbing step is only planned", () => {
    // No evidence exists yet, which is the whole of "planned": the store emits
    // an absorption record only once a run has succeeded, verified and passed
    // validation. Nothing to filter, because nothing was written.
    expect([...satisfiedStepsFromEvidence(new Set(), [])]).toEqual([]);
  });

  it("stays open while the absorbing step is unfinished", () => {
    // The record exists — a run wrote it — but step 2 is not complete, so the
    // work it was supposed to establish has not been established.
    expect([...satisfiedStepsFromEvidence(new Set(), [absorbedEvidence()])]).toEqual([]);
  });

  it("is skipped once the absorbing step is complete", () => {
    const satisfied = satisfiedStepsFromEvidence(new Set([2]), [absorbedEvidence()]);

    expect([...satisfied].sort()).toEqual([1, 2]);
    expect(firstActionableStep([analysis, build], satisfied)).toBeNull();
  });

  it("is never recorded as completed", () => {
    // The audit trail is the point. `completedStepsFromEvidence` is asked the
    // same question with the same evidence and answers only for what ran.
    const completed = completedStepsFromEvidence(
      [analysis, build],
      [],
      [agentEvidence({ stepKey: build.id, stepOrder: build.order })],
      [],
    );

    expect([...completed]).toEqual([2]);
    expect([...satisfiedStepsFromEvidence(completed, [absorbedEvidence()])].sort()).toEqual([1, 2]);
  });

  it("names what covered it, so a screen never has to say 'done'", () => {
    expect([...absorptionByStepOrder(new Set([2]), [absorbedEvidence()])]).toEqual([[1, 2]]);
  });

  it("names nothing for a step that was genuinely executed as well", () => {
    // Absorbed and later run on its own is not a contradiction, and the honest
    // reading is the stronger one: it was executed.
    expect([...absorptionByStepOrder(new Set([1, 2]), [absorbedEvidence()])]).toEqual([]);
  });

  it("blocks the plan again if the absorbing step is not complete", () => {
    // The failure case, stated as sequencing rather than as a set: step 2
    // depends on step 1, so an unsatisfied step 1 leaves step 1 itself as the
    // entry point — exactly where the founder was before any run happened.
    const satisfied = satisfiedStepsFromEvidence(new Set(), [absorbedEvidence()]);

    expect(firstActionableStep([analysis, build], satisfied)?.order).toBe(1);
  });
});

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
 * Which steps a founder may close, and the one this must never grow into.
 *
 * The widening exists because a founder's real plan deadlocked on its own
 * first step: `vibe` + `research`, which `resolveStepExecution` refuses, no
 * run produces, no founder resolution covers and no attestation reached. It
 * could be completed by nothing, so `firstActionableStep` returned it forever
 * and the four steps behind it were unreachable.
 *
 * The dangerous direction is the other one, so it gets the most tests: if this
 * ever admitted a `product_change`, a founder could confirm away the work Vibe
 * exists to build.
 */
describe("which steps a founder may confirm", () => {
  it("admits real-world work, as it always did", () => {
    const step = fakePlanStep({
      actor: "founder_action",
      changeKind: "external_setup",
      executionSupport: "founder_acts",
    });

    expect(isFounderAttestable(step)).toBe(true);
  });

  it("admits Vibe's own work that no run could produce", () => {
    for (const changeKind of ["research", "decision", "analysis", "measurement"] as const) {
      expect(isFounderAttestable(fakePlanStep({ actor: "vibe", changeKind }))).toBe(true);
    }
  });

  it("never admits a product change, whatever the Planner stored about it", () => {
    /*
     * The reason the predicate reads `changeKind` and not `executionSupport`.
     *
     * `not_yet_supported` is what every agentic step carries too — the registry
     * has one entry, so it misses nearly all of them. Keying on the stored
     * support value would have handed the founder a button that closes the
     * work Vibe was about to do.
     */
    for (const executionSupport of [
      "not_yet_supported",
      "vibe_executes_now",
      "vibe_prepares",
    ] as const) {
      const step = fakePlanStep({ actor: "vibe", changeKind: "product_change", executionSupport });
      expect(isFounderAttestable(step)).toBe(false);
    }
  });

  it("never admits work that belongs to somebody else", () => {
    for (const actor of ["founder_decision", "founder_input", "external_party"] as const) {
      expect(isFounderAttestable(fakePlanStep({ actor, changeKind: "decision" }))).toBe(false);
    }
  });

  it("never admits a founder_action the Planner did not classify as one", () => {
    const step = fakePlanStep({
      actor: "founder_action",
      changeKind: "external_setup",
      executionSupport: "not_yet_supported",
    });

    expect(isFounderAttestable(step)).toBe(false);
  });

  it("completes the Vibe step no execution could reach", () => {
    const step = fakePlanStep({
      id: "1-research-establish-what-the-billing-route-does",
      order: 1,
      actor: "vibe",
      changeKind: "research",
      executionSupport: "not_yet_supported",
    });

    expect([...completedStepsFromEvidence([step], [], [], [])]).toEqual([]);
    expect([
      ...completedStepsFromEvidence(
        [step],
        [],
        [],
        [founderActionEvidence({ stepKey: step.id, stepOrder: step.order })],
      ),
    ]).toEqual([1]);
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
