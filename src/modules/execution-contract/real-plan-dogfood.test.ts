import { describe, expect, it } from "vitest";
import type { ActionPlanStep } from "@/modules/action-plans/schema";
import type { RepositoryIntelligenceSnapshot } from "@/modules/repository-intelligence/schema";
import { resolvePlanExecution } from "./resolver";
import { fakePlanContext, fakeSnapshot } from "./test-support";

/**
 * The real Action Plan, resolved (EXECUTION CORE-3 §38, §39, §42, §43).
 *
 * ## Why this is a test and not only a probe
 *
 * `dogfood.probe.ts` resolves the plan straight out of the production database,
 * which is the honest dogfood and cannot run in CI. This file carries the same
 * data as a fixture so the *result* is protected: a future change to the risk
 * model, the registry or the eligibility gates that would silently start
 * offering to build a login flow fails here.
 *
 * ## Where the fixture came from
 *
 * The real persisted plan `82767dd4` for project *Jandia-Arena*, read from the
 * Vibe Business Supabase project on 2026-08-18 — the plan the CORE-2b dogfood
 * produced, not one written for this sprint. The repository facts are that
 * project's newest successful snapshot `b3d6a18c`: a FastAPI + React repository
 * at `5b76b2a3`, package manager undetected.
 *
 * Nothing here is seeded to make a step resolve well. §39 is explicit that the
 * expected outcomes must not be hardcoded, and the assertions below are what
 * the resolver actually says about this project — including that Vibe cannot
 * agentically execute anything in it, for a reason that has nothing to do with
 * the plan's quality.
 */

/** The five steps as persisted, verbatim. */
const REAL_STEPS: ActionPlanStep[] = [
  {
    id: "1-lay-out-the-access-options-for-resort-staff-and-managers",
    order: 1,
    title: "Lay out the access options for resort staff and managers",
    description: "Work out the realistic ways staff and managers could be given access.",
    purpose: "So the founder chooses between real options rather than in the abstract.",
    actor: "vibe",
    changeKind: "analysis",
    completionCriteria:
      "A short set of distinct access approaches exists, each with what it would mean for staff and managers day to day.",
    dependsOn: [],
    evidenceIds: [
      "profile.audience.primary",
      "profile.audience.user_type",
      "repo.surface.authentication",
    ],
    executionSupport: "vibe_prepares",
    capability: null,
    requiresApproval: false,
    founderInputRequirement: null,
  },
  {
    id: "2-decide-how-staff-and-managers-will-sign-in",
    order: 2,
    title: "Decide how staff and managers will sign in",
    description: "Pick one access model to build against.",
    purpose: "Everything downstream depends on which model is chosen.",
    actor: "founder_decision",
    changeKind: "decision",
    completionCriteria:
      "One access model is explicitly chosen and recorded as the one to build against.",
    dependsOn: [1],
    evidenceIds: [],
    executionSupport: "founder_decides",
    capability: null,
    requiresApproval: false,
    founderInputRequirement: null,
  },
  {
    id: "3-build-a-working-login-connected-to-the-actual-calendar-and-request-tool",
    order: 3,
    title: "Build a working login connected to the actual calendar and request tool",
    description: "Implement the chosen authentication and connect it to the existing tools.",
    purpose: "So the product staff were promised actually exists for them.",
    actor: "vibe",
    changeKind: "product_change",
    completionCriteria:
      "A person can authenticate through the chosen mechanism and reach a signed-in area that shows the calendar and request tool, where none existed before.",
    dependsOn: [2],
    evidenceIds: [
      "repo.surface.authentication",
      "repo.surface.dashboard_app",
      "live.surface.dashboard_app",
      "live.surface.login",
    ],
    executionSupport: "not_yet_supported",
    capability: null,
    requiresApproval: true,
    founderInputRequirement: null,
  },
  {
    id: "4-put-a-visible-way-in-on-the-homepage",
    order: 4,
    title: "Put a visible way in on the homepage",
    description: "Add a login entry point to the live homepage.",
    purpose: "So staff can find the way in without being told a URL.",
    actor: "vibe",
    changeKind: "product_change",
    completionCriteria:
      "The live homepage shows a login entry point that leads directly into the authentication flow built in the previous step.",
    dependsOn: [3],
    evidenceIds: ["live.conversion.primary_cta", "live.surface.login"],
    executionSupport: "not_yet_supported",
    capability: null,
    requiresApproval: true,
    founderInputRequirement: null,
  },
  {
    id: "5-confirm-a-staff-member-can-get-from-the-homepage-into-the-calendar",
    order: 5,
    title: "Confirm a staff member can get from the homepage into the calendar",
    description: "Have a real staff member walk the path end to end.",
    purpose: "So the outcome is observed rather than assumed.",
    actor: "founder_action",
    changeKind: "measurement",
    completionCriteria:
      "A named staff member or manager has completed the path from homepage to signed-in calendar view, and the founder confirms it behaves as intended.",
    dependsOn: [4],
    evidenceIds: ["profile.journey.signed_in_experience_not_found"],
    executionSupport: "founder_acts",
    capability: null,
    requiresApproval: false,
    founderInputRequirement: null,
  },
];

