import { beforeAll, describe, expect, it } from "vitest";
import { finishAgentExecutionStep } from "@/modules/operations/agent-execution/execution";
import { expireStaleAgentExecution } from "@/modules/operations/agent-execution/server-writes";
import { grantCreditLot } from "../grants";
import { internalChargeFor } from "../internal";
import { creditUnits } from "../units";
import { getReservation } from "../store";
import {
  createAgentScaffolding,
  createRunningAgentRun,
  deleteAgentRun,
  type AgentScaffolding,
} from "./agent-fixture";
import {
  client,
  clients,
  createFixtureUser,
  forEachIteration,
  isConfigured,
  ITERATIONS,
  resolveTarget,
} from "./harness";

/**
 * Race class E — one agent execution, one billing authority, under real MVCC.
 *
 * ## Why this class exists and D did not cover it
 *
 * D raced `settleOperationCredits` against `releaseOperationCredits` and found
 * that they overlap: 20 iterations out of 20 ended with a charge standing
 * against a hold recorded as released. That proved the *primitives* are not
 * mutually exclusive — a true and useful architectural fact, and not a defect
 * on its own, because primitives are not supposed to be the authority.
 *
 * What it did not answer is whether anything above them supplies that
 * authority. It does not, and the callers are two different processes:
 *
 * ```
 * workflow process       finishAgentExecutionStep   → settle or release
 * web request process    expireStaleAgentExecution  → release
 * ```
 *
 * `expireStaleAgentExecution` runs inside `getAgentExecutionStatus`, which the
 * run page polls, so it fires from request handlers while the workflow runs.
 * Both read the run's status and then act on it, and neither checked whether it
 * had won. This class drives those two callers against each other.
 *
 * ## What the fix was, and what it was not
 *
 * `completeAgentRun` and `failAgentRun` are compare-and-swap on
 * `agent_execution_runs.status` and both return whether they won. Gating each
 * caller's billing on that boolean makes the swap the single authority — no
 * lease, no heartbeat, no sweeper, no new table. It is the pattern the three
 * deterministic operation families already use on `operation_runs.status`.
 *
 * It does **not** decide whether declaring a run dead at `started_at` + 40
 * minutes is correct. After this, an expiry that wins stops the workflow from
 * charging later, which is the financially safe direction; a *false* expiry
 * still fails a run that was merely slow. That stays open.
 */

/**
 * Funded for the whole suite, derived rather than guessed.
 *
 * Every iteration takes one `agent_execution_dogfood` hold, and a hold that
 * *settles* is spent for good — nothing returns it. So the account has to cover
 * the worst case where all three scenarios charge on every iteration, and that
 * total moves whenever `ITERATIONS` does.
 *
 * It was a flat `creditsToUnits(5000)`, sized for twenty iterations and left
 * behind when Sprint 0069 raised them to sixty. The suite then exhausted the
 * account part-way through and failed in `createRunningAgentRun` with "fixture
 * could not reserve Credits" — a fixture running out of money, reported as
 * though the billing code had refused. Deriving it means the two numbers cannot
 * drift apart again.
 *
 * Deliberately the exact worst case rather than a padded one. Each iteration of
 * each scenario takes exactly one hold, so running out means the suite took
 * more holds than it has iterations — a defect in the suite, and one worth
 * failing on rather than hiding under headroom.
 */
const SCENARIOS = 3;
const HOLD =
  internalChargeFor("agent_execution_dogfood")?.creditUnits ??
  (() => {
    throw new Error("no internal price for agent_execution_dogfood");
  })();
const FUNDING = creditUnits(HOLD * SCENARIOS * ITERATIONS);

/** Long before any deadline this suite computes, so staleness is unambiguous. */
const STARTED_AT = "2026-01-01T00:00:00.000Z";
const PAST_DEADLINE = Date.parse("2026-01-02T00:00:00.000Z");
const BEFORE_DEADLINE = Date.parse("2026-01-01T00:00:01.000Z");

