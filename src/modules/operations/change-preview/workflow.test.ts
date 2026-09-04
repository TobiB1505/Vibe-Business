import { ANALYZER_VERSION as REPOSITORY_ANALYZER_VERSION } from "@/modules/repository-intelligence/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PREVIEW_BUDGETS } from "@/modules/change-preview/budgets";
import {} from "@/modules/change-preview/schema";
import { clonedSandboxFiles } from "@/modules/change-preview/test-support";
import { DEPENDENCY_HOSTS, SOURCE_HOSTS } from "@/modules/validation/sandbox-port";
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

vi.mock("@/modules/github/installation-token", () => ({
  // The one place a raw token leaves the Octokit boundary in production. Here
  // it is a string, so the workflow's own handling of it is what is under test.
  mintInstallationCloneCredential: async () => ({
    username: "x-access-token",
    password: "ghs_fixture",
  }),
}));

const { changePreviewWorkflow } = await import("./workflow");

const USER = "user_1";
const PROJECT = "project_1";
const PREPARED = "prepared_1";
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
    subject_id: PREPARED,
  });

  db.current.seed("prepared_changes", {
    id: PREPARED,
    project_id: PROJECT,
    user_id: USER,
    status: "prepared",
    commit_sha: FIXTURE_COMMIT_SHA,
    files: [{ path: "app/robots.ts", contentHash: "a".repeat(64), bytes: 48 }],
  });

  db.current.seed("repository_intelligence_snapshots", {
    analyzer_version: REPOSITORY_ANALYZER_VERSION,
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
  });
}

beforeEach(() => {
  db.current = new FakeDatabase();
  provider.current = fakeSandboxProvider({
    files: clonedSandboxFiles(),
    results: { "git rev-parse HEAD": { exitCode: 0, output: FIXTURE_COMMIT_SHA } },
  });
});

describe("the workflow's ordering", () => {
  it("provisions, starts and completes", async () => {
    seed();

    await changePreviewWorkflow(OPERATION);

    expect(db.current.rows("preview_sessions")[0].status).toBe("running");
    expect(db.current.rows("operation_runs")[0].status).toBe("completed");
  });

  it("starts no server when the provider produced a different commit", async () => {
    provider.current = fakeSandboxProvider({
      files: clonedSandboxFiles(),
      results: { "git rev-parse HEAD": { exitCode: 0, output: "c".repeat(40) } },
    });
    seed();

    await changePreviewWorkflow(OPERATION);

    // The load-bearing assertion of the sprint. Untrusted application code must
    // not run — and must certainly not be served on a public URL — when what
    // came back is not the commit Vibe prepared (§30).
    expect(provider.current.backgroundCommands()).toEqual([]);
    expect(db.current.rows("preview_sessions")[0].failure_code).toBe("preview_source_unavailable");
  });

  it("starts no server when the clone credential survived removal", async () => {
    provider.current = fakeSandboxProvider({
      files: clonedSandboxFiles({ "product/.git/config": "[remote]\n  url = https://x@github" }),
      unremovablePaths: ["product/.git/config"],
      results: { "git rev-parse HEAD": { exitCode: 0, output: FIXTURE_COMMIT_SHA } },
    });
    seed();

    await changePreviewWorkflow(OPERATION);

    expect(provider.current.backgroundCommands()).toEqual([]);
    expect(db.current.rows("preview_sessions")[0].failure_code).toBe(
      "preview_credential_scrub_failed",
    );
  });

  it("starts no server when the change has no commit to serve", async () => {
    seed();
    db.current.rows("prepared_changes")[0].commit_sha = null;

    await changePreviewWorkflow(OPERATION);

    expect(provider.current.createCount()).toBe(0);
    expect(provider.current.backgroundCommands()).toEqual([]);
  });

  it("cleans up on every failing path", async () => {
    provider.current = fakeSandboxProvider({
      files: clonedSandboxFiles(),
      results: { "git rev-parse HEAD": { exitCode: 0, output: FIXTURE_COMMIT_SHA } },
      healthStatus: null,
    });
    seed();

    await changePreviewWorkflow(OPERATION);

    expect(provider.current.stopped()).toBe(true);
    expect(db.current.rows("preview_sessions")[0].status).toBe("failed");
  });

  it("does not tear down a preview that started successfully", async () => {
    seed();

    await changePreviewWorkflow(OPERATION);

    // The deliberate asymmetry with the validation workflow: the running
    // sandbox *is* the product. Unconditional cleanup here would stop every
    // preview the moment it worked.
    expect(provider.current.stopped()).toBe(false);
  });

  it("creates exactly one sandbox and starts exactly one server", async () => {
    seed();

    await changePreviewWorkflow(OPERATION);

    expect(provider.current.createCount()).toBe(1);
    expect(provider.current.backgroundCommands()).toHaveLength(1);
    expect(provider.current.exposedPorts()).toEqual([PREVIEW_BUDGETS.port]);
  });

  it("narrows egress twice and never widens it", async () => {
    seed();

    await changePreviewWorkflow(OPERATION);

    // Two windows, each as narrow as the work needs, and shut before any
    // repository-controlled command runs (rule 81).
    expect(provider.current.policies()).toEqual([
      { mode: "allow_domains", domains: SOURCE_HOSTS },
      { mode: "allow_domains", domains: DEPENDENCY_HOSTS },
      { mode: "deny_all" },
    ]);
  });
});
