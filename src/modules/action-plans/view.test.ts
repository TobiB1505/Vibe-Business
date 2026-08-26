import { describe, expect, it } from "vitest";
import type { ActionPlanBlockReason } from "./service";
import { EXECUTION_SUPPORT, type ActionPlanStep } from "./schema";
import {
  RESPONSIBILITY_HEADLINES,
  RESPONSIBILITY_SUBLABELS,
  buildActionPlanBlockNotice,
  planMetaSummary,
  stepDependencyTitles,
  stepDisplayState,
  stepSequenceStatus,
} from "./view";

/**
 * The Action Plan presentation layer (ACTION PLANNER UI-1).
 *
 * Pure functions only, tested without a DOM or a database — the same
 * standard `opportunities/view.ts` is held to. What these tests exist to pin
 * down: every block reason has a way out, and step display state is computed
 * from `firstActionableOrder` and `dependsOn` rather than from array
 * position.
 */

const ALL_BLOCK_REASONS: ActionPlanBlockReason[] = [
  "audit_missing",
  "audit_stale",
  "move_missing",
  "move_stale",
  "product_profile_missing",
  "planner_source_unresolved",
];

function step(overrides: Partial<ActionPlanStep> = {}): ActionPlanStep {
  return {
    id: "step-1",
    order: 1,
    title: "Do the thing",
    description: "A description.",
    purpose: "A purpose.",
    actor: "vibe",
    changeKind: "analysis",
    completionCriteria: "It is done.",
    dependsOn: [],
    evidenceIds: [],
    executionSupport: "vibe_prepares",
    capability: null,
    requiresApproval: false,
    ...overrides,
    founderInputRequirement: overrides.founderInputRequirement ?? null,
  };
}

describe("buildActionPlanBlockNotice", () => {
  it("returns null for no block", () => {
    expect(buildActionPlanBlockNotice(null)).toBeNull();
  });

  /**
   * Mirrors the rule `buildOpportunityBlockNotice` is tested against: a
   * blocked state is never a dead end, so every reason must resolve to a
   * concrete action and somewhere to send the founder.
   */
  it("gives every reason an action label and a target", () => {
    for (const reason of ALL_BLOCK_REASONS) {
      const notice = buildActionPlanBlockNotice(reason);
      expect(notice).not.toBeNull();
      expect(notice!.reason).toBe(reason);
      expect(notice!.actionLabel.length).toBeGreaterThan(0);
      expect(["business_audit", "product_understanding", "next_moves"]).toContain(
        notice!.target,
      );
    }
  });

  it("routes the audit reasons at the business audit, not next moves", () => {
    expect(buildActionPlanBlockNotice("audit_missing")!.target).toBe("business_audit");
    expect(buildActionPlanBlockNotice("audit_stale")!.target).toBe("business_audit");
  });

  it("routes every Move-shaped reason back at next moves", () => {
    expect(buildActionPlanBlockNotice("move_missing")!.target).toBe("next_moves");
    expect(buildActionPlanBlockNotice("move_stale")!.target).toBe("next_moves");
    // The Move itself may be current — what failed is its link to a
    // conclusion — but the remedy is the same regeneration.
    expect(buildActionPlanBlockNotice("planner_source_unresolved")!.target).toBe("next_moves");
  });
});

describe("stepDisplayState", () => {
  it("marks the step firstActionableStep actually returned, not steps[0]", () => {
    const decision = step({ order: 1, dependsOn: [] });
    const laterStep = step({ order: 2, dependsOn: [1] });

    // firstActionableStep picked order 2 — impossible unless 1 were already
    // done, but the display state must still trust the server's answer
    // rather than re-deriving "first" as array position.
    expect(stepDisplayState(decision, 2)).not.toBe("start_here");
    expect(stepDisplayState(laterStep, 2)).toBe("start_here");
  });

  it("marks a zero-dependency step that is not the chosen one as also_ready", () => {
    const first = step({ order: 1, dependsOn: [] });
    const second = step({ order: 2, dependsOn: [] });

    expect(stepDisplayState(first, 1)).toBe("start_here");
    expect(stepDisplayState(second, 1)).toBe("also_ready");
  });

  it("marks a step with an open prerequisite as waiting", () => {
    const blocked = step({ order: 3, dependsOn: [1] });
    expect(stepDisplayState(blocked, 1)).toBe("waiting_on_steps");
  });

  it("marks a completed step as done regardless of dependencies or order", () => {
    const finished = step({ order: 1, dependsOn: [] });
    expect(stepDisplayState(finished, null, new Set([1]))).toBe("done");
  });

  it("never crowns a step start_here when nothing is actionable", () => {
    const anyStep = step({ order: 1, dependsOn: [] });
    expect(stepDisplayState(anyStep, null)).not.toBe("start_here");
  });
});

