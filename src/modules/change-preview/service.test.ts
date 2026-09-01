import { beforeEach, describe, expect, it } from "vitest";
import { FakeDatabase, FakeExecutor, fakeSupabase } from "@/modules/operations/test-support";
import { fakeSandboxProvider } from "@/modules/validation/test-support";
import { PREVIEW_BUDGETS } from "./budgets";
import { computePreviewIdentity } from "./identity";
import {
  CURRENT_PREVIEW_PROFILE,
  PREVIEW_POLICY_VERSION,
  previewProfileVersionFor,
} from "./schema";
import {
  getPreviewCard,
  getPreviewStatus,
  startChangePreview,
  stopChangePreview,
} from "./service";
import { FIXTURE_COMMIT_SHA } from "./test-support";

/**
 * Authority, eligibility and lifecycle (Sprint 10B-2 §28, §29, §32, §33).
 *
 * Three families of test, and they are the three ways this goes wrong
 * expensively or dangerously:
 *
 *  - someone previewing an artifact that is not theirs;
 *  - one click buying two microVMs on two public URLs;
 *  - a preview URL that outlives the thing that authorized it.
 *
 * Every one of these asserts against a **fake sandbox provider that creates
 * nothing**, so a test that says "zero sandbox creation" is checking a counter
 * rather than reading the source.
 */

const USER = "user_1";
const OTHER_USER = "user_2";
const PROJECT = "project_1";
const OTHER_PROJECT = "project_2";
const PREPARED = "prepared_1";
const VALIDATION = "validation_1";

let db: FakeDatabase;
let executor: FakeExecutor;
let provider: ReturnType<typeof fakeSandboxProvider>;

const HOUR_AGO = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();

function identityFor(overrides: { commitSha?: string; policyVersion?: string } = {}) {
  return computePreviewIdentity({
    projectId: PROJECT,
    preparedChangeId: PREPARED,
    preparedCommitSha: overrides.commitSha ?? FIXTURE_COMMIT_SHA,
    previewProfile: CURRENT_PREVIEW_PROFILE,
    previewProfileVersion: previewProfileVersionFor(CURRENT_PREVIEW_PROFILE),
    previewPolicyVersion: overrides.policyVersion ?? PREVIEW_POLICY_VERSION,
  });
}

function seed(
  options: {
    preparedStatus?: string;
    commitSha?: string | null;
    projectId?: string;
    userId?: string;
    framework?: string;
  } = {},
) {
  db.seed("projects", { id: PROJECT, user_id: USER });
  db.seed("projects", { id: OTHER_PROJECT, user_id: OTHER_USER });

  db.seed("prepared_changes", {
    id: PREPARED,
    project_id: options.projectId ?? PROJECT,
    user_id: options.userId ?? USER,
    status: options.preparedStatus ?? "prepared",
    commit_sha: options.commitSha === undefined ? FIXTURE_COMMIT_SHA : options.commitSha,
    files: [{ path: "app/robots.ts", contentHash: "a".repeat(64), bytes: 408 }],
  });

  /*
   * The analyzer's snapshot is what says a preview is possible at all — the
   * same detection validation uses, not a second one (Sprint 0114).
   */
  db.seed("repository_intelligence_snapshots", {
    id: "snapshot_1",
    project_id: options.projectId ?? PROJECT,
    status: "completed",
    result: {
      frameworks: [{ id: options.framework ?? "nextjs", confidence: "high" }],
      packageManager: "pnpm",
      projectStructure: { monorepo: { detected: false, ambiguous: false } },
    },
    created_at: "2026-08-13T00:00:00.000Z",
  });
}

function start(
  params: {
    userId?: string;
    projectId?: string;
    preparedChangeId?: string;
    confirmPublicExposure?: boolean;
  } = {},
) {
  return startChangePreview(fakeSupabase(db), executor, {
    projectId: params.projectId ?? PROJECT,
    userId: params.userId ?? USER,
    preparedChangeId: params.preparedChangeId ?? PREPARED,
    confirmPublicExposure: params.confirmPublicExposure ?? true,
  });
}

beforeEach(() => {
  db = new FakeDatabase();
  executor = new FakeExecutor();
  provider = fakeSandboxProvider();
});

