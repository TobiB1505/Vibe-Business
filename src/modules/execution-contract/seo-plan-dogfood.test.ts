import { describe, expect, it } from "vitest";
import type { ActionPlanStep } from "@/modules/action-plans/schema";
import type { RepositoryIntelligenceSnapshot } from "@/modules/repository-intelligence/schema";
import { resolveExecutionDependencies } from "./dependencies";
import { resolvePlanExecution } from "./resolver";
import { firstExecutableStep, isAgentReady } from "./schema";
import { fakePlanContext, fakeSnapshot } from "./test-support";

/**
 * The real SEO Action Plan, resolved (CORE-4 SEMANTICS FIX §23, §24).
 *
 * ## Where this data came from
 *
 * Action Plan `9110ab8b-84f4-4964-a8df-3d4aeef081df` for project *Vibe-Business*
 * (`b95779dc`), read verbatim from the Vibe Business Supabase project on
 * 2026-08-18 — the plan the Action Planner produced, not one written for this
 * test. The repository facts are that project's newest successful snapshot
 * `c40986d0`: Next.js + React, pnpm, robots.txt and sitemap both present, at
 * commit `61618ac8`.
 *
 * No Planner call was made to produce it, and none is made here. The plan
 * already exists; re-planning to evaluate a resolver would be paying for an
 * answer we have.
 *
 * ## What it is protecting
 *
 * This is the plan the semantics defect was found on. Steps 2, 3 and 4 are
 * moderate-risk changes to a repository Vibe can independently validate, and
 * all three resolved `blocked` — because step 1, *"Define the metadata plan"*,
 * is Vibe's own analysis work with no executor behind it and was treated as a
 * hard prerequisite.
 *
 * Nothing below is seeded to make a step resolve well, and no expected outcome
 * is hardcoded: the assertions are what the resolver actually says about this
 * project, including everything that is still refused.
 */

/** The six steps as persisted, verbatim. */
const REAL_STEPS: ActionPlanStep[] = [
  {
    id: "1-analysis-define-the-metadata-plan-for-canonical-open-grap",
    order: 1,
    title:
      "Define the metadata plan for canonical, Open Graph, structured data, and robots signals",
    description:
      "Work out, for each existing public page, what the canonical URL should resolve to, what Open Graph title/description/image/url values should be drawn from the confirmed product identity and promise, what structured data type fits a SaaS application, and what robots meta should say for public versus signed-in pages.",
    purpose:
      "Without a plan, the technical fix risks becoming inconsistent tags added ad hoc. This step turns the four missing signals into a concrete, page-by-page specification that implementation can follow directly.",
    actor: "vibe",
    changeKind: "analysis",
    completionCriteria:
      "A specific canonical URL, Open Graph value set, structured data type, and robots directive is recorded for each existing public page.",
    dependsOn: [],
    evidenceIds: [
      "live.seo.canonical_missing",
      "live.seo.open_graph_missing",
      "live.seo.structured_data_missing",
      "live.seo.robots_meta_missing",
    ],
    executionSupport: "vibe_prepares",
    capability: null,
    requiresApproval: false,
  },
  {
    id: "2-product_change-add-canonical-urls-to-public-pages",
    order: 2,
    title: "Add canonical URLs to public pages",
    description:
      "Implement the canonical URL tags specified in the metadata plan across the public pages.",
    purpose:
      "Closes the specific gap where duplicate or parameterised URLs could be misread by search engines as separate pages, so indexing consolidates correctly on the intended URL.",
    actor: "vibe",
    changeKind: "product_change",
    completionCriteria:
      "Every existing public page returns a canonical URL tag matching the plan when the page is loaded.",
    dependsOn: [1],
    evidenceIds: ["live.seo.canonical_missing"],
    executionSupport: "not_yet_supported",
    capability: null,
    requiresApproval: true,
  },
  {
    id: "3-product_change-add-open-graph-tags-and-structured-data-to-publi",
    order: 3,
    title: "Add Open Graph tags and structured data to public pages",
    description:
      "Implement Open Graph metadata (title, description, image, url) and structured data markup on public pages, using the values defined in the metadata plan.",
    purpose:
      "Makes the product render correctly with the right title, description and image when a link is shared on social or messaging platforms, and gives search engines a structured description of what the product is, rather than none at all.",
    actor: "vibe",
    changeKind: "product_change",
    completionCriteria:
      "Every existing public page exposes Open Graph tags and a structured data block matching the values in the metadata plan.",
    dependsOn: [1],
    evidenceIds: ["live.seo.open_graph_missing", "live.seo.structured_data_missing"],
    executionSupport: "not_yet_supported",
    capability: null,
    requiresApproval: true,
  },
  {
    id: "4-product_change-add-robots-meta-directives-to-public-and-signed-",
    order: 4,
    title: "Add robots meta directives to public and signed-in pages",
    description:
      "Implement robots meta tags that mark public pages as indexable and signed-in pages as non-indexable, per the metadata plan.",
    purpose:
      "Prevents search engines from either missing pages that should be indexed or incorrectly indexing signed-in application pages that should stay private.",
    actor: "vibe",
    changeKind: "product_change",
    completionCriteria:
      "Public pages carry an indexable robots meta directive and signed-in pages carry a non-indexable one, matching the plan.",
    dependsOn: [1],
    evidenceIds: ["live.seo.robots_meta_missing"],
    executionSupport: "not_yet_supported",
    capability: null,
    requiresApproval: true,
  },
  {
    id: "5-measurement-verify-the-new-signals-render-correctly-on-the-l",
    order: 5,
    title: "Verify the new signals render correctly on the live site",
    description:
      "Check each updated page to confirm the canonical URL resolves as intended, the Open Graph preview shows the correct title, description and image, the structured data validates, and the robots meta reflects the intended indexing state.",
    purpose:
      "Turns the implementation from something believed to be correct into something confirmed to behave as intended on the actual live pages, closing the loop the audit's evidence identified as missing.",
    actor: "vibe",
    changeKind: "measurement",
    completionCriteria:
      "Each public page's canonical, Open Graph, structured data and robots meta match the metadata plan when inspected live.",
    dependsOn: [2, 3, 4],
    evidenceIds: [],
    executionSupport: "vibe_prepares",
    capability: null,
    requiresApproval: false,
  },
  {
    id: "6-external_setup-request-re-crawl-of-the-updated-pages",
    order: 6,
    title: "Request re-crawl of the updated pages",
    description:
      "Submit the affected pages for re-crawl through the relevant search console tool so the new signals are picked up rather than waiting on the next scheduled crawl.",
    purpose:
      "Shortens the time between fixing the technical signals and search engines actually reflecting them, since an unindexed fix has no effect until it is crawled.",
    actor: "founder_action",
    changeKind: "external_setup",
    completionCriteria:
      "A re-crawl request for the updated public pages has been submitted and shows as received in the search console tool.",
    dependsOn: [5],
    evidenceIds: [],
    executionSupport: "founder_acts",
    capability: null,
    requiresApproval: true,
  },
];

