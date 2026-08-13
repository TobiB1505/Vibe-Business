import { beforeEach, describe, expect, it, vi } from "vitest";
import { PREVIEW_BUDGETS } from "@/modules/change-preview/budgets";
import {
  PREVIEW_SNAPSHOT_ID,
  RESTORED_FILES,
  restoredSandboxFiles,
  sha256,
} from "@/modules/change-preview/test-support";
import { FakeDatabase, fakeSupabase } from "@/modules/operations/test-support";
import { FIXTURE_COMMIT_SHA, fakeSandboxProvider, fakeValidatableSnapshot } from "@/modules/validation/test-support";
import {
  cleanupFailedPreviewStep,
  completePreviewStep,
  failPreviewStep,
  restoreArtifactStep,
  startPreviewStep,
  verifyArtifactStep,
  type PreviewDeps,
} from "./execution";

/**
 * The durable preview, driven through the real steps (Sprint 10B-2 §31–§34).
 *
 * The orchestrator's own tests prove the security sequence against a recorded
 * transcript. These prove the *durable* properties that only exist once steps
 * are separate invocations against persisted state: that a replay does not buy
 * a second sandbox, that a failure cleans up, and that a failing preview never
 * leaves an artifact behind.
 *
 * `getProjectWithRepository` and the repository snapshot are the two pieces of
 * server state a step re-derives, so they are seeded rather than stubbed
 * wherever the fake database can carry them.
 */

vi.mock("@/modules/projects/queries", () => ({
  getProjectWithRepository: async () => ({
    id: "project_1",
    repository: { owner: "acme", name: "product", installationId: 42 },
  }),
}));

const USER = "user_1";
const PROJECT = "project_1";
const PREPARED = "prepared_1";
const VALIDATION = "validation_1";
const OPERATION = "operation_1";
const SESSION = "preview_1";

let db: FakeDatabase;
let provider: ReturnType<typeof fakeSandboxProvider>;

function deps(): PreviewDeps {
  return { supabase: fakeSupabase(db), provider };
}

function seed(
  options: { artifactExpiresAt?: string; sessionOverrides?: Record<string, unknown> } = {},
) {
  db.seed("projects", { id: PROJECT, user_id: USER });

  db.seed("operation_runs", {
    id: OPERATION,
    project_id: PROJECT,
    user_id: USER,
    operation_type: "change_preview",
    input_identity: "i".repeat(64),
    status: "running",
    stage: "preflight",
    subject_id: VALIDATION,
  });

  db.seed("prepared_changes", {
    id: PREPARED,
    project_id: PROJECT,
    user_id: USER,
    status: "prepared",
    commit_sha: FIXTURE_COMMIT_SHA,
    files: [
      {
        path: "app/robots.ts",
        contentHash: sha256(RESTORED_FILES["product/app/robots.ts"]),
        bytes: 48,
      },
    ],
  });

  db.seed("validation_runs", {
    id: VALIDATION,
    project_id: PROJECT,
    user_id: USER,
    prepared_change_id: PREPARED,
    validation_profile: "nextjs_node_v1",
    prepared_commit_sha: FIXTURE_COMMIT_SHA,
    status: "passed",
    artifact_snapshot_id: PREVIEW_SNAPSHOT_ID,
    artifact_expires_at:
      options.artifactExpiresAt ?? new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    artifact_deleted_at: null,
    source_integrity: {
      buildIdentityDigests: {
        "package.json": sha256(RESTORED_FILES["product/package.json"]),
        "pnpm-lock.yaml": sha256(RESTORED_FILES["product/pnpm-lock.yaml"]),
      },
    },
  });

  db.seed("repository_intelligence_snapshots", {
    id: "snapshot_1",
    project_id: PROJECT,
    status: "completed",
    result: fakeValidatableSnapshot(),
    created_at: "2026-08-13T00:00:00.000Z",
  });

  db.seed("preview_sessions", {
    id: SESSION,
    project_id: PROJECT,
    user_id: USER,
    prepared_change_id: PREPARED,
    validation_run_id: VALIDATION,
    operation_run_id: OPERATION,
    artifact_snapshot_id: PREVIEW_SNAPSHOT_ID,
    preview_profile: "nextjs_preview_v1",
    preview_identity: "p".repeat(64),
    status: "starting",
    stage: "preflight",
    port: PREVIEW_BUDGETS.port,
    started_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + PREVIEW_BUDGETS.ttlMs).toISOString(),
    artifact_deleted_at: null,
    ...options.sessionOverrides,
  });
}

beforeEach(() => {
  db = new FakeDatabase();
  provider = fakeSandboxProvider({ files: restoredSandboxFiles() });
});