describe("the happy path", () => {
  it("starts one durable operation for a previewable artifact", async () => {
    seed();

    const outcome = await start();

    expect(outcome.kind).toBe("starting");
    expect(executor.starts).toHaveLength(1);
    expect(executor.starts[0].operationType).toBe("change_preview");
  });

  it("claims a session with the deadline already set", async () => {
    seed();

    await start();

    const session = db.rows("preview_sessions")[0];
    expect(session.status).toBe("starting");
    expect(session.port).toBe(PREVIEW_BUDGETS.port);

    // Persisted at claim time, before the sandbox exists. A TTL written after a
    // successful start would not bound a preview that started and then lost its
    // workflow (§18).
    const ttl = Date.parse(String(session.expires_at)) - Date.now();
    expect(ttl).toBeGreaterThan(PREVIEW_BUDGETS.ttlMs - 5000);
    expect(ttl).toBeLessThanOrEqual(PREVIEW_BUDGETS.ttlMs);
  });

  it("records the exact snapshot it will restore", async () => {
    seed();

    await start();

    expect(db.rows("preview_sessions")[0].prepared_commit_sha).toBe(FIXTURE_COMMIT_SHA);
  });

  it("creates no sandbox in the request that started it", async () => {
    seed();

    await start();

    // The browser request does not own preview startup (§21).
    expect(provider.createCount()).toBe(0);
  });
});

describe("authority", () => {
  it("refuses another user's project", async () => {
    seed();

    const outcome = await start({ userId: OTHER_USER });

    expect(outcome).toEqual({ kind: "failed", error: "project_not_found" });
    expect(executor.starts).toHaveLength(0);
    expect(provider.createCount()).toBe(0);
  });

  it("refuses a prepared change belonging to a different project", async () => {
    seed();
    db.seed("prepared_changes", {
      id: "prepared_other",
      project_id: OTHER_PROJECT,
      user_id: OTHER_USER,
      status: "prepared",
      commit_sha: FIXTURE_COMMIT_SHA,
      files: [],
    });

    // Named directly, with the caller's own project. Scoping is a query
    // predicate, so the other tenant's change is invisible rather than
    // forbidden — there is no code path that reads it and then decides.
    const outcome = await start({ preparedChangeId: "prepared_other" });

    expect(outcome).toEqual({ kind: "failed", error: "preview_change_not_prepared" });
    expect(db.rows("preview_sessions")).toHaveLength(0);
  });

  it("refuses a prepared change id that does not exist", async () => {
    seed();

    expect(await start({ preparedChangeId: "prepared_invented" })).toEqual({
      kind: "failed",
      error: "preview_change_not_prepared",
    });
  });

  it("accepts no parameter that could choose a snapshot, port, command or policy", async () => {
    seed();

    await start();

    const session = db.rows("preview_sessions")[0];
    // Everything consequential is server-resolved. The type of
    // `StartPreviewParams` is the real guarantee — these assertions record what
    // that type produces, so a widened parameter surface shows up here.
    expect(session.port).toBe(PREVIEW_BUDGETS.port);
    expect(session.preview_profile).toBe(CURRENT_PREVIEW_PROFILE);
    expect(session.preview_policy_version).toBe(PREVIEW_POLICY_VERSION);
    expect(session.provider).toBe("vercel_sandbox");
    expect(session.prepared_commit_sha).toBe(FIXTURE_COMMIT_SHA);
  });
});

describe("eligibility", () => {
  it("refuses without explicit public-exposure confirmation", async () => {
    seed();

    const outcome = await start({ confirmPublicExposure: false });

    expect(outcome).toEqual({ kind: "failed", error: "preview_exposure_not_confirmed" });
    // The requirement is load-bearing: no operation, no session, no spend (§8).
    expect(db.rows("operation_runs")).toHaveLength(0);
    expect(db.rows("preview_sessions")).toHaveLength(0);
    expect(provider.createCount()).toBe(0);
  });

  it("does not wait for a validation of any status", async () => {
    /*
     * The property this sprint exists to create, and the reason it is asserted
     * rather than described: a preview used to require a *passing* validation
     * with a live captured artifact, which is what made a person wait roughly
     * five minutes to look at code that was already written (ADR 0064).
     *
     * The fixture seeds no validation at all.
     */
    seed();

    const outcome = await start();

    expect(outcome).toMatchObject({ kind: "starting" });
    expect(db.rows("validation_runs")).toHaveLength(0);
  });

  it("refuses a change with no commit to serve", async () => {
    seed({ commitSha: null, preparedStatus: "preparing" });

    expect(await start()).toEqual({ kind: "failed", error: "preview_change_not_prepared" });
    expect(provider.createCount()).toBe(0);
    expect(db.rows("operation_runs")).toHaveLength(0);
  });

  it("refuses a repository whose framework has no preview profile", async () => {
    seed({ framework: "some_future_framework" });

    expect(await start()).toEqual({ kind: "failed", error: "preview_not_supported" });
    expect(provider.createCount()).toBe(0);
  });

  it("refuses a project with no analysis to resolve a profile from", async () => {
    seed();
    db.rows("repository_intelligence_snapshots").length = 0;

    expect(await start()).toEqual({ kind: "failed", error: "preview_not_supported" });
    expect(provider.createCount()).toBe(0);
  });
});

