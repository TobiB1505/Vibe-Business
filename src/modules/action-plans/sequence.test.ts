import { describe, expect, it } from "vitest";
import {
  findDependencyCycles,
  firstActionableStep,
  isUnblocked,
  planProgress,
  repairDependencies,
} from "./sequence";
import type { ActionPlanStep } from "./schema";

/**
 * Dependency reasoning (CORE-2b §21, §38, §39, §78, §79).
 *
 * The load-bearing test in this file is "does not offer a blocked downstream
 * step". Everything else supports it.
 */

function step(overrides: Partial<ActionPlanStep> & { order: number }): ActionPlanStep {
  return {
    id: `step-${overrides.order}`,
    title: `Step ${overrides.order}`,
    description: "…",
    purpose: "…",
    actor: "vibe",
    changeKind: "analysis",
    completionCriteria: "Something observable is true.",
    dependsOn: [],
    evidenceIds: [],
    executionSupport: "vibe_prepares",
    capability: null,
    requiresApproval: false,
    ...overrides,
    founderInputRequirement: overrides.founderInputRequirement ?? null,
  };
}

describe("firstActionableStep", () => {
  it("is the first step when nothing blocks it", () => {
    const steps = [step({ order: 1 }), step({ order: 2, dependsOn: [1] })];
    expect(firstActionableStep(steps)?.order).toBe(1);
  });

  /**
   * §38, §95 — "first move" is not "first array item".
   *
   * A completed first step means the genuine next move is step 2, and a product
   * that showed step 1 would be telling a founder to redo finished work.
   */
  it("skips completed steps", () => {
    const steps = [step({ order: 1 }), step({ order: 2, dependsOn: [1] })];
    expect(firstActionableStep(steps, new Set([1]))?.order).toBe(2);
  });

  /**
   * §78 — the test this file exists for.
   *
   * Step 3 is downstream of an unmade decision. It must never be offered, even
   * though it is the only step Vibe could technically act on.
   */
  it("never offers a blocked downstream step", () => {
    const steps = [
      step({ order: 1, actor: "vibe", executionSupport: "vibe_prepares" }),
      step({ order: 2, dependsOn: [1], actor: "founder_decision", executionSupport: "founder_decides" }),
      step({ order: 3, dependsOn: [2], changeKind: "product_change" }),
    ];

    // Nothing done yet: step 1.
    expect(firstActionableStep(steps)?.order).toBe(1);
    // Vibe has prepared; the decision is now genuinely next, not the rewrite.
    expect(firstActionableStep(steps, new Set([1]))?.order).toBe(2);
    expect(firstActionableStep(steps, new Set([1]))?.actor).toBe("founder_decision");
  });

  it("returns null when everything is finished", () => {
    const steps = [step({ order: 1 }), step({ order: 2 })];
    expect(firstActionableStep(steps, new Set([1, 2]))).toBeNull();
  });

  it("reads order rather than array position", () => {
    const steps = [step({ order: 2, dependsOn: [1] }), step({ order: 1 })];
    expect(firstActionableStep(steps)?.order).toBe(1);
  });
});

describe("planProgress", () => {
  it("is ready when Vibe can move", () => {
    expect(planProgress([step({ order: 1 }), step({ order: 2 })])).toBe("ready");
  });

  it("needs the founder when the next step is theirs", () => {
    const steps = [
      step({ order: 1, actor: "founder_decision", executionSupport: "founder_decides" }),
      step({ order: 2, dependsOn: [1] }),
    ];
    expect(planProgress(steps)).toBe("needs_founder");
  });

  it("is blocked when the next step waits on someone else", () => {
    const steps = [
      step({ order: 1, actor: "external_party", executionSupport: "external_dependency" }),
      step({ order: 2, dependsOn: [1] }),
    ];
    expect(planProgress(steps)).toBe("blocked");
  });

  it("is finished when every step is done", () => {
    const steps = [step({ order: 1 }), step({ order: 2 })];
    expect(planProgress(steps, new Set([1, 2]))).toBe("finished");
  });
});

describe("findDependencyCycles", () => {
  it("finds nothing in an acyclic plan", () => {
    const steps = [step({ order: 1 }), step({ order: 2, dependsOn: [1] }), step({ order: 3, dependsOn: [1, 2] })];
    expect(findDependencyCycles(steps)).toEqual([]);
  });

  /** §79 — a plan where nothing can ever start. */
  it("finds a two-step loop", () => {
    const steps = [step({ order: 1, dependsOn: [2] }), step({ order: 2, dependsOn: [1] })];
    expect(findDependencyCycles(steps)).toEqual([1, 2]);
  });

  it("finds a longer loop", () => {
    const steps = [
      step({ order: 1, dependsOn: [3] }),
      step({ order: 2, dependsOn: [1] }),
      step({ order: 3, dependsOn: [2] }),
    ];
    expect(findDependencyCycles(steps)).toEqual([1, 2, 3]);
  });

  it("finds a self-reference", () => {
    expect(findDependencyCycles([step({ order: 1, dependsOn: [1] })])).toEqual([1]);
  });
});

describe("repairDependencies", () => {
  it("removes an edge pointing at a step that is not in the plan", () => {
    const repaired = repairDependencies([step({ order: 1, dependsOn: [7] })]);

    expect(repaired.steps[0].dependsOn).toEqual([]);
    expect(repaired.notes).toHaveLength(1);
  });

  /**
   * The repair a cyclic plan needs: after it, something can start.
   *
   * The edges are dropped rather than reordered. Which of two mutually
   * dependent steps "really" comes first is not something the server can know,
   * and inventing an answer would be the server writing the plan.
   */
  it("breaks a loop so the plan can be ordered", () => {
    const repaired = repairDependencies([
      step({ order: 1, dependsOn: [2] }),
      step({ order: 2, dependsOn: [1] }),
    ]);

    expect(findDependencyCycles(repaired.steps)).toEqual([]);
    expect(firstActionableStep(repaired.steps)).not.toBeNull();
    expect(repaired.notes.join(" ")).toContain("loop");
  });

  it("leaves a valid plan untouched", () => {
    const steps = [step({ order: 1 }), step({ order: 2, dependsOn: [1] })];
    const repaired = repairDependencies(steps);

    expect(repaired.notes).toEqual([]);
    expect(repaired.steps[1].dependsOn).toEqual([1]);
  });
});

describe("isUnblocked", () => {
  it("is true only when every prerequisite is complete", () => {
    const target = step({ order: 3, dependsOn: [1, 2] });
    expect(isUnblocked(target, new Set([1]))).toBe(false);
    expect(isUnblocked(target, new Set([1, 2]))).toBe(true);
  });
});
