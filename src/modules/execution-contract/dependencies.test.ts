import { describe, expect, it } from "vitest";
import type { ActionPlanStep } from "@/modules/action-plans/schema";
import { classifyExecutionDependency, resolveExecutionDependencies } from "./dependencies";
import { isToolAllowed } from "./policy";
import { resolvePlanExecution, resolveStepExecution } from "./resolver";
import { isAgentReady } from "./schema";
import { buildExecutionSpec } from "./spec";
import {
  FIXTURE_PLAN,
  fakeBudget,
  fakePlanContext,
  fakePlanStep,
  fakeRepositoryBinding,
  fakeRepositoryContext,
  fakeResolveInput,
  fakeSnapshot,
  fakeWriteScope,
} from "./test-support";
import { resolveExecutionValidation } from "./validation-requirements";

/**
 * Execution dependency semantics (EXECUTION CORE-4 SEMANTICS FIX §27–§36).
 *
 * ## What broke, and what these protect
 *
 * The resolver treated every unfinished Planner prerequisite as a hard block.
 * On the real SEO plan that meant three moderate-risk, fully validatable
 * changes were refused because Vibe had not first written down a metadata plan
 * — a piece of Vibe's own thinking that a coding agent performs anyway as its
 * first act.
 *
 * The fix is a distinction, not a relaxation, so the cases that must **stay**
 * blocked outnumber the one that opens. A founder decision, real-world work, an
 * external prerequisite, a product change and a dependency loop are all still
 * walls, and each has a test below saying so.
 */

/* ---------------------------------------------------------------------------
 * Fixtures
 * ------------------------------------------------------------------------ */

/** Vibe's own technical preparation: work out how this repository does X. */
function preparationStep(overrides: Partial<ActionPlanStep> = {}): ActionPlanStep {
  return fakePlanStep({
    id: "1-work-out-the-approach",
    order: 1,
    title: "Work out the repository-consistent approach",
    actor: "vibe",
    changeKind: "analysis",
    dependsOn: [],
    evidenceIds: ["live.seo.canonical_missing"],
    executionSupport: "vibe_prepares",
    ...overrides,
  });
}

/** An agentic-eligible implementation step. */
function implementationStep(overrides: Partial<ActionPlanStep> = {}): ActionPlanStep {
  return fakePlanStep({
    id: "2-implement-it",
    order: 2,
    title: "Implement it",
    actor: "vibe",
    changeKind: "product_change",
    dependsOn: [1],
    evidenceIds: ["live.seo.open_graph_missing"],
    ...overrides,
  });
}

function resolve(steps: ActionPlanStep[], target: number, completed = new Set<number>()) {
  const step = steps.find((candidate) => candidate.order === target);
  if (!step) throw new Error(`no step ${target}`);
  return resolveStepExecution(
    fakeResolveInput({ step, plan: fakePlanContext(steps, { completedSteps: completed }) }),
  );
}

/* ---------------------------------------------------------------------------
 * §27 — the case the dogfood found
 * ------------------------------------------------------------------------ */

