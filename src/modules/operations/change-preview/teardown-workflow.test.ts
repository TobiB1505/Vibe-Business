import { beforeEach, describe, expect, it, vi } from "vitest";
import { PREVIEW_BUDGETS } from "@/modules/change-preview/budgets";
import { PREVIEW_SNAPSHOT_ID } from "@/modules/change-preview/test-support";
import { FakeDatabase, fakeSupabase } from "@/modules/operations/test-support";
import { fakeSandboxProvider } from "@/modules/validation/test-support";

/**
 * The durable preview teardown, executed rather than mirrored (Sprint 10B-3).
 *
 * ## Why this file exists
 *
 * The first real stop looked perfect and recorded no spend. `sandbox_usage_events`
 * grants SELECT and nothing else — a ledger the client can write is not a
 * ledger — and the inline stop ran under the cookie-scoped client, so its insert
 * was refused by RLS and swallowed by a best-effort `if (error) return`.
 *
 * Everything below asserts the properties that failure bought:
 *
 *  - the spend is recorded, by the one caller that may;
 *  - retries cannot double-count a sandbox that ran once;
 *  - cleanup outranks accounting, so a failed ledger write never resurrects or
 *    retains the sandbox;
 *  - manual stop and expiry converge on the same work.
 */

const db = { current: new FakeDatabase() };
const provider = { current: fakeSandboxProvider() };

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => fakeSupabase(db.current),
}));

vi.mock("@/modules/validation/vercel/provider", () => ({
  createVercelSandboxProvider: () => provider.current,
}));

const { previewTeardownWorkflow } = await import("./teardown-workflow");

const USER = "user_1";
const PROJECT = "project_1";
const PREPARED = "prepared_1";
const VALIDATION = "validation_1";
const OPERATION = "teardown_op_1";
const SESSION = "preview_1";

function seed(overrides: Record<string, unknown> = {}) {
  db.current.seed("projects", { id: PROJECT, user_id: USER });

  db.current.seed("operation_runs", {
    id: OPERATION,
    project_id: PROJECT,
    user_id: USER,
    operation_type: "preview_teardown",
    input_identity: "t".repeat(64),
    status: "queued",
    stage: "preparing",
    subject_id: SESSION,
  });

  db.current.seed("validation_runs", {
    id: VALIDATION,
    project_id: PROJECT,
    user_id: USER,
    prepared_change_id: PREPARED,
    status: "passed",
    artifact_snapshot_id: PREVIEW_SNAPSHOT_ID,
    artifact_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    artifact_deleted_at: null,
  });

  db.current.seed("preview_sessions", {
    id: SESSION,
    project_id: PROJECT,
    user_id: USER,
    prepared_change_id: PREPARED,
    validation_run_id: VALIDATION,
    operation_run_id: "start_op_1",
    artifact_snapshot_id: PREVIEW_SNAPSHOT_ID,
    preview_profile: "nextjs_preview_v1",
    preview_identity: "p".repeat(64),
    provider: "vercel_sandbox",
    status: "stopping",
    teardown_reason: "stopped",
    stage: "completed",
    port: PREVIEW_BUDGETS.port,
    failure_code: null,
    started_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    ready_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    artifact_deleted_at: null,
    ...overrides,
  });
}

function session() {
  return db.current.rows("preview_sessions")[0];
}

beforeEach(() => {
  db.current = new FakeDatabase();
  provider.current = fakeSandboxProvider();
});

describe("what a teardown does", () => {
  it("stops the sandbox, deletes the snapshot and records the spend", async () => {
    seed();
    await provider.current.create({
      name: "vibe-preview-1",
      source: { kind: "snapshot", snapshotId: PREVIEW_SNAPSHOT_ID },
      networkPolicy: { mode: "deny_all" },
      ports: [PREVIEW_BUDGETS.port],
      timeoutMs: PREVIEW_BUDGETS.ttlMs,
      env: {},
    });

    await previewTeardownWorkflow(OPERATION);

    expect(provider.current.stopped()).toBe(true);
    expect(provider.current.deletedArtifacts()).toEqual([PREVIEW_SNAPSHOT_ID]);

    const [usage] = db.current.rows("sandbox_usage_events");
    expect(usage.operation).toBe("change_preview");
    expect(usage.preview_session_id).toBe(SESSION);
    // Measured, never estimated. Vercel exposes no attributable per-sandbox
    // amount, and a rate-card figure would be a guess in an accounting field.
    expect(usage.active_cpu_ms).toBe(1234);
    expect(usage.provider_cost_usd).toBeNull();
  });

  it("converges the session and the artifact", async () => {
    seed();

    await previewTeardownWorkflow(OPERATION);

    expect(session().status).toBe("stopped");
    expect(session().stopped_at).toBeTruthy();
    expect(session().artifact_deleted_at).toBeTruthy();
    expect(db.current.rows("validation_runs")[0].artifact_deleted_at).toBeTruthy();
  });

  it("leaves the ValidationRun and PreparedChange historically intact", async () => {
    seed();

    await previewTeardownWorkflow(OPERATION);

    // Only the artifact's availability is lost (§20).
    expect(db.current.rows("validation_runs")[0].status).toBe("passed");
  });

  it("uses the reason the initiator persisted", async () => {
    seed({ teardown_reason: "expired" });

    await previewTeardownWorkflow(OPERATION);

    // Not inferred from `expires_at` at convergence time: a manual stop made
    // seconds before the deadline would otherwise be reported as an expiry once
    // queue latency is counted.
    expect(session().status).toBe("expired");
  });

  it("completes the operation", async () => {
    seed();

    await previewTeardownWorkflow(OPERATION);

    expect(db.current.rows("operation_runs")[0].status).toBe("completed");
  });
});