describe("idempotency", () => {
  it("reuses a live preview for the same identity", async () => {
    seed();
    db.seed("preview_sessions", {
      id: "preview_live",
      project_id: PROJECT,
      user_id: USER,
      prepared_change_id: PREPARED,
      validation_run_id: VALIDATION,
      operation_run_id: "operation_old",
      prepared_commit_sha: FIXTURE_COMMIT_SHA,
      preview_profile: CURRENT_PREVIEW_PROFILE,
      preview_identity: identityFor(),
      status: "running",
      port: PREVIEW_BUDGETS.port,
      expires_at: new Date(Date.now() + PREVIEW_BUDGETS.ttlMs).toISOString(),
    });

    const outcome = await start();

    expect(outcome).toMatchObject({ kind: "reused", previewSessionId: "preview_live" });
    expect(executor.starts).toHaveLength(0);
    expect(provider.createCount()).toBe(0);
  });

  it("does not reuse a live session whose deadline has passed", async () => {
    seed();
    db.seed("preview_sessions", {
      id: "preview_stale",
      project_id: PROJECT,
      user_id: USER,
      prepared_change_id: PREPARED,
      validation_run_id: VALIDATION,
      operation_run_id: "operation_old",
      prepared_commit_sha: FIXTURE_COMMIT_SHA,
      preview_profile: CURRENT_PREVIEW_PROFILE,
      preview_identity: identityFor(),
      status: "running",
      port: PREVIEW_BUDGETS.port,
      expires_at: HOUR_AGO(),
    });

    // The row still says `running` because nothing has looked at it yet. A
    // reuse based on the status alone would hand back a URL that is gone (§25).
    expect((await start()).kind).not.toBe("reused");
  });

  it("does not reuse a preview started under a different policy version", async () => {
    seed();
    db.seed("preview_sessions", {
      id: "preview_old_policy",
      project_id: PROJECT,
      user_id: USER,
      prepared_change_id: PREPARED,
      validation_run_id: VALIDATION,
      operation_run_id: "operation_old",
      prepared_commit_sha: FIXTURE_COMMIT_SHA,
      preview_profile: CURRENT_PREVIEW_PROFILE,
      preview_identity: identityFor({ policyVersion: "preview-policy-v0" }),
      status: "running",
      port: PREVIEW_BUDGETS.port,
      expires_at: new Date(Date.now() + PREVIEW_BUDGETS.ttlMs).toISOString(),
    });

    // A live session started under other rules is not an answer to a question
    // asked under these ones (§22).
    expect((await start()).kind).not.toBe("reused");
  });

  it("turns a double click into one operation and one session", async () => {
    seed();

    const [first, second] = await Promise.all([start(), start()]);

    // The partial unique index does the real work; the application check that
    // precedes it is a courtesy (§32).
    expect(db.rows("operation_runs")).toHaveLength(1);
    expect(db.rows("preview_sessions")).toHaveLength(1);
    expect(executor.starts).toHaveLength(1);
    expect([first.kind, second.kind].sort()).toEqual(["running", "starting"]);
  });

  it("points a second click at the session already starting", async () => {
    seed();
    await start();

    const again = await start();

    // `reused` rather than `running`: a `starting` session is already this
    // exact preview, and the caller gets its id plus its real status rather
    // than an operation view it would have to poll to learn the same thing.
    expect(again).toMatchObject({ kind: "reused", status: "starting" });
    expect(executor.starts).toHaveLength(1);
    expect(db.rows("preview_sessions")).toHaveLength(1);
  });
});

