import { beforeEach, describe, expect, it } from "vitest";
import { BUSINESS_READINESS_AUDIT_CONFIG } from "@/modules/ai/operations";
import { EVIDENCE_PACK_V2_VERSION } from "@/modules/business-audit/evidence-v2";
import { PROMPT_VERSION } from "@/modules/business-audit/prompt";
import { RUBRIC_VERSION } from "@/modules/business-audit/rubric";
import { BUSINESS_AUDIT_SCHEMA_VERSION, BUSINESS_AUDIT_VERSION } from "@/modules/business-audit/schema";
import { computeAuditInputHash } from "@/modules/business-audit/store";
import {
  getActiveBusinessAuditOperation,
  getOperationStatus,
  startBusinessAuditOperation,
} from "./service";
import { FakeDatabase, FakeExecutor, fakeSupabase } from "./test-support";

/**
 * Starting a durable audit (Sprint 7 §8, §9, §29).
 *
 * Almost every case here is about *not* doing something: not starting a
 * workflow, not starting a second one, not spending on an audit that already
 * exists. That balance is deliberate — the expensive mistakes in this system
 * are all duplicates.
 */

const USER = "user_1";
const OTHER_USER = "user_2";
const PROJECT = "project_1";

function seedProject(db: FakeDatabase, projectId = PROJECT, userId = USER) {
  db.seed("projects", { id: projectId, user_id: userId });
}

function seedEvidence(
  db: FakeDatabase,
  options: { projectId?: string; repositoryId?: string; contextHash?: string } = {},
) {
  const projectId = options.projectId ?? PROJECT;
  db.seed("repository_intelligence_snapshots", {
    id: options.repositoryId ?? "repo_snapshot_1",
    project_id: projectId,
    status: "completed",
    result: { schemaVersion: "repository_intelligence.v1" },
    created_at: "2026-08-01T00:00:00.000Z",
  });
  db.seed("live_product_intelligence_snapshots", {
    id: "live_snapshot_1",
    project_id: projectId,
    status: "completed",
    result: { schemaVersion: "live-product-intelligence.v1" },
    created_at: "2026-08-01T00:00:00.000Z",
    completed_at: "2026-08-01T00:00:00.000Z",
  });
  db.seed("project_business_context", {
    id: "context_1",
    project_id: projectId,
    product_summary: "A product summary long enough to be valid for the audit.",
    target_customer: "Builders",
    stage: "prototype",
    monetization_model: "none",
    primary_goal: "launch",
    context_hash: options.contextHash ?? "c".repeat(64),
    updated_at: "2026-08-01T00:00:00.000Z",
  });
}

function identityFor(options: { repositoryId?: string; contextHash?: string } = {}) {
  return computeAuditInputHash({
    repositorySnapshotId: options.repositoryId ?? "repo_snapshot_1",
    liveSnapshotId: "live_snapshot_1",
    businessContextHash: options.contextHash ?? "c".repeat(64),
    authenticatedSnapshotId: null,
    schemaVersion: BUSINESS_AUDIT_SCHEMA_VERSION,
    auditVersion: BUSINESS_AUDIT_VERSION,
    evidencePackVersion: EVIDENCE_PACK_V2_VERSION,
    promptVersion: PROMPT_VERSION,
    rubricVersion: RUBRIC_VERSION,
    provider: "anthropic",
    model: BUSINESS_READINESS_AUDIT_CONFIG.model,
  });
}

let db: FakeDatabase;
let executor: FakeExecutor;

beforeEach(() => {
  db = new FakeDatabase();
  executor = new FakeExecutor();
  seedProject(db);
  seedEvidence(db);
});

function start(params: { force?: boolean; userId?: string; projectId?: string } = {}) {
  return startBusinessAuditOperation(fakeSupabase(db), executor, {
    projectId: params.projectId ?? PROJECT,
    userId: params.userId ?? USER,
    force: params.force,
  });
}