describe("§27 — a Vibe-preparable dependency does not block", () => {
  const STEPS = [preparationStep(), implementationStep()];

  it("resolves the implementation step agentic while the preparation is unfinished", () => {
    const resolution = resolve(STEPS, 2);

    expect(resolution.mode).toBe("agentic");
    expect(resolution.reason).toBe("agentic_v1_eligible");
    expect(resolution.blockedBy).toEqual([]);
    expect(isAgentReady(resolution)).toBe(true);
  });

  it("records the preparation as absorbed rather than ignored", () => {
    expect(resolve(STEPS, 2).absorbedPreparation).toEqual([1]);
  });

  /**
   * The point of §4: Vibe must not ask the founder to tick off Vibe's own
   * preparatory work before Vibe will do the work that follows it.
   */
  it("needs no completion event first", () => {
    const withoutCompletion = resolve(STEPS, 2);
    const withCompletion = resolve(STEPS, 2, new Set([1]));

    expect(withoutCompletion.mode).toBe("agentic");
    expect(withCompletion.mode).toBe("agentic");
    // The only difference: a finished step is not preparation to perform.
    expect(withCompletion.absorbedPreparation).toEqual([]);
  });

  it("carries the preparation into the ExecutionSpec as bounded context (§12, §13)", () => {
    const resolution = resolve(STEPS, 2);
    const spec = buildExecutionSpec({
      resolution,
      step: STEPS[1],
      plan: { ...FIXTURE_PLAN, id: "plan-1" },
      projectId: "project-1",
      repository: fakeRepositoryBinding(),
      approvedDecisions: [],
      validation: resolveExecutionValidation(fakeSnapshot()),
      budget: null,
      credit: { quoteId: null, maxAuthorizedCredits: null },
      writeScope: fakeWriteScope(),
      preparationSteps: [STEPS[0]],
      createdAt: "2026-08-18T12:00:00.000Z",
    });

    expect(spec.objective.preparation).toEqual([
      {
        stepOrder: 1,
        stepKey: "1-work-out-the-approach",
        title: "Work out the repository-consistent approach",
        purpose: STEPS[0].purpose,
        doneWhen: STEPS[0].completionCriteria,
      },
    ]);
    // The delivery target is unchanged: preparation supports the step, it does
    // not replace or widen it (§20).
    expect(spec.objective.stepTitle).toBe("Implement it");
    expect(spec.stepOrder).toBe(2);
  });

  /**
   * A spec's identity is what makes reuse safe. Two runs that deliver the same
   * step while carrying different preparation are different boundaries.
   */
  it("gives a spec carrying preparation a different identity from one without", () => {
    const common = {
      step: STEPS[1],
      plan: { ...FIXTURE_PLAN, id: "plan-1" },
      projectId: "project-1",
      repository: fakeRepositoryBinding(),
      approvedDecisions: [],
      validation: resolveExecutionValidation(fakeSnapshot()),
      budget: null,
      credit: { quoteId: null, maxAuthorizedCredits: null },
      writeScope: fakeWriteScope(),
      createdAt: "2026-08-18T12:00:00.000Z",
    } as const;

    const withPreparation = buildExecutionSpec({
      ...common,
      resolution: resolve(STEPS, 2),
      preparationSteps: [STEPS[0]],
    });
    const withoutPreparation = buildExecutionSpec({
      ...common,
      resolution: resolve(STEPS, 2, new Set([1])),
    });

    expect(withPreparation.identity).not.toBe(withoutPreparation.identity);
  });

  it("refuses to build a spec whose preparation disagrees with the resolver", () => {
    expect(() =>
      buildExecutionSpec({
        resolution: resolve(STEPS, 2),
        step: STEPS[1],
        plan: { ...FIXTURE_PLAN, id: "plan-1" },
        projectId: "project-1",
        repository: fakeRepositoryBinding(),
        approvedDecisions: [],
        validation: resolveExecutionValidation(fakeSnapshot()),
        budget: null,
        credit: { quoteId: null, maxAuthorizedCredits: null },
        writeScope: fakeWriteScope(),
        // The resolver absorbed step 1; nothing is supplied.
        preparationSteps: [],
        createdAt: "2026-08-18T12:00:00.000Z",
      }),
    ).toThrow(/absorbed preparation steps \[1\]/);
  });
});

/* ---------------------------------------------------------------------------
 * §28, §29, §30 — what stays hard
 * ------------------------------------------------------------------------ */