/** Snapshot `c40986d0`: Next.js + React on pnpm, robots.txt and sitemap present. */
const REAL_SNAPSHOT: RepositoryIntelligenceSnapshot = fakeSnapshot({
  frameworks: [
    { id: "nextjs", name: "Next.js" },
    { id: "react", name: "React" },
  ],
  packageManager: "pnpm",
  robotsDetected: true,
  sitemapDetected: true,
});

const REAL_COMMIT = "61618ac8045263a5762021240316a4d54996115a";

function resolveRealPlan(options: { budgetAuthorized?: boolean } = {}) {
  return resolvePlanExecution({
    // Nothing in the product completes a step yet, so an empty set is the
    // truthful state rather than a simplification — and it is the state the
    // defect appeared in.
    plan: fakePlanContext(REAL_STEPS),
    repository: {
      connection: { id: "conn-vibe", fullName: "TobiB1505/Vibe-Business", defaultBranch: "main" },
      snapshot: REAL_SNAPSHOT,
      snapshotId: "c40986d0-2d3c-462e-b1ed-e742709fba2f",
      snapshotCommitSha: REAL_COMMIT,
      snapshotIsLatest: true,
      liveHead: { defaultBranch: "main", commitSha: REAL_COMMIT },
    },
    // False in production: `EXECUTION_BUDGET_POLICIES` is empty, so no customer
    // project is admitted. The internal dogfood policy is resolved separately,
    // for an allowlisted project only.
    agenticBudgetAuthorized: options.budgetAuthorized ?? false,
  });
}

