import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import {
  callEraseProjectLifecycle,
  findBlockingWork,
  listProjectScreenshotPaths,
  removeProjectScreenshots,
} from "./store";

export type DeleteProjectLifecycleFailure =
  | "project_not_found"
  | "active_operation"
  | "agent_running"
  | "merge_in_progress"
  | "billing_not_finalized"
  | "storage_cleanup_failed"
  | "deletion_failed";

export type DeleteProjectLifecycleResult =
  | { ok: true }
  | { ok: false; reason: DeleteProjectLifecycleFailure };

/**
 * Deletes one project and everything derived from it (ADR 0056 §3).
 *
 * ## Why this lives in `src/modules/operations/`
 *
 * Not preference — rule 53. It needs the service-role client for the storage
 * sweep and the lifecycle RPC, and `src/lib/supabase/service.ts` confines that
 * client to `operations/` and `billing/`. It could not live beside
 * `disconnect.ts` in `src/modules/projects/` even if that read better.
 *
 * ## Why it is not a Vercel Workflow
 *
 * ADR 0056 §3 calls it a durable operation, and the architecture review's
 * reason was placement rather than duration. The work here is a prefix listing,
 * one `remove` call and one short transaction — seconds, not the tens of
 * seconds rule 49 is about. `preview_teardown` records the same distinction in
 * `operations/schema.ts`: "Durable because it needs the privileged ledger
 * writer, **not because it is slow**." This follows the shape
 * `founder-action/server-writes.ts` established for exactly that case.
 *
 * If a project ever accumulates enough screenshots that the sweep stops being
 * quick, that is when a workflow earns its place — and the page cap in the
 * store is what would report it rather than hiding it.
 *
 * ## The order, and why storage goes first
 *
 * Ownership → refuse if busy → sweep storage → erase the subtree.
 *
 * Storage and the database cannot share a transaction, so one of them will
 * fail while the other has already succeeded. Sweeping first is **not**
 * justified by "the database row is the only pointer to the objects" — it is
 * not: `review/identity.ts` derives the path from the project id, so orphaned
 * bytes stay discoverable by prefix with no surviving row. It is chosen because
 * it produces the failure mode that is visible and safely retryable: the
 * project still exists, the user is told the deletion failed, and re-running
 * re-sweeps an already-partly-empty prefix and then completes. The reverse
 * order produces a failure that looks like success from the outside.
 *
 * Both stages are idempotent, so a retry is safe from any point.
 */
export async function deleteProjectLifecycle(params: {
  projectId: string;
  /** Always from `requireSession()`. Never accepted from a client argument. */
  userId: string;
}): Promise<DeleteProjectLifecycleResult> {
  const supabase = createServiceClient();

  // Ownership first, so nothing below can report on a project the caller does
  // not own. `project_not_found` deliberately does not distinguish "no such
  // project" from "not yours" — anything finer would be an ownership oracle.
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id")
    .eq("id", params.projectId)
    .eq("user_id", params.userId)
    .maybeSingle();
  if (projectError || !project) return { ok: false, reason: "project_not_found" };

  let blocking;
  try {
    blocking = await findBlockingWork(supabase, params.projectId);
  } catch {
    return { ok: false, reason: "deletion_failed" };
  }
  if (blocking) return { ok: false, reason: blocking };

  const screenshots = await listProjectScreenshotPaths(supabase, params.projectId);
  if (!screenshots.ok) return { ok: false, reason: "storage_cleanup_failed" };
  if (!(await removeProjectScreenshots(supabase, screenshots.paths))) {
    return { ok: false, reason: "storage_cleanup_failed" };
  }

  let erased: boolean;
  try {
    erased = await callEraseProjectLifecycle(supabase, params);
  } catch {
    // A PostgREST error names the table, constraint or trigger that refused.
    // It never leaves this module (VB-003).
    return { ok: false, reason: "deletion_failed" };
  }

  // The row was there a moment ago and is not gone now: something raised inside
  // the cascade, or it lost a race with another deletion. Either way this call
  // did not do what it said, and reporting success would be the VB-003 defect
  // in a new place.
  if (!erased) return { ok: false, reason: "deletion_failed" };

  return { ok: true };
}