describe("starting a business audit", () => {
  it("creates one operation and starts exactly one durable run", async () => {
    const outcome = await start();

    expect(outcome.kind).toBe("started");
    expect(db.rows("operation_runs")).toHaveLength(1);
    expect(executor.starts).toHaveLength(1);
  });

  it("records the input identity the audit domain would compute", async () => {
    await start();
    expect(db.rows("operation_runs")[0].input_identity).toBe(identityFor());
  });

  it("stores the durable run reference without exposing it", async () => {
    const outcome = await start();

    expect(db.rows("operation_runs")[0].workflow_run_id).toBe("run_1");
    expect(db.rows("operation_runs")[0].execution_provider).toBe("fake_executor");
    // The DTO carries no provider internals (§17).
    if (outcome.kind !== "started") throw new Error("expected started");
    expect(Object.keys(outcome.operation)).not.toContain("workflowRunId");
    expect(JSON.stringify(outcome.operation)).not.toContain("run_1");
  });

  it("returns quickly with a queued operation rather than a result", async () => {
    const outcome = await start();
    if (outcome.kind !== "started") throw new Error("expected started");

    expect(outcome.operation.status).toBe("queued");
    expect(outcome.operation.stage).toBe("preparing");
    expect(outcome.operation.shouldPoll).toBe(true);
  });
});

describe("reuse", () => {
  it("reuses an identical completed audit and starts nothing", async () => {
    db.seed("business_readiness_audits", {
      id: "audit_1",
      project_id: PROJECT,
      status: "completed",
      input_hash: identityFor(),
      result: { schemaVersion: "business-readiness-audit.v1" },
      overall_score: 40,
      created_at: "2026-08-02T00:00:00.000Z",
    });

    const outcome = await start();

    expect(outcome).toEqual({ kind: "reused", auditId: "audit_1" });
    expect(executor.starts).toHaveLength(0);
    expect(db.rows("operation_runs")).toHaveLength(0);
  });

  it("does not reuse an audit produced from different evidence", async () => {
    db.seed("business_readiness_audits", {
      id: "audit_old",
      project_id: PROJECT,
      status: "completed",
      input_hash: identityFor({ contextHash: "d".repeat(64) }),
      result: {},
      created_at: "2026-08-02T00:00:00.000Z",
    });

    const outcome = await start();

    expect(outcome.kind).toBe("started");
    expect(executor.starts).toHaveLength(1);
  });

  it("does not reuse a failed audit", async () => {
    db.seed("business_readiness_audits", {
      id: "audit_failed",
      project_id: PROJECT,
      status: "failed",
      input_hash: identityFor(),
      failure_code: "provider_timeout",
      created_at: "2026-08-02T00:00:00.000Z",
    });

    expect((await start()).kind).toBe("started");
  });

  it("force skips result reuse and buys a new run", async () => {
    db.seed("business_readiness_audits", {
      id: "audit_1",
      project_id: PROJECT,
      status: "completed",
      input_hash: identityFor(),
      result: {},
      created_at: "2026-08-02T00:00:00.000Z",
    });

    expect((await start({ force: true })).kind).toBe("started");
    expect(executor.starts).toHaveLength(1);
  });
});

describe("double-spend protection (§8)", () => {
  it("returns the existing operation instead of starting a second", async () => {
    await start();
    const second = await start();

    expect(second.kind).toBe("active");
    expect(db.rows("operation_runs")).toHaveLength(1);
    expect(executor.starts).toHaveLength(1);
  });

  it("answers from the application check without attempting a second insert", async () => {
    await start();
    // Any insert into operation_runs now fails. A second start must still
    // return the live operation, which it can only do by checking first —
    // the constraint is the backstop, not the normal path.
    db.failNextWriteWith = { table: "operation_runs", message: "must not insert" };

    expect((await start()).kind).toBe("active");
    expect(db.failNextWriteWith).not.toBeNull();
  });

  it("survives two starts racing past the application-level check", async () => {
    // Both calls resolve their identity before either inserts, which is
    // exactly what two clicks 20ms apart do. Only the unique index can
    // separate them.
    const [first, second] = await Promise.all([start(), start()]);

    const kinds = [first.kind, second.kind].sort();
    expect(kinds).toEqual(["active", "started"]);
    expect(db.rows("operation_runs")).toHaveLength(1);
    expect(executor.starts).toHaveLength(1);
  });

  it("refuses a second run even under force while one is live", async () => {
    await start();
    const forced = await start({ force: true });

    expect(forced.kind).toBe("active");
    expect(executor.starts).toHaveLength(1);
  });

  it("allows a new operation once the previous one is terminal", async () => {
    await start();
    const operation = db.rows("operation_runs")[0];
    operation.status = "failed";
    operation.failure_code = "provider_timeout";
    operation.completed_at = "2026-08-02T00:00:00.000Z";

    expect((await start()).kind).toBe("started");
    expect(db.rows("operation_runs")).toHaveLength(2);
  });
});