describe("the real SEO plan 9110ab8b, resolved (§23)", () => {
  it("step 1 — Vibe's own analysis, still with no executor behind it", () => {
    const step = resolveRealPlan()[0];

    // Unchanged by this fix, and deliberately so: being *absorbable* into a
    // downstream run is not the same as being independently runnable.
    expect(step.mode).toBe("unsupported");
    expect(step.reason).toBe("no_executor_for_vibe_work");
    expect(step.riskClass).toBe("low");
    expect(step.absorbedPreparation).toEqual([]);
  });

  it.each([
    [2, "Add canonical URLs to public pages"],
    [3, "Add Open Graph tags and structured data to public pages"],
    [4, "Add robots meta directives to public and signed-in pages"],
  ])("step %i — %s resolves agentic, absorbing step 1", (order) => {
    const step = resolveRealPlan()[order - 1];

    expect(step.mode).toBe("agentic");
    expect(step.reason).toBe("agentic_v1_eligible");
    expect(step.riskClass).toBe("moderate");
    expect(step.blockedBy).toEqual([]);
    expect(step.absorbedPreparation).toEqual([1]);
    // No deterministic capability matches: the plan cites canonical/OG/robots-meta
    // evidence, and the one registry entry serves robots.txt + sitemap — both of
    // which this repository already has.
    expect(step.capability).toBeNull();
  });

  it("step 5 — verification is not folded into the run that produced the change", () => {
    const step = resolveRealPlan()[4];

    // Its prerequisites are the three product changes, which have to genuinely
    // exist first. And a measurement step is never absorbable in any case: a run
    // must not become its own judge (Rule 78).
    expect(step.mode).toBe("blocked");
    expect(step.blockedBy).toEqual([2, 3, 4]);
    expect(step.intrinsicMode).toBe("unsupported");
  });

  it("step 6 — a person submits the re-crawl, whatever else changes", () => {
    const step = resolveRealPlan()[5];

    expect(step.mode).toBe("blocked");
    expect(step.blockedBy).toEqual([5]);
    expect(step.intrinsicMode).toBe("manual");
  });
});

describe("§24 — step 3 is the dogfood candidate", () => {
  const step3 = () => resolveRealPlan({ budgetAuthorized: true })[2];

  it("passes every classification gate", () => {
    const step = step3();

    expect(step.mode).toBe("agentic");
    expect(step.riskClass).toBe("moderate");
    expect(step.requiresUserInput).toBe(false);
    expect(step.unmetRequirements).toEqual([]);
  });

  it("is agent-ready once economics authorize it", () => {
    expect(isAgentReady(step3())).toBe(true);
  });

  /**
   * The honest production answer. Nothing about this fix activates an Agent
   * price, and a customer project reaches exactly this refusal.
   */
  it("is refused for any project without authorized economics", () => {
    const step = resolveRealPlan()[2];

    expect(step.mode).toBe("agentic");
    expect(step.admission).toEqual({
      admissible: false,
      refusal: "agentic_pricing_not_configured",
    });
  });

  it("names step 1 as preparation rather than as a blocker", () => {
    const dependencies = resolveExecutionDependencies({
      step: REAL_STEPS[2],
      steps: REAL_STEPS,
      completed: new Set(),
      capabilityContext: { repository: REAL_SNAPSHOT },
      absorbable: true,
    });

    expect(dependencies).toEqual({
      hardBlockers: [],
      absorbedPreparation: [1],
      classifications: [{ order: 1, classification: "agent_preparable" }],
      cycleDetected: false,
    });
  });
});

/**
 * §17, §37 — what a surface would ask, and how.
 *
 * There is no "Run with Vibe" control in the product: Core-3 §40 kept execution
 * out of the UI and Core-4 did not add it. What exists is the question a future
 * one must ask, and these pin that it is answered by resolving the real plan
 * rather than by naming a step.
 */
describe("§17 — the first step Vibe could actually start", () => {
  it("is the earliest executable step, not the plan's first step", () => {
    const next = firstExecutableStep(resolveRealPlan({ budgetAuthorized: true }));

    // Step 1 is the plan's first actionable step and always was — nothing
    // stands in front of it. It is not the first *executable* one, because no
    // executor produces a written metadata plan.
    expect(next?.stepOrder).toBe(2);
    expect(next?.absorbedPreparation).toEqual([1]);
  });

  it("is null while nothing is admissible, rather than falling back to a step id", () => {
    // Production today: no approved Agent price, so nothing is executable.
    expect(firstExecutableStep(resolveRealPlan())).toBeNull();
  });

  it("follows the plan rather than a remembered answer", () => {
    // Same repository, a plan whose only executable work is step 4.
    const trimmed = resolvePlanExecution({
      plan: fakePlanContext([REAL_STEPS[0], REAL_STEPS[4], REAL_STEPS[3]]),
      repository: {
        connection: { id: "conn-vibe", fullName: "TobiB1505/Vibe-Business", defaultBranch: "main" },
        snapshot: REAL_SNAPSHOT,
        snapshotId: "c40986d0-2d3c-462e-b1ed-e742709fba2f",
        snapshotCommitSha: REAL_COMMIT,
        snapshotIsLatest: true,
        liveHead: { defaultBranch: "main", commitSha: REAL_COMMIT },
      },
      agenticBudgetAuthorized: true,
    });

    expect(firstExecutableStep(trimmed)?.stepOrder).toBe(4);
  });
});

