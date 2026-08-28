import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OperationExecutor } from "../executor";
import { expireStaleOperation } from "../staleness";
import { attachExecutionRun, createOperationRun, failOperationRun } from "../store";

/**
 * Starting an account erasure (ADR 0056 §4, ADR 0057).
 *
 * ## What the caller is allowed to say
 *
 * Nothing. There is no parameter naming an account, a project, or anything
 * else — the owner comes from the verified session at the call site and is
 * written onto the operation row, and every step afterwards re-reads it from
 * that row. An erasure is the operation where "a caller could name somebody
 * else" is least survivable, so there is no argument to put a name in.
 *
 * ## Why the identity is derived rather than random
 *
 * `operation_runs_single_active_account_idx` is unique over
 * `(user_id, operation_type, input_identity)` for active account-level rows, so
 * a stable identity makes a double click lose at the database rather than at a
 * read that can be raced (ADR 0057 §3). The index is partial on the active
 * statuses, which is what still allows a **retry after a failure** — a failed
 * erasure must not lock somebody out of erasing.
 *
 * ## What this does not do
 *
 * It does not warn, confirm, or explain. The consequence disclosure — that the
 * GitHub App is not uninstalled on GitHub's side, that an unused subscription
 * period is not refunded, and that nothing here can be undone — belongs to the
 * surface that offers the control, and ADR 0056 leaves that copy undecided.
 * **No user-facing erasure control is authorized by this module.**
 */

export type StartErasureResult =
  | { kind: "started"; operationId: string }
  | { kind: "active"; operationId: string }
  | { kind: "blocked"; reason: "erasure_start_failed" };

/** Stable per identity, so a second click collides instead of starting a second run. */
export function computeErasureIdentity(userId: string): string {
  return createHash("sha256").update(`account_erasure:v1:${userId}`).digest("hex");
}

export type ErasureRecord = {
  id: string;
  status: string;
  failureCode: string | null;
};

/**
 * The most recent erasure this account attempted, whatever became of it.
 *
 * "Is one running" is not the only question a settings screen has to answer. A
 * *failed* erasure stops being active the moment it fails, so a screen that
 * only asked the first question would respond to a failure by quietly redrawing
 * the button — indistinguishable, to the person looking at it, from never
 * having pressed it. That is the defect `findLatestOperation` was added for on
 * the project side, and it applies here for the same reason.
 *
 * Reads on the caller's own client, so RLS answers it: an account-level row is
 * visible to its owner and to nobody else (ADR 0057 §1).
 */
export async function findLatestErasure(
  supabase: SupabaseClient,
  userId: string,
): Promise<ErasureRecord | null> {
  const { data, error } = await supabase
    .from("operation_runs")
    .select("id, status, failure_code")
    .eq("user_id", userId)
    .eq("operation_type", "account_erasure")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const row = data as { id: string; status: string; failure_code: string | null };

  /*
   * The backstop, at the read that is the moment somebody cares (VB-014).
   *
   * The settings page is the only place an erasure's state is shown, so it is
   * the only place a died one can be noticed. Without this, a workflow that
   * stopped carrying an erasure leaves the row `running`, and
   * `startAccountErasure` answers every later attempt "already running" off the
   * account-level active index — so a person who asked to delete their account
   * could never ask again, and nothing anywhere would say why.
   *
   * Only a `running` row is worth the call; the sweep is idempotent and
   * bounded, and it refuses anything inside its deadline.
   */
  if (row.status !== "running") {
    return { id: row.id, status: row.status, failureCode: row.failure_code };
  }

  const { expired } = await expireStaleOperation({ operationId: row.id });
  if (!expired) {
    return { id: row.id, status: row.status, failureCode: row.failure_code };
  }

  return {
    id: row.id,
    status: "failed",
    failureCode: "operation_wall_clock_exceeded",
  };
}

export async function startAccountErasure(
  supabase: SupabaseClient,
  executor: OperationExecutor,
  params: {
    /** Always from `requireSession()`. Never accepted from a client argument. */
    userId: string;
  },
): Promise<StartErasureResult> {
  const inputIdentity = computeErasureIdentity(params.userId);

  const created = await createOperationRun(supabase, {
    // Null is the operation's subject, not a missing value: an erasure is about
    // the account (ADR 0057 §1).
    projectId: null,
    userId: params.userId,
    operationType: "account_erasure",
    inputIdentity,
    initiatedBy: "customer",
  });

  if (!created.ok) {
    // Somebody else — or the same person's second click — already started it.
    // Reporting the live one is the honest answer to both.
    if (created.error === "already_active") {
      const active = await supabase
        .from("operation_runs")
        .select("id")
        .eq("user_id", params.userId)
        .eq("operation_type", "account_erasure")
        .in("status", ["queued", "running", "needs_user"])
        .limit(1)
        .maybeSingle();

      if (active.data) return { kind: "active", operationId: (active.data as { id: string }).id };
    }
    return { kind: "blocked", reason: "erasure_start_failed" };
  }

  const operation = created.operation;

  const started = await executor.start({
    operationId: operation.id,
    operationType: "account_erasure",
  });

  if (!started.ok) {
    // The row exists and nothing durable is carrying it. Left queued it would
    // hold the account-level identity index forever *and* keep the start-path
    // trigger closed — freezing an account on a failure to enqueue.
    await failOperationRun(supabase, {
      operationId: operation.id,
      failureCode: "erasure_start_failed",
    });
    return { kind: "blocked", reason: "erasure_start_failed" };
  }

  await attachExecutionRun(supabase, {
    operationId: operation.id,
    workflowRunId: started.runId,
    executionProvider: executor.name,
  });

  return { kind: "started", operationId: operation.id };
}