describe("stepDependencyTitles", () => {
  it("resolves prerequisite orders to their titles, in dependsOn order", () => {
    const decision = step({ order: 1, title: "Choose a segment" });
    const research = step({ order: 2, title: "Interview five customers" });
    const dependent = step({ order: 3, dependsOn: [1, 2] });

    expect(stepDependencyTitles(dependent, [decision, research, dependent])).toEqual([
      "Choose a segment",
      "Interview five customers",
    ]);
  });

  it("drops a dangling reference rather than rendering an empty title", () => {
    const dependent = step({ order: 2, dependsOn: [1] });
    expect(stepDependencyTitles(dependent, [dependent])).toEqual([]);
  });

  it("returns an empty list for a step with no prerequisites", () => {
    const first = step({ order: 1, dependsOn: [] });
    expect(stepDependencyTitles(first, [first])).toEqual([]);
  });
});

/**
 * ACTION PLANNER UI-1.1 — density pass helpers.
 *
 * `RESPONSIBILITY_HEADLINES` is the one place a step's actor/executionSupport
 * pairing becomes the single scannable statement the collapsed row shows —
 * so every value the enum can take must resolve to real, non-empty copy, and
 * `not_yet_supported` must never read as if something is happening
 * automatically.
 */
describe("RESPONSIBILITY_HEADLINES", () => {
  it("gives every ExecutionSupport value a non-empty headline", () => {
    for (const value of EXECUTION_SUPPORT) {
      expect(RESPONSIBILITY_HEADLINES[value].length).toBeGreaterThan(0);
    }
  });

  it("never lets 'not yet supported' read as automatic", () => {
    const headline = RESPONSIBILITY_HEADLINES.not_yet_supported.toLowerCase();
    expect(headline).not.toContain("automat");
    expect(RESPONSIBILITY_SUBLABELS.not_yet_supported).toBe("Not automated yet");
  });

  it("reserves the sublabel for the one value that needs disambiguating", () => {
    for (const value of EXECUTION_SUPPORT) {
      if (value === "not_yet_supported") continue;
      expect(RESPONSIBILITY_SUBLABELS[value]).toBeUndefined();
    }
  });
});

describe("stepSequenceStatus", () => {
  it("reads Ready now for the current entry point", () => {
    const current = step({ order: 1, dependsOn: [] });
    expect(stepSequenceStatus(current, [current], "start_here")).toEqual({
      label: "Ready now",
      state: "ready",
    });
  });

  it("reads Ready now for an also-ready step, same as Start Here", () => {
    const first = step({ order: 1, dependsOn: [] });
    const second = step({ order: 2, dependsOn: [] });
    expect(stepSequenceStatus(second, [first, second], "also_ready").label).toBe("Ready now");
  });

  it("names the single prerequisite by title, not just its order", () => {
    const decision = step({ order: 1, title: "Choose a segment" });
    const dependent = step({ order: 2, dependsOn: [1] });
    const status = stepSequenceStatus(dependent, [decision, dependent], "waiting_on_steps");

    expect(status.state).toBe("waiting");
    expect(status.label).toBe("Waiting for step 1: Choose a segment");
  });

  it("summarizes rather than lists every prerequisite when there is more than one", () => {
    const a = step({ order: 1, title: "A" });
    const b = step({ order: 2, title: "B" });
    const dependent = step({ order: 3, dependsOn: [1, 2] });
    const status = stepSequenceStatus(dependent, [a, b, dependent], "waiting_on_steps");

    expect(status.label).toBe("Waiting for 2 earlier steps");
  });

  it("reads Done for a completed step regardless of its dependencies", () => {
    const finished = step({ order: 1, dependsOn: [] });
    expect(stepSequenceStatus(finished, [finished], "done")).toEqual({
      label: "Done",
      state: "done",
    });
  });
});

describe("planMetaSummary", () => {
  it("counts steps and pluralizes correctly", () => {
    expect(planMetaSummary([step({ order: 1 })])).toBe("1 step");
    expect(planMetaSummary([step({ order: 1 }), step({ order: 2 })])).toBe("2 steps");
  });

  it("adds a founder-decision count only when one exists, pluralized", () => {
    const noDecision = [step({ order: 1, actor: "vibe" })];
    expect(planMetaSummary(noDecision)).toBe("1 step");

    const oneDecision = [step({ order: 1, actor: "founder_decision" }), step({ order: 2 })];
    expect(planMetaSummary(oneDecision)).toBe("2 steps · 1 founder decision");

    const twoDecisions = [
      step({ order: 1, actor: "founder_decision" }),
      step({ order: 2, actor: "founder_decision" }),
      step({ order: 3 }),
    ];
    expect(planMetaSummary(twoDecisions)).toBe("3 steps · 2 founder decisions");
  });
});
