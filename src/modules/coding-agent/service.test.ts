import { beforeEach, describe, expect, it, vi } from "vitest";
import { creditsToUnits } from "@/modules/credits/units";
import { FakeDatabase, FakeExecutor, fakeSupabase } from "@/modules/operations/test-support";
import { AGENTIC_EXECUTION_CONFIG } from "@/modules/ai/operations";
import { computeAgentRunIdentity } from "./identity";
import { CODING_AGENT_POLICY_VERSION, AGENT_PROMPT_COMPILER_VERSION } from "./schema";
import { fakeAgentSpec } from "./test-support";

/*
 * The Credit hold and the run row are server-owned: both tables carry a select
 * policy and no write policy, so `startAgentExecution` takes them with the
 * service-role client (Rule 53). The double shares this test's in-memory
 * database, which is what production does too — one Postgres, two clients with
 * different write access to it.
 *
 * `operations/service.test.ts` sets the same double up for the same reason.
 */
const serviceDb = { current: new FakeDatabase() };
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => fakeSupabase(serviceDb.current),
}));

const { startAgentExecution } = await import("./service");

/**
 * Starting an agent execution
 * (EXECUTION CORE-4 §18, §53, §55, §56).
 *
 * Four §-numbered requirements meet in this one function, and each is a way a
 * paid, repository-writing operation could go wrong:
 *
 * ```
 * §18  a customer project cannot start one at all
 * §53  project A cannot operate on project B's spec
 * §55  no reservation → provider call count is zero
 * §56  a double click buys one agent, not two
 * ```
 */

const USER = "user_1";
const OTHER_USER = "user_2";
const PROJECT = "project_1";
const OTHER_PROJECT = "project_2";

let db: FakeDatabase;
let executor: FakeExecutor;

function seedProject(id: string, userId: string) {
  db.seed("projects", { id, user_id: userId, production_url: "https://acme.com" });
}

function seedSpec(id: string, projectId: string, overrides: Record<string, unknown> = {}) {
  const spec = fakeAgentSpec();
  db.seed("execution_specs", {
    id,
    project_id: projectId,
    action_plan_id: "plan-1",
    step_key: spec.stepKey,
    step_order: spec.stepOrder,
    business_audit_id: "audit-1",
    opportunity_id: "move-1",
    spec_identity: `identity-${id}`,
    mode: "agentic",
    execution_class: "application_code_change",
    risk_class: "moderate",
    repository_connection_id: "conn-1",
    base_sha: spec.repository.baseSha,
    repository_snapshot_id: spec.repository.repositorySnapshotId,
    capability: null,
    capability_version: null,
    credit_quote_id: null,
    max_authorized_credits: null,
    spec,
    schema_version: spec.schemaVersion,
    resolver_version: spec.resolverVersion,
    policy_version: spec.policyVersion,
    risk_policy_version: spec.riskPolicyVersion,
    created_at: "2026-08-18T00:00:00.000Z",
    ...overrides,
  });
}

/**
 * A funded internal account, through the real grant path.
 *
 * Seeding the rows by hand would produce a wallet the ledger disagrees with,
 * and every billing assertion here would then be about a shape rather than
 * about behaviour.
 */
async function fundWallet(userId: string, credits: number): Promise<void> {
  const { grantCreditLot } = await import("@/modules/credits/grants");
  await grantCreditLot(fakeSupabase(db), {
    userId,
    sourceKind: "purchase",
    credits: creditsToUnits(credits),
    reason: "internal dogfood funding",
    idempotencyKey: `dogfood-fund:${userId}:${credits}`,
  });
}

const ALLOWLISTED = { VIBE_INTERNAL_AGENT_DOGFOOD_PROJECT_IDS: PROJECT };

/**
 * Runs `body` with the allowlist set, and restores the environment after it
 * has actually finished.
 *
 * `await` inside the try rather than returning the promise: the allowlist is
 * read *during* the call, so restoring it while the body is still in flight
 * would make the authorization check see an unset variable and refuse — a
 * failure that looks exactly like the one these tests are meant to detect.
 */