describe("§28 — a founder decision is never absorbed", () => {
  const STEPS = [
    fakePlanStep({
      id: "1-decide",
      order: 1,
      title: "Decide how sign-in works",
      actor: "founder_decision",
      changeKind: "decision",
      dependsOn: [],
      evidenceIds: [],
      executionSupport: "founder_decides",
    }),
    implementationStep(),
  ];

  it("blocks the implementation step", () => {
    const resolution = resolve(STEPS, 2);

    expect(resolution.mode).toBe("blocked");
    expect(resolution.blockedBy).toEqual([1]);
    expect(resolution.reason).toBe("dependency_unsatisfied");
    expect(resolution.absorbedPreparation).toEqual([]);
  });

  it("leaves no ExecutionSpec that could be run", () => {
    expect(() =>
      buildExecutionSpec({
        resolution: resolve(STEPS, 2),
        step: STEPS[1],
        plan: { ...FIXTURE_PLAN, id: "plan-1" },
        projectId: "project-1",
        repository: fakeRepositoryBinding(),
        approvedDecisions: [],
        validation: resolveExecutionValidation(fakeSnapshot()),
        budget: null,
        credit: { quoteId: null, maxAuthorizedCredits: null },
        writeScope: fakeWriteScope(),
        createdAt: "2026-08-18T12:00:00.000Z",
      }),
    ).toThrow(/mode "blocked"/);
  });

  it("is hard however the plan words it", () => {
    expect(
      classifyExecutionDependency({
        step: STEPS[0],
        completed: new Set(),
        capabilityContext: { repository: fakeSnapshot() },
      }),
    ).toBe("hard");
  });
});

describe("§29 — a manual or external prerequisite is never absorbed", () => {
  it.each([
    ["founder_action", "external_setup"],
    ["founder_action", "measurement"],
    ["external_party", "external_setup"],
  ] as const)("keeps %s / %s hard", (actor, changeKind) => {
    const steps = [
      fakePlanStep({
        id: "1-set-up-the-account",
        order: 1,
        actor,
        changeKind,
        dependsOn: [],
        evidenceIds: [],
      }),
      implementationStep(),
    ];

    const resolution = resolve(steps, 2);
    expect(resolution.mode).toBe("blocked");
    expect(resolution.blockedBy).toEqual([1]);
  });
});

describe("§30 — one hard dependency is enough", () => {
  const STEPS = [
    preparationStep(),
    fakePlanStep({
      id: "2-decide",
      order: 2,
      actor: "founder_decision",
      changeKind: "decision",
      dependsOn: [],
      evidenceIds: [],
    }),
    implementationStep({ id: "3-implement-it", order: 3, dependsOn: [1, 2] }),
  ];

  it("blocks on the decision even though the preparation is absorbable", () => {
    const resolution = resolve(STEPS, 3);

    expect(resolution.mode).toBe("blocked");
    expect(resolution.blockedBy).toEqual([2]);
    // Absorption is all-or-nothing: nothing is carried into a run that is not
    // happening.
    expect(resolution.absorbedPreparation).toEqual([]);
  });

  it("still reports which dependency was preparation, for a report to explain", () => {
    const dependencies = resolveExecutionDependencies({
      step: STEPS[2],
      steps: STEPS,
      completed: new Set(),
      capabilityContext: { repository: fakeSnapshot() },
      absorbable: true,
    });

    expect(dependencies.classifications).toEqual([
      { order: 1, classification: "agent_preparable" },
      { order: 2, classification: "hard" },
    ]);
    expect(dependencies.hardBlockers).toEqual([2]);
  });
});

/* ---------------------------------------------------------------------------
 * §31, §32 — chains and loops
 * ------------------------------------------------------------------------ */

describe("§31 — transitive preparation", () => {
  const STEPS = [
    preparationStep({ id: "1-analyze", order: 1, dependsOn: [] }),
    preparationStep({ id: "2-prepare-the-approach", order: 2, dependsOn: [1] }),
    implementationStep({ id: "3-implement-it", order: 3, dependsOn: [2] }),
  ];

  it("absorbs the whole chain when every link is Vibe's own preparation", () => {
    const resolution = resolve(STEPS, 3);

    expect(resolution.mode).toBe("agentic");
    expect(resolution.absorbedPreparation).toEqual([1, 2]);
  });

  /**
   * The chain is only as absorbable as its weakest link. Performing B without
   * the decision A rests on would be executing on a premise nobody established.
   */
  it("refuses the chain when something hard sits behind the preparation", () => {
    const steps = [
      fakePlanStep({
        id: "1-decide",
        order: 1,
        actor: "founder_decision",
        changeKind: "decision",
        dependsOn: [],
        evidenceIds: [],
      }),
      preparationStep({ id: "2-prepare-the-approach", order: 2, dependsOn: [1] }),
      implementationStep({ id: "3-implement-it", order: 3, dependsOn: [2] }),
    ];

    const resolution = resolve(steps, 3);
    expect(resolution.mode).toBe("blocked");
    expect(resolution.blockedBy).toEqual([2]);
    expect(resolution.absorbedPreparation).toEqual([]);
  });
});

