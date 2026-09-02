import { beforeEach, describe, expect, it } from "vitest";
import { creditsToUnits } from "@/modules/credits/units";
import { authorizeOperationCredits } from "@/modules/credits/operation-billing";
import { grantCreditLot } from "@/modules/credits/grants";
import { FakeDatabase, fakeSupabase } from "@/modules/operations/test-support";
import { resolveAgentHold } from "./hold";

/**
 * What the customer's Credits are actually taken for (ADR 0073).
 *
 * ## Why this is asserted against the real billing chain
 *
 * Because the defect it closes was invisible to every test that existed.
 * Settlement moved out of `finishAgentExecutionStep` and **not one test
 * failed** — the only assertion that a delivered run charges lived on the
 * winning branch of a race the harness never lets the workflow win.
 *
 * So nothing here stubs a reservation. The hold is created by
 * `authorizeOperationCredits` against a funded account, and the assertions read
 * the reservation row and the ledger the way the database records them.
 */

const PROJECT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

let db: FakeDatabase;
const supabase = () => fakeSupabase(db);

async function seedPreparedChange(): Promise<{ preparedChangeId: string; reservationId: string }> {
  db.seed("projects", { id: PROJECT, user_id: USER, production_url: "https://acme.com" });

  const operation = db.seed("operation_runs", {
    project_id: PROJECT,
    user_id: USER,
    operation_type: "agent_execution",
    status: "running",
    stage: "executing",
    input_identity: "run-identity-1",
  });

  await grantCreditLot(supabase(), {
    userId: USER,
    sourceKind: "purchase",
    credits: creditsToUnits(500),
    reason: "test funding",
    idempotencyKey: "fund-1",
  });

  const authorized = await authorizeOperationCredits(supabase(), {
    projectId: PROJECT,
    operation: "agent_execution_dogfood",
    idempotencyKey: String(operation.id),
    operationRunId: String(operation.id),
  });
  if (!authorized.ok || !authorized.billable) throw new Error("fixture did not reserve");

  db.seed("agent_execution_runs", {
    project_id: PROJECT,
    user_id: USER,
    operation_run_id: operation.id,
    execution_spec_id: "33333333-3333-4333-8333-333333333333",
    run_identity: "run-identity-1",
    provider: "fake_provider",
    harness: "fake_harness",
    model: "claude-sonnet-5",
    budget_policy_version: "core4-dogfood-budget-v1",
    non_production_economics: true,
    base_sha: "b".repeat(40),
    credit_reservation_id: authorized.reservationId,
    status: "succeeded",
  });

  const prepared = db.seed("prepared_changes", {
    project_id: PROJECT,
    user_id: USER,
    operation_run_id: operation.id,
    execution_capability: "agentic_execution_v1",
    execution_version: "agentic-execution-v1",
    repository_snapshot_id: "44444444-4444-4444-8444-444444444444",
    base_branch: "main",
    base_sha: "b".repeat(40),
    branch_name: "vibe/agent-1",
    commit_sha: "c".repeat(40),
    files: [{ path: "src/app/page.tsx", contentHash: "a".repeat(64), bytes: 512 }],
    status: "prepared",
  });

  return { preparedChangeId: String(prepared.id), reservationId: authorized.reservationId };
}

function reservation() {
  return db.rows("billing_credit_reservations")[0] as unknown as {
    status: string;
    settled_credits: number | null;
    release_reason: string | null;
  };
}

function charges(): unknown[] {
  return db.rows("billing_credit_ledger").filter((row) => (row as { kind: string }).kind === "charge");
}

beforeEach(() => {
  db = new FakeDatabase();
});

describe("a validated improvement is what is charged for", () => {
  it("settles the agent's hold when validation passes", async () => {
    const { preparedChangeId, reservationId } = await seedPreparedChange();

    const resolved = await resolveAgentHold(supabase(), {
      projectId: PROJECT,
      preparedChangeId,
      outcome: "validated",
    });

    expect(resolved).toEqual({ kind: "settled", reservationId, alreadySettled: false });
    expect(reservation().status).toBe("settled");
    expect(charges()).toHaveLength(1);
  });

  it("releases it when validation does not pass, and charges nothing", async () => {
    // CREDIT_ECONOMICS.md's approved failure policy: Vibe paid the provider,
    // the customer pays nothing. `abandoned_with_usage` keeps the two facts
    // apart rather than pretending the tokens were free.
    const { preparedChangeId, reservationId } = await seedPreparedChange();

    const resolved = await resolveAgentHold(supabase(), {
      projectId: PROJECT,
      preparedChangeId,
      outcome: "unvalidated",
    });

    expect(resolved).toEqual({ kind: "released", reservationId });
    expect(reservation().status).toBe("released");
    expect(reservation().release_reason).toBe("abandoned_with_usage");
    expect(charges()).toHaveLength(0);
  });
});