async function withEnv<T>(env: Record<string, string>, body: () => Promise<T>): Promise<T> {
  const previous = { ...process.env };
  Object.assign(process.env, env);
  try {
    return await body();
  } finally {
    for (const key of Object.keys(env)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

beforeEach(async () => {
  db = new FakeDatabase();
  serviceDb.current = db;
  executor = new FakeExecutor();
  seedProject(PROJECT, USER);
  seedProject(OTHER_PROJECT, OTHER_USER);
  seedSpec("spec-1", PROJECT);
  seedSpec("spec-2", OTHER_PROJECT);
  await fundWallet(USER, 500);
  await fundWallet(OTHER_USER, 500);
});

describe("§18 — a customer project cannot start one", () => {
  it("refuses when the project is not on the internal allowlist", async () => {
    const outcome = await withEnv({ VIBE_INTERNAL_AGENT_DOGFOOD_PROJECT_IDS: "" }, () =>
      startAgentExecution(fakeSupabase(db), executor, {
        projectId: PROJECT,
        userId: USER,
        executionSpecId: "spec-1",
      }),
    );

    expect(await outcome).toEqual({
      kind: "failed",
      error: "agentic_execution_not_authorized",
    });

    // Nothing was queued, nothing was reserved, nothing was claimed.
    expect(db.rows("operation_runs")).toHaveLength(0);
    expect(db.rows("agent_execution_runs")).toHaveLength(0);
    expect(db.rows("billing_credit_reservations")).toHaveLength(0);
    expect(executor.starts).toHaveLength(0);
  });
});

describe("§53 — cross-project isolation", () => {
  it("cannot start project B's spec from project A", async () => {
    const outcome = await withEnv(ALLOWLISTED, () =>
      startAgentExecution(fakeSupabase(db), executor, {
        projectId: PROJECT,
        userId: USER,
        // Belongs to the other project.
        executionSpecId: "spec-2",
      }),
    );

    expect(await outcome).toEqual({ kind: "failed", error: "execution_spec_not_found" });
    expect(db.rows("agent_execution_runs")).toHaveLength(0);
  });

  it("cannot start another user's project, even naming its own spec", async () => {
    const outcome = await withEnv(
      { VIBE_INTERNAL_AGENT_DOGFOOD_PROJECT_IDS: `${PROJECT},${OTHER_PROJECT}` },
      () =>
        startAgentExecution(fakeSupabase(db), executor, {
          projectId: OTHER_PROJECT,
          // Not the owner.
          userId: USER,
          executionSpecId: "spec-2",
        }),
    );

    expect(await outcome).toEqual({ kind: "failed", error: "project_not_found" });
    expect(db.rows("agent_execution_runs")).toHaveLength(0);
  });

  it("refuses a spec that is not agentic", async () => {
    seedSpec("spec-deterministic", PROJECT, {
      mode: "deterministic",
      execution_class: null,
      capability: "nextjs_seo_foundations_v2",
      spec_identity: "identity-deterministic",
    });

    const outcome = await withEnv(ALLOWLISTED, () =>
      startAgentExecution(fakeSupabase(db), executor, {
        projectId: PROJECT,
        userId: USER,
        executionSpecId: "spec-deterministic",
      }),
    );

    expect(await outcome).toEqual({ kind: "failed", error: "spec_not_agentic" });
  });
});

describe("§55 — no reservation means no provider call", () => {
  it("starts nothing when the account cannot fund the ceiling", async () => {
    // Suspended rather than empty: the wallet holds enough Credits, and only
    // `claimReservation` asks whether this account may spend them. That is the
    // path a balance pre-check cannot reach, and the one §55 is about.
    db.rows("billing_credit_accounts")[0].status = "suspended";

    const outcome = await withEnv(ALLOWLISTED, () =>
      startAgentExecution(fakeSupabase(db), executor, {
        projectId: PROJECT,
        userId: USER,
        executionSpecId: "spec-1",
      }),
    );

    expect(await outcome).toEqual({ kind: "failed", error: "insufficient_credits" });

    // The operation exists and is failed — but no agent run was claimed, so no
    // provider execution can follow.
    expect(db.rows("agent_execution_runs")).toHaveLength(0);
    expect(executor.starts).toHaveLength(0);
  });

  it("reserves before it claims, and claims before it enqueues", async () => {
    const outcome = await withEnv(ALLOWLISTED, () =>
      startAgentExecution(fakeSupabase(db), executor, {
        projectId: PROJECT,
        userId: USER,
        executionSpecId: "spec-1",
      }),
    );

    const result = await outcome;
    expect(result.kind).toBe("started");

    const reservation = db.rows("billing_credit_reservations")[0];
    expect(reservation).toBeDefined();
    expect(reservation.status).toBe("active");

    const run = db.rows("agent_execution_runs")[0];
    expect(run.credit_reservation_id).toBe(reservation.id);
    expect(run.status).toBe("queued");
    // Marked, never inferred (§18).
    expect(run.non_production_economics).toBe(true);
    expect(run.model).toBe(AGENTIC_EXECUTION_CONFIG.model);

    expect(executor.starts).toHaveLength(1);
  });
});

describe("§56 — a double click buys one agent", () => {
  it("returns the live operation on a second start", async () => {
    const supabase = fakeSupabase(db);

    const first = await withEnv(ALLOWLISTED, () =>
      startAgentExecution(supabase, executor, {
        projectId: PROJECT,
        userId: USER,
        executionSpecId: "spec-1",
      }),
    );
    const second = await withEnv(ALLOWLISTED, () =>
      startAgentExecution(supabase, executor, {
        projectId: PROJECT,
        userId: USER,
        executionSpecId: "spec-1",
      }),
    );

    expect((await first).kind).toBe("started");
    expect((await second).kind).toBe("running");

    expect(db.rows("agent_execution_runs")).toHaveLength(1);
    expect(db.rows("operation_runs")).toHaveLength(1);
    expect(db.rows("billing_credit_reservations")).toHaveLength(1);
    expect(executor.starts).toHaveLength(1);
  });

  it("computes the same identity for the same work", () => {
    const identity = () =>
      computeAgentRunIdentity({
        projectId: PROJECT,
        executionSpecIdentity: "identity-spec-1",
        codingAgentPolicyVersion: CODING_AGENT_POLICY_VERSION,
        promptCompilerVersion: AGENT_PROMPT_COMPILER_VERSION,
        model: AGENTIC_EXECUTION_CONFIG.model,
        budgetPolicyVersion: "core4-dogfood-budget-v1",
      });

    expect(identity()).toBe(identity());
  });

  it("returns the existing change rather than running again", async () => {
    const supabase = fakeSupabase(db);

    await withEnv(ALLOWLISTED, () =>
      startAgentExecution(supabase, executor, {
        projectId: PROJECT,
        userId: USER,
        executionSpecId: "spec-1",
      }),
    );

    const prepared = db.seed("prepared_changes", {
      project_id: PROJECT,
      user_id: USER,
      operation_run_id: db.rows("operation_runs")[0].id,
      opportunity_set_id: null,
      opportunity_id: null,
      execution_capability: "agentic_execution_v1",
      execution_version: "agentic-execution-v1",
      repository_snapshot_id: "snapshot-1",
      base_branch: "main",
      base_sha: "abc1234",
      branch_name: "vibe/agent-deadbeef1234",
      commit_sha: "cafe1234",
      files: [],
      execution_identity: "change-identity",
      status: "prepared",
    });

    const run = db.rows("agent_execution_runs")[0];
    run.status = "succeeded";
    run.prepared_change_id = prepared.id;

    const again = await withEnv(ALLOWLISTED, () =>
      startAgentExecution(supabase, executor, {
        projectId: PROJECT,
        userId: USER,
        executionSpecId: "spec-1",
      }),
    );

    expect(await again).toEqual({
      kind: "reused",
      agentExecutionRunId: run.id,
      preparedChangeId: prepared.id,
    });
    expect(executor.starts).toHaveLength(1);
  });
});

/**
 * A run that never started must not keep the customer's Credits.
 *
 * ## The leak
 *
 * `startAgentExecution` reserves Credits, claims an `agent_execution_runs` row
 * as `queued`, and then asks the executor to enqueue durable work. When that
 * enqueue fails it failed the operation and returned — and nothing released the
 * hold. Its own comment said it did ("and releases the hold, because nothing
 * was spent"); the code did not.
 *
 * ## Why nothing else cleans it up
 *
 * This is not a race and not a window. It is deterministic, and permanent:
 *
 * ```
 * agent_execution_runs.status = queued
 * expireStaleAgentExecution   ignores queued, deliberately and correctly
 * reservation sweeper         does not exist
 * ```
 *
 * So the hold suppresses capacity the customer could spend, for as long as the
 * account exists — which is exactly the failure the `agent_reservation_invalid`
 * branch a few lines above was written to avoid, and it uses the same release
 * primitive this now uses.
 */
describe("a failed start returns the hold", () => {
  it("releases the reservation when the executor cannot enqueue the run", async () => {
    const failing = new FakeExecutor({ fail: true });

    const outcome = await withEnv(ALLOWLISTED, () =>
      startAgentExecution(fakeSupabase(db), failing, {
        projectId: PROJECT,
        userId: USER,
        executionSpecId: "spec-1",
      }),
    );

    expect(await outcome).toEqual({ kind: "failed", error: "execution_start_failed" });

    // The hold was taken, so it has to be given back — asserted on the rows,
    // not on the return value.
    const reservations = db.rows("billing_credit_reservations") as unknown as {
      status: string;
    }[];
    expect(reservations).toHaveLength(1);
    expect(reservations[0].status).not.toBe("active");

    const account = db.rows("billing_credit_accounts")[0] as unknown as {
      posted_credits: number;
      reserved_credits: number;
    };
    expect(account.reserved_credits).toBe(0);
    // Nothing was delivered, so nothing is charged either.
    expect(account.posted_credits).toBe(creditsToUnits(500));
    expect(
      db.rows("billing_credit_ledger").filter((row) => (row as { kind: string }).kind === "charge"),
    ).toHaveLength(0);

    // And no lot capacity stays taken for a run that never ran.
    const lots = db.rows("billing_credit_grants") as unknown as {
      allocated_credit_units: number;
    }[];
    expect(lots.reduce((total, lot) => total + lot.allocated_credit_units, 0)).toBe(0);

    // The operation is terminal so the identity index is free to try again.
    expect((db.rows("operation_runs")[0] as unknown as { status: string }).status).toBe("failed");
  });

  /**
   * ...but only when this path actually won the right to release it.
   *
   * The release above is correct precisely because nothing else was finalizing
   * that operation. This point is reached *after* `claimAgentExecutionRunRow`
   * succeeded, so a run row exists — and `executor.start` returning `!ok` says
   * only that this attempt failed, not that no workflow is running. A throw on
   * the *response* of an enqueue that already succeeded server-side yields
   * `{ ok: false }` for a live run that will finish, settle, and charge.
   *
   * Releasing unconditionally there is the unchecked-CAS shape Sprint 0057
   * E2b's class D proved produces `charge_without_hold`: the winner's charge
   * stands against a hold this path recorded as released. So the release is
   * gated on `failOperationRun`'s own compare-and-swap, exactly as the agent
   * finalizers were fixed to do.
   */
  it("leaves the hold alone when something else already finalized the operation", async () => {
    /** Fails the enqueue, but only after a concurrent finalizer has won. */
    class RacedExecutor extends FakeExecutor {
      constructor() {
        super({ fail: true });
      }

      async start(input: Parameters<FakeExecutor["start"]>[0]) {
        const operation = db.rows("operation_runs")[0] as unknown as {
          status: string;
          completed_at: string | null;
        };
        operation.status = "completed";
        operation.completed_at = "2026-08-02T00:00:00.000Z";
        return super.start(input);
      }
    }

    const outcome = await withEnv(ALLOWLISTED, () =>
      startAgentExecution(fakeSupabase(db), new RacedExecutor(), {
        projectId: PROJECT,
        userId: USER,
        executionSpecId: "spec-1",
      }),
    );

    expect(await outcome).toEqual({ kind: "failed", error: "execution_start_failed" });

    // The winner's terminal state stands, and its hold is left for it to settle.
    expect((db.rows("operation_runs")[0] as unknown as { status: string }).status).toBe("completed");
    const reservations = db.rows("billing_credit_reservations") as unknown as { status: string }[];
    expect(reservations).toHaveLength(1);
    expect(reservations[0].status).toBe("active");
  });
});
