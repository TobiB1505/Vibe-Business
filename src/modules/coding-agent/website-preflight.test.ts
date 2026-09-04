import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDatabase, fakeSupabase } from "@/modules/operations/test-support";
import { fakeSnapshot } from "@/modules/execution-contract/test-support";
import { fakeLiveSnapshot } from "@/modules/business-audit/test-support";

const getHead = vi.fn(async () => ({ defaultBranch: "main", commitSha: SNAPSHOT_SHA }));
const createGithubRepositoryReader = vi.fn(() => ({ getHead }));
vi.mock("@/modules/github/repository-reader", () => ({ createGithubRepositoryReader }));

const {
  previewAgentStep,
  resolveAgentPlanRoutes,
  resolveRouteAgentEconomics,
} = await import("./website-preflight");
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

/**
 * The allowlist is gone, and every test below passes `env: {}` because of it
 * (ADR 0092).
 *
 * There used to be a gate here: `isDogfoodEligibleProject` refused any project
 * not named in `VIBE_INTERNAL_AGENT_DOGFOOD_PROJECT_IDS` before a single row
 * was read, and every test in this file had to hand it an allowlist to get
 * past. So the whole rest of the file is now the proof that a project nobody
 * named reaches the real chain, builds a real spec, and is refused only by the
 * things that are genuinely about this project's own state.
 */
describe("previewAgentStep — nothing in the environment decides who may start", () => {
  it("answers a project nobody named with its own first missing prerequisite", async () => {
    // Nothing seeded. Under the allowlist this returned `not_dogfood_eligible`
    // before touching the database; the honest answer is that there is no plan.
    const preview = await previewAgentStep(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      stepKey: "1-ship-it",
      env: {},
    });

    expect(preview).toEqual({ eligible: false, reason: "no_action_plan" });
  });

  /**
   * A benchmark fixture is no longer reachable through the start path.
   *
   * It used to be: a namespaced step key resolved against Vibe's own fixture
   * registry, which was safe only because the allowlist stood in front of it.
   * Without that, the branch would let any customer start a Vibe-authored task
   * against their repository — and pay for it — by typing a key their plan does
   * not contain.
   */
  it("treats a benchmark fixture key as a step this plan does not have", async () => {
    seedOwnedRepository();
    seedSuccessfulSnapshot();
    seedCompletedPlan([AGENTIC_STEP]);

    const preview = await previewAgentStep(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      stepKey: "dogfood-fixture--low-ui-primary-cta",
      env: {},
    });

    expect(preview).toEqual({ eligible: false, reason: "step_not_found" });
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
describe("previewAgentStep — the real chain", () => {
  it("resolves a real agentic step and builds its instruction package", async () => {
    seedOwnedRepository();
    seedSuccessfulSnapshot();
    seedCompletedPlan([AGENTIC_STEP]);

    const preview = await previewAgentStep(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      stepKey: "1-ship-it",
      env: {},
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

    await previewAgentStep(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      stepKey: "1-ship-it",
      env: {},
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
      previewAgentStep(fakeSupabase(db), {
        projectId: PROJECT,
        userId: USER,
        stepKey: "1-ship-it",
        env: {},
      });

    const first = await call();
    const second = await call();

    expect(first.eligible && second.eligible).toBe(true);
    if (!first.eligible || !second.eligible) return;
    expect(second.spec.identity).toBe(first.spec.identity);
  });

  it("uses a resolved founder decision as dependency evidence and execution context", async () => {
    seedOwnedRepository();
    seedSuccessfulSnapshot();
    seedCompletedPlan([
      {
        ...AGENTIC_STEP,
        step_key: "1-choose-model",
        step_order: 1,
        actor: "founder_decision",
        change_kind: "decision",
        execution_support: "founder_decides",
        requires_approval: false,
        founder_input_requirement: {
          kind: "decision",
          subjectKey: "monetization.pricing_model",
          question: "Which pricing model should the product use?",
          whyNeeded: "The pricing implementation needs one confirmed model.",
          responseType: "single_select",
          recommendation: null,
          alternatives: [],
          allowCustom: true,
        },
      },
      { ...AGENTIC_STEP, step_key: "2-build", step_order: 2, depends_on: [1] },
    ]);
    db.seed("project_founder_resolutions", {
      id: "resolution-1",
      project_id: PROJECT,
      request_id: "request-1",
      input_kind: "decision",
      subject_key: "monetization.pricing_model",
      response_source: "option",
      selected_option_id: "freemium",
      raw_answer: null,
      resolved_statement: "Use a freemium pricing model.",
      context_hash: "a".repeat(64),
      supersedes_resolution_id: null,
      superseded_at: null,
      created_at: "2026-08-25T00:00:00.000Z",
    });

    const preview = await previewAgentStep(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      stepKey: "2-build",
      env: {},
    });

    expect(preview.eligible).toBe(true);
    if (!preview.eligible) return;
    expect(preview.resolution.mode).toBe("agentic");
    expect(preview.spec.businessContext.approvedDecisions).toEqual([
      {
        key: "decision:monetization.pricing_model",
        stepOrder: 1,
        decision: "Use a freemium pricing model.",
      },
    ]);
  });

  it("puts a runtime resolution into a fresh immutable spec even when no plan step owns it", async () => {
    seedOwnedRepository();
    seedSuccessfulSnapshot();
    seedCompletedPlan([AGENTIC_STEP]);

    const before = await previewAgentStep(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      stepKey: "1-ship-it",
      env: {},
    });
    expect(before.eligible).toBe(true);
    if (!before.eligible) return;

    db.seed("project_founder_resolutions", {
      id: "resolution-runtime-1",
      project_id: PROJECT,
      request_id: "request-runtime-1",
      input_kind: "decision",
      subject_key: "runtime.1-ship-it.0123456789abcdef01234567",
      response_source: "custom",
      selected_option_id: null,
      raw_answer: "Invite existing customers first.",
      resolved_statement: "Invite existing customers first.",
      context_hash: before.spec.identity,
      supersedes_resolution_id: null,
      superseded_at: null,
      created_at: "2026-08-25T00:00:00.000Z",
    });

    const after = await previewAgentStep(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      stepKey: "1-ship-it",
      env: {},
    });
    expect(after.eligible).toBe(true);
    if (!after.eligible) return;

    expect(after.spec.businessContext.approvedDecisions).toContainEqual({
      key: "decision:runtime.1-ship-it.0123456789abcdef01234567",
      stepOrder: null,
      decision: "Invite existing customers first.",
    });
    expect(after.spec.identity).not.toBe(before.spec.identity);
  });
});

describe("previewAgentStep — cross-project and cross-user isolation (§25, §53)", () => {
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

    const preview = await previewAgentStep(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      stepKey: "only-on-project-2",
      env: {},
    });

    expect(preview).toEqual({ eligible: false, reason: "step_not_found" });
  });

  it("refuses when the repository connection belongs to a different user's installation", async () => {
    seedOwnedRepository();
    // Installation exists, but is owned by someone else.
    db.rows("github_installations")[0].user_id = OTHER_USER;
    seedSuccessfulSnapshot();
    seedCompletedPlan([AGENTIC_STEP]);

    const preview = await previewAgentStep(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      stepKey: "1-ship-it",
      env: {},
    });

    expect(preview).toEqual({ eligible: false, reason: "repository_not_connected" });
  });
});

