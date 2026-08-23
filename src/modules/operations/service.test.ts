import { beforeEach, describe, expect, it, vi } from "vitest";
import { BUSINESS_READINESS_AUDIT_CONFIG } from "@/modules/ai/operations";
import { EVIDENCE_PACK_V3_VERSION } from "@/modules/business-audit/evidence-v3";
import { PROMPT_VERSION } from "@/modules/business-audit/prompt";
import { RUBRIC_VERSION } from "@/modules/business-audit/rubric";
import { BUSINESS_AUDIT_SCHEMA_VERSION, BUSINESS_AUDIT_VERSION } from "@/modules/business-audit/schema";
import { computeAuditInputHash } from "@/modules/business-audit/store";
import { creditsToUnits } from "@/modules/credits/units";
import {
  FakeDatabase,
  FakeExecutor,
  fakeSupabase,
  seedProductUnderstanding,
} from "./test-support";

/*
 * The credit hold is taken with the service-role client (§53, §64) — see the
 * comment in `service.ts` next to `createServiceClient()` for why. The double
 * shares the same in-memory database as the cookie-scoped `supabase` these
 * tests pass in directly, which is what production does too: one Postgres
 * database, two clients with different write access to it.
 */
const serviceDb = { current: new FakeDatabase() };
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => fakeSupabase(serviceDb.current),
}));

const {
  getActiveBusinessAuditOperation,
  getOperationStatus,
  startBusinessAuditOperation,
} = await import("./service");

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
  // CORE-2 §3: the audit's third prerequisite is the Product Profile, not a
  // paragraph the founder typed.
  seedProductUnderstanding(db, { projectId, intentHash: options.contextHash });
}

