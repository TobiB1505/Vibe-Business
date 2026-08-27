import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { REVIEW_BUCKET } from "@/modules/review/storage";
import { OPERATION_STATUSES, isActive } from "@/modules/operations/schema";

/**
 * The service-role reads and writes behind project deletion (ADR 0056 §3).
 *
 * Everything here runs with the service-role client, so every query filters on
 * ownership taken from the caller's verified session — never from a client
 * argument (rule 53). The deletion itself repeats that check inside the
 * database function, so a bug here still cannot cross tenants.
 */

/**
 * The operation statuses that block a deletion, **derived from `isActive()`
 * rather than restated.**
 *
 * This is the trap ADR 0056 §10 names. `operations/store.ts` has its own
 * `ACTIVE_STATUSES`, and it is `queued`/`running` only — it deliberately omits
 * `needs_user`, because it answers "is something *working*". A gate built on
 * that set would delete a project holding a paused audit that still owns a live
 * Credit reservation.
 *
 * Deriving it means `isActive()` stays the single definition: if a fourth
 * status ever counts as active, this gate follows without anybody remembering.
 */
const BLOCKING_OPERATION_STATUSES = OPERATION_STATUSES.filter(isActive);

/** Agent run states that mean a sandbox may still write. */
const BLOCKING_AGENT_STATUSES = ["queued", "running", "needs_user_input"] as const;

/** `preflight` means a write may still be attempted; `merging` means one is. */
const BLOCKING_MERGE_STATUSES = ["preflight", "merging"] as const;

export type BlockingWork =
  | "active_operation"
  | "agent_running"
  | "merge_in_progress"
  | "billing_not_finalized";

/**
 * The first reason this project may not be deleted, or `null`.
 *
 * No such query existed before: every lookup in `operations/store.ts` is keyed
 * by `operation_type`, because every caller so far wanted one kind of work.
 * Deletion is the first caller that has to ask "is *anything* live", so the
 * type-agnostic question is asked here.
 *
 * The order is the order of consequence, not of cost. An operation is checked
 * first because it is the broadest; a Credit reservation last because it is the
 * one whose authority belongs to somebody else entirely (see below).
 */
export async function findBlockingWork(
  supabase: SupabaseClient,
  projectId: string,
): Promise<BlockingWork | null> {
  const operation = await supabase
    .from("operation_runs")
    .select("id")
    .eq("project_id", projectId)
    .in("status", [...BLOCKING_OPERATION_STATUSES])
    .limit(1)
    .maybeSingle();
  if (operation.error) throw operation.error;
  if (operation.data) return "active_operation";

  const agentRun = await supabase
    .from("agent_execution_runs")
    .select("id")
    .eq("project_id", projectId)
    .in("status", [...BLOCKING_AGENT_STATUSES])
    .limit(1)
    .maybeSingle();
  if (agentRun.error) throw agentRun.error;
  if (agentRun.data) return "agent_running";

  const merge = await supabase
    .from("change_merges")
    .select("id")
    .eq("project_id", projectId)
    .in("status", [...BLOCKING_MERGE_STATUSES])
    .limit(1)
    .maybeSingle();
  if (merge.error) throw merge.error;
  if (merge.data) return "merge_in_progress";

  /**
   * A hold this deletion must **wait for**, never release.
   *
   * Settling or releasing a reservation is the CAS-gated finalizers' authority
   * (ADR 0042). Deletion taking it would risk the `charge_without_hold` class
   * four sprints of billing work went into eliminating — so deletion refuses
   * and the finalizer does its job.
   */
  const reservation = await supabase
    .from("billing_credit_reservations")
    .select("id")
    .eq("project_id", projectId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (reservation.error) throw reservation.error;
  if (reservation.data) return "billing_not_finalized";

  return null;
}

/**
 * Loop guards, not product budgets.
 *
 * Supabase's `list` returns at most 100 entries per call, so a project with
 * many review artifacts needs paging. These caps exist so a provider that keeps
 * returning a full page cannot spin forever; at 100 pages of 100 they are two
 * orders of magnitude above anything V0.1 produces (two screenshots per review
 * artifact), and reaching one is reported as a failed sweep rather than
 * silently treated as "that was all of them".
 */
const STORAGE_PAGE_SIZE = 100;
const STORAGE_MAX_PAGES = 100;

async function listAll(
  supabase: SupabaseClient,
  prefix: string,
): Promise<{ ok: true; names: string[] } | { ok: false }> {
  const names: string[] = [];

  for (let page = 0; page < STORAGE_MAX_PAGES; page += 1) {
    const { data, error } = await supabase.storage
      .from(REVIEW_BUCKET)
      .list(prefix, { limit: STORAGE_PAGE_SIZE, offset: page * STORAGE_PAGE_SIZE });

    if (error) return { ok: false };
    const entries = data ?? [];
    names.push(...entries.map((entry) => entry.name));
    if (entries.length < STORAGE_PAGE_SIZE) return { ok: true, names };
  }

  // Still full after the cap: there is more than this sweep can see, and
  // saying so is the difference between a retryable failure and a silent
  // half-deletion.
  return { ok: false };
}

/**
 * Every screenshot object under one project's prefix.
 *
 * Two levels, because `list` is not recursive and
 * `review/identity.ts:reviewObjectPath` lays the bucket out as
 * `{projectId}/{reviewArtifactId}/{side}.png`. That prefix layout is what makes
 * the sweep possible from the project id alone — and therefore what makes an
 * orphaned-bytes failure discoverable without a surviving database row
 * (ADR 0056, failure and retry semantics).
 */
export async function listProjectScreenshotPaths(
  supabase: SupabaseClient,
  projectId: string,
): Promise<{ ok: true; paths: string[] } | { ok: false }> {
  const artifacts = await listAll(supabase, projectId);
  if (!artifacts.ok) return { ok: false };

  const paths: string[] = [];
  for (const artifactId of artifacts.names) {
    const files = await listAll(supabase, `${projectId}/${artifactId}`);
    if (!files.ok) return { ok: false };
    paths.push(...files.names.map((name) => `${projectId}/${artifactId}/${name}`));
  }

  return { ok: true, paths };
}

/**
 * Removes objects, and reports whether it worked.
 *
 * Deliberately not `review/storage.ts:removeScreenshots`, which is best-effort
 * by design: it drops a pair of images for a comparison that will never be
 * shown, and "it will expire eventually" is an acceptable fallback there. Here
 * a failed removal has to reach the caller, because the alternative is a
 * committed deletion whose bytes nobody knows about.
 *
 * Removing an object that is already gone is a success — that is what makes a
 * retry safe after a partial sweep.
 */
export async function removeProjectScreenshots(
  supabase: SupabaseClient,
  paths: readonly string[],
): Promise<boolean> {
  if (paths.length === 0) return true;

  const { error } = await supabase.storage.from(REVIEW_BUCKET).remove([...paths]);
  return !error;
}

/**
 * The one database authority that can delete a project (VB-001 M1).
 *
 * `DELETE ON public.projects` is granted to no Data API role, so this RPC is
 * the only route — and it verifies ownership again in its own body. `false`
 * means no row matched: no such project, not this owner, or already deleted.
 */
export async function callEraseProjectLifecycle(
  supabase: SupabaseClient,
  params: { projectId: string; userId: string },
): Promise<boolean> {
  const { data, error } = await supabase.rpc("erase_project_lifecycle", {
    p_project_id: params.projectId,
    p_user_id: params.userId,
  });

  if (error) throw error;
  return data === true;
}
