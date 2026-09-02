import { beforeEach, describe, expect, it, vi } from "vitest";
import { creditsToUnits } from "@/modules/credits/units";
import { FakeDatabase, fakeSupabase } from "../test-support";

/*
 * The service-role client, replaced with a double over the same in-memory
 * database — the pattern `server-writes.test.ts` and `operations/service.test.ts`
 * already use. It matters more than usual here: the whole defect is that two
 * *different processes* finalize the same run's billing, and one of them builds
 * its own client rather than being handed one.
 */
const serviceDb = { current: new FakeDatabase() };
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => fakeSupabase(serviceDb.current),
}));

const { finishAgentExecutionStep } = await import("./execution");
const { expireStaleAgentExecution } = await import("./server-writes");
const { authorizeOperationCredits } = await import("@/modules/credits/operation-billing");
const { grantCreditLot } = await import("@/modules/credits/grants");
const { fakeAgentSpec } = await import("@/modules/coding-agent/test-support");

/**
 * One agent run, one billing authority.
 *
 * ## The defect these exist for
 *
 * Two independent processes can finalize the same agent execution's Credits:
 *
 * ```
 * workflow process        finishAgentExecutionStep  → settle or release
 * web request process     expireStaleAgentExecution → release
 * ```
 *
 * `expireStaleAgentExecution` runs inside `getAgentExecutionStatus`, which the
 * run page polls, so it fires from a request handler while the workflow runs in
 * its own durable process. Neither reads the other's state, and the deadline it
 * uses — `started_at` + sandbox lifetime + grace — is a guess about liveness,
 * not a fact about it: a workflow between step retries sits `running` past it
 * and then resumes.
 *
 * ## The exclusivity that already existed and was thrown away
 *
 * `completeAgentRun` and `failAgentRun` are both compare-and-swap on
 * `agent_execution_runs.status`, and both **return whether they won**. Every
 * caller discarded that boolean and finalized billing regardless. So the fix is
 * not a lease, a heartbeat, a sweeper or a new table — it is using the
 * primitive that is already there:
 *
 * **whoever wins the status swap owns the billing finalization.**
 *
 * The three deterministic operation families already work exactly this way, on
 * `operation_runs.status` — see `business-audit/execution.ts`, which gates
 * `settleOperationBilling` behind `if (!transitioned) return`. Agent execution
 * did not, and additionally called billing *before* the transition rather than
 * after it.
 *
 * ## What this does not fix, deliberately
 *
 * Whether a run may be declared dead at `started_at + 40 minutes` at all. After
 * this, an expiry that wins correctly stops the workflow from charging later —
 * which is the financially safe direction — but a *false* expiry still fails a
 * run that was merely slow. That is a liveness/lease question and stays open.
 */

const USER = "user_1";
const PROJECT = "project_1";
const BASE_SHA = "1f4b0c9d7a2e5f8b3c6d9e0a1b2c3d4e5f607182";
const HELD = 100;

/** Two hours before the fixture clock, so the staleness deadline is long past. */
const LONG_AGO = "2026-08-18T00:00:00.000Z";
const NOW = Date.parse("2026-08-18T04:00:00.000Z");

function db() {
  return serviceDb.current;
}

function supabase() {
  return fakeSupabase(serviceDb.current);
}

/**
 * Only the client. `finishAgentExecutionStep` reads and writes rows and calls
 * nothing else — handing it a sandbox provider or an agent runtime it never
 * touches would suggest this test is about the step graph, which it is not.
 */
function deps() {
  return { supabase: supabase() } as unknown as Parameters<typeof finishAgentExecutionStep>[0];
}

/** A funded project with one running agent execution holding Credits. */
async function seedRunningExecution(runStatus = "running") {
  db().seed("projects", { id: PROJECT, user_id: USER, production_url: "https://acme.com" });

  const spec = fakeAgentSpec();
  const specRow = db().seed("execution_specs", {
    project_id: PROJECT,
    step_key: spec.stepKey,
    step_order: spec.stepOrder,
    mode: "agentic",
    base_sha: BASE_SHA,
    spec: { ...spec, repository: { ...spec.repository, baseSha: BASE_SHA } },
    created_at: LONG_AGO,
  });

  const operation = db().seed("operation_runs", {
    project_id: PROJECT,
    user_id: USER,
    operation_type: "agent_execution",
    status: "running",
    stage: "executing",
    input_identity: "run-identity-1",
    subject_id: specRow.id,
    created_at: LONG_AGO,
  });

  await grantCreditLot(supabase(), {
    userId: USER,
    sourceKind: "purchase",
    credits: creditsToUnits(500),
    reason: "internal dogfood funding",
    idempotencyKey: "fund-1",
  });

  const authorized = await authorizeOperationCredits(supabase(), {
    projectId: PROJECT,
    operation: "agent_execution_dogfood",
    idempotencyKey: String(operation.id),
    operationRunId: String(operation.id),
  });
  if (!authorized.ok || !authorized.billable) throw new Error("fixture did not reserve");

  const run = db().seed("agent_execution_runs", {
    project_id: PROJECT,
    user_id: USER,
    operation_run_id: operation.id,
    execution_spec_id: specRow.id,
    run_identity: "run-identity-1",
    provider: "fake_provider",
    harness: "fake_harness",
    model: "claude-sonnet-5",
    budget_policy_version: "core4-dogfood-budget-v1",
    non_production_economics: true,
    base_sha: BASE_SHA,
    credit_reservation_id: authorized.reservationId,
    status: runStatus,
    started_at: LONG_AGO,
    created_at: LONG_AGO,
  });

  return {
    operationId: String(operation.id),
    runId: String(run.id),
    reservationId: authorized.reservationId,
  };
}

