import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDatabase, fakeSupabase } from "@/modules/operations/test-support";
import { fakeSnapshot } from "@/modules/execution-contract/test-support";

const getHead = vi.fn(async () => ({ defaultBranch: "main", commitSha: SNAPSHOT_SHA }));
const createGithubRepositoryReader = vi.fn(() => ({ getHead }));
vi.mock("@/modules/github/repository-reader", () => ({ createGithubRepositoryReader }));

const { previewDogfoodStep, isDogfoodEligibleProject, resolveDogfoodPlanRoutes } =
  await import("./website-preflight");
const { GithubDomainError } = await import("@/modules/github/errors");

/**
 * The internal dogfood website preflight (EXECUTION CORE-4 website gate,
 * §7, §8, §9, §14, §25, §26, §27).
 *
 * Every refusal here is a security boundary the website route depends on:
 * this is what stops a browser from starting a run on another project's step,
 * on a step that never resolved agentic, or on a project nobody enabled.
 */

const PROJECT = "project-1";
const USER = "user-1";
const OTHER_USER = "user-2";
const SNAPSHOT_SHA = "5b76b2a331f718ab6808dac1fd1c0746922d17df";
const ALLOWLIST = { VIBE_INTERNAL_AGENT_DOGFOOD_PROJECT_IDS: PROJECT };

let db: FakeDatabase;

function seedOwnedRepository() {
  db.seed("projects", { id: PROJECT, user_id: USER });
  db.seed("github_installations", { id: "install-1", user_id: USER, installation_id: 42 });
  db.seed("repository_connections", {
    id: "conn-1",
    project_id: PROJECT,
    owner: "acme",
    name: "product",
    full_name: "acme/product",
    default_branch: "main",
    github_installation_id: "install-1",
  });
}

function seedSuccessfulSnapshot(overrides: Record<string, unknown> = {}) {
  const snapshot = fakeSnapshot();
  db.seed("repository_intelligence_snapshots", {
    id: "snapshot-1",
    project_id: PROJECT,
    status: "completed",
    source_commit_sha: SNAPSHOT_SHA,
    source_branch: "main",
    result: { ...snapshot, source: { ...snapshot.source, commitSha: SNAPSHOT_SHA } },
    created_at: "2026-08-18T00:00:00.000Z",
    completed_at: "2026-08-18T00:00:01.000Z",
    ...overrides,
  });
}

function seedCompletedPlan(steps: Record<string, unknown>[]) {
  db.seed("action_plans", {
    id: "plan-1",
    project_id: PROJECT,
    business_audit_id: "audit-1",
    opportunity_id: "move-1",
    status: "completed",
    goal: "Ship the thing.",
    expected_outcome: "The thing is shipped.",
    assumptions: [],
    created_at: "2026-08-18T00:00:00.000Z",
  });
  for (const step of steps) db.seed("action_plan_steps", { action_plan_id: "plan-1", ...step });
}

const AGENTIC_STEP = {
  step_key: "1-ship-it",
  step_order: 1,
  title: "Ship the thing",
  description: "Make the product do the thing.",
  purpose: "So a visitor can complete the flow.",
  actor: "vibe",
  change_kind: "product_change",
  completion_criteria: "A visitor can complete the flow end to end.",
  depends_on: [],
  evidence_ids: ["live.surface.dashboard_app"],
  execution_support: "not_yet_supported",
  capability: null,
  requires_approval: true,
};

beforeEach(() => {
  db = new FakeDatabase();
  getHead.mockClear();
  getHead.mockResolvedValue({ defaultBranch: "main", commitSha: SNAPSHOT_SHA });
});

describe("isDogfoodEligibleProject (§26, §27)", () => {
  it("is false for an unlisted project", () => {
    expect(isDogfoodEligibleProject(PROJECT, {})).toBe(false);
  });

  it("is true only for an allowlisted project", () => {
    expect(isDogfoodEligibleProject(PROJECT, ALLOWLIST)).toBe(true);
    expect(isDogfoodEligibleProject("some-other-project", ALLOWLIST)).toBe(false);
  });
});

describe("previewDogfoodStep — the gate runs before anything else is read (§26, §27)", () => {
  it("refuses a project that is not on the allowlist without reading the database", async () => {
    // Nothing seeded at all. If the gate ran after a query, this would throw
    // on a missing table row instead of returning the refusal.
    const preview = await previewDogfoodStep(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      stepKey: "1-ship-it",
      env: {},
    });

    expect(preview).toEqual({ eligible: false, reason: "not_dogfood_eligible" });
  });
});

