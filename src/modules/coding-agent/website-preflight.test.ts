import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDatabase, fakeSupabase } from "@/modules/operations/test-support";
import { fakeSnapshot } from "@/modules/execution-contract/test-support";
import { fakeLiveSnapshot } from "@/modules/business-audit/test-support";

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

/**
 * A live observation taken *after* the plan, still finding the cited defect.
 *
 * The steps here cite `live.*` evidence, and a step citing a live defect for a
 * project Vibe has never looked at is not a state the product can produce — so
 * the fixture was describing an impossible world. Seeding the observation makes
 * these tests represent a real one, and makes them additionally prove the
 * live-premise check passes when the premise genuinely holds.
 *
 * Completed a day after the plan, so it is the informative case that needs no
 * fresh crawl. `fakeLiveSnapshot` mints `canonical: present: false`, which is
 * exactly the `live.seo.canonical_missing` these steps cite.
 */
function seedLiveSnapshot(overrides: Record<string, unknown> = {}) {
  db.seed("live_product_intelligence_snapshots", {
    id: "live-1",
    project_id: PROJECT,
    status: "completed",
    source_origin: "https://example.com",
    configured_url: "https://example.com",
    analyzer_version: "live_product_intelligence.v1",
    completeness: "complete",
    completeness_reasons: [],
    failure_code: null,
    result: fakeLiveSnapshot(),
    created_at: "2026-08-19T00:00:00.000Z",
    completed_at: "2026-08-19T00:00:01.000Z",
    ...overrides,
  });
}

function seedCompletedPlan(steps: Record<string, unknown>[]) {
  seedLiveSnapshot();
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

/**
 * The preview is a read (§7, §9).
 *
 * These two tests used to assert the opposite — that a preview persisted a spec
 * row and returned its id — and they passed while the behaviour they described
 * had **never once worked in production**. `execution_specs` has a select policy
 * and deliberately no insert policy, so the caller's cookie-scoped client was
 * refused every time; `FakeDatabase` models no RLS, so the write "succeeded"
 * here and nowhere else.
 *
 * That is the lesson worth keeping: a fake that is more permissive than the
 * real database can only prove that code runs, never that it is allowed to.
 * The behaviour is now what it should always have been — building is a read,
 * and only a click writes.
 */
describe("previewDogfoodStep — the real chain", () => {
  it("resolves a real agentic step and builds its instruction package", async () => {
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
    expect(preview.spec.identity).toBeTruthy();
    expect(preview.spec.projectId).toBe(PROJECT);
    expect(preview.repositoryConnectionId).toBeTruthy();
    // Live HEAD is read for real: this is the one thing the dev probe cannot do.
    expect(getHead).toHaveBeenCalledWith();
  });

  it("writes nothing — rendering a page mints no immutable row", async () => {
    seedOwnedRepository();
    seedSuccessfulSnapshot();
    seedCompletedPlan([AGENTIC_STEP]);

    await previewDogfoodStep(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      stepKey: "1-ship-it",
      env: ALLOWLIST,
    });

    expect(db.rows("execution_specs")).toHaveLength(0);
    expect(db.rows("audit_events")).toHaveLength(0);
  });

  /**
   * Identity, not a row id, is what makes a second look at the same step the
   * same job — which is exactly why the start path can persist late and still
   * be idempotent.
   */
  it("builds a byte-identical spec identity on a second call against unchanged state", async () => {
    seedOwnedRepository();
    seedSuccessfulSnapshot();
    seedCompletedPlan([AGENTIC_STEP]);

    const call = () =>
      previewDogfoodStep(fakeSupabase(db), {
        projectId: PROJECT,
        userId: USER,
        stepKey: "1-ship-it",
        env: ALLOWLIST,
      });

    const first = await call();
    const second = await call();

    expect(first.eligible && second.eligible).toBe(true);
    if (!first.eligible || !second.eligible) return;
    expect(second.spec.identity).toBe(first.spec.identity);
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

  it("resolves the implementation step and builds a spec carrying the preparation", async () => {
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

    // The spec records the boundary that was compiled, so a run started from it
    // is explainable later without re-resolving anything.
    expect(preview.spec.objective.preparation).toEqual([
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

/**
 * The live premise, rechecked before the money (Rule 55).
 *
 * Three of five dogfood calibration fixtures cited a `live.seo.*` defect that
 * had been fixed between the audit and the run. All three reached the agent,
 * which read the files, correctly found nothing to do, and failed with
 * `agent_produced_no_change` — a paid run that could not have produced
 * anything. `docs/business/calibration/README.md` records it.
 *
 * These tests are that failure at the gate that spends: the refusal has to
 * land in the preview, before `startAgentExecution` is ever reached.
 */
describe("previewDogfoodStep — a fixed defect does not buy a run", () => {
  /** Cites a defect the seeded live snapshot still finds. */
  const CITES_CANONICAL = {
    ...AGENTIC_STEP,
    evidence_ids: ["live.seo.canonical_missing"],
  };

  it("refuses when the cited defect is gone from a complete scan", async () => {
    seedOwnedRepository();
    seedSuccessfulSnapshot();
    seedCompletedPlan([CITES_CANONICAL]);
    // The observation that postdates the plan no longer finds it: the site
    // grew a canonical tag, so the id is not minted at all any more.
    db.rows("live_product_intelligence_snapshots")[0].result = fakeLiveSnapshot({
      seoSignals: [
        { id: "title", name: "Title", present: true, evidence: [] },
        { id: "canonical", name: "Canonical URL", present: true, evidence: [] },
      ],
    });

    const preview = await previewDogfoodStep(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      stepKey: "1-ship-it",
      env: ALLOWLIST,
    });

    expect(preview.eligible).toBe(false);
    if (preview.eligible) return;
    expect(preview.resolution?.admission).toEqual({
      admissible: false,
      refusal: "live_premise_no_longer_true",
    });
  });

  it("allows the run when the cited defect is still there", async () => {
    // The control, so the refusal above cannot be satisfied by a change that
    // simply stopped admitting anything.
    seedOwnedRepository();
    seedSuccessfulSnapshot();
    seedCompletedPlan([CITES_CANONICAL]);

    const preview = await previewDogfoodStep(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      stepKey: "1-ship-it",
      env: ALLOWLIST,
    });

    expect(preview.eligible).toBe(true);
    if (!preview.eligible) return;
    expect(preview.resolution.admission).toEqual({ admissible: true });
  });

  /**
   * A budget-degraded crawl (Rule 39) that did not reach the cited surface
   * says nothing about whether the defect is fixed. Unobserved must never read
   * as fine — the same posture an unread repository HEAD already has.
   */
  it("refuses rather than guessing when the scan came back partial", async () => {
    seedOwnedRepository();
    seedSuccessfulSnapshot();
    seedCompletedPlan([CITES_CANONICAL]);
    const snapshot = db.rows("live_product_intelligence_snapshots")[0];
    snapshot.completeness = "partial";
    snapshot.result = fakeLiveSnapshot({
      seoSignals: [{ id: "title", name: "Title", present: true, evidence: [] }],
    });

    const preview = await previewDogfoodStep(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      stepKey: "1-ship-it",
      env: ALLOWLIST,
    });

    expect(preview.eligible).toBe(false);
    if (preview.eligible) return;
    expect(preview.resolution?.admission).toEqual({
      admissible: false,
      refusal: "live_premise_unverified",
    });
  });
});