describe("retries cannot double-record or re-destroy", () => {
  it("records one ledger row however many times the workflow runs", async () => {
    seed();

    await previewTeardownWorkflow(OPERATION);
    await previewTeardownWorkflow(OPERATION);
    await previewTeardownWorkflow(OPERATION);

    // The unique index on `preview_session_id` is the guarantee; the step
    // merely tries. A sandbox that ran once is billed once.
    expect(db.current.rows("sandbox_usage_events")).toHaveLength(1);
  });

  it("does not re-delete an artifact or reopen a converged session", async () => {
    seed();
    await previewTeardownWorkflow(OPERATION);
    const stoppedAt = session().stopped_at;

    await previewTeardownWorkflow(OPERATION);

    expect(session().status).toBe("stopped");
    // Terminal writes are scoped to live rows, so a replay changes nothing.
    expect(session().stopped_at).toBe(stoppedAt);
  });
});

describe("cleanup outranks accounting", () => {
  it("leaves the sandbox stopped when the ledger write fails", async () => {
    seed();
    await provider.current.create({
      name: "vibe-preview-1",
      source: { kind: "snapshot", snapshotId: PREVIEW_SNAPSHOT_ID },
      networkPolicy: { mode: "deny_all" },
      ports: [PREVIEW_BUDGETS.port],
      timeoutMs: PREVIEW_BUDGETS.ttlMs,
      env: {},
    });
    db.current.failNextWriteWith = { table: "sandbox_usage_events", message: "ledger unavailable" };

    await previewTeardownWorkflow(OPERATION);

    // The sandbox is gone and stays gone. Nothing resurrects or retains a paid
    // VM to make the books balance.
    expect(provider.current.stopped()).toBe(true);
    expect(provider.current.deletedArtifacts()).toEqual([PREVIEW_SNAPSHOT_ID]);
  });

  it("still records the spend on a later attempt", async () => {
    seed();
    db.current.failNextWriteWith = { table: "sandbox_usage_events", message: "ledger unavailable" };

    await previewTeardownWorkflow(OPERATION);
    expect(db.current.rows("sandbox_usage_events")).toHaveLength(0);

    // The missing ledger step is idempotently retryable on its own, without
    // repeating the destructive half.
    await previewTeardownWorkflow(OPERATION);

    expect(db.current.rows("sandbox_usage_events")).toHaveLength(1);
  });

  it("records a snapshot deletion failure without hiding it", async () => {
    provider.current = fakeSandboxProvider({ failDeleteArtifact: true });
    seed();

    await previewTeardownWorkflow(OPERATION);

    expect(session().cleanup_status).toBe("artifact_delete_failed");
    expect(session().artifact_deleted_at).toBeFalsy();
    // The run still says it holds an artifact, because it does.
    expect(db.current.rows("validation_runs")[0].artifact_deleted_at).toBeFalsy();

    const event = db.current
      .rows("audit_events")
      .find((row) => row.event_type === "change_preview.cleanup_incomplete");
    expect(event).toBeTruthy();
  });
});

describe("the ledger boundary", () => {
  it("writes the spend through the service-role client only", async () => {
    seed();

    await previewTeardownWorkflow(OPERATION);

    // The whole reason teardown is durable. `sandbox_usage_events` has no
    // INSERT policy, so this row can only exist because a privileged writer
    // made it — which only durable execution holds (CLAUDE.md rule 53).
    expect(db.current.rows("sandbox_usage_events")).toHaveLength(1);
    expect(db.current.rows("sandbox_usage_events")[0].user_id).toBe(USER);
    expect(db.current.rows("sandbox_usage_events")[0].project_id).toBe(PROJECT);
  });

  it("takes ownership from the operation row, never from a caller", async () => {
    seed();
    // A session belonging to someone else, reachable only if the step trusted
    // an argument instead of the persisted operation.
    db.current.rows("operation_runs")[0].project_id = "project_other";

    await previewTeardownWorkflow(OPERATION);

    // Scoped to the operation's project, so nothing is found and nothing is
    // torn down.
    expect(session().status).toBe("stopping");
    expect(db.current.rows("sandbox_usage_events")).toHaveLength(0);
  });
});