describe("previewDogfoodStep — the real chain (§7, §9)", () => {
  it("resolves a real agentic step and persists a spec", async () => {
    seedOwnedRepository();
    seedSuccessfulSnapshot();
    seedCompletedPlan([AGENTIC_STEP]);

    const preview = await previewDogfoodStep(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      stepKey: "1-ship-it",
      env: ALLOWLIST,
    });

    expect(preview.eligible).toBe(true);
    if (!preview.eligible) return;
    expect(preview.resolution.mode).toBe("agentic");
    expect(preview.preflight.passed).toBe(true);
    expect(preview.executionSpecId).toBeTruthy();
    expect(getHead).toHaveBeenCalledWith();

    // The persisted spec is a real row, findable by identity — not a value
    // invented in memory and handed to the caller.
    const rows = db.rows("execution_specs");
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(preview.executionSpecId);
    expect(rows[0].project_id).toBe(PROJECT);
  });

  it("returns the same spec id on a second call against unchanged state (idempotent)", async () => {
    seedOwnedRepository();
    seedSuccessfulSnapshot();
    seedCompletedPlan([AGENTIC_STEP]);

    const first = await previewDogfoodStep(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      stepKey: "1-ship-it",
      env: ALLOWLIST,
    });
    const second = await previewDogfoodStep(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      stepKey: "1-ship-it",
      env: ALLOWLIST,
    });

    expect(first.eligible && second.eligible).toBe(true);
    if (!first.eligible || !second.eligible) return;
    expect(second.executionSpecId).toBe(first.executionSpecId);
    expect(db.rows("execution_specs")).toHaveLength(1);
  });
});

describe("previewDogfoodStep — cross-project and cross-user isolation (§25, §53)", () => {
  it("refuses a step key belonging to another project's plan", async () => {
    seedOwnedRepository();
    seedSuccessfulSnapshot();
    seedCompletedPlan([AGENTIC_STEP]);
    // A second, unrelated project's own step, same key coincidence aside.
    db.seed("projects", { id: "project-2", user_id: USER });
    db.seed("action_plans", {
      id: "plan-2",
      project_id: "project-2",
      status: "completed",
      goal: "g",
      expected_outcome: "o",
      business_audit_id: "audit-2",
      opportunity_id: "move-2",
      assumptions: [],
    });
    db.seed("action_plan_steps", { action_plan_id: "plan-2", ...AGENTIC_STEP, step_key: "only-on-project-2" });

    const preview = await previewDogfoodStep(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      stepKey: "only-on-project-2",
      env: ALLOWLIST,
    });

    expect(preview).toEqual({ eligible: false, reason: "step_not_found" });
  });

  it("refuses when the repository connection belongs to a different user's installation", async () => {
    seedOwnedRepository();
    // Installation exists, but is owned by someone else.
    db.rows("github_installations")[0].user_id = OTHER_USER;
    seedSuccessfulSnapshot();
    seedCompletedPlan([AGENTIC_STEP]);

    const preview = await previewDogfoodStep(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      stepKey: "1-ship-it",
      env: ALLOWLIST,
    });

    expect(preview).toEqual({ eligible: false, reason: "repository_not_connected" });
  });
});

describe("previewDogfoodStep — honest refusals for missing prerequisites", () => {
  it("refuses when the project has no completed Action Plan", async () => {
    seedOwnedRepository();
    seedSuccessfulSnapshot();

    const preview = await previewDogfoodStep(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      stepKey: "anything",
      env: ALLOWLIST,
    });

    expect(preview).toEqual({ eligible: false, reason: "no_action_plan" });
  });

  it("refuses when no repository is connected", async () => {
    db.seed("projects", { id: PROJECT, user_id: USER });
    seedCompletedPlan([AGENTIC_STEP]);

    const preview = await previewDogfoodStep(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      stepKey: "1-ship-it",
      env: ALLOWLIST,
    });

    expect(preview).toEqual({ eligible: false, reason: "repository_not_connected" });
  });

  it("refuses when Vibe has never successfully read the repository", async () => {
    seedOwnedRepository();
    seedCompletedPlan([AGENTIC_STEP]);

    const preview = await previewDogfoodStep(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      stepKey: "1-ship-it",
      env: ALLOWLIST,
    });

    expect(preview).toEqual({ eligible: false, reason: "repository_snapshot_missing" });
  });

  it("does not crash when the live GitHub read fails — an unread HEAD refuses admission, not the request", async () => {
    seedOwnedRepository();
    seedSuccessfulSnapshot();
    seedCompletedPlan([AGENTIC_STEP]);
    getHead.mockRejectedValueOnce(new GithubDomainError("github_api_error"));

    const preview = await previewDogfoodStep(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      stepKey: "1-ship-it",
      env: ALLOWLIST,
    });

    expect(preview.eligible).toBe(false);
    if (preview.eligible) return;
    expect(preview.reason).toBe("preflight_refused");
    expect(preview.resolution?.admission).toEqual({
      admissible: false,
      refusal: "source_revision_unverified",
    });
  });
});

