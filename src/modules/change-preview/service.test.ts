import { beforeEach, describe, expect, it } from "vitest";
import { FakeDatabase, FakeExecutor, fakeSupabase } from "@/modules/operations/test-support";
import { fakeSandboxProvider } from "@/modules/validation/test-support";
import { PREVIEW_BUDGETS } from "./budgets";
import { computePreviewIdentity } from "./identity";
import { PREVIEW_POLICY_VERSION, previewProfileVersionFor } from "./schema";
import {
  getPreviewCard,
  getPreviewStatus,
  startChangePreview,
  stopChangePreview,
} from "./service";
import { FIXTURE_COMMIT_SHA, PREVIEW_SNAPSHOT_ID } from "./test-support";

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

const HOUR_FROM_NOW = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();
const HOUR_AGO = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();

function identityFor(
  overrides: { snapshotId?: string; policyVersion?: string; validationRunId?: string } = {},
) {
  return computePreviewIdentity({
    projectId: PROJECT,
    preparedChangeId: PREPARED,
    validationRunId: overrides.validationRunId ?? VALIDATION,
    artifactSnapshotId: overrides.snapshotId ?? PREVIEW_SNAPSHOT_ID,
    preparedCommitSha: FIXTURE_COMMIT_SHA,
    previewProfile: "nextjs_preview_v1",
    previewProfileVersion: previewProfileVersionFor("nextjs_preview_v1"),
    previewPolicyVersion: overrides.policyVersion ?? PREVIEW_POLICY_VERSION,
  });
}

function seed(
  options: {
    validationStatus?: string;
    snapshotId?: string | null;
    artifactExpiresAt?: string | null;
    artifactDeletedAt?: string | null;
    projectId?: string;
    userId?: string;
    validationRunId?: string;
  } = {},
) {
  db.seed("projects", { id: PROJECT, user_id: USER });
  db.seed("projects", { id: OTHER_PROJECT, user_id: OTHER_USER });

  db.seed("prepared_changes", {
    id: PREPARED,
    project_id: options.projectId ?? PROJECT,
    user_id: options.userId ?? USER,
    status: "prepared",
    commit_sha: FIXTURE_COMMIT_SHA,
    files: [{ path: "app/robots.ts", contentHash: "a".repeat(64), bytes: 408 }],
  });

  db.seed("validation_runs", {
    id: options.validationRunId ?? VALIDATION,
    project_id: options.projectId ?? PROJECT,
    user_id: options.userId ?? USER,
    prepared_change_id: PREPARED,
    validation_profile: "nextjs_node_v1",
    prepared_commit_sha: FIXTURE_COMMIT_SHA,
    status: options.validationStatus ?? "passed",
    artifact_snapshot_id:
      options.snapshotId === undefined ? PREVIEW_SNAPSHOT_ID : options.snapshotId,
    artifact_expires_at:
      options.artifactExpiresAt === undefined ? HOUR_FROM_NOW() : options.artifactExpiresAt,
    artifact_deleted_at: options.artifactDeletedAt ?? null,
  });
}

