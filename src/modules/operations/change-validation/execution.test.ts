import { beforeEach, describe, expect, it } from "vitest";
import { FIXTURE_COMMIT_SHA, fakeSandboxProvider, fakeValidatableSnapshot, healthySandboxFiles } from "@/modules/validation/test-support";
import { FakeDatabase, fakeSupabase } from "../test-support";
import {
  executeValidationStep,
  failValidationStep,
  prepareValidationStep,
  type ValidationDeps,
} from "./execution";

/**
 * Durable change validation (Sprint 10A §20, §34, §36).
 *
 * The assertion that matters in most cases is whether a sandbox was created at
 * all. Anything that can refuse must refuse *before* provisioning, because
 * provisioning is where the money starts.
 */

const USER = "user_1";
const PROJECT = "project_1";
const PREPARED = "prepared_1";
const OPERATION = "operation_1";
const HEAD = "git rev-parse HEAD";

let db: FakeDatabase;
let provider: ReturnType<typeof fakeSandboxProvider>;

function deps(overrides: Partial<ValidationDeps> = {}): ValidationDeps {
  return {
    supabase: fakeSupabase(db),
    provider,
    resolveTarget: async () => ({
      repositoryUrl: "https://github.com/acme/product.git",
      cloneCredential: { username: "x-access-token", password: "ghs_tokenValue1234567890" },
      // No GitHub side in these tests: build-identity files land in
      // `buildIdentityFilesUnverified`, which is the honest default.
      manifest: { getTextFile: async () => null },
    }),
    ...overrides,
  };
}

function seed(options: { preparedStatus?: string; commitSha?: string | null } = {}) {
  db.seed("projects", { id: PROJECT, user_id: USER });

  db.seed("prepared_changes", {
    id: PREPARED,
    project_id: PROJECT,
    user_id: USER,
    status: options.preparedStatus ?? "prepared",
    commit_sha: options.commitSha === undefined ? FIXTURE_COMMIT_SHA : options.commitSha,
    base_branch: "main",
    base_sha: "528d372",
    branch_name: "vibe/seo-foundations-cc32273131c5",
    execution_capability: "nextjs_seo_foundations_v1",
    execution_version: "nextjs-seo-foundations-v1",
    files: [],
  });

  db.seed("repository_intelligence_snapshots", {
    id: "snapshot_1",
    project_id: PROJECT,
    status: "completed",
    result: fakeValidatableSnapshot(),
    created_at: "2026-08-12T00:00:00.000Z",
  });

  db.seed("operation_runs", {
    id: OPERATION,
    project_id: PROJECT,
    user_id: USER,
    operation_type: "change_validation",
    status: "queued",
    stage: "preparing",
    input_identity: "identity_1",
    subject_id: PREPARED,
    result_id: null,
    failure_code: null,
    started_at: null,
    completed_at: null,
    created_at: "2026-08-12T00:00:00.000Z",
  });
}

async function runPipeline(overrides: Partial<ValidationDeps> = {}) {
  const d = deps(overrides);
  const prepared = await prepareValidationStep(d, OPERATION);
  if (!prepared.ok) return prepared;
  return executeValidationStep(d, OPERATION);
}

beforeEach(() => {
  db = new FakeDatabase();
  provider = fakeSandboxProvider({
    files: healthySandboxFiles(),
    results: { [HEAD]: { output: `${FIXTURE_COMMIT_SHA}\n` } },
  });
});

describe("the happy path", () => {
  it("validates and records one run", async () => {
    seed();

    const outcome = await runPipeline();

    expect(outcome.ok).toBe(true);
    expect(db.rows("validation_runs")).toHaveLength(1);
    expect(db.rows("validation_runs")[0].status).toBe("passed");
  });

  it("writes an infrastructure usage event, not an AI usage event (§25)", async () => {
    seed();
    await runPipeline();

    // Sandbox execution is compute, not inference. Mixing it into
    // ai_usage_events would corrupt every cost-per-audit figure.
    expect(db.rows("ai_usage_events")).toHaveLength(0);
    expect(db.rows("sandbox_usage_events")).toHaveLength(1);

    const usage = db.rows("sandbox_usage_events")[0];
    expect(usage.operation).toBe("change_validation");
    expect(usage.active_cpu_ms).toBe(1234);
    // Vercel exposes no attributable per-sandbox cost, so it stays null.
    expect(usage.provider_cost_usd ?? null).toBeNull();
  });

  it("records the sandbox policy version that was actually in force", async () => {
    seed();
    await runPipeline();

    expect(db.rows("validation_runs")[0].sandbox_policy_version).toBe("sandbox-policy-v1");
  });

  it("emits the domain lifecycle events once each", async () => {
    seed();
    await runPipeline();

    const types = db.rows("audit_events").map((row) => row.event_type);
    expect(types.filter((type) => type === "change_validation.started")).toHaveLength(1);
    expect(types.filter((type) => type === "change_validation.passed")).toHaveLength(1);
  });
});