describe("previewDogfoodStep — non-agentic routes never produce a spec (§6)", () => {
  it("reports why, without building a spec, for a founder-decision step", async () => {
    seedOwnedRepository();
    seedSuccessfulSnapshot();
    seedCompletedPlan([
      { ...AGENTIC_STEP, actor: "founder_decision", change_kind: "decision", requires_approval: false },
    ]);

    const preview = await previewDogfoodStep(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      stepKey: "1-ship-it",
      env: ALLOWLIST,
    });

    expect(preview.eligible).toBe(false);
    if (preview.eligible) return;
    expect(preview.reason).toBe("not_agentic");
    expect(preview.resolution?.mode).toBe("needs_user_input");
    expect(db.rows("execution_specs")).toHaveLength(0);
  });

  it("reports why for a step blocked on an unfinished prerequisite", async () => {
    seedOwnedRepository();
    seedSuccessfulSnapshot();
    seedCompletedPlan([
      { ...AGENTIC_STEP, step_key: "1-decide", step_order: 1, actor: "founder_decision", change_kind: "decision" },
      { ...AGENTIC_STEP, step_key: "2-build", step_order: 2, depends_on: [1] },
    ]);

    const preview = await previewDogfoodStep(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      stepKey: "2-build",
      env: ALLOWLIST,
    });

    expect(preview.eligible).toBe(false);
    if (preview.eligible) return;
    expect(preview.reason).toBe("not_agentic");
    expect(preview.resolution?.mode).toBe("blocked");
    expect(db.rows("execution_specs")).toHaveLength(0);
  });
});

/**
 * The website reads the real resolver (semantics fix §37).
 *
 * No step id is named anywhere in this surface: eligibility is whatever
 * `resolveStepExecution` says about the step the URL points at. So the fix to
 * dependency semantics reaches the page for free, and this is the test that
 * says it did.
 */
/**
 * The index page's routing (the "waiting on an earlier step" defect).
 *
 * The list resolved every step against a repository context of all nulls, so
 * `classifyIntrinsic` could never reach `agentic` — every implementation step
 * read "waiting on an earlier step", and the link to the step page was
 * unreachable by construction. The surface was a list of refusals for a project
 * whose repository was connected, snapshotted and supported.
 *
 * These assert the list routes against what the project actually has.
 */