describe("reading a preview", () => {
  function seedRunning(expiresAt: string) {
    seed();
    db.seed("preview_sessions", {
      id: "preview_1",
      project_id: PROJECT,
      user_id: USER,
      prepared_change_id: PREPARED,
      validation_run_id: VALIDATION,
      operation_run_id: "operation_1",
      prepared_commit_sha: FIXTURE_COMMIT_SHA,
      preview_profile: CURRENT_PREVIEW_PROFILE,
      preview_identity: identityFor(),
      status: "running",
      stage: "completed",
      port: PREVIEW_BUDGETS.port,
      ready_at: new Date().toISOString(),
      expires_at: expiresAt,
      started_at: new Date().toISOString(),
      artifact_deleted_at: null,
    });
  }

  function read(params: { userId?: string; projectId?: string } = {}) {
    return getPreviewStatus(fakeSupabase(db), provider, executor, {
      projectId: params.projectId ?? PROJECT,
      userId: params.userId ?? USER,
      previewSessionId: "preview_1",
    });
  }

  it("returns a provider-derived origin for a live preview", async () => {
    seedRunning(new Date(Date.now() + PREVIEW_BUDGETS.ttlMs).toISOString());
    await provider.create({
      name: "vibe-preview-aaaaaaaabbbbccccdddd",
      source: { kind: "git", repositoryUrl: "https://github.com/acme/p.git", revision: FIXTURE_COMMIT_SHA, credential: null },
      networkPolicy: { mode: "deny_all" },
      ports: [PREVIEW_BUDGETS.port],
      timeoutMs: PREVIEW_BUDGETS.ttlMs,
      env: {},
    });

    const view = await read();

    expect(view?.origin).toBe(`https://sandbox-${PREVIEW_BUDGETS.port}.example.invalid`);
    expect(view?.verdict).toBe("preview_available");
  });

  it("never persists the origin", async () => {
    seedRunning(new Date(Date.now() + PREVIEW_BUDGETS.ttlMs).toISOString());

    await read();

    // Capability-like: an unlisted public URL to a VM serving untrusted code
    // must not exist in a durable, widely readable place (§16).
    const stored = JSON.stringify(db.rows("preview_sessions"));
    expect(stored).not.toContain("example.invalid");
    expect(stored).not.toContain("https://");
  });

  it("hides the origin from another user", async () => {
    seedRunning(new Date(Date.now() + PREVIEW_BUDGETS.ttlMs).toISOString());

    expect(await read({ userId: OTHER_USER })).toBeNull();
  });

  it("hides the session from a different project", async () => {
    seedRunning(new Date(Date.now() + PREVIEW_BUDGETS.ttlMs).toISOString());

    // The other project genuinely belongs to the other user, so this is the
    // "right session id, wrong project" case rather than a second ownership
    // check on the same tenant.
    expect(await read({ projectId: OTHER_PROJECT, userId: OTHER_USER })).toBeNull();
  });

  it("returns no origin for a session that is not running", async () => {
    // Every non-running status. Deleting the status gate from the origin read
    // survived the first mutation run, because the only coverage was in the
    // action tests against a mocked service — which cannot fail when the
    // service is what changed.
    for (const status of ["starting", "stopping", "stopped", "expired", "failed"] as const) {
      db = new FakeDatabase();
      provider = fakeSandboxProvider();
      seedRunning(new Date(Date.now() + PREVIEW_BUDGETS.ttlMs).toISOString());
      const session = db.rows("preview_sessions")[0];
      session.status = status;
      if (status !== "starting" && status !== "stopping") session.stopped_at = new Date().toISOString();
      if (status === "failed") session.failure_code = "preview_health_check_failed";

      const view = await read();

      expect(view?.status).toBe(status);
      expect(view?.origin).toBeNull();
      expect(view?.verdict).toBeNull();
      // And no provider call was made to find out.
      expect(provider.origins()).toEqual([]);
    }
  });

  it("returns no origin past the deadline, and hands it to teardown", async () => {
    seedRunning(HOUR_AGO());

    const view = await read();

    expect(view).toMatchObject({ status: "stopping", origin: null, verdict: null });
    expect(db.rows("preview_sessions")[0].status).toBe("stopping");
    // The reason is persisted by whoever noticed, not inferred later. A manual
    // stop seconds before the deadline would otherwise converge as an expiry.
    expect(db.rows("preview_sessions")[0].teardown_reason).toBe("expired");
  });

  it("performs no provider work in the request that noticed the expiry", async () => {
    seedRunning(HOUR_AGO());

    await read();

    // The read notices; the workflow acts. Doing it here is what left the first
    // real preview's spend unrecorded — a request has no privileged writer.
    expect(provider.deletedArtifacts()).toEqual([]);
    expect(provider.stopped()).toBe(false);
    expect(db.rows("sandbox_usage_events")).toHaveLength(0);
  });

  it("starts exactly one teardown however many times it is read", async () => {
    seedRunning(HOUR_AGO());

    await read();
    await read();
    await read();

    const teardowns = executor.starts.filter((s) => s.operationType === "preview_teardown");
    expect(teardowns).toHaveLength(1);
    expect(db.rows("operation_runs")).toHaveLength(1);
  });
});

