import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { deriveOnboardingState, type OnboardingFacts } from "@/modules/onboarding/state";
import { firstActionableStep, planProgress } from "./sequence";
import type { ActionPlanStep } from "./schema";

/**
 * Onboarding's First Move phase (CORE-2b §59, §60).
 *
 * Two obligations, and they pull in opposite directions:
 *
 *  - **§59** — the planner must expose enough for onboarding to render "this is
 *    where Vibe would start, and here is the plan".
 *  - **§60** — onboarding must still complete when the plan begins with a
 *    founder decision, a manual action, an external dependency, or something
 *    Vibe cannot automate. Activation is not the First Win, and CORE-2b must
 *    not be what regresses that.
 *
 * The second is the one that needs guarding, because it is the one a future
 * "the plan must be actionable before you can finish" change would break.
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

const READY_FOR_FIRST_MOVE: OnboardingFacts = {
  hasProductSource: true,
  liveSiteStatus: "provided",
  hasRepositorySnapshot: true,
  understandingRunning: false,
  hasProductProfile: true,
  productConfirmed: true,
  auditNeedsUser: false,
  auditRunning: false,
  auditAnalyzing: false,
  hasAudit: true,
  auditRevealed: true,
  completed: false,
};

describe("onboarding is not gated on a plan", () => {
  /**
   * The structural guarantee, stated as a test.
   *
   * `OnboardingFacts` carries no plan field, so the state machine cannot
   * consult one. Asserting the fact keys rather than a behaviour means adding a
   * plan prerequisite to onboarding fails here, at the point the decision is
   * made, rather than in a browser three sprints later.
   */
  it("takes no Action Plan fact as input", () => {
    const keys = Object.keys(READY_FOR_FIRST_MOVE);

    for (const key of keys) {
      expect(key.toLowerCase()).not.toContain("plan");
      expect(key.toLowerCase()).not.toContain("move");
    }
    expect(deriveOnboardingState(READY_FOR_FIRST_MOVE)).toBe("first_move");
  });

  /**
   * §60 — the completion condition is untouched.
   *
   * Read from source rather than exercised, in the style of the onboarding
   * contract test: the guard lives in a Server Action, and what matters is that
   * nothing about a plan appears in it.
   */
  it("does not require a plan to complete", () => {
    const source = readFileSync(
      join(process.cwd(), "src/app/app/onboarding/[projectId]/actions.ts"),
      "utf8",
    );

    expect(source).not.toContain("action_plan");
    expect(source).not.toContain("ActionPlan");
  });
});

describe("what the First Move phase can render", () => {
  /** §59 — a plan Vibe can move on. */
  it("names Vibe's own first step when there is one", () => {
    const steps = [step({ order: 1 }), step({ order: 2, dependsOn: [1] })];

    expect(firstActionableStep(steps)?.order).toBe(1);
    expect(planProgress(steps)).toBe("ready");
  });

  /** §60 — a plan that opens with a decision. Onboarding still completes. */
  it("names the founder's decision when that is genuinely next", () => {
    const steps = [
      step({ order: 1, actor: "founder_decision", executionSupport: "founder_decides" }),
      step({ order: 2, dependsOn: [1] }),
    ];

    expect(firstActionableStep(steps)?.actor).toBe("founder_decision");
    expect(planProgress(steps)).toBe("needs_founder");
    expect(deriveOnboardingState(READY_FOR_FIRST_MOVE)).toBe("first_move");
    expect(deriveOnboardingState({ ...READY_FOR_FIRST_MOVE, completed: true })).toBe("complete");
  });

  /** §60 — a plan blocked on the outside world. Onboarding still completes. */
  it("says the plan is blocked without blocking onboarding", () => {
    const steps = [
      step({ order: 1, actor: "external_party", executionSupport: "external_dependency" }),
      step({ order: 2, dependsOn: [1] }),
    ];

    expect(planProgress(steps)).toBe("blocked");
    expect(deriveOnboardingState({ ...READY_FOR_FIRST_MOVE, completed: true })).toBe("complete");
  });

  /** §60 — a plan Vibe cannot automate at all. Still a plan, still completable. */
  it("handles a plan with nothing Vibe can execute", () => {
    const steps = [
      step({ order: 1, changeKind: "product_change", executionSupport: "not_yet_supported" }),
      step({ order: 2, dependsOn: [1] }),
    ];

    expect(firstActionableStep(steps)?.executionSupport).toBe("not_yet_supported");
    expect(planProgress(steps)).toBe("ready");
    expect(deriveOnboardingState({ ...READY_FOR_FIRST_MOVE, completed: true })).toBe("complete");
  });

  /** No plan at all is a normal state — onboarding predates every plan. */
  it("has nothing to render before any plan exists", () => {
    expect(firstActionableStep([])).toBeNull();
    expect(planProgress([])).toBe("blocked");
    expect(deriveOnboardingState(READY_FOR_FIRST_MOVE)).toBe("first_move");
  });
});
