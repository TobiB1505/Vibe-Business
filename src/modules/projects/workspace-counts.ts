import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { countPreparedChangesForProject } from "@/modules/execution/store";

/**
 * Workspace navigation counts (Sprint UI-2.5 Phase B).
 *
 * ## Why this exists separately from every other read
 *
 * UI-1's sidebar carried badges — "3" beside Next moves, "2" beside Prepared —
 * and they were free, because the single page had already loaded both. UI-2
 * split the workspace into routes and **removed** them rather than putting an
 * opportunity read and a prepared read into the shared layout, where every one
 * of the seven routes would have paid for them.
 *
 * This is the cheap read that lets them come back: two `count`-only queries,
 * no rows transferred, no detail assembly of any kind.
 *
 * ## The counts mean what the domain means
 *
 * Neither number was invented for a badge:
 *
 * - **`nextMoves`** counts the opportunities in the *latest completed set*,
 *   which is exactly what the Action Plan renders. Not every opportunity row the
 *   project has ever produced — regenerating opportunities creates a new set,
 *   and the old ones are history, not a backlog.
 * - **`prepared`** counts prepared changes with `status = 'prepared'`, which is
 *   what `listPreparedChangesForProject` shows. Not every execution job ever
 *   run: a discarded or superseded change is not something waiting for you.
 *
 * Changing either definition here without changing the route it labels would
 * make the badge lie about the page behind it.
 *
 * ## Failure is not fatal
 *
 * The navigation matters more than its badges. Any failure returns nulls and
 * the caller renders the nav without them — never a zero, which would claim
 * "nothing here" when the truth is "could not count".
 */

export type ProjectWorkspaceCounts = {
  /** Opportunities in the latest completed set. Null when unknown. */
  nextMoves: number | null;
  /** Prepared changes still in `prepared` status. Null when unknown. */
  prepared: number | null;
};

const UNKNOWN: ProjectWorkspaceCounts = { nextMoves: null, prepared: null };

/**
 * The execution module's own count, with this file's "a badge is never worth a
 * broken nav" failure rule wrapped around it.
 *
 * Delegated rather than repeated: the `status = 'prepared'` filter is what
 * makes the badge match the page it labels, and two copies of it are two
 * chances for the badge to start describing something else.
 */
async function countPreparedChanges(
  supabase: SupabaseClient,
  projectId: string,
): Promise<number | null> {
  try {
    return await countPreparedChangesForProject(supabase, projectId);
  } catch {
    return null;
  }
}

async function countNextMoves(
  supabase: SupabaseClient,
  projectId: string,
): Promise<number | null> {
  // The latest *completed* set — the same one the Action Plan renders. One row, one
  // column.
  const { data: set, error: setError } = await supabase
    .from("opportunity_sets")
    .select("id")
    .eq("project_id", projectId)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (setError) return null;
  // No set is a real answer: this project has never had opportunities
  // identified. Zero, not unknown — and the caller hides a zero badge.
  if (!set) return 0;

  const { count, error } = await supabase
    .from("business_opportunities")
    .select("id", { count: "exact", head: true })
    .eq("opportunity_set_id", (set as { id: string }).id);

  if (error) return null;
  return count ?? null;
}

/**
 * Both counts, resolved in parallel. Runs under the caller's RLS-bound client,
 * so a project that is not the caller's yields nothing — the same boundary
 * every other read in the workspace sits behind.
 */
export async function getProjectWorkspaceCounts(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ProjectWorkspaceCounts> {
  try {
    const [nextMoves, prepared] = await Promise.all([
      countNextMoves(supabase, projectId),
      countPreparedChanges(supabase, projectId),
    ]);

    return { nextMoves, prepared };
  } catch {
    // A badge is not worth a broken workspace. Swallowed deliberately, and
    // narrowly: the individual queries already return null on a query error,
    // so reaching here means something unexpected — and the navigation still
    // renders.
    return UNKNOWN;
  }
}