describe("a verdict that arrives twice", () => {
  it("charges once", async () => {
    const { preparedChangeId } = await seedPreparedChange();
    const params = { projectId: PROJECT, preparedChangeId, outcome: "validated" as const };

    await resolveAgentHold(supabase(), params);
    const second = await resolveAgentHold(supabase(), params);

    expect(second).toMatchObject({ kind: "settled", alreadySettled: true });
    expect(charges()).toHaveLength(1);
  });

  it("releases once", async () => {
    const { preparedChangeId } = await seedPreparedChange();
    const params = { projectId: PROJECT, preparedChangeId, outcome: "unvalidated" as const };

    await resolveAgentHold(supabase(), params);
    const second = await resolveAgentHold(supabase(), params);

    expect(second).toMatchObject({ kind: "already_closed" });
    expect(reservation().status).toBe("released");
  });
});

describe("a hold that was already closed the other way", () => {
  it("never charges a released hold", async () => {
    // The shape a stale sweep racing a verdict takes. Releasing first must not
    // leave a later pass able to charge against a hold the customer got back.
    const { preparedChangeId } = await seedPreparedChange();

    await resolveAgentHold(supabase(), {
      projectId: PROJECT,
      preparedChangeId,
      outcome: "unvalidated",
    });
    const late = await resolveAgentHold(supabase(), {
      projectId: PROJECT,
      preparedChangeId,
      outcome: "validated",
    });

    expect(late.kind).toBe("already_closed");
    expect(charges()).toHaveLength(0);
    expect(reservation().status).toBe("released");
  });

  it("never releases a settled hold", async () => {
    // The damaging direction: handing back money for work that was delivered
    // and paid for.
    const { preparedChangeId } = await seedPreparedChange();

    await resolveAgentHold(supabase(), {
      projectId: PROJECT,
      preparedChangeId,
      outcome: "validated",
    });
    const late = await resolveAgentHold(supabase(), {
      projectId: PROJECT,
      preparedChangeId,
      outcome: "unvalidated",
    });

    expect(late.kind).toBe("already_closed");
    expect(reservation().status).toBe("settled");
    expect(charges()).toHaveLength(1);
  });
});

describe("changes with no agent hold behind them", () => {
  it("reports a deterministic generator's change as having no hold", async () => {
    // A prepared change whose run reserved nothing. Not an error, and not a
    // reason to invent a charge.
    db.seed("projects", { id: PROJECT, user_id: USER, production_url: "https://acme.com" });
    const operation = db.seed("operation_runs", {
      project_id: PROJECT,
      user_id: USER,
      operation_type: "agent_execution",
      status: "completed",
      input_identity: "run-identity-2",
    });
    db.seed("agent_execution_runs", {
      project_id: PROJECT,
      user_id: USER,
      operation_run_id: operation.id,
      execution_spec_id: "33333333-3333-4333-8333-333333333333",
      run_identity: "run-identity-2",
      provider: "fake_provider",
      harness: "fake_harness",
      model: "claude-sonnet-5",
      budget_policy_version: "core4-dogfood-budget-v1",
      base_sha: "b".repeat(40),
      credit_reservation_id: null,
      status: "succeeded",
    });
    const prepared = db.seed("prepared_changes", {
      project_id: PROJECT,
      user_id: USER,
      operation_run_id: operation.id,
      execution_capability: "nextjs_seo_foundations_v2",
      execution_version: "nextjs-seo-foundations-v2",
      base_branch: "main",
      base_sha: "b".repeat(40),
      branch_name: "vibe/seo-1",
      status: "prepared",
    });

    expect(
      await resolveAgentHold(supabase(), {
        projectId: PROJECT,
        preparedChangeId: String(prepared.id),
        outcome: "validated",
      }),
    ).toEqual({ kind: "no_hold" });
  });

  it("refuses a prepared change belonging to another project", async () => {
    // The lookup runs under the service-role client, which bypasses RLS, so the
    // ownership it filters on has to be the ownership the database recorded
    // (rule 53). A wrong project must find nothing rather than another
    // tenant's hold.
    const { preparedChangeId } = await seedPreparedChange();

    expect(
      await resolveAgentHold(supabase(), {
        projectId: "99999999-9999-4999-8999-999999999999",
        preparedChangeId,
        outcome: "validated",
      }),
    ).toEqual({ kind: "not_found" });
    expect(charges()).toHaveLength(0);
  });
});