function reservation() {
  return db().rows("billing_credit_reservations")[0] as unknown as {
    status: string;
    reserved_credits: number;
  };
}

function charges(): unknown[] {
  return db()
    .rows("billing_credit_ledger")
    .filter((row) => (row as { kind: string }).kind === "charge");
}

function account() {
  return db().rows("billing_credit_accounts")[0] as unknown as {
    posted_credits: number;
    reserved_credits: number;
  };
}

beforeEach(() => {
  serviceDb.current = new FakeDatabase();
});

describe("the run-status swap decides who finalizes the money", () => {
  it("does not settle after losing the completion swap", async () => {
    // Somebody else already moved this run out of `running` — the expiry path,
    // or a second workflow attempt. The workflow then reports success.
    const { operationId } = await seedRunningExecution("failed");

    await finishAgentExecutionStep(deps(), operationId, {
      kind: "succeeded",
      preparedChangeId: "change-1",
    });

    // A charge here is a customer paying for a run this process was not
    // entitled to finalize.
    expect(charges()).toHaveLength(0);
    expect(reservation().status).toBe("active");
    expect(account().posted_credits).toBe(creditsToUnits(500));
  });

  it("does not release after losing the failure swap", async () => {
    // The mirror image: the run already completed, and a late failure arrives.
    const { operationId } = await seedRunningExecution("completed");

    await finishAgentExecutionStep(deps(), operationId, {
      kind: "failed",
      failureCode: "agent_change_rejected",
    });

    // Releasing here hands back a hold whose settlement is somebody else's to
    // make — the direction that loses Vibe the charge for delivered work.
    expect(reservation().status).toBe("active");
    expect(reservation().reserved_credits).toBe(creditsToUnits(HELD));
  });

  it("reports no expiry when it loses the failure swap, and touches no money", async () => {
    // The stale-run backstop arriving after the workflow already finished.
    const { operationId } = await seedRunningExecution("completed");

    const result = await expireStaleAgentExecution({
      operationRunId: operationId,
      now: () => NOW,
    });

    expect(result).toEqual({ expired: false });
    expect(reservation().status).toBe("active");
    expect(charges()).toHaveLength(0);
  });

  /**
   * The two production actors, against each other, on one run.
   *
   * This is the shape the defect actually takes: not two billing primitives
   * called side by side, but a workflow process and a request handler each
   * believing it owns the outcome.
   */
  it("lets exactly one of the workflow and the expiry finalize, whoever wins", async () => {
    const { operationId } = await seedRunningExecution();

    await Promise.all([
      finishAgentExecutionStep(deps(), operationId, {
        kind: "succeeded",
        preparedChangeId: "change-1",
      }),
      expireStaleAgentExecution({ operationRunId: operationId, now: () => NOW }),
    ]);

    const runs = db().rows("agent_execution_runs") as unknown as { status: string }[];
    expect(runs).toHaveLength(1);
    /*
     * Exactly one agent terminal transition happened.
     *
     * `succeeded` was missing from this list, and could be: in this harness the
     * expiry always wins the `Promise.all`, so the branch below has only ever
     * seen `failed`. The test directly after this one drives the other side.
     */
    expect(["succeeded", "failed"]).toContain(runs[0].status);

    /*
     * The winner's answer, and nobody else's.
     *
     * The completed side changed with ADR 0073 and the change is the point: a
     * finished agent run no longer charges. It leaves the hold open for the
     * validation verdict, because the price is for a *validated* improvement.
     * So "the workflow won" now means an untouched hold rather than a charge —
     * and the thing this test exists for is unchanged, that the loser wrote
     * nothing.
     */
    if (runs[0].status === "succeeded") {
      expect(charges()).toHaveLength(0);
      expect(reservation().status).toBe("active");
    } else {
      expect(charges()).toHaveLength(0);
      expect(reservation().status).toBe("released");
    }

    // Never both. A charge standing against a hold recorded as released is the
    // state E2b measured 20 times out of 20 against real PostgreSQL.
    expect(
      charges().length === 1 && reservation().status === "released",
      "charged against a hold recorded as released",
    ).toBe(false);
  });

  /**
   * The branch the race above cannot reach, driven directly (ADR 0073).
   *
   * `Promise.all` decides which actor wins, and in this harness the expiry
   * always does — so the settle side of that test has never executed. Stating
   * the completed side on its own is what makes "a finished run does not
   * charge" a fact this suite checks rather than one it happens to allow.
   */
  it("leaves the hold open when the workflow wins, because validation has not answered", async () => {
    const { operationId } = await seedRunningExecution();

    await finishAgentExecutionStep(deps(), operationId, {
      kind: "succeeded",
      preparedChangeId: "change-1",
    });

    const runs = db().rows("agent_execution_runs") as unknown as { status: string }[];
    expect(runs[0].status).toBe("succeeded");

    // The improvement exists. The *validated* improvement — which is what the
    // price is for — does not yet.
    expect(charges()).toHaveLength(0);
    expect(reservation().status).toBe("active");
    expect(account().posted_credits).toBe(creditsToUnits(500));
  });
});