describe("the fix changes dependency semantics and nothing else", () => {
  /**
   * §35, on this plan: absorbing preparation must never make an unsupported
   * technology stack executable.
   *
   * Both halves are asserted. With step 1 unfinished the answer is `blocked` —
   * because an *unsupported* route cannot absorb anything, so the dependency is
   * hard again — and with step 1 marked finished the underlying refusal is
   * visible on its own. The validation gap is reported either way.
   */
  it("still refuses this repository if it could not be validated", () => {
    const unvalidatable = resolvePlanExecution({
      plan: fakePlanContext(REAL_STEPS, { completedSteps: new Set([1]) }),
      repository: {
        connection: { id: "conn-vibe", fullName: "TobiB1505/Vibe-Business", defaultBranch: "main" },
        snapshot: fakeSnapshot({
          frameworks: [{ id: "fastapi", name: "FastAPI" }],
          packageManager: "unknown",
        }),
        snapshotId: "c40986d0-2d3c-462e-b1ed-e742709fba2f",
        snapshotCommitSha: REAL_COMMIT,
        snapshotIsLatest: true,
        liveHead: { defaultBranch: "main", commitSha: REAL_COMMIT },
      },
      agenticBudgetAuthorized: true,
    });

    expect(unvalidatable[2].mode).toBe("unsupported");
    expect(unvalidatable[2].unmetRequirements).toContain("validation_profile_unsupported");
    expect(unvalidatable[2].absorbedPreparation).toEqual([]);
  });

  it("does not absorb preparation into a route that cannot be validated", () => {
    const unvalidatable = resolvePlanExecution({
      plan: fakePlanContext(REAL_STEPS),
      repository: {
        connection: { id: "conn-vibe", fullName: "TobiB1505/Vibe-Business", defaultBranch: "main" },
        snapshot: fakeSnapshot({
          frameworks: [{ id: "fastapi", name: "FastAPI" }],
          packageManager: "unknown",
        }),
        snapshotId: "c40986d0-2d3c-462e-b1ed-e742709fba2f",
        snapshotCommitSha: REAL_COMMIT,
        snapshotIsLatest: true,
        liveHead: { defaultBranch: "main", commitSha: REAL_COMMIT },
      },
      agenticBudgetAuthorized: true,
    });

    // An unsupported route carries no preparation, so step 1 is a hard
    // prerequisite again — and the validation gap is still reported underneath.
    expect(unvalidatable[2].mode).toBe("blocked");
    expect(unvalidatable[2].intrinsicMode).toBe("unsupported");
    expect(unvalidatable[2].absorbedPreparation).toEqual([]);
    expect(unvalidatable[2].unmetRequirements).toContain("validation_profile_unsupported");
  });

  it("still refuses when the repository has moved since the snapshot", () => {
    const moved = resolvePlanExecution({
      plan: fakePlanContext(REAL_STEPS),
      repository: {
        connection: { id: "conn-vibe", fullName: "TobiB1505/Vibe-Business", defaultBranch: "main" },
        snapshot: REAL_SNAPSHOT,
        snapshotId: "c40986d0-2d3c-462e-b1ed-e742709fba2f",
        snapshotCommitSha: REAL_COMMIT,
        snapshotIsLatest: true,
        liveHead: { defaultBranch: "main", commitSha: "0".repeat(40) },
      },
      agenticBudgetAuthorized: true,
    });

    expect(moved[2].mode).toBe("agentic");
    expect(moved[2].admission).toEqual({ admissible: false, refusal: "repository_head_moved" });
  });

  it("still reads none of the Planner's own execution claims (§6)", () => {
    const forged = REAL_STEPS.map((step) => ({
      ...step,
      executionSupport: "vibe_executes_now" as const,
      capability: "nextjs_seo_foundations_v2" as const,
    }));

    const honest = resolveRealPlan();
    const inflated = resolvePlanExecution({
      plan: fakePlanContext(forged),
      repository: {
        connection: { id: "conn-vibe", fullName: "TobiB1505/Vibe-Business", defaultBranch: "main" },
        snapshot: REAL_SNAPSHOT,
        snapshotId: "c40986d0-2d3c-462e-b1ed-e742709fba2f",
        snapshotCommitSha: REAL_COMMIT,
        snapshotIsLatest: true,
        liveHead: { defaultBranch: "main", commitSha: REAL_COMMIT },
      },
      agenticBudgetAuthorized: false,
    });

    expect(inflated).toEqual(honest);
  });
});
