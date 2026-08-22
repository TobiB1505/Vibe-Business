import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { STALLING_MERGE_FAILURES } from "./change-progress";
import type { PreparedChangeLoopFacts } from "./loop-stage";
import type { PreparedChangeSummary } from "./workspace";

/**
 * The two verdicts the loop rail needs and the cheap reads do not already have
 * (UI-8 §1).
 *
 * ## Why this is not `getPreparedChangeWorkspace`
 *
 * That function answers this question completely, and it is the wrong tool
 * here for a stated reason: per prepared change it reads seven cards, spends
 * up to four GitHub calls for an approved one, signs review-image URLs, and
 * asks the sandbox provider for an origin. Its own docblock says it "should
 * only run where a prepared change is actually shown".
 *
 * The rail is shown on the project's home page, which deliberately does not do
 * any of that — `listPreparedChangeSummaries` exists precisely so a count does
 * not cost a workspace. This is the same bargain one step further: two queries
 * over two small columns, so a spine does not cost a workspace either.
 *
 * ## These are not second opinions
 *
 * `approved` is `change_approvals.status = 'approved'`, which is the approvals
 * module's own persisted verdict and the same predicate its partial unique
 * index is built on. `merged` and `mergeStalled` read `change_merges` the same
 * way, and reuse `STALLING_MERGE_FAILURES` from `change-progress.ts` rather
 * than restating which refusals mean trouble — a second copy of that list is
 * how "it is your turn" starts being reported as a failure.
 *
 * What this cannot see is everything that needs a live external read: whether a
 * merge is *currently* safe, whether a preview is running, whether a review
 * artifact is still valid. None of that belongs on a rail. `/prepared` asks
 * those questions where the answers are acted on.
 *
 * ## Failure is not fatal
 *
 * The page matters more than its rail. A failed query yields no verdicts rather
 * than a wrong one, which reads as "nothing has been approved or merged yet" —
 * the same conservative direction `getProjectWorkspaceCounts` chose, and the
 * one that cannot invent progress a project has not made.
 */

export type PreparedChangeVerdicts = {
  approved: boolean;
  merged: boolean;
  mergeStalled: boolean;
};

const NONE: PreparedChangeVerdicts = { approved: false, merged: false, mergeStalled: false };

type MergeRow = { prepared_change_id: string; status: string; failure_code: string | null };

/**
 * A merge row that means *this change cannot go in as it is*.
 *
 * `failed` always counts. `blocked` only counts when its code is one a person
 * has to act on — a change nobody has approved is also `blocked`, carrying
 * `merge_approval_required`, and calling that trouble would announce a problem
 * where the honest answer is "it is your turn".
 */
function rowIsStalled(row: MergeRow): boolean {
  if (row.status === "failed") return true;
  return row.failure_code !== null && STALLING_MERGE_FAILURES.has(row.failure_code);
}

async function readApprovedChangeIds(
  supabase: SupabaseClient,
  projectId: string,
): Promise<Set<string> | null> {
  const { data, error } = await supabase
    .from("change_approvals")
    .select("prepared_change_id")
    .eq("project_id", projectId)
    // The same predicate the approvals module's partial unique index uses.
    // Revoked and invalidated approvals are history, not standing consent.
    .eq("status", "approved");

  if (error) return null;
  return new Set((data ?? []).map((row) => (row as { prepared_change_id: string }).prepared_change_id));
}

async function readMergeRows(
  supabase: SupabaseClient,
  projectId: string,
): Promise<MergeRow[] | null> {
  const { data, error } = await supabase
    .from("change_merges")
    .select("prepared_change_id, status, failure_code")
    .eq("project_id", projectId);

  if (error) return null;
  return (data ?? []) as MergeRow[];
}

/**
 * Both verdicts for every prepared change in a project, in two queries.
 *
 * Runs under the caller's RLS-bound client, so a project that is not the
 * caller's yields nothing — the same boundary every other workspace read sits
 * behind.
 */
export async function getPreparedChangeVerdicts(
  supabase: SupabaseClient,
  projectId: string,
): Promise<Map<string, PreparedChangeVerdicts>> {
  const verdicts = new Map<string, PreparedChangeVerdicts>();

  try {
    const [approvedIds, mergeRows] = await Promise.all([
      readApprovedChangeIds(supabase, projectId),
      readMergeRows(supabase, projectId),
    ]);

    for (const id of approvedIds ?? []) {
      verdicts.set(id, { ...NONE, approved: true });
    }

    for (const row of mergeRows ?? []) {
      const current = verdicts.get(row.prepared_change_id) ?? NONE;
      verdicts.set(row.prepared_change_id, {
        approved: current.approved,
        // A change can carry several merge rows across retries. Any row that
        // read the default branch back settles it; that is what `merged` means.
        merged: current.merged || row.status === "merged",
        mergeStalled: current.mergeStalled || rowIsStalled(row),
      });
    }
  } catch {
    // A rail is not worth a broken project page. Swallowed deliberately and
    // narrowly — both queries already return null on a query error, so
    // reaching here means something unexpected, and the page still renders.
    return verdicts;
  }

  return verdicts;
}

/**
 * Prepared-change summaries plus verdicts, as the loop rail's facts.
 *
 * Pure, so the mapping from "what the database said" to "what the rail is told"
 * is a unit test rather than something only a live project exercises. The
 * validation half comes from the summary the page already loaded; the other
 * two come from `getPreparedChangeVerdicts`.
 */
export function toPreparedChangeLoopFacts(
  summaries: Pick<PreparedChangeSummary, "id" | "validationStatus">[],
  verdicts: Map<string, PreparedChangeVerdicts>,
): PreparedChangeLoopFacts[] {
  return summaries.map((summary) => {
    const verdict = verdicts.get(summary.id) ?? NONE;

    return {
      validationPassed: summary.validationStatus === "passed",
      // `cancelled` reads as "not checked" rather than as a failure, matching
      // the validation panel and `validationGate`: a run somebody stopped says
      // nothing about the change.
      validationFailed: summary.validationStatus === "failed",
      approved: verdict.approved,
      merged: verdict.merged,
      mergeStalled: verdict.mergeStalled,
    };
  });
}