describe("the durable happy path", () => {
  it("restores, verifies, starts and marks the session running", async () => {
    seed();

    expect(await restoreArtifactStep(deps(), OPERATION)).toEqual({ ok: true });
    expect(await verifyArtifactStep(deps(), OPERATION)).toEqual({ ok: true });
    expect(await startPreviewStep(deps(), OPERATION)).toEqual({ ok: true });

    const session = db.rows("preview_sessions")[0];
    expect(session.status).toBe("running");
    expect(session.ready_at).toBeTruthy();
  });

  it("uses exactly one sandbox across every step", async () => {
    seed();

    await restoreArtifactStep(deps(), OPERATION);
    await verifyArtifactStep(deps(), OPERATION);
    await startPreviewStep(deps(), OPERATION);

    // One PreviewSession must produce one sandbox however many invocations it
    // takes. A second creation means the server started on a filesystem the
    // integrity check never saw (§32).
    expect(provider.createCount()).toBe(1);
  });

  it("completes the operation once the session is running", async () => {
    seed();
    await restoreArtifactStep(deps(), OPERATION);
    await verifyArtifactStep(deps(), OPERATION);
    await startPreviewStep(deps(), OPERATION);

    await completePreviewStep(deps(), OPERATION);

    // The session then owns its own TTL. An operation held open for fifteen
    // minutes would be a workflow doing nothing (§23).
    expect(db.rows("operation_runs")[0].status).toBe("completed");
    expect(db.rows("operation_runs")[0].result_id).toBe(SESSION);
  });

  it("never records an AI usage event", async () => {
    seed();
    await restoreArtifactStep(deps(), OPERATION);
    await verifyArtifactStep(deps(), OPERATION);
    await startPreviewStep(deps(), OPERATION);

    // Nothing in a preview calls a model, so no inference row is earned (§27).
    expect(db.rows("ai_usage_events")).toHaveLength(0);
  });

  it("keeps the preview's sandbox and snapshot alive on success", async () => {
    seed();

    await restoreArtifactStep(deps(), OPERATION);
    await verifyArtifactStep(deps(), OPERATION);
    await startPreviewStep(deps(), OPERATION);

    // The running sandbox *is* the preview, and the snapshot is what it exists
    // to serve. Tearing either down here is the difference between "run and
    // serve" and "run and tear down" (§19).
    expect(provider.stopped()).toBe(false);
    expect(provider.deletedArtifacts()).toEqual([]);
  });
});

describe("re-entry", () => {
  it("does not create a second sandbox when the restore step replays", async () => {
    seed();

    await restoreArtifactStep(deps(), OPERATION);
    await restoreArtifactStep(deps(), OPERATION);

    expect(provider.createCount()).toBe(1);
  });

  it("does not start a second server when the start step replays", async () => {
    seed();
    await restoreArtifactStep(deps(), OPERATION);
    await verifyArtifactStep(deps(), OPERATION);

    await startPreviewStep(deps(), OPERATION);
    await startPreviewStep(deps(), OPERATION);

    expect(provider.backgroundCommands()).toHaveLength(1);
  });
});

describe("refusals before repository code runs", () => {
  it("refuses an artifact that expired between the click and the step", async () => {
    seed({ artifactExpiresAt: new Date(Date.now() - 1000).toISOString() });

    const outcome = await restoreArtifactStep(deps(), OPERATION);

    // Between the service check and this one there is a queue. A deadline that
    // passed in the meantime must not be discovered by asking the provider
    // to restore something that is gone (§10).
    expect(outcome).toEqual({ ok: false, failureCode: "preview_artifact_expired" });
    expect(provider.createCount()).toBe(0);
  });

  it("refuses an artifact deleted between the click and the step", async () => {
    seed();
    db.rows("validation_runs")[0].artifact_deleted_at = new Date().toISOString();

    expect(await restoreArtifactStep(deps(), OPERATION)).toEqual({
      ok: false,
      failureCode: "preview_artifact_unavailable",
    });
    expect(provider.createCount()).toBe(0);
  });

  it("starts no server when the restored artifact fails integrity", async () => {
    provider = fakeSandboxProvider({
      files: restoredSandboxFiles({ "product/app/robots.ts": "tampered\n" }),
    });
    seed();
    await restoreArtifactStep(deps(), OPERATION);

    const outcome = await verifyArtifactStep(deps(), OPERATION);

    expect(outcome).toEqual({ ok: false, failureCode: "preview_artifact_integrity_failed" });
    expect(provider.backgroundCommands()).toEqual([]);
  });

  it("starts no server when a credential-bearing .git came back", async () => {
    provider = fakeSandboxProvider({
      files: restoredSandboxFiles({
        "product/.git/config":
          '[remote "origin"]\n\turl = https://x-access-token:ghs_secret@github.com/acme/product.git\n',
      }),
    });
    seed();
    await restoreArtifactStep(deps(), OPERATION);

    expect(await verifyArtifactStep(deps(), OPERATION)).toEqual({
      ok: false,
      failureCode: "preview_artifact_integrity_failed",
    });
    expect(provider.backgroundCommands()).toEqual([]);
  });

  it("records an integrity failure without leaking the credential", async () => {
    provider = fakeSandboxProvider({
      files: restoredSandboxFiles({
        "product/.git/config": "url = https://x-access-token:ghs_secret@github.com/acme/product.git",
      }),
    });
    seed();
    await restoreArtifactStep(deps(), OPERATION);
    await verifyArtifactStep(deps(), OPERATION);

    expect(JSON.stringify(db.rows("audit_log_events"))).not.toContain("ghs_secret");
  });
});