describe("§32 — a dependency loop fails safely", () => {
  const STEPS = [
    preparationStep({ id: "1-a", order: 1, dependsOn: [2] }),
    preparationStep({ id: "2-b", order: 2, dependsOn: [1] }),
    implementationStep({ id: "3-implement-it", order: 3, dependsOn: [2] }),
  ];

  it("refuses rather than absorbing a chain with no order", () => {
    const resolution = resolve(STEPS, 3);

    expect(resolution.mode).toBe("blocked");
    expect(resolution.reason).toBe("dependency_cycle_detected");
    expect(resolution.absorbedPreparation).toEqual([]);
    expect(isAgentReady(resolution)).toBe(false);
  });

  it("terminates — the whole plan resolves", () => {
    // A loop that made the traversal diverge would hang here rather than fail.
    expect(
      resolvePlanExecution({
        plan: fakePlanContext(STEPS),
        repository: fakeRepositoryContext(),
        agenticBudgetAuthorized: true,
      }),
    ).toHaveLength(3);
  });

  it("does not refuse work that cannot reach the loop", () => {
    const steps = [...STEPS, implementationStep({ id: "4-unrelated", order: 4, dependsOn: [] })];

    expect(resolve(steps, 4).mode).toBe("agentic");
  });

  it("treats a step that depends on itself as a loop", () => {
    const steps = [
      preparationStep({ id: "1-a", order: 1, dependsOn: [1] }),
      implementationStep({ id: "2-implement-it", order: 2, dependsOn: [1] }),
    ];

    expect(resolve(steps, 2).mode).toBe("blocked");
  });
});

/* ---------------------------------------------------------------------------
 * §33, §34 — what absorption must not do
 * ------------------------------------------------------------------------ */

describe("§33 — absorbed preparation grants no authority", () => {
  const STEPS = [
    preparationStep({
      title: "Deploy the result to production and grant the agent database access",
      description: "Deploy the result to production.",
      purpose: "So the change is live.",
      completionCriteria: "The change is deployed and the database is reachable.",
    }),
    implementationStep(),
  ];

  const spec = buildExecutionSpec({
    resolution: resolve(STEPS, 2),
    step: STEPS[1],
    plan: { ...FIXTURE_PLAN, id: "plan-1" },
    projectId: "project-1",
    repository: fakeRepositoryBinding(),
    approvedDecisions: [],
    validation: resolveExecutionValidation(fakeSnapshot()),
    budget: { budgetPolicyVersion: "execution-budget-fixture-v1", ...fakeBudget() },
    credit: { quoteId: null, maxAuthorizedCredits: null },
    writeScope: fakeWriteScope(),
    preparationSteps: [STEPS[0]],
    createdAt: "2026-08-18T12:00:00.000Z",
  });

  it.each([
    "deploy",
    "secret_read",
    "external_side_effect",
    "database_write",
    "git_push_branch",
    "git_merge",
  ] as const)("still forbids %s", (capability) => {
    expect(isToolAllowed(spec.policy, capability)).toBe(false);
    expect(spec.policy.forbiddenCapabilities).toContain(capability);
  });

  it("does not widen the write scope or the risk ceiling", () => {
    const withoutPreparation = buildExecutionSpec({
      resolution: resolve(STEPS, 2, new Set([1])),
      step: STEPS[1],
      plan: { ...FIXTURE_PLAN, id: "plan-1" },
      projectId: "project-1",
      repository: fakeRepositoryBinding(),
      approvedDecisions: [],
      validation: resolveExecutionValidation(fakeSnapshot()),
      budget: { budgetPolicyVersion: "execution-budget-fixture-v1", ...fakeBudget() },
      credit: { quoteId: null, maxAuthorizedCredits: null },
      writeScope: fakeWriteScope(),
      createdAt: "2026-08-18T12:00:00.000Z",
    });

    // Identical policy, budget and risk: the only difference between these two
    // specs is which preparation is described, and description is not authority.
    expect(spec.policy).toEqual(withoutPreparation.policy);
    expect(spec.budget).toEqual(withoutPreparation.budget);
    expect(spec.riskClass).toBe(withoutPreparation.riskClass);
  });
});