function start(
  params: {
    userId?: string;
    projectId?: string;
    validatedArtifactId?: string;
    confirmPublicExposure?: boolean;
  } = {},
) {
  return startChangePreview(fakeSupabase(db), executor, {
    projectId: params.projectId ?? PROJECT,
    userId: params.userId ?? USER,
    validatedArtifactId: params.validatedArtifactId ?? VALIDATION,
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

    expect(db.rows("preview_sessions")[0].artifact_snapshot_id).toBe(PREVIEW_SNAPSHOT_ID);
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

  it("refuses an artifact belonging to a different project", async () => {
    seed();
    db.seed("validation_runs", {
      id: "validation_other",
      project_id: OTHER_PROJECT,
      user_id: OTHER_USER,
      prepared_change_id: "prepared_other",
      validation_profile: "nextjs_node_v1",
      prepared_commit_sha: FIXTURE_COMMIT_SHA,
      status: "passed",
      artifact_snapshot_id: "snap_someone_else",
      artifact_expires_at: HOUR_FROM_NOW(),
    });

    // Named directly, with the caller's own project. Scoping is a query
    // predicate, so the other tenant's artifact is invisible rather than
    // forbidden — there is no code path that reads it and then decides.
    const outcome = await start({ validatedArtifactId: "validation_other" });

    expect(outcome).toEqual({ kind: "failed", error: "preview_artifact_unavailable" });
    expect(db.rows("preview_sessions")).toHaveLength(0);
  });

  it("refuses an artifact id that does not exist", async () => {
    seed();

    expect(await start({ validatedArtifactId: "validation_invented" })).toEqual({
      kind: "failed",
      error: "preview_artifact_unavailable",
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
    expect(session.preview_profile).toBe("nextjs_preview_v1");
    expect(session.preview_policy_version).toBe(PREVIEW_POLICY_VERSION);
    expect(session.provider).toBe("vercel_sandbox");
    expect(session.artifact_snapshot_id).toBe(PREVIEW_SNAPSHOT_ID);
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

  it("refuses when the validation did not pass, even with a snapshot present", async () => {
    // The snapshot is deliberately left in place. A version of this test that
    // also removed the artifact would pass for the wrong reason — and did:
    // deleting the `status = 'passed'` predicate from the query survived the
    // first mutation run, because nothing was asking the question this asks.
    //
    // The database's own CHECK refuses an artifact on a non-passing row, so
    // this state should not arise. "Should not arise" is exactly the condition
    // a second, independent gate exists for (§29).
    seed({ validationStatus: "failed" });

    expect(await start()).toEqual({ kind: "failed", error: "preview_artifact_unavailable" });
    expect(provider.createCount()).toBe(0);
    expect(db.rows("preview_sessions")).toHaveLength(0);
  });

  it("refuses when a passing run captured nothing at all", async () => {
    seed({ snapshotId: null, artifactExpiresAt: null });

    expect(await start()).toEqual({ kind: "failed", error: "preview_artifact_unavailable" });
    expect(provider.createCount()).toBe(0);
  });

  it("refuses when the passing run captured no artifact", async () => {
    seed({ snapshotId: null, artifactExpiresAt: null });

    expect(await start()).toEqual({ kind: "failed", error: "preview_artifact_unavailable" });
    expect(provider.createCount()).toBe(0);
  });

  it("refuses an artifact that was already deleted", async () => {
    seed({ artifactDeletedAt: new Date().toISOString() });

    expect(await start()).toEqual({ kind: "failed", error: "preview_artifact_unavailable" });
    expect(provider.createCount()).toBe(0);
  });

  it("refuses an expired artifact before any provider spend", async () => {
    seed({ artifactExpiresAt: HOUR_AGO() });

    const outcome = await start();

    // Checked against Vibe's own deadline. Discovering expiry by asking the
    // provider to restore something that is gone would mean the check lived in
    // the provider rather than in the product (§10).
    expect(outcome).toEqual({ kind: "failed", error: "preview_artifact_expired" });
    expect(provider.createCount()).toBe(0);
    expect(db.rows("operation_runs")).toHaveLength(0);
  });

  it("refuses a validation profile with no preview profile", async () => {
    seed();
    db.rows("validation_runs")[0].validation_profile = "some_future_framework_v1";

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
      artifact_snapshot_id: PREVIEW_SNAPSHOT_ID,
      preview_profile: "nextjs_preview_v1",
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
      artifact_snapshot_id: PREVIEW_SNAPSHOT_ID,
      preview_profile: "nextjs_preview_v1",
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
      artifact_snapshot_id: PREVIEW_SNAPSHOT_ID,
      preview_profile: "nextjs_preview_v1",
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
      artifact_snapshot_id: PREVIEW_SNAPSHOT_ID,
      preview_profile: "nextjs_preview_v1",
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
    return getPreviewStatus(fakeSupabase(db), provider, {
      projectId: params.projectId ?? PROJECT,
      userId: params.userId ?? USER,
      previewSessionId: "preview_1",
    });
  }

  it("returns a provider-derived origin for a live preview", async () => {
    seedRunning(new Date(Date.now() + PREVIEW_BUDGETS.ttlMs).toISOString());
    await provider.create({
      name: "vibe-preview-aaaaaaaabbbbccccdddd",
      source: { kind: "snapshot", snapshotId: PREVIEW_SNAPSHOT_ID },
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

  it("returns no origin past the deadline, and converges the row", async () => {
    seedRunning(HOUR_AGO());

    const view = await read();

    expect(view).toMatchObject({ status: "expired", origin: null, verdict: null });
    expect(db.rows("preview_sessions")[0].status).toBe("expired");
    expect(db.rows("preview_sessions")[0].stopped_at).toBeTruthy();
  });

  it("deletes the artifact when it converges an expired preview", async () => {
    seedRunning(HOUR_AGO());

    await read();

    // Nothing else performs this. Saying expiry "cleans up automatically"
    // without something doing it would be a claim with no actor (§25).
    expect(provider.deletedArtifacts()).toEqual([PREVIEW_SNAPSHOT_ID]);
    expect(db.rows("validation_runs")[0].artifact_deleted_at).toBeTruthy();
    expect(db.rows("preview_sessions")[0].artifact_deleted_at).toBeTruthy();
  });

  it("records one usage row when it converges, and not a second on re-read", async () => {
    seedRunning(HOUR_AGO());

    await read();
    await read();

    expect(db.rows("sandbox_usage_events")).toHaveLength(1);
    expect(db.rows("sandbox_usage_events")[0].operation).toBe("change_preview");
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
      artifact_snapshot_id: PREVIEW_SNAPSHOT_ID,
      preview_profile: "nextjs_preview_v1",
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
    return stopChangePreview(fakeSupabase(db), provider, {
      projectId: params.projectId ?? PROJECT,
      userId: params.userId ?? USER,
      previewSessionId: "preview_1",
    });
  }

  it("stops the sandbox, deletes the snapshot and marks the artifact gone", async () => {
    seedRunning();

    const outcome = await stop();

    expect(outcome).toMatchObject({ kind: "stopped", cleanupComplete: true });
    expect(provider.deletedArtifacts()).toEqual([PREVIEW_SNAPSHOT_ID]);
    expect(db.rows("preview_sessions")[0].status).toBe("stopped");
    expect(db.rows("validation_runs")[0].artifact_deleted_at).toBeTruthy();
  });

  it("leaves the ValidationRun and PreparedChange historically intact", async () => {
    seedRunning();

    await stop();

    // Only the artifact's availability is lost. Rewriting the past to tidy up
    // storage would make "this change validated" untrue after the fact (§20).
    expect(db.rows("validation_runs")[0].status).toBe("passed");
    expect(db.rows("prepared_changes")[0].status).toBe("prepared");
  });

  it("refuses another user's preview", async () => {
    seedRunning();

    expect(await stop({ userId: OTHER_USER })).toEqual({
      kind: "failed",
      error: "project_not_found",
    });
    expect(provider.deletedArtifacts()).toEqual([]);
    expect(db.rows("preview_sessions")[0].status).toBe("running");
  });

  it("produces one logical result when called twice", async () => {
    seedRunning();

    const first = await stop();
    const second = await stop();

    expect(first.kind).toBe("stopped");
    expect(second).toMatchObject({ kind: "already_stopped", status: "stopped" });
    // One ledger row, one stop, no error from an already-stopped provider.
    expect(db.rows("sandbox_usage_events")).toHaveLength(1);
  });

  it("reports an outstanding snapshot deletion rather than claiming success", async () => {
    provider = fakeSandboxProvider({ failDeleteArtifact: true });
    seedRunning();

    const outcome = await stop();

    expect(outcome).toMatchObject({ kind: "stopped", cleanupComplete: false });
    expect(db.rows("preview_sessions")[0].cleanup_status).toBe("artifact_delete_failed");
    expect(db.rows("preview_sessions")[0].artifact_deleted_at).toBeFalsy();
    // The run keeps its artifact marked live, because it *is* still live.
    expect(db.rows("validation_runs")[0].artifact_deleted_at).toBeFalsy();
  });

  it("retries an outstanding snapshot deletion on a later stop", async () => {
    provider = fakeSandboxProvider({ failDeleteArtifact: true });
    seedRunning();
    await stop();

    // The storage call now succeeds. The session is already terminal, so the
    // retry must fix the deletion without reopening it (§33).
    provider = fakeSandboxProvider();
    const again = await stop();

    expect(again.kind).toBe("already_stopped");
    expect(provider.deletedArtifacts()).toEqual([PREVIEW_SNAPSHOT_ID]);
    expect(db.rows("preview_sessions")[0].artifact_deleted_at).toBeTruthy();
    expect(db.rows("validation_runs")[0].artifact_deleted_at).toBeTruthy();
  });

  it("records preview spend against the preview, distinguishable from validation", async () => {
    seedRunning();
    // A sandbox that actually exists, so the ledger records what the provider
    // measured rather than the nulls of a preview that never provisioned.
    await provider.create({
      name: "vibe-preview-1",
      source: { kind: "snapshot", snapshotId: PREVIEW_SNAPSHOT_ID },
      networkPolicy: { mode: "deny_all" },
      ports: [PREVIEW_BUDGETS.port],
      timeoutMs: PREVIEW_BUDGETS.ttlMs,
      env: {},
    });

    await stop();

    const [usage] = db.rows("sandbox_usage_events");
    expect(usage.operation).toBe("change_preview");
    expect(usage.preview_session_id).toBe("preview_1");
    // Measured, never estimated: Vercel exposes no attributable per-sandbox
    // amount, and a rate-card figure would be a guess in an accounting field.
    expect(usage.provider_cost_usd).toBeNull();
    expect(usage.active_cpu_ms).toBe(1234);
  });
});

describe("the preview card, and what reading it must never cost", () => {
  function card(overrides: { validation?: { id: string; status: string } | null } = {}) {
    const validation =
      overrides.validation === undefined ? { id: VALIDATION, status: "passed" } : overrides.validation;

    return getPreviewCard(fakeSupabase(db), {
      projectId: PROJECT,
      preparedChangeId: PREPARED,
      validation,
      resolveFailureMessage: () => "safe copy",
    });
  }

  it("offers a start when a live artifact exists", async () => {
    seed();

    expect((await card()).state).toBe("ready_to_start");
  });

  it("requires validation when none has passed", async () => {
    seed({ validationStatus: "failed" });

    expect((await card({ validation: { id: VALIDATION, status: "failed" } })).state).toBe(
      "needs_validation",
    );
  });

  it("reports an unavailable artifact and asks for a deliberate re-validation", async () => {
    seed({ artifactDeletedAt: new Date().toISOString() });

    const result = await card();

    expect(result.state).toBe("artifact_unavailable");
    expect(result.revalidationRequired).toBe(true);
  });

  it("reports an expired artifact separately", async () => {
    seed({ artifactExpiresAt: HOUR_AGO() });

    expect((await card()).state).toBe("artifact_expired");
  });

  it("starts nothing at all when the artifact is unavailable", async () => {
    seed({ artifactDeletedAt: new Date().toISOString() });

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
    seed({ artifactDeletedAt: new Date().toISOString() });
    db.seed("preview_sessions", {
      id: "preview_failed",
      project_id: PROJECT,
      user_id: USER,
      prepared_change_id: PREPARED,
      validation_run_id: VALIDATION,
      operation_run_id: "operation_old",
      artifact_snapshot_id: PREVIEW_SNAPSHOT_ID,
      preview_profile: "nextjs_preview_v1",
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
    expect(db.rows("repository_intelligence_snapshots")).toHaveLength(0);
    expect(db.rows("business_readiness_audits")).toHaveLength(0);
    expect(db.rows("opportunity_sets")).toHaveLength(0);
  });

  it("shows a live session over the artifact it already consumed", async () => {
    seed({ artifactDeletedAt: new Date().toISOString() });
    db.seed("preview_sessions", {
      id: "preview_live",
      project_id: PROJECT,
      user_id: USER,
      prepared_change_id: PREPARED,
      validation_run_id: VALIDATION,
      operation_run_id: "operation_old",
      artifact_snapshot_id: PREVIEW_SNAPSHOT_ID,
      preview_profile: "nextjs_preview_v1",
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
      preview_profile: "nextjs_preview_v1",
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