describe("previewAgentStep — honest refusals for missing prerequisites", () => {
  it("refuses when the project has no completed Action Plan", async () => {
    seedOwnedRepository();
    seedSuccessfulSnapshot();

    const preview = await previewAgentStep(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      stepKey: "anything",
      env: {},
    });

    expect(preview).toEqual({ eligible: false, reason: "no_action_plan" });
  });

  it("refuses when no repository is connected", async () => {
    db.seed("projects", { id: PROJECT, user_id: USER });
    seedCompletedPlan([AGENTIC_STEP]);

    const preview = await previewAgentStep(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      stepKey: "1-ship-it",
      env: {},
    });

    expect(preview).toEqual({ eligible: false, reason: "repository_not_connected" });
  });

  it("refuses when Vibe has never successfully read the repository", async () => {
    seedOwnedRepository();
    seedCompletedPlan([AGENTIC_STEP]);

    const preview = await previewAgentStep(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      stepKey: "1-ship-it",
      env: {},
    });

    expect(preview).toEqual({ eligible: false, reason: "repository_snapshot_missing" });
  });

  it("does not crash when the live GitHub read fails — an unread HEAD refuses admission, not the request", async () => {
    seedOwnedRepository();
    seedSuccessfulSnapshot();
    seedCompletedPlan([AGENTIC_STEP]);
    getHead.mockRejectedValueOnce(new GithubDomainError("github_api_error"));

    const preview = await previewAgentStep(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      stepKey: "1-ship-it",
      env: {},
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

describe("previewAgentStep — non-agentic routes never produce a spec (§6)", () => {
  it("reports why, without building a spec, for a founder-decision step", async () => {
    seedOwnedRepository();
    seedSuccessfulSnapshot();
    seedCompletedPlan([
      { ...AGENTIC_STEP, actor: "founder_decision", change_kind: "decision", requires_approval: false },
    ]);

    const preview = await previewAgentStep(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      stepKey: "1-ship-it",
      env: {},
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

    const preview = await previewAgentStep(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      stepKey: "2-build",
      env: {},
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
describe("resolveAgentPlanRoutes — the list routes against real repository state", () => {
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

    const routes = await resolveAgentPlanRoutes(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      env: {},
    });

    expect(routes.available).toBe(true);
    if (!routes.available) return;

    const [preparation, implementation] = routes.resolutions;
    // Vibe's own thinking work: real, and still not a button.
    expect(preparation.mode).toBe("unsupported");
    // The regression, stated directly.
    expect(implementation.mode).toBe("agentic");
    expect(implementation.absorbedPreparation).toEqual([1]);
    /*
     * The ceiling belongs to the step, not to the plan (launch-v1).
     *
     * This used to assert one plan-wide `routes.economics`. `launch-v1` prices
     * an agent improvement by execution pricing class, and the class reads this
     * step's own risk class — so the route set can no longer answer it, and the
     * screen resolves it for the step it is actually offering.
     */
    const economics = resolveRouteAgentEconomics({
      projectId: PROJECT,
      members: [routes.plan.steps[1]],
      headRiskClass: implementation.riskClass,
      env: {},
    });
    expect(economics?.budget.maxCredits).toBeGreaterThan(0);
  });

  it("offers dependent execution after the founder-owned requirement is resolved", async () => {
    seedOwnedRepository();
    seedSuccessfulSnapshot();
    seedCompletedPlan([
      {
        ...AGENTIC_STEP,
        step_key: "1-choose-model",
        step_order: 1,
        actor: "founder_decision",
        change_kind: "decision",
        execution_support: "founder_decides",
        requires_approval: false,
        founder_input_requirement: {
          kind: "decision",
          subjectKey: "monetization.pricing_model",
          question: "Which pricing model should the product use?",
          whyNeeded: "The pricing implementation needs one confirmed model.",
          responseType: "single_select",
          recommendation: null,
          alternatives: [],
          allowCustom: true,
        },
      },
      { ...IMPLEMENTATION, depends_on: [1] },
    ]);
    db.seed("project_founder_resolutions", {
      id: "resolution-route-1",
      project_id: PROJECT,
      request_id: "request-route-1",
      input_kind: "decision",
      subject_key: "monetization.pricing_model",
      response_source: "option",
      selected_option_id: "freemium",
      raw_answer: null,
      resolved_statement: "Use a freemium pricing model.",
      context_hash: "a".repeat(64),
      supersedes_resolution_id: null,
      superseded_at: null,
      created_at: "2026-08-25T00:00:00.000Z",
    });

    const routes = await resolveAgentPlanRoutes(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      env: {},
    });

    expect(routes.available).toBe(true);
    if (!routes.available) return;
    expect(routes.resolutions[1].mode).toBe("agentic");
    expect(routes.resolutions[1].blockedBy).toEqual([]);
  });

  /**
   * The exact shape of the defect: with no repository loaded, an
   * agentic-eligible step cannot classify as agentic and its preparation
   * becomes a hard blocker again. Pinned so the page cannot quietly go back to
   * resolving against nulls.
   */
  it("says the repository is missing rather than inventing a route for one", async () => {
    seedCompletedPlan([PREPARATION, IMPLEMENTATION]);

    const routes = await resolveAgentPlanRoutes(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      env: {},
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

  it("reports an absent plan as its own state rather than an empty list", async () => {
    seedOwnedRepository();
    seedSuccessfulSnapshot();

    const routes = await resolveAgentPlanRoutes(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      env: {},
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

    await resolveAgentPlanRoutes(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      env: {},
    });

    expect(getHead).not.toHaveBeenCalled();
  });
});

describe("previewAgentStep — Vibe's own preparation does not gate the click", () => {
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

    const preview = await previewAgentStep(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      stepKey: "2-build",
      env: {},
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

    const preview = await previewAgentStep(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      stepKey: "1-work-out-the-approach",
      env: {},
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
describe("previewAgentStep — a fixed defect does not buy a run", () => {
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

    const preview = await previewAgentStep(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      stepKey: "1-ship-it",
      env: {},
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

    const preview = await previewAgentStep(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      stepKey: "1-ship-it",
      env: {},
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

    const preview = await previewAgentStep(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      stepKey: "1-ship-it",
      env: {},
    });

    expect(preview.eligible).toBe(false);
    if (preview.eligible) return;
    expect(preview.resolution?.admission).toEqual({
      admissible: false,
      refusal: "live_premise_unverified",
    });
  });
});

/**
 * The successor that never came up.
 *
 * On the founder's own plan, step 2 ("Build a public pricing page") ran,
 * verified and validated, and step 3 ("Make the pricing page reachable")
 * depends on it. Step 3 was permanently unstartable, and the screen said an
 * earlier step had to finish first.
 *
 * Two independent causes, both here:
 *
 *  1. the router asked only for founder resolutions, so no amount of agent
 *     evidence could satisfy a dependency;
 *  2. `completedByAgentExecution` required `isExecutableByVibe`, which is false
 *     for every agent-built step by construction — the agentic route is the one
 *     with no registry capability.
 *
 * This suite is the regression test for both, driven end to end through the
 * real store reads rather than through either projection in isolation.
 */
describe("a build step whose prerequisite is another build step", () => {
  /** Step 2 ran, verified and validated. Whether it merged is the variable. */
  function seedDeliveredPredecessor(options: { merged: boolean }) {
    db.seed("execution_specs", {
      id: "spec-2",
      project_id: PROJECT,
      action_plan_id: "plan-1",
      step_key: "2-build",
      step_order: 2,
    });
    db.seed("agent_execution_runs", {
      id: "run-2",
      project_id: PROJECT,
      execution_spec_id: "spec-2",
      execution_origin: "planner",
      status: "succeeded",
      prepared_change_id: "change-2",
    });
    db.seed("agent_execution_events", {
      id: "event-2",
      project_id: PROJECT,
      agent_execution_run_id: "run-2",
      type: "change_verified",
    });
    db.seed("validation_runs", {
      id: "validation-2",
      project_id: PROJECT,
      prepared_change_id: "change-2",
      status: "passed",
      source_integrity: { changedFilesVerified: true },
    });

    if (options.merged) {
      db.seed("change_merges", {
        id: "merge-2",
        project_id: PROJECT,
        prepared_change_id: "change-2",
        status: "merged",
        created_at: "2026-08-26T00:00:00.000Z",
      });
    }
  }

  function seedTwoBuildSteps() {
    seedOwnedRepository();
    seedSuccessfulSnapshot();
    seedCompletedPlan([
      { ...AGENTIC_STEP, step_key: "2-build", step_order: 2 },
      { ...AGENTIC_STEP, step_key: "3-link", step_order: 3, depends_on: [2] },
    ]);
  }

  it("offers the successor once the earlier build is on the default branch", async () => {
    seedTwoBuildSteps();
    seedDeliveredPredecessor({ merged: true });

    const preview = await previewAgentStep(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      stepKey: "3-link",
      env: {},
    });

    expect(preview.eligible).toBe(true);
    if (!preview.eligible) return;
    expect(preview.resolution.mode).toBe("agentic");
    expect(preview.resolution.blockedBy).toEqual([]);
  });

  /*
   * The narrower question the router asks. A run is prepared against the
   * default branch, so starting the successor here would hand the agent a tree
   * without the page it is supposed to link to.
   */
  it("still blocks it while that change waits on a branch", async () => {
    seedTwoBuildSteps();
    seedDeliveredPredecessor({ merged: false });

    const preview = await previewAgentStep(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      stepKey: "3-link",
      env: {},
    });

    expect(preview.eligible).toBe(false);
    if (preview.eligible) return;
    expect(preview.reason).toBe("not_agentic");
  });

  it("blocks it when the earlier build never ran at all", async () => {
    seedTwoBuildSteps();

    const preview = await previewAgentStep(fakeSupabase(db), {
      projectId: PROJECT,
      userId: USER,
      stepKey: "3-link",
      env: {},
    });

    expect(preview.eligible).toBe(false);
  });
});