function identityFor(options: { repositoryId?: string; contextHash?: string } = {}) {
  return computeAuditInputHash({
    repositorySnapshotId: options.repositoryId ?? "repo_snapshot_1",
    liveSnapshotId: "live_snapshot_1",
    productProfileId: "profile_1",
    founderIntentHash: options.contextHash ?? "c".repeat(64),
    profileSchemaVersion: "product-profile.v1",
    profileBuilderVersion: "product-understanding-v1",
    authenticatedSnapshotId: null,
    schemaVersion: BUSINESS_AUDIT_SCHEMA_VERSION,
    auditVersion: BUSINESS_AUDIT_VERSION,
    evidencePackVersion: EVIDENCE_PACK_V3_VERSION,
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
  serviceDb.current = db;
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

/**
 * The entitlement gate (CORE-2 §16), and the defect the first dogfood found.
 *
 * The gate existed as a pure function and was never called on the write path.
 * A re-run on a project whose free audit was already spent therefore started,
 * paid for a model call, and only failed at `persisting` when the completed row
 * collided with the one-included-audit unique index.
 *
 * So the property under test is not "it refuses" — it is **where** it refuses:
 * before anything is claimed and before the executor is ever asked to start.
 */
describe("the free audit entitlement", () => {
  function seedConsumedEntitlement(projectId = PROJECT) {
    db.seed("repository_connections", {
      id: "conn_1",
      project_id: projectId,
      github_repository_id: 12345,
    });
    db.seed("free_audit_grants", {
      id: "grant_1",
      user_id: USER,
      github_repository_id: 12345,
    });
  }

  /** Funds the owner's wallet so the entitlement can be paid past with Credits. */
  async function fundWallet(credits: number, userId = USER): Promise<void> {
    const { grantCreditLot } = await import("@/modules/credits/grants");
    await grantCreditLot(fakeSupabase(db), {
      userId,
      sourceKind: "purchase",
      credits: creditsToUnits(credits),
      reason: "test funding",
      idempotencyKey: `test-fund:${userId}:${credits}`,
    });
  }

  it("runs a paid audit on Credits once the free one is spent (§39)", async () => {
    seedConsumedEntitlement();
    await fundWallet(100);

    const outcome = await start({ force: true });

    expect(outcome.kind).toBe("started");
    expect(executor.starts).toHaveLength(1);

    // 35 held, nothing charged yet — the charge follows a delivered result.
    const reservation = db.rows("billing_credit_reservations")[0];
    expect(reservation).toMatchObject({ status: "active", reserved_credits: creditsToUnits(35) });
    expect(db.rows("billing_credit_ledger").filter((row) => row.kind === "charge")).toHaveLength(0);
  });

  it("starts no provider work when the hold is refused (§82, §102.10)", async () => {
    /*
     * The branch a pre-check cannot reach.
     *
     * `checkOperationAffordability` turns away most under-funded runs before an
     * operation row exists, so "the *reservation* was refused" is a separate
     * path — the one that runs when two projects race for the last Credits, or
     * when the wallet is not in a state that may spend at all.
     *
     * Mutation testing found it uncovered: deleting the abort after a refused
     * hold left every other test green while the executor started anyway.
     *
     * Driven here through a suspended wallet, which is a state the pre-check
     * deliberately does not consider — it asks "are there enough Credits?",
     * and there are. Only `claimReservation` asks whether this account may
     * spend them.
     */
    seedConsumedEntitlement();
    await fundWallet(100);

    const wallet = db.rows("billing_credit_accounts")[0];
    wallet.status = "suspended";

    const outcome = await start({ force: true });

    expect(outcome).toEqual({ kind: "failed", error: "insufficient_credits" });
    // The property that matters: no provider work was enqueued.
    expect(executor.starts).toHaveLength(0);
    // And no hold was left behind.
    expect(db.rows("billing_credit_reservations").filter((row) => row.status === "active")).toHaveLength(0);
  });

  it("refuses a paid run once the free audit is consumed and no Credits exist", async () => {
    seedConsumedEntitlement();

    const outcome = await start({ force: true });

    /*
     * `insufficient_credits`, not `credits_required` (BILLING CORE-2 §39, §43).
     *
     * Before Core-2 a spent entitlement was the end of the road, because
     * Credits did not exist. Now it is a route into paying with them, and this
     * account simply has none — which is a statement about balance, and the
     * one the UI can act on by offering a way to get more.
     */
    expect(outcome).toEqual({ kind: "failed", error: "insufficient_credits" });
  });

  it("spends nothing: no operation row, and the executor is never started", async () => {
    seedConsumedEntitlement();

    await start({ force: true });

    expect(db.rows("operation_runs")).toHaveLength(0);
    expect(executor.starts).toHaveLength(0);
    expect(db.rows("business_readiness_audits")).toHaveLength(0);
  });

  /**
   * Reuse costs nothing, so it must keep working after the entitlement is
   * spent. Refusing here would take away an audit the user already paid for.
   */
  it("still returns an existing identical audit for free", async () => {
    seedConsumedEntitlement();
    db.seed("business_readiness_audits", {
      id: "audit_1",
      project_id: PROJECT,
      status: "completed",
      access_mode: "included_first_audit",
      input_hash: identityFor(),
      result: { schemaVersion: "business-readiness-audit.v1" },
      overall_score: 40,
      created_at: "2026-08-02T00:00:00.000Z",
    });

    expect(await start()).toEqual({ kind: "reused", auditId: "audit_1" });
  });

  it("allows the first audit when nothing has been consumed", async () => {
    expect((await start()).kind).toBe("started");
    expect(executor.starts).toHaveLength(1);
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

  /**
   * The failed-start release is gated on winning the terminal CAS, not on
   * `executor.start` having returned `!ok`.
   *
   * `executor.start` returning `!ok` says this attempt failed; it does not say
   * the workflow is not running. `VercelWorkflowExecutor.start` wraps a network
   * call, so a throw on the *response* — timeout, connection reset — after the
   * run was already enqueued server-side yields `{ ok: false }` for a workflow
   * that is alive and will finish, settle, and charge.
   *
   * Before the fix this branch called `failOperationRun` and discarded its
   * boolean, then released unconditionally — the exact unchecked-CAS shape
   * Sprint 0057 E2b's class D proved produces `charge_without_hold`: the
   * concurrent winner's charge stands while this path marks the hold released.
   * That is the same defect the agent-execution finalizers were fixed for, in
   * three more places (`business_audit`, `opportunity_generation`,
   * `action_planning`) plus one in `coding-agent/service.ts`.
   *
   * The concurrent finalizer is simulated the way the FakeDatabase-level tests
   * for the original defect did it: the operation is moved to a terminal status
   * out of band, so this path's own CAS must lose.
   */
  it("does not release a hold it did not win the right to release", async () => {
    // Consume the free entitlement and fund the wallet, so the run takes a real
    // Credit hold rather than riding the free audit — the hold is the subject.
    db.seed("repository_connections", { id: "conn_1", project_id: PROJECT, github_repository_id: 12345 });
    db.seed("free_audit_grants", { id: "grant_1", user_id: USER, github_repository_id: 12345 });
    const { grantCreditLot } = await import("@/modules/credits/grants");
    await grantCreditLot(fakeSupabase(db), {
      userId: USER,
      sourceKind: "purchase",
      credits: creditsToUnits(100),
      reason: "test funding",
      idempotencyKey: `test-fund:${USER}:race`,
    });

    /*
     * Fails the start, but only after something else has already finalized the
     * operation — the interleaving where a live workflow finished while this
     * caller was still waiting on a start response it never got.
     */
    class RacedExecutor extends FakeExecutor {
      constructor() {
        super({ fail: true });
      }

      async start(input: Parameters<FakeExecutor["start"]>[0]) {
        const operation = db.rows("operation_runs")[0];
        operation.status = "completed";
        operation.result_id = "audit_1";
        operation.completed_at = "2026-08-02T00:00:00.000Z";
        return super.start(input);
      }
    }

    const outcome = await startBusinessAuditOperation(fakeSupabase(db), new RacedExecutor(), {
      projectId: PROJECT,
      userId: USER,
      force: true,
    });

    expect(outcome).toEqual({ kind: "failed", error: "execution_start_failed" });

    // The winner's terminal state stands — this path must not overwrite it.
    expect(db.rows("operation_runs")[0].status).toBe("completed");

    // The property the fix exists for: the hold is left for the winner to
    // settle. Releasing it here is what would have let a charge stand against
    // a hold recorded as released.
    const reservations = db.rows("billing_credit_reservations");
    expect(reservations).toHaveLength(1);
    expect(reservations[0].status).toBe("active");
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

  /**
   * ADR 0042 §P2 — the same backstop `getAgentExecutionStatus` already runs
   * before its own read (`expireStaleAgentExecution`), generalized. A page
   * that has been polling a dead run should see it fail on the very read that
   * notices, not stay `running` forever (`staleness.test.ts` covers the
   * mechanism itself in full; this proves only that `getOperationStatus`
   * actually calls it).
   */
  it("fails an operation nothing is carrying any more on the read that notices", async () => {
    await start();
    const operation = db.rows("operation_runs")[0];
    operation.status = "running";
    operation.started_at = new Date(Date.now() - 60 * 60_000).toISOString();

    const status = await getOperationStatus(fakeSupabase(db), {
      projectId: PROJECT,
      operationId: String(operation.id),
    });

    expect(status?.status).toBe("failed");
    expect(db.rows("operation_runs")[0]).toMatchObject({
      status: "failed",
      failure_code: "operation_wall_clock_exceeded",
    });
  });
});