describe("stopping a preview", () => {
  function seedRunning(overrides: Record<string, unknown> = {}) {
    seed();
    db.seed("preview_sessions", {
      id: "preview_1",
      project_id: PROJECT,
      user_id: USER,
      prepared_change_id: PREPARED,
      validation_run_id: VALIDATION,
      operation_run_id: "operation_1",
      prepared_commit_sha: FIXTURE_COMMIT_SHA,
      preview_profile: CURRENT_PREVIEW_PROFILE,
      preview_identity: identityFor(),
      status: "running",
      stage: "completed",
      port: PREVIEW_BUDGETS.port,
      ready_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + PREVIEW_BUDGETS.ttlMs).toISOString(),
      artifact_deleted_at: null,
      ...overrides,
    });
  }

  function stop(params: { userId?: string; projectId?: string } = {}) {
    return stopChangePreview(fakeSupabase(db), executor, {
      projectId: params.projectId ?? PROJECT,
      userId: params.userId ?? USER,
      previewSessionId: "preview_1",
    });
  }

  it("claims the session and hands the work to a durable teardown", async () => {
    seedRunning();

    const outcome = await stop();

    expect(outcome).toMatchObject({ kind: "stopping", previewSessionId: "preview_1" });
    expect(db.rows("preview_sessions")[0].status).toBe("stopping");
    expect(db.rows("preview_sessions")[0].teardown_reason).toBe("stopped");
    expect(executor.starts).toHaveLength(1);
    expect(executor.starts[0].operationType).toBe("preview_teardown");
  });

  it("touches no provider and writes no ledger row in the request", async () => {
    seedRunning();

    await stop();

    // The defect this design exists to prevent. `sandbox_usage_events` grants
    // SELECT only, so an inline stop's ledger insert was refused by RLS and
    // swallowed — the preview stopped and its spend was recorded nowhere.
    expect(provider.stopped()).toBe(false);
    expect(provider.deletedArtifacts()).toEqual([]);
    expect(db.rows("sandbox_usage_events")).toHaveLength(0);
  });

  it("refuses another user's preview", async () => {
    seedRunning();

    expect(await stop({ userId: OTHER_USER })).toEqual({
      kind: "failed",
      error: "project_not_found",
    });
    expect(executor.starts).toHaveLength(0);
    expect(db.rows("preview_sessions")[0].status).toBe("running");
  });

  it("starts one teardown when clicked twice", async () => {
    seedRunning();

    const first = await stop();
    const second = await stop();

    // The claim moves the session out of `running` in one conditional
    // statement, so the second call finds nothing left to claim.
    expect(first.kind).toBe("stopping");
    expect(second).toMatchObject({ kind: "already_stopped", status: "stopping" });
    expect(executor.starts).toHaveLength(1);
  });

  it("does not start a second teardown for an already terminal session", async () => {
    seedRunning({ status: "stopped", stopped_at: new Date().toISOString() });

    expect(await stop()).toMatchObject({ kind: "already_stopped", status: "stopped" });
    expect(executor.starts).toHaveLength(0);
  });

  it("leaves the PreparedChange historically intact", async () => {
    seedRunning();

    await stop();

    // Stopping a preview loses the running sandbox and nothing else. Rewriting
    // the past to tidy up would make "this change was prepared" untrue after
    // the fact (§20).
    expect(db.rows("prepared_changes")[0].status).toBe("prepared");
  });
});