describe("resolveDogfoodPlanRoutes — the list routes against real repository state", () => {
  const PREPARATION = {
    ...AGENTIC_STEP,
    step_key: "1-work-out-the-approach",
    step_order: 1,
    actor: "vibe",
    change_kind: "analysis",
    depends_on: [],
    evidence_ids: ["live.seo.canonical_missing"],
    execution_support: "vibe_prepares",
    requires_approval: false,
  };
  const IMPLEMENTATION = { ...AGENTIC_STEP, step_key: "2-build", step_order: 2, depends_on: [1] };

  it("offers the implementation step, with the preparation named rather than blocking", async () => {
    seedOwnedRepository();
    seedSuccessfulSnapshot();
    seedCompletedPlan([PREPARATION, IMPLEMENTATION]);

    const routes = await resolveDogfoodPlanRoutes(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      env: ALLOWLIST,
    });

    expect(routes.available).toBe(true);
    if (!routes.available) return;

    const [preparation, implementation] = routes.resolutions;
    // Vibe's own thinking work: real, and still not a button.
    expect(preparation.mode).toBe("unsupported");
    // The regression, stated directly.
    expect(implementation.mode).toBe("agentic");
    expect(implementation.absorbedPreparation).toEqual([1]);
  });

  /**
   * The exact shape of the defect: with no repository loaded, an
   * agentic-eligible step cannot classify as agentic and its preparation
   * becomes a hard blocker again. Pinned so the page cannot quietly go back to
   * resolving against nulls.
   */
  it("says the repository is missing rather than inventing a route for one", async () => {
    seedCompletedPlan([PREPARATION, IMPLEMENTATION]);

    const routes = await resolveDogfoodPlanRoutes(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      env: ALLOWLIST,
    });

    expect(routes.available).toBe(true);
    if (!routes.available) return;

    const implementation = routes.resolutions[1];
    expect(implementation.mode).not.toBe("agentic");
    expect(implementation.absorbedPreparation).toEqual([]);
    // The real gap is still reported underneath the dependency block, so the
    // page can say something a founder can act on.
    expect(implementation.unmetRequirements).toContain("repository_not_connected");
    expect(implementation.unmetRequirements).toContain("repository_snapshot_missing");
  });

  it("refuses a project that is not on the allowlist, before reading a plan", async () => {
    seedOwnedRepository();
    seedSuccessfulSnapshot();
    seedCompletedPlan([PREPARATION, IMPLEMENTATION]);

    const routes = await resolveDogfoodPlanRoutes(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      env: {},
    });

    expect(routes).toEqual({ available: false, reason: "not_dogfood_eligible" });
  });

  it("reports an absent plan as its own state rather than an empty list", async () => {
    seedOwnedRepository();
    seedSuccessfulSnapshot();

    const routes = await resolveDogfoodPlanRoutes(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      env: ALLOWLIST,
    });

    expect(routes).toEqual({ available: false, reason: "no_action_plan" });
  });

  /**
   * The list must not reach GitHub. It renders classification, and admission —
   * the only thing a live HEAD answers — is the step page's job.
   */
  it("makes no live GitHub call", async () => {
    seedOwnedRepository();
    seedSuccessfulSnapshot();
    seedCompletedPlan([PREPARATION, IMPLEMENTATION]);

    await resolveDogfoodPlanRoutes(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      env: ALLOWLIST,
    });

    expect(getHead).not.toHaveBeenCalled();
  });
});

describe("previewDogfoodStep — Vibe's own preparation does not gate the click", () => {
  const PREPARATION_STEP = {
    ...AGENTIC_STEP,
    step_key: "1-work-out-the-approach",
    step_order: 1,
    title: "Work out the repository-consistent approach",
    actor: "vibe",
    change_kind: "analysis",
    depends_on: [],
    evidence_ids: ["live.seo.canonical_missing"],
    execution_support: "vibe_prepares",
    requires_approval: false,
  };

  it("resolves the implementation step and persists a spec carrying the preparation", async () => {
    seedOwnedRepository();
    seedSuccessfulSnapshot();
    seedCompletedPlan([
      PREPARATION_STEP,
      { ...AGENTIC_STEP, step_key: "2-build", step_order: 2, depends_on: [1] },
    ]);

    const preview = await previewDogfoodStep(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      stepKey: "2-build",
      env: ALLOWLIST,
    });

    expect(preview.eligible).toBe(true);
    if (!preview.eligible) return;
    expect(preview.resolution.mode).toBe("agentic");
    expect(preview.resolution.absorbedPreparation).toEqual([1]);

    // The persisted spec records the boundary that was compiled, so the run is
    // explainable later without re-resolving anything.
    const [spec] = db.rows("execution_specs");
    expect(spec).toBeDefined();
    expect((spec.spec as { objective: { preparation: unknown[] } }).objective.preparation).toEqual([
      {
        stepOrder: 1,
        stepKey: "1-work-out-the-approach",
        title: "Work out the repository-consistent approach",
        purpose: "So a visitor can complete the flow.",
        doneWhen: "A visitor can complete the flow end to end.",
      },
    ]);
  });

  /**
   * The preparation step itself is still not independently runnable. Being
   * absorbable is a statement about a *downstream* execution, never a claim
   * that a click exists for the preparation.
   */
  it("still refuses the preparation step on its own", async () => {
    seedOwnedRepository();
    seedSuccessfulSnapshot();
    seedCompletedPlan([
      PREPARATION_STEP,
      { ...AGENTIC_STEP, step_key: "2-build", step_order: 2, depends_on: [1] },
    ]);

    const preview = await previewDogfoodStep(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      stepKey: "1-work-out-the-approach",
      env: ALLOWLIST,
    });

    expect(preview.eligible).toBe(false);
    if (preview.eligible) return;
    expect(preview.resolution?.mode).toBe("unsupported");
    expect(preview.resolution?.reason).toBe("no_executor_for_vibe_work");
  });
});
