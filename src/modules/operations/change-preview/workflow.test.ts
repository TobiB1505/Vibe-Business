import { beforeEach, describe, expect, it, vi } from "vitest";
import { PREVIEW_BUDGETS } from "@/modules/change-preview/budgets";
import {
  PREVIEW_SNAPSHOT_ID,
  RESTORED_FILES,
  restoredSandboxFiles,
  sha256,
} from "@/modules/change-preview/test-support";
import { FakeDatabase, fakeSupabase } from "@/modules/operations/test-support";
import {
  FIXTURE_COMMIT_SHA,
  fakeSandboxProvider,
  fakeValidatableSnapshot,
} from "@/modules/validation/test-support";

/**
 * The workflow's own ordering, executed rather than mirrored (Sprint 10B-2 §30).
 *
 * ## Why this file exists
 *
 * Sprint 10A proved its durable ordering with a driver in the test file that
 * reproduced the workflow's control flow "deliberately literally". That works
 * until the two diverge — and a mutation run showed exactly that hole here:
 * making the preview workflow start the server *regardless* of the integrity
 * result broke nothing, because no test ran the workflow.
 *
 * The `"use workflow"` and `"use step"` directives are string literals. Under
 * the platform's build they become durable boundaries; under vitest they are
 * inert, and the function simply calls its steps in order. That is precisely
 * what needs asserting: the ordering, the fail-fast, and the fact that cleanup
 * runs on failing paths and does not run on the success path.
 *
 * What this does **not** test is durability — retries, replay, step isolation.
 * Those belong to the platform, and the step functions' own re-entry behaviour
 * is covered in `execution.test.ts`.
 */

const db = { current: new FakeDatabase() };
const provider = { current: fakeSandboxProvider() };

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => fakeSupabase(db.current),
}));

vi.mock("@/modules/validation/vercel/provider", () => ({
  // The real adapter is never constructed in a test. There is no local
  // execution path and there must never be one (ADR 0015 §4).
  createVercelSandboxProvider: () => provider.current,
}));

vi.mock("@/modules/projects/queries", () => ({
  getProjectWithRepository: async () => ({
    id: "project_1",
    repository: { owner: "acme", name: "product", installationId: 42 },
  }),
}));

const { changePreviewWorkflow } = await import("./workflow");

const USER = "user_1";
const PROJECT = "project_1";
const PREPARED = "prepared_1";
const VALIDATION = "validation_1";
const OPERATION = "operation_1";
const SESSION = "preview_1";

function seed() {
  db.current.seed("projects", { id: PROJECT, user_id: USER });

  db.current.seed("operation_runs", {
    id: OPERATION,
    project_id: PROJECT,
    user_id: USER,
    operation_type: "change_preview",
    input_identity: "i".repeat(64),
    status: "running",
    stage: "preflight",
    subject_id: VALIDATION,
  });

  db.current.seed("prepared_changes", {
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

  db.current.seed("validation_runs", {
    id: VALIDATION,
    project_id: PROJECT,
    user_id: USER,
    prepared_change_id: PREPARED,
    validation_profile: "nextjs_node_v1",
    prepared_commit_sha: FIXTURE_COMMIT_SHA,
    status: "passed",
    artifact_snapshot_id: PREVIEW_SNAPSHOT_ID,
    artifact_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    artifact_deleted_at: null,
    source_integrity: {
      buildIdentityDigests: {
        "package.json": sha256(RESTORED_FILES["product/package.json"]),
        "pnpm-lock.yaml": sha256(RESTORED_FILES["product/pnpm-lock.yaml"]),
      },
    },
  });

  db.current.seed("repository_intelligence_snapshots", {
    id: "snapshot_1",
    project_id: PROJECT,
    status: "completed",
    result: fakeValidatableSnapshot(),
    created_at: "2026-08-13T00:00:00.000Z",
  });

  db.current.seed("preview_sessions", {
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
  });
}

beforeEach(() => {
  db.current = new FakeDatabase();
  provider.current = fakeSandboxProvider({ files: restoredSandboxFiles() });
});

describe("the workflow's ordering", () => {
  it("restores, verifies, starts and completes", async () => {
    seed();

    await changePreviewWorkflow(OPERATION);

    expect(db.current.rows("preview_sessions")[0].status).toBe("running");
    expect(db.current.rows("operation_runs")[0].status).toBe("completed");
  });

  it("starts no server when the restored artifact fails integrity", async () => {
    provider.current = fakeSandboxProvider({
      files: restoredSandboxFiles({ "product/app/robots.ts": "tampered\n" }),
    });
    seed();

    await changePreviewWorkflow(OPERATION);

    // The load-bearing assertion of the sprint. Untrusted application code must
    // not run — and must certainly not be served on a public URL — after the
    // restored bytes failed to match the validated ones (§30).
    expect(provider.current.backgroundCommands()).toEqual([]);
    expect(db.current.rows("preview_sessions")[0].failure_code).toBe(
      "preview_artifact_integrity_failed",
    );
  });

  it("starts no server when the artifact expired before the workflow ran", async () => {
    seed();
    db.current.rows("validation_runs")[0].artifact_expires_at = new Date(
      Date.now() - 1000,
    ).toISOString();

    await changePreviewWorkflow(OPERATION);

    expect(provider.current.createCount()).toBe(0);
    expect(provider.current.backgroundCommands()).toEqual([]);
  });

  it("cleans up and deletes the artifact on every failing path", async () => {
    provider.current = fakeSandboxProvider({
      files: restoredSandboxFiles(),
      healthStatus: null,
    });
    seed();

    await changePreviewWorkflow(OPERATION);

    expect(provider.current.stopped()).toBe(true);
    expect(provider.current.deletedArtifacts()).toEqual([PREVIEW_SNAPSHOT_ID]);
    expect(db.current.rows("preview_sessions")[0].status).toBe("failed");
    expect(db.current.rows("validation_runs")[0].artifact_deleted_at).toBeTruthy();
  });

  it("does not tear down a preview that started successfully", async () => {
    seed();

    await changePreviewWorkflow(OPERATION);

    // The deliberate asymmetry with the validation workflow: the running
    // sandbox *is* the product, and the snapshot is what it exists to serve.
    // Unconditional cleanup here would stop every preview the moment it worked.
    expect(provider.current.stopped()).toBe(false);
    expect(provider.current.deletedArtifacts()).toEqual([]);
  });

  it("creates exactly one sandbox and starts exactly one server", async () => {
    seed();

    await changePreviewWorkflow(OPERATION);

    expect(provider.current.createCount()).toBe(1);
    expect(provider.current.backgroundCommands()).toHaveLength(1);
    expect(provider.current.exposedPorts()).toEqual([PREVIEW_BUDGETS.port]);
  });

  it("never opens egress at any point in the run", async () => {
    seed();

    await changePreviewWorkflow(OPERATION);

    for (const policy of provider.current.policies()) {
      expect(policy).toEqual({ mode: "deny_all" });
    }
  });
});