describe("the preview card, and what reading it must never cost", () => {
  function card(overrides: { prepared?: boolean } = {}) {
    return getPreviewCard(fakeSupabase(db), {
      projectId: PROJECT,
      preparedChangeId: PREPARED,
      prepared: overrides.prepared ?? true,
      resolveFailureMessage: () => "safe copy",
    });
  }

  it("offers a start as soon as a commit exists", async () => {
    seed();

    expect((await card()).state).toBe("ready_to_start");
  });

  it("says there is nothing to preview when no commit exists", async () => {
    seed({ commitSha: null, preparedStatus: "preparing" });

    expect((await card({ prepared: false })).state).toBe("not_available");
  });


  it("starts nothing at all when there is nothing to preview", async () => {
    seed({ commitSha: null, preparedStatus: "preparing" });

    await card();

    // The regression this exists for (§22). A panel that "helpfully"
    // re-validated an expired artifact on render would spend the user's money
    // for looking at a page. Zero of everything, asserted rather than assumed.
    expect(db.rows("validation_runs").filter((row) => row.status === "running")).toHaveLength(0);
    expect(db.rows("preview_sessions")).toHaveLength(0);
    expect(db.rows("operation_runs")).toHaveLength(0);
    expect(executor.starts).toHaveLength(0);
    expect(provider.createCount()).toBe(0);
    expect(db.rows("sandbox_usage_events")).toHaveLength(0);
    expect(db.rows("ai_usage_events")).toHaveLength(0);
  });

  it("starts nothing after a failed preview either", async () => {
    seed();
    db.seed("preview_sessions", {
      id: "preview_failed",
      project_id: PROJECT,
      user_id: USER,
      prepared_change_id: PREPARED,
      validation_run_id: VALIDATION,
      operation_run_id: "operation_old",
      prepared_commit_sha: FIXTURE_COMMIT_SHA,
      preview_profile: CURRENT_PREVIEW_PROFILE,
      preview_identity: identityFor(),
      status: "failed",
      failure_code: "preview_health_check_failed",
      port: PREVIEW_BUDGETS.port,
      expires_at: HOUR_AGO(),
      stopped_at: HOUR_AGO(),
    });

    const result = await card();

    expect(result.state).toBe("failed");
    expect(result.failureMessage).toBe("safe copy");
    // A failure must never trigger a retry, a re-validation, a fresh scan, an
    // audit or an opportunity run on the user's behalf (§22).
    expect(executor.starts).toHaveLength(0);
    expect(provider.createCount()).toBe(0);
    expect(db.rows("ai_usage_events")).toHaveLength(0);
    expect(db.rows("business_readiness_audits")).toHaveLength(0);
    expect(db.rows("opportunity_sets")).toHaveLength(0);
  });

  it("shows a live session", async () => {
    seed();
    db.seed("preview_sessions", {
      id: "preview_live",
      project_id: PROJECT,
      user_id: USER,
      prepared_change_id: PREPARED,
      validation_run_id: VALIDATION,
      operation_run_id: "operation_old",
      prepared_commit_sha: FIXTURE_COMMIT_SHA,
      preview_profile: CURRENT_PREVIEW_PROFILE,
      preview_identity: identityFor(),
      status: "running",
      stage: "completed",
      port: PREVIEW_BUDGETS.port,
      ready_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + PREVIEW_BUDGETS.ttlMs).toISOString(),
    });

    // The artifact is deleted at teardown, so a running preview whose artifact
    // is gone is the normal case rather than an inconsistency.
    expect((await card()).state).toBe("running");
  });

  it("never returns another project's preview", async () => {
    seed();
    db.seed("preview_sessions", {
      id: "preview_other",
      project_id: OTHER_PROJECT,
      user_id: OTHER_USER,
      prepared_change_id: PREPARED,
      validation_run_id: VALIDATION,
      operation_run_id: "operation_other",
      artifact_snapshot_id: "snap_someone_else",
      preview_profile: CURRENT_PREVIEW_PROFILE,
      preview_identity: identityFor(),
      status: "running",
      stage: "completed",
      port: PREVIEW_BUDGETS.port,
      ready_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + PREVIEW_BUDGETS.ttlMs).toISOString(),
    });

    const result = await card();

    expect(result.state).toBe("ready_to_start");
    expect(result.previewSessionId).toBeNull();
  });
});
