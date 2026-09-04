import { ANALYZER_VERSION as REPOSITORY_ANALYZER_VERSION } from "@/modules/repository-intelligence/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PREVIEW_BUDGETS } from "@/modules/change-preview/budgets";
import {} from "@/modules/change-preview/schema";
import { clonedSandboxFiles } from "@/modules/change-preview/test-support";
import { FakeDatabase, fakeSupabase } from "@/modules/operations/test-support";
import {
  FIXTURE_COMMIT_SHA,
  fakeSandboxProvider,
  fakeValidatableSnapshot,
} from "@/modules/validation/test-support";
import {
  cleanupFailedPreviewStep,
  completePreviewStep,
  failPreviewStep,
  provisionPreviewStep,
  startPreviewStep,
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
const OPERATION = "operation_1";
const SESSION = "preview_1";

let db: FakeDatabase;
let provider: ReturnType<typeof fakeSandboxProvider>;

function deps(): PreviewDeps {
  return {
    supabase: fakeSupabase(db),
    provider,
    resolveTarget: async (_operation, options) => ({
      repositoryUrl: "https://github.com/acme/product.git",
      sourceRoot: "product",
      // Minted only where the clone happens, exactly as production does.
      cloneCredential: options.withCloneCredential
        ? { username: "x-access-token", password: "ghs_fixture" }
        : null,
    }),
  };
}

function seed(options: { sessionOverrides?: Record<string, unknown> } = {}) {
  db.seed("projects", { id: PROJECT, user_id: USER });

  db.seed("operation_runs", {
    id: OPERATION,
    project_id: PROJECT,
    user_id: USER,
    operation_type: "change_preview",
    input_identity: "i".repeat(64),
    status: "running",
    stage: "preflight",
    subject_id: PREPARED,
  });

  db.seed("prepared_changes", {
    id: PREPARED,
    project_id: PROJECT,
    user_id: USER,
    status: "prepared",
    commit_sha: FIXTURE_COMMIT_SHA,
    files: [{ path: "app/robots.ts", contentHash: "a".repeat(64), bytes: 48 }],
  });

  db.seed("repository_intelligence_snapshots", {
    analyzer_version: REPOSITORY_ANALYZER_VERSION,
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
    prepared_commit_sha: FIXTURE_COMMIT_SHA,
    operation_run_id: OPERATION,
    preview_profile: "next_dev_v1",
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
  provider = fakeSandboxProvider({
    files: clonedSandboxFiles(),
    results: { "git rev-parse HEAD": { exitCode: 0, output: FIXTURE_COMMIT_SHA } },
  });
});

describe("the durable happy path", () => {
  it("provisions, starts and marks the session running", async () => {
    seed();

    expect(await provisionPreviewStep(deps(), OPERATION)).toEqual({ ok: true });
    expect(await startPreviewStep(deps(), OPERATION)).toEqual({ ok: true });

    const session = db.rows("preview_sessions")[0];
    expect(session.status).toBe("running");
    expect(session.ready_at).toBeTruthy();
  });

  it("uses exactly one sandbox across every step", async () => {
    seed();

    await provisionPreviewStep(deps(), OPERATION);
    await startPreviewStep(deps(), OPERATION);

    // One PreviewSession must produce one sandbox however many invocations it
    // takes. A second creation means the server started on a filesystem the
    // integrity check never saw (§32).
    expect(provider.createCount()).toBe(1);
  });

  it("completes the operation once the session is running", async () => {
    seed();
    await provisionPreviewStep(deps(), OPERATION);
    await startPreviewStep(deps(), OPERATION);

    await completePreviewStep(deps(), OPERATION);

    // The session then owns its own TTL. An operation held open for fifteen
    // minutes would be a workflow doing nothing (§23).
    expect(db.rows("operation_runs")[0].status).toBe("completed");
    expect(db.rows("operation_runs")[0].result_id).toBe(SESSION);
  });

  it("never records an AI usage event", async () => {
    seed();
    await provisionPreviewStep(deps(), OPERATION);
    await startPreviewStep(deps(), OPERATION);

    // Nothing in a preview calls a model, so no inference row is earned (§27).
    expect(db.rows("ai_usage_events")).toHaveLength(0);
  });

  it("keeps the preview's sandbox and snapshot alive on success", async () => {
    seed();

    await provisionPreviewStep(deps(), OPERATION);
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

    await provisionPreviewStep(deps(), OPERATION);
    await provisionPreviewStep(deps(), OPERATION);

    expect(provider.createCount()).toBe(1);
  });

  it("does not start a second server when the start step replays", async () => {
    seed();
    await provisionPreviewStep(deps(), OPERATION);

    await startPreviewStep(deps(), OPERATION);
    await startPreviewStep(deps(), OPERATION);

    expect(provider.backgroundCommands()).toHaveLength(1);
  });
});

describe("refusals before repository code runs", () => {
  it("refuses when the change's commit moved between the click and the step", async () => {
    // Between the service check and this one there is a queue. A change that
    // now points somewhere else is not the change this session was claimed for,
    // and serving it on a public URL would be serving bytes nobody asked about.
    seed();
    db.rows("prepared_changes")[0].commit_sha = "b".repeat(40);

    expect(await provisionPreviewStep(deps(), OPERATION)).toEqual({
      ok: false,
      failureCode: "preview_source_unavailable",
    });
    expect(provider.createCount()).toBe(0);
  });

  it("refuses when the provider produced a different commit", async () => {
    provider = fakeSandboxProvider({
      files: clonedSandboxFiles(),
      results: { "git rev-parse HEAD": { exitCode: 0, output: "c".repeat(40) } },
    });
    seed();

    expect(await provisionPreviewStep(deps(), OPERATION)).toEqual({
      ok: false,
      failureCode: "preview_source_unavailable",
    });
    expect(provider.backgroundCommands()).toEqual([]);
  });

  it("starts no server when the clone credential survived removal", async () => {
    provider = fakeSandboxProvider({
      files: clonedSandboxFiles({
        "product/.git/config":
          '[remote "origin"]\n\turl = https://x-access-token:ghs_secret@github.com/acme/product.git\n',
      }),
      unremovablePaths: ["product/.git/config"],
      results: { "git rev-parse HEAD": { exitCode: 0, output: FIXTURE_COMMIT_SHA } },
    });
    seed();

    expect(await provisionPreviewStep(deps(), OPERATION)).toEqual({
      ok: false,
      failureCode: "preview_credential_scrub_failed",
    });
    expect(provider.backgroundCommands()).toEqual([]);
  });

  it("never records the credential it refused to leave behind", async () => {
    provider = fakeSandboxProvider({
      files: clonedSandboxFiles({
        "product/.git/config":
          "url = https://x-access-token:ghs_secret@github.com/acme/product.git",
      }),
      unremovablePaths: ["product/.git/config"],
      results: { "git rev-parse HEAD": { exitCode: 0, output: FIXTURE_COMMIT_SHA } },
    });
    seed();

    await provisionPreviewStep(deps(), OPERATION);

    expect(JSON.stringify(db.rows("audit_log_events"))).not.toContain("ghs_secret");
    expect(JSON.stringify(db.rows("preview_sessions"))).not.toContain("ghs_secret");
  });

  it("starts no server when the install fails", async () => {
    provider = fakeSandboxProvider({
      files: clonedSandboxFiles(),
      results: {
        "git rev-parse HEAD": { exitCode: 0, output: FIXTURE_COMMIT_SHA },
        "pnpm install --frozen-lockfile --ignore-scripts": { exitCode: 1, output: "lockfile" },
      },
    });
    seed();

    expect(await provisionPreviewStep(deps(), OPERATION)).toEqual({
      ok: false,
      failureCode: "preview_install_failed",
    });
    expect(provider.backgroundCommands()).toEqual([]);
  });
});

describe("cleanup on failure", () => {
  it("stops the sandbox when the start fails", async () => {
    provider = fakeSandboxProvider({
      files: clonedSandboxFiles(),
      results: { "git rev-parse HEAD": { exitCode: 0, output: FIXTURE_COMMIT_SHA } },
      backgroundExitCode: 1,
      healthStatus: null,
    });
    seed();
    await provisionPreviewStep(deps(), OPERATION);
    const started = await startPreviewStep(deps(), OPERATION);
    expect(started.ok).toBe(false);

    const teardown = await cleanupFailedPreviewStep(deps(), OPERATION);

    // The VM is what costs money by the minute, and it is the whole of what a
    // preview leaves behind now: no snapshot is taken, so none is deleted.
    expect(teardown).toMatchObject({ cleanup: "stopped", artifactDeleted: false });
    expect(provider.deletedArtifacts()).toEqual([]);
  });

  it("cleans up after a failure that happened before the server started", async () => {
    provider = fakeSandboxProvider({
      files: clonedSandboxFiles(),
      results: {
        "git rev-parse HEAD": { exitCode: 0, output: FIXTURE_COMMIT_SHA },
        "pnpm install --frozen-lockfile --ignore-scripts": { exitCode: 1, output: "lockfile" },
      },
    });
    seed();
    await provisionPreviewStep(deps(), OPERATION);

    await cleanupFailedPreviewStep(deps(), OPERATION);

    // A sandbox that will never serve anything is still a paid VM.
    expect(provider.stopped()).toBe(true);
  });

  it("records the failure on the session, the ledger and the operation", async () => {
    provider = fakeSandboxProvider({
      files: clonedSandboxFiles(),
      results: { "git rev-parse HEAD": { exitCode: 0, output: FIXTURE_COMMIT_SHA } },
      healthStatus: null,
    });
    seed();
    await provisionPreviewStep(deps(), OPERATION);
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
      files: clonedSandboxFiles(),
      results: { "git rev-parse HEAD": { exitCode: 0, output: FIXTURE_COMMIT_SHA } },
      healthStatus: null,
      failStop: true,
    });
    seed();
    await provisionPreviewStep(deps(), OPERATION);
    const teardown = await cleanupFailedPreviewStep(deps(), OPERATION);

    await failPreviewStep(deps(), OPERATION, "preview_health_check_failed", teardown);

    const session = db.rows("preview_sessions")[0];
    // The user asked why their preview did not work. "We could not stop the
    // sandbox" is not that answer — but it is recorded beside it (§19).
    expect(session.failure_code).toBe("preview_health_check_failed");
    expect(session.cleanup_status).toBe("stop_failed");
  });

  it("records one usage row however many times the terminal step runs", async () => {
    provider = fakeSandboxProvider({
      files: clonedSandboxFiles(),
      results: { "git rev-parse HEAD": { exitCode: 0, output: FIXTURE_COMMIT_SHA } },
      healthStatus: null,
    });
    seed();
    await provisionPreviewStep(deps(), OPERATION);
    const teardown = await cleanupFailedPreviewStep(deps(), OPERATION);

    await failPreviewStep(deps(), OPERATION, "preview_failed", teardown);
    await failPreviewStep(deps(), OPERATION, "preview_failed", teardown);

    expect(db.rows("sandbox_usage_events")).toHaveLength(1);
  });
});