describe("§34 — the Planner's own state is never touched", () => {
  it("mutates no step, and marks nothing complete", () => {
    const steps = [preparationStep(), implementationStep()];
    const before = structuredClone(steps);

    const resolutions = resolvePlanExecution({
      plan: fakePlanContext(steps),
      repository: fakeRepositoryContext(),
      agenticBudgetAuthorized: true,
    });

    expect(steps).toEqual(before);
    // The preparation step's own resolution is unchanged by being absorbable:
    // it is still Vibe's work with no executor behind it.
    expect(resolutions[0].mode).toBe("unsupported");
    expect(resolutions[0].reason).toBe("no_executor_for_vibe_work");
  });
});

/* ---------------------------------------------------------------------------
 * §36 and the boundaries of the rule
 * ------------------------------------------------------------------------ */

describe("§36 — deterministic execution is unaffected", () => {
  /** The one registry capability: robots.txt + sitemap on a Next.js repository. */
  const SEO_STEP = fakePlanStep({
    id: "2-seo-foundations",
    order: 2,
    changeKind: "product_change",
    evidenceIds: ["live.seo.robots_txt_missing", "live.seo.sitemap_missing"],
    dependsOn: [1],
  });

  it("keeps a deterministic step blocked by its preparation", () => {
    const steps = [preparationStep(), SEO_STEP];
    const resolution = resolve(steps, 2);

    // A deterministic executor is a code generator reading structured facts. It
    // does not read a metadata plan, so claiming it absorbed one would be false.
    expect(resolution.intrinsicMode).toBe("deterministic");
    expect(resolution.mode).toBe("blocked");
    expect(resolution.absorbedPreparation).toEqual([]);
  });

  it("still prefers deterministic over agentic once nothing blocks it", () => {
    const steps = [preparationStep(), SEO_STEP];
    const resolution = resolve(steps, 2, new Set([1]));

    expect(resolution.mode).toBe("deterministic");
    expect(resolution.capability).toBe("nextjs_seo_foundations_v2");
  });
});

describe("what is not preparation", () => {
  it.each([
    ["measurement", "verification is not absorbed — a run must not judge itself"],
    ["research", "market and customer research has no answer in a repository"],
    ["decision", "a decision assigned to Vibe is still a decision"],
    ["product_change", "a change to the product must actually exist first"],
    ["external_setup", "external setup happens outside the product"],
  ] as const)("keeps a vibe / %s dependency hard (%s)", (changeKind, _why) => {
    const steps = [preparationStep({ changeKind, evidenceIds: [] }), implementationStep()];

    expect(resolve(steps, 2).mode).toBe("blocked");
  });

  /**
   * The rule reads structured fields, never prose. A step whose title sounds
   * preparatory but whose change kind says it alters the product is hard —
   * which is what stops a reworded plan from reclassifying itself.
   */
  it("does not read the step's wording", () => {
    const steps = [
      preparationStep({
        title: "Analyze and prepare the approach",
        description: "Just some analysis, nothing that changes anything.",
        changeKind: "product_change",
        evidenceIds: [],
      }),
      implementationStep(),
    ];

    expect(resolve(steps, 2).mode).toBe("blocked");
  });

  it("treats a prerequisite that is not in the plan as hard", () => {
    const steps = [implementationStep({ order: 2, dependsOn: [7] })];
    expect(resolve(steps, 2).mode).toBe("blocked");
  });
});
