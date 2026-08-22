import { beforeAll, describe, expect, it } from "vitest";
import { startAgentExecution } from "@/modules/coding-agent/service";
import type { OperationExecutor } from "@/modules/operations/executor";
import { grantCreditLot } from "../grants";
import { findOperationReservation } from "../operation-billing";
import { creditsToUnits } from "../units";
import {
  createAgentScaffolding,
  createIterationExecutionSpec,
  type AgentScaffolding,
} from "./agent-fixture";
import {
  client,
  createFixtureUser,
  forEachIteration,
  isConfigured,
  ITERATIONS,
  readAllocatedAcrossLots,
  resolveTarget,
} from "./harness";

/**
 * Defect B, against real PostgreSQL — the corrective work E2b's verification
 * triggered, alongside class E.
 *
 * ## The defect
 *
 * `startAgentExecution` takes a Credit hold before calling `executor.start()`
 * (§55: money before work). When the executor refuses — `!started.ok` — the
 * operation is failed, but until this sprint nothing ever closed the hold.
 * Nothing else ever would have: the `agent_execution_runs` row this path
 * claims stays `queued` forever, and `expireStaleAgentExecution` ignores
 * `queued` deliberately — a run that has taken no provider call yet may
 * simply not have been picked up, and expiring it would race one about to
 * start. There is no reservation sweeper (rule 24) either. Not a race and not
 * a window — a deterministic leak on a path with no retry of its own.
 *
 * `service.ts` now calls `releaseOperationBilling` in this branch, reusing the
 * exact primitive the `agent_reservation_invalid` branch above it already
 * used — no new correctness mechanism, per the same instruction class E's own
 * fix followed.
 *
 * ## Why this is its own file rather than a scenario in class E
 *
 * It exercises a different production caller — `startAgentExecution`, not
 * `finishAgentExecutionStep` or `expireStaleAgentExecution` — and it is not a
 * race: one actor, one deterministic branch. Twenty iterations here are not
 * about catching a rare interleaving; they are what the shared harness
 * affords for cheap and a guard against a fix that only works once.
 *
 * ## Why every iteration gets its own execution spec
 *
 * `startAgentExecution`'s run-identity uniqueness (`agent_execution_runs_
 * single_active_idx`) excludes `failed` rows, so a *failed operation* never
 * blocks a retry with the same identity — "the user can simply try again" is
 * a designed, already-tested path. But this branch fails the *operation*
 * without ever touching the `agent_execution_runs` row `claimAgentExecutionRunRow`
 * wrote moments earlier: that row stays `queued`, which the same index
 * **does** count as active. Reusing one execution spec across iterations
 * would make every iteration after the first see its predecessor's run as
 * still live and return `{ kind: "running" }` instead of failing — proving
 * nothing. A fresh `spec_identity` per iteration produces a fresh
 * `run_identity`, so each attempt is independent by construction, same as
 * class E's per-iteration identity for the same reason.
 */

const FUNDING = creditsToUnits(5000);

const configured = isConfigured();

/** Always refuses — the shape production sees when the executor cannot enqueue. */
const refusingExecutor: OperationExecutor = {
  name: "e2b-refusing-executor",
  start: async () => ({ ok: false, error: "execution_start_failed" }),
};

describe.skipIf(!configured)("Defect B — a failed start releases its hold", () => {
  const admin = { current: null as ReturnType<typeof client> | null };
  const owner = { userId: "" };
  const creditAccountId = { current: "" };
  const scaffolding = { current: null as AgentScaffolding | null };

  beforeAll(async () => {
    resolveTarget();
    const supabase = client();
    admin.current = supabase;

    const user = await createFixtureUser(supabase, "start-failure");
    owner.userId = user.userId;

    const granted = await grantCreditLot(supabase, {
      userId: user.userId,
      sourceKind: "purchase",
      credits: FUNDING,
      reason: "concurrency fixture",
      idempotencyKey: `e2b:start-failure:${user.userId}`,
      expiresAt: null,
    });
    creditAccountId.current = granted.creditAccountId;

    scaffolding.current = await createAgentScaffolding(supabase, user.userId, "start-failure");

    // `resolveAgentEconomics` reads this allowlist from `process.env` directly
    // (by design — an operator decision, never database state a customer path
    // could reach), so the fixture project has to be named here for
    // `startAgentExecution` to get past "agentic_execution_not_authorized" and
    // reach the branch this file exists to prove.
    const existing = process.env.VIBE_INTERNAL_AGENT_DOGFOOD_PROJECT_IDS;
    process.env.VIBE_INTERNAL_AGENT_DOGFOOD_PROJECT_IDS = existing
      ? `${existing},${scaffolding.current.projectId}`
      : scaffolding.current.projectId;
  });

  it(`releases the hold every time the executor refuses to start, ${ITERATIONS} times`, async () => {
    await forEachIteration(async (iteration) => {
      const supabase = admin.current!;

      const executionSpecId = await createIterationExecutionSpec(
        supabase,
        scaffolding.current!,
        `start-failure-${iteration}`,
      );

      const outcome = await startAgentExecution(supabase, refusingExecutor, {
        projectId: scaffolding.current!.projectId,
        userId: owner.userId,
        executionSpecId,
      });

      expect(outcome).toEqual({ kind: "failed", error: "execution_start_failed" });

      // The outcome carries no operation id on failure, so the row this
      // attempt just wrote is the newest one for the project — true because
      // this test drives one actor at a time, unlike class E.
      const latest = await supabase
        .from("operation_runs")
        .select("id, status")
        .eq("project_id", scaffolding.current!.projectId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      if (latest.error) throw latest.error;
      const row = latest.data as { id: string; status: string };
      expect(row.status).toBe("failed");

      const reservation = await findOperationReservation(supabase, row.id);
      expect(reservation).not.toBeNull();
      expect(reservation!.status).toBe("released");

      const charges = await supabase
        .from("billing_credit_ledger")
        .select("id", { count: "exact", head: true })
        .eq("reservation_id", reservation!.id)
        .eq("kind", "charge");
      if (charges.error) throw charges.error;
      expect(charges.count ?? 0).toBe(0);

      // No stranded allocation: nothing was ever charged and this hold is now
      // released, so every lot on the account reads back to no capacity taken
      // at all — the account was funded once, up front, and every earlier
      // iteration must have already returned what it took.
      const allocated = await readAllocatedAcrossLots(supabase, creditAccountId.current);
      expect(allocated).toBe(0);
    });
  });
});