describe("refusing before spending (§34)", () => {
  it.each([
    ["a preparation that is still running", { preparedStatus: "preparing" }],
    ["a preparation that failed", { preparedStatus: "failed" }],
    ["a preparation with no commit", { commitSha: null }],
  ])("creates no sandbox for %s", async (_label, options) => {
    seed(options);

    const outcome = await runPipeline();

    expect(outcome.ok).toBe(false);
    expect(provider.createdWith()).toBeNull();
    expect(db.rows("validation_runs")).toHaveLength(0);
  });

  it("creates no sandbox when the repository connection cannot be resolved", async () => {
    seed();

    const outcome = await runPipeline({ resolveTarget: async () => null });

    expect(outcome).toMatchObject({ ok: false, failureCode: "repository_connection_invalid" });
    expect(provider.createdWith()).toBeNull();
  });

  it("creates no sandbox for an unsupported repository", async () => {
    seed();
    db.rows("repository_intelligence_snapshots")[0].result = fakeValidatableSnapshot({
      frameworks: [{ id: "django", name: "Django" }],
    });

    const outcome = await runPipeline();

    expect(outcome).toMatchObject({ ok: false, failureCode: "validation_not_supported" });
    expect(provider.createdWith()).toBeNull();
  });
});

describe("idempotency (§35)", () => {
  it("does not claim a second validation when the prepare step replays", async () => {
    seed();
    const d = deps();

    await prepareValidationStep(d, OPERATION);
    await prepareValidationStep(d, OPERATION);

    expect(db.rows("validation_runs")).toHaveLength(1);
  });

  it("does not provision a second sandbox when the execute step replays", async () => {
    seed();
    const d = deps();

    await prepareValidationStep(d, OPERATION);
    await executeValidationStep(d, OPERATION);
    await executeValidationStep(d, OPERATION);

    expect(provider.events.filter((event) => event.kind === "create")).toHaveLength(1);
  });
});

describe("cleanup and failure handling (§23, §36)", () => {
  it("stops the sandbox even when the result cannot be persisted", async () => {
    seed();
    const d = deps();
    await prepareValidationStep(d, OPERATION);

    // The database goes away exactly at the moment the verdict is written.
    db.failNextWriteWith = { table: "validation_runs", message: "connection lost" };

    await executeValidationStep(d, OPERATION).catch(() => undefined);

    // The paid VM is gone regardless. A failed DB call must never leave one
    // running — that is the whole reason cleanup lives inside the orchestrator.
    expect(provider.stopped()).toBe(true);
  });

  it("stops the sandbox when the provider throws mid-run", async () => {
    seed();
    provider = fakeSandboxProvider({
      files: healthySandboxFiles(),
      results: { [HEAD]: { output: `${FIXTURE_COMMIT_SHA}\n` } },
      throwOn: "pnpm run build",
    });

    await runPipeline();

    expect(provider.stopped()).toBe(true);
    expect(db.rows("validation_runs")[0].status).toBe("failed");
  });

  it("closes an abandoned run so the UI is not left waiting", async () => {
    seed();
    const d = deps();
    await prepareValidationStep(d, OPERATION);

    await failValidationStep(d, OPERATION, "validation_run_failed");

    expect(db.rows("validation_runs")[0].status).toBe("failed");
    expect(db.rows("operation_runs")[0].status).toBe("failed");
  });
});

describe("no secrets reach the sandbox (§8, §31, §37)", () => {
  it("passes the clone credential only as the clone credential", async () => {
    seed();
    await runPipeline();

    const created = provider.createdWith();
    expect(created?.source.credential?.password).toBe("ghs_tokenValue1234567890");
    expect(JSON.stringify(created?.env)).not.toContain("ghs_tokenValue1234567890");
  });

  it("never persists the credential anywhere", async () => {
    seed();
    await runPipeline();

    const everything = JSON.stringify([
      db.rows("validation_runs"),
      db.rows("sandbox_usage_events"),
      db.rows("audit_events"),
      db.rows("operation_runs"),
    ]);

    expect(everything).not.toContain("ghs_tokenValue1234567890");
    expect(everything).not.toContain("x-access-token");
  });
});