const configured = isConfigured();

/** Only the client: the finalizer reads and writes rows and calls nothing else. */
function deps(supabase: ReturnType<typeof client>) {
  return { supabase } as unknown as Parameters<typeof finishAgentExecutionStep>[0];
}

describe.skipIf(!configured)("E — one agent run, one billing authority", () => {
  const admin = { current: null as ReturnType<typeof client> | null };
  const owner = { userId: "" };
  const scaffolding = { current: null as AgentScaffolding | null };

  beforeAll(async () => {
    resolveTarget();
    const supabase = client();
    admin.current = supabase;

    const user = await createFixtureUser(supabase, "agent");
    owner.userId = user.userId;

    await grantCreditLot(supabase, {
      userId: user.userId,
      sourceKind: "purchase",
      credits: FUNDING,
      reason: "concurrency fixture",
      idempotencyKey: `e2b:agent:${user.userId}`,
      expiresAt: null,
    });

    // Eleven inert rows, built once. See `agent-fixture.ts` for why they have
    // to exist at all against a real database.
    scaffolding.current = await createAgentScaffolding(supabase, user.userId, "agent");
  });

  // No teardown. `execution_specs` carries a `BEFORE UPDATE OR DELETE` trigger
  // that unconditionally rejects mutation, including a mutation arriving as
  // `ON DELETE CASCADE` — so once this suite's scaffolding creates one such
  // row, neither the project nor the user above it can ever be deleted from
  // this database. See `deleteAgentScaffolding`'s former home in
  // `agent-fixture.ts` for the full trace of that discovery.
  //
  // That is not a gap to patch: the disposable database itself is the
  // cleanup, torn down whole (`supabase stop --no-backup`) at the end of the
  // job, exactly as ADR 0040 already reasons for the gate as a whole. The
  // only rows genuinely scoped to one iteration — and so the only ones that
  // would collide across iterations if left — are cleaned up by
  // `deleteAgentRun` in each `it` block's `finally`.

  async function runningRun(iteration: number, label: string) {
    const supabase = admin.current!;
    return createRunningAgentRun(supabase, {
      scaffolding: scaffolding.current!,
      userId: owner.userId,
      startedAt: STARTED_AT,
      identity: `${label}-${iteration}`,
    });
  }

  /** Everything the two actors could have written, read back from the rows. */
  async function terminalState(operationRunId: string, reservationId: string) {
    const supabase = admin.current!;

    const runRow = await supabase
      .from("agent_execution_runs")
      .select("status")
      .eq("operation_run_id", operationRunId)
      .single();
    if (runRow.error) throw runRow.error;

    const operationRow = await supabase
      .from("operation_runs")
      .select("status")
      .eq("id", operationRunId)
      .single();
    if (operationRow.error) throw operationRow.error;

    const charges = await supabase
      .from("billing_credit_ledger")
      .select("id", { count: "exact", head: true })
      .eq("reservation_id", reservationId)
      .eq("kind", "charge");
    if (charges.error) throw charges.error;

    const reservation = await getReservation(supabase, reservationId);

    return {
      runStatus: (runRow.data as { status: string }).status,
      operationStatus: (operationRow.data as { status: string }).status,
      charges: charges.count ?? 0,
      reservationStatus: reservation?.status ?? "missing",
    };
  }

  it(`lets exactly one actor finalize when both are due, ${ITERATIONS} times`, async () => {
    const winners: Record<string, number> = {};

    await forEachIteration(async (iteration) => {
      const fixture = await runningRun(iteration, "race");

      try {
        // Two clients, because these are two processes in production.
        const [workflow] = clients(1);
        await Promise.all([
          finishAgentExecutionStep(deps(workflow), fixture.operationRunId, {
            kind: "succeeded",
            preparedChangeId: fixture.preparedChangeId,
          }).catch(() => undefined),
          // Reads its own client from the environment, exactly as it does in a
          // request handler — which is why the target guard also requires the
          // application's own variables to name this same local stack.
          expireStaleAgentExecution({
            operationRunId: fixture.operationRunId,
            now: () => PAST_DEADLINE,
          }).catch(() => undefined),
        ]);

        const state = await terminalState(fixture.operationRunId, fixture.reservationId);

        // Exactly one agent terminal transition.
        expect(["succeeded", "failed"]).toContain(state.runStatus);

        // Exactly one billing terminal effect, and it agrees with the winner.
        if (state.runStatus === "succeeded") {
          expect(state.charges).toBe(1);
          expect(state.reservationStatus).toBe("settled");
        } else {
          expect(state.charges).toBe(0);
          expect(state.reservationStatus).toBe("released");
        }

        // Never both. This is the state E2b measured 20 of 20 times before the
        // authority existed: a customer charged against a hold the product
        // simultaneously recorded as abandoned.
        expect(
          state.charges === 1 && state.reservationStatus === "released",
          "charged against a hold recorded as released",
        ).toBe(false);

        // And the hold is closed either way — nothing stays reserved.
        expect(["settled", "released"]).toContain(state.reservationStatus);

        winners[state.runStatus] = (winners[state.runStatus] ?? 0) + 1;
      } finally {
        await deleteAgentRun(admin.current!, fixture.operationRunId);
      }
    });

    console.log(
      `\nE — ${ITERATIONS} iterations of workflow ‖ expiry, both due\n` +
        Object.entries(winners)
          .sort()
          .map(([status, count]) => `  run ended ${status}: ${count}`)
          .join("\n"),
    );
  });

  /**
   * Workflow wins, deterministically: the expiry is not due, so it must decline
   * and touch nothing.
   */
  it(`settles once when the run is not yet stale, ${ITERATIONS} times`, async () => {
    await forEachIteration(async (iteration) => {
      const fixture = await runningRun(iteration, "workflow-wins");

      try {
        const [workflow] = clients(1);
        const [, expiry] = await Promise.all([
          finishAgentExecutionStep(deps(workflow), fixture.operationRunId, {
            kind: "succeeded",
            preparedChangeId: fixture.preparedChangeId,
          }),
          expireStaleAgentExecution({
            operationRunId: fixture.operationRunId,
            now: () => BEFORE_DEADLINE,
          }),
        ]);

        expect(expiry).toEqual({ expired: false });

        const state = await terminalState(fixture.operationRunId, fixture.reservationId);
        expect(state.runStatus).toBe("succeeded");
        expect(state.operationStatus).toBe("completed");
        expect(state.charges).toBe(1);
        expect(state.reservationStatus).toBe("settled");
      } finally {
        await deleteAgentRun(admin.current!, fixture.operationRunId);
      }
    });
  });

  /**
   * Expiry wins, deterministically: it finishes first, and the workflow arrives
   * afterwards believing it succeeded. Before the fix this charged the customer
   * against a hold the expiry had already released.
   */
  it(`never charges after losing to a completed expiry, ${ITERATIONS} times`, async () => {
    await forEachIteration(async (iteration) => {
      const fixture = await runningRun(iteration, "expiry-wins");

      try {
        const expiry = await expireStaleAgentExecution({
          operationRunId: fixture.operationRunId,
          now: () => PAST_DEADLINE,
        });
        expect(expiry).toEqual({ expired: true });

        const [workflow] = clients(1);
        await finishAgentExecutionStep(deps(workflow), fixture.operationRunId, {
          kind: "succeeded",
          preparedChangeId: fixture.preparedChangeId,
        });

        const state = await terminalState(fixture.operationRunId, fixture.reservationId);
        expect(state.runStatus).toBe("failed");
        expect(state.operationStatus).toBe("failed");
        // The whole point: the late workflow does not charge.
        expect(state.charges).toBe(0);
        expect(state.reservationStatus).toBe("released");
      } finally {
        await deleteAgentRun(admin.current!, fixture.operationRunId);
      }
    });
  });
});