describe("prerequisites and ownership", () => {
  it("refuses a project the caller does not own", async () => {
    const outcome = await start({ userId: OTHER_USER });

    expect(outcome).toEqual({ kind: "failed", error: "project_not_found" });
    expect(executor.starts).toHaveLength(0);
  });

  it("names the missing evidence rather than failing opaquely", async () => {
    const bare = new FakeDatabase();
    seedProject(bare);
    const outcome = await startBusinessAuditOperation(fakeSupabase(bare), executor, {
      projectId: PROJECT,
      userId: USER,
    });

    expect(outcome).toEqual({ kind: "failed", error: "repository_intelligence_missing" });
    expect(executor.starts).toHaveLength(0);
  });

  it("fails the operation when the run cannot be enqueued, freeing the identity", async () => {
    const failing = new FakeExecutor({ fail: true });
    const outcome = await startBusinessAuditOperation(fakeSupabase(db), failing, {
      projectId: PROJECT,
      userId: USER,
    });

    expect(outcome).toEqual({ kind: "failed", error: "execution_start_failed" });
    // Left queued, the row would block this identity's unique index forever.
    expect(db.rows("operation_runs")[0].status).toBe("failed");

    const retry = await start();
    expect(retry.kind).toBe("started");
  });
});

describe("reading operation state", () => {
  it("finds the live operation after a page reload", async () => {
    await start();

    const active = await getActiveBusinessAuditOperation(fakeSupabase(db), PROJECT);

    expect(active?.status).toBe("queued");
    expect(active?.shouldPoll).toBe(true);
    // Crucially, reloading discovered it — it did not start anything.
    expect(executor.starts).toHaveLength(1);
  });

  it("reports nothing live once the operation completes", async () => {
    await start();
    const operation = db.rows("operation_runs")[0];
    operation.status = "completed";
    operation.stage = "completed";
    operation.result_id = "audit_1";
    operation.completed_at = "2026-08-02T00:00:00.000Z";

    expect(await getActiveBusinessAuditOperation(fakeSupabase(db), PROJECT)).toBeNull();
  });

  it("links the completed operation to its audit", async () => {
    await start();
    const operation = db.rows("operation_runs")[0];
    operation.status = "completed";
    operation.stage = "completed";
    operation.result_id = "audit_7";
    operation.completed_at = "2026-08-02T00:00:00.000Z";

    const status = await getOperationStatus(fakeSupabase(db), {
      projectId: PROJECT,
      operationId: String(operation.id),
    });

    expect(status?.resultId).toBe("audit_7");
    expect(status?.shouldPoll).toBe(false);
  });

  it("does not return an operation belonging to another project", async () => {
    await start();
    const operationId = String(db.rows("operation_runs")[0].id);

    seedProject(db, "project_2", USER);
    const status = await getOperationStatus(fakeSupabase(db), {
      projectId: "project_2",
      operationId,
    });

    expect(status).toBeNull();
  });

  it("exposes a failed operation with its typed code and nothing else", async () => {
    await start();
    const operation = db.rows("operation_runs")[0];
    operation.status = "failed";
    operation.failure_code = "provider_refusal";
    operation.completed_at = "2026-08-02T00:00:00.000Z";

    const status = await getOperationStatus(fakeSupabase(db), {
      projectId: PROJECT,
      operationId: String(operation.id),
    });

    expect(status?.failureCode).toBe("provider_refusal");
    expect(status?.shouldPoll).toBe(false);
    // A refusal is not a "try again" — the same input would be refused again.
    expect(status?.retryAllowed).toBe(false);
  });
});