/** The project's real repository facts: FastAPI + React, package manager undetected. */
const REAL_SNAPSHOT: RepositoryIntelligenceSnapshot = fakeSnapshot({
  frameworks: [
    { id: "fastapi", name: "FastAPI" },
    { id: "react", name: "React" },
  ],
  packageManager: "unknown",
});

const REAL_COMMIT = "5b76b2a331f718ab6808dac1fd1c0746922d17df";

function resolveRealPlan() {
  return resolvePlanExecution({
    plan: fakePlanContext(REAL_STEPS),
    repository: {
      connection: { id: "conn-real", fullName: "TobiB1505/Jandia-Arena", defaultBranch: "main" },
      snapshot: REAL_SNAPSHOT,
      snapshotId: "b3d6a18c-b562-462e-a72e-f2bef4015062",
      snapshotCommitSha: REAL_COMMIT,
      snapshotIsLatest: true,
      liveHead: { defaultBranch: "main", commitSha: REAL_COMMIT },
    },
    // False in production: `budget.ts` ships no approved policy.
    agenticBudgetAuthorized: false,
  });
}

describe("the real Action Plan, resolved (§38, §39)", () => {
  it("gives every step a truthful, non-executable result", () => {
    const resolutions = resolveRealPlan();

    expect(resolutions).toHaveLength(5);
    for (const resolution of resolutions) {
      expect(resolution.admission.admissible).toBe(false);
    }
  });

  it("step 1 — Vibe's own analysis work, with no executor behind it", () => {
    const [step] = resolveRealPlan();

    expect(step.mode).toBe("unsupported");
    expect(step.reason).toBe("no_executor_for_vibe_work");
    expect(step.riskClass).toBe("low");
  });

  it("step 2 — the founder's decision, and nothing runs until it is made", () => {
    const step = resolveRealPlan()[1];

    // Blocked, because step 1 is unfinished — §27 is absolute about that, and
    // the forecast records what it would otherwise be.
    expect(step.mode).toBe("blocked");
    expect(step.blockedBy).toEqual([1]);
    expect(step.intrinsicMode).toBe("needs_user_input");
  });

  it("step 3 — blocked by the decision, and high risk underneath it", () => {
    const step = resolveRealPlan()[2];

    expect(step.mode).toBe("blocked");
    expect(step.blockedBy).toEqual([2]);
    // Two independent reasons it is not agentic, and the plan being blocked is
    // only the first: this is a login flow, which is outside the V1 boundary.
    expect(step.riskClass).toBe("high");
    expect(step.intrinsicMode).toBe("unsupported");
  });

  it("step 4 — blocked by step 3, and still auth-adjacent", () => {
    const step = resolveRealPlan()[3];

    expect(step.mode).toBe("blocked");
    expect(step.blockedBy).toEqual([3]);
    expect(step.riskClass).toBe("high");
  });

  it("step 5 — a person has to do this, whatever the plan's position", () => {
    const step = resolveRealPlan()[4];

    expect(step.mode).toBe("blocked");
    expect(step.intrinsicMode).toBe("manual");
  });

  it("would refuse agentic execution on this repository even with the plan unblocked", () => {
    // The finding that matters most, and it is about the *project*, not the
    // plan: a FastAPI + React repository with no detected package manager has
    // no validation profile, so Vibe could never independently prove a change
    // to it builds — and §31 forbids letting an agent's own claim stand in.
    const unblocked = resolvePlanExecution({
      plan: fakePlanContext(REAL_STEPS, { completedSteps: new Set([1, 2, 3, 4]) }),
      repository: {
        connection: { id: "conn-real", fullName: "TobiB1505/Jandia-Arena", defaultBranch: "main" },
        snapshot: REAL_SNAPSHOT,
        snapshotId: "b3d6a18c-b562-462e-a72e-f2bef4015062",
        snapshotCommitSha: REAL_COMMIT,
        snapshotIsLatest: true,
        liveHead: { defaultBranch: "main", commitSha: REAL_COMMIT },
      },
      agenticBudgetAuthorized: true,
    });

    const step4 = unblocked[3];
    expect(step4.mode).toBe("unsupported");
    expect(step4.unmetRequirements).toContain("validation_profile_unsupported");
    expect(step4.unmetRequirements).toContain("risk_class_not_permitted");
  });

  it("never reads the Planner's own execution support to reach any of this (§6)", () => {
    // Same plan, every Planner claim inverted to the most permissive value.
    // The resolution must be byte-identical.
    const forged = REAL_STEPS.map((step) => ({
      ...step,
      executionSupport: "vibe_executes_now" as const,
      capability: "nextjs_seo_foundations_v2" as const,
    }));

    const honest = resolveRealPlan();
    const inflated = resolvePlanExecution({
      plan: fakePlanContext(forged),
      repository: {
        connection: { id: "conn-real", fullName: "TobiB1505/Jandia-Arena", defaultBranch: "main" },
        snapshot: REAL_SNAPSHOT,
        snapshotId: "b3d6a18c-b562-462e-a72e-f2bef4015062",
        snapshotCommitSha: REAL_COMMIT,
        snapshotIsLatest: true,
        liveHead: { defaultBranch: "main", commitSha: REAL_COMMIT },
      },
      agenticBudgetAuthorized: false,
    });

    expect(inflated).toEqual(honest);
  });
});