describe("cleanup on failure", () => {
  it("stops the sandbox and deletes the artifact when the start fails", async () => {
    provider = fakeSandboxProvider({
      files: restoredSandboxFiles(),
      backgroundExitCode: 1,
      healthStatus: null,
    });
    seed();
    await restoreArtifactStep(deps(), OPERATION);
    await verifyArtifactStep(deps(), OPERATION);
    const started = await startPreviewStep(deps(), OPERATION);
    expect(started.ok).toBe(false);

    const teardown = await cleanupFailedPreviewStep(deps(), OPERATION);

    expect(teardown).toMatchObject({ cleanup: "stopped", artifactDeleted: true });
    expect(provider.deletedArtifacts()).toEqual([PREVIEW_SNAPSHOT_ID]);
    expect(db.rows("validation_runs")[0].artifact_deleted_at).toBeTruthy();
  });

  it("cleans up after an integrity failure", async () => {
    provider = fakeSandboxProvider({
      files: restoredSandboxFiles({ "product/pnpm-lock.yaml": "lockfileVersion: '6.0'\n" }),
    });
    seed();
    await restoreArtifactStep(deps(), OPERATION);
    await verifyArtifactStep(deps(), OPERATION);

    const teardown = await cleanupFailedPreviewStep(deps(), OPERATION);

    // A snapshot whose restored bytes are wrong is worth nothing to anyone and
    // is still a customer's filesystem in third-party storage (§33).
    expect(provider.stopped()).toBe(true);
    expect(teardown.artifactDeleted).toBe(true);
  });

  it("records the failure on the session, the ledger and the operation", async () => {
    provider = fakeSandboxProvider({ files: restoredSandboxFiles(), healthStatus: null });
    seed();
    await restoreArtifactStep(deps(), OPERATION);
    const teardown = await cleanupFailedPreviewStep(deps(), OPERATION);

    await failPreviewStep(deps(), OPERATION, "preview_health_check_failed", teardown);

    const session = db.rows("preview_sessions")[0];
    expect(session.status).toBe("failed");
    expect(session.failure_code).toBe("preview_health_check_failed");
    expect(session.stopped_at).toBeTruthy();

    expect(db.rows("sandbox_usage_events")).toHaveLength(1);
    expect(db.rows("sandbox_usage_events")[0].status).toBe("failed");
    expect(db.rows("operation_runs")[0].status).toBe("failed");
  });

  it("does not let a cleanup failure replace the reason the preview failed", async () => {
    provider = fakeSandboxProvider({
      files: restoredSandboxFiles(),
      healthStatus: null,
      failDeleteArtifact: true,
    });
    seed();
    await restoreArtifactStep(deps(), OPERATION);
    const teardown = await cleanupFailedPreviewStep(deps(), OPERATION);

    await failPreviewStep(deps(), OPERATION, "preview_health_check_failed", teardown);

    const session = db.rows("preview_sessions")[0];
    // The user asked why their preview did not work. "We could not delete a
    // snapshot" is not that answer — but it is recorded beside it (§19).
    expect(session.failure_code).toBe("preview_health_check_failed");
    expect(session.cleanup_status).toBe("artifact_delete_failed");
    expect(session.artifact_deleted_at).toBeFalsy();
    expect(db.rows("validation_runs")[0].artifact_deleted_at).toBeFalsy();
  });

  it("records one usage row however many times the terminal step runs", async () => {
    provider = fakeSandboxProvider({ files: restoredSandboxFiles(), healthStatus: null });
    seed();
    await restoreArtifactStep(deps(), OPERATION);
    const teardown = await cleanupFailedPreviewStep(deps(), OPERATION);

    await failPreviewStep(deps(), OPERATION, "preview_failed", teardown);
    await failPreviewStep(deps(), OPERATION, "preview_failed", teardown);

    expect(db.rows("sandbox_usage_events")).toHaveLength(1);
  });
});
