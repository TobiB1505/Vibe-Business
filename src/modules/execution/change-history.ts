import type { SupabaseClient } from "@supabase/supabase-js";
import { getLatestApprovalsForPreparedChanges } from "@/modules/approvals/store";
import type { ChangeApproval } from "@/modules/approvals/schema";
import { getLatestMergesForPreparedChanges } from "@/modules/merge/store";
import {
  getLatestValidationsForPreparedChanges,
  type StoredValidationRun,
} from "@/modules/validation/store";
import { buildBranchUrl } from "./diff";
import { listAllPreparedChangesForProject } from "./store";
import type { ChangeMerge } from "@/modules/merge/schema";
import type { PreparedChangeStatus } from "./schema";

/**
 * What became of a change, for a list of every change a product has had.
 *
 * ## Why the history is changes and not runs
 *
 * Because a founder's question is *what has Vibe done to my product*, and the
 * answer to that is a list of changes. A run is Vibe's unit of work: it can
 * end without producing anything, it can be one of several attempts at the
 * same Move, and its status — `completed` — says the machinery finished, not
 * that the product moved. A change is the thing that either reached the
 * default branch or did not.
 *
 * The run is still in the row. It is just not what the row is about.
 *
 * ## Why this is not `deriveChangeProgress`
 *
 * `ChangeProgress` has twelve stages and exists to decide *what a founder
 * should do next about one change*. It needs the preview session, the review
 * artifact, the outcome chain and the review classification to say that —
 * which is the full card, which costs a GitHub read and a signed URL per
 * change. A history list must not pay that per row.
 *
 * These nine say *what became of it*, from three batched reads. The two
 * projections agree on the only thing they both claim: a change is `merged`
 * here exactly when it is `merged` or `observed` there, because both read the
 * same merge row and neither infers a merge from anything else (rule 74).
 *
 * ## Why `merged` still means only one sentence
 *
 * The default branch points at the approved commit and Vibe read it back. Not
 * deployed, not released, not live (rule 74). The label says "Merged" and the
 * view module beside this one is where that wording is kept honest.
 */
export const CHANGE_HISTORY_OUTCOMES = [
  /** The default branch moved to this commit and Vibe read it back. */
  "merged",
  /**
   * A write was attempted and no verified merge followed.
   *
   * Never resolved to either side here: `merging` is the ambiguous state rule
   * 73 exists for, and a list is the last place that should guess which way it
   * went. It reads as stopped, and the change's own screen is where the
   * observation happens.
   */
  "merge_stopped",
  /** Refused before any write. The repository was not touched. */
  "merge_refused",
  /** A person said yes to this exact commit and nothing has been written. */
  "approved",
  /** The checks did not pass. */
  "checks_failed",
  /** Nobody has decided yet. */
  "waiting",
  /** A person said no. The branch stays; the change is not coming back. */
  "discarded",
  /** The preparation itself did not finish. There is no commit to look at. */
  "failed",
  /**
   * Vibe is still writing it.
   *
   * In a list about the past, and deliberately: a founder who opens the
   * history while a run is in flight should see that row rather than a gap
   * where the newest change will be. Mapping it to `waiting` would be the one
   * false answer available here — `waiting` means nobody has decided, and
   * there is nothing to decide about yet.
   */
  "preparing",
] as const;

export type ChangeHistoryOutcome = (typeof CHANGE_HISTORY_OUTCOMES)[number];

/**
 * One row: a change, what it was for, and where it ended.
 *
 * `opportunityId` rather than a title. The titles live on the opportunity set
 * the surface is already holding — the Agent workspace reads it to render the
 * task panel — so carrying them here would be a second copy of the same
 * strings and a read the list does not need.
 */
export type ChangeHistoryEntry = {
  preparedChangeId: string;
  /** When Vibe prepared it. Not when the run started — the run may predate it. */
  createdAt: string;
  branchName: string;
  branchUrl: string | null;
  /** Paths in the commit. Zero only for a preparation that produced nothing. */
  filesChanged: number;
  /** The Move this change answers, when it came from one. */
  opportunityId: string | null;
  /** The run that produced it, so a row can lead back to the work. */
  operationRunId: string | null;
  outcome: ChangeHistoryOutcome;
};

/**
 * What became of one change, read from the far end backwards.
 *
 * The same direction `deriveChangeProgress` reads in, and for the same reason:
 * a change that reached the default branch has been through everything before
 * it, so asking about validation first would let an early gate speak for a
 * change that is long past it.
 *
 * `status` comes first regardless, because a discarded, failed or unfinished
 * preparation is a fact about the change itself rather than about a gate it
 * stopped at — and a discarded change can carry a passed validation, which
 * would otherwise read as "waiting".
 */
export function changeHistoryOutcome(input: {
  status: PreparedChangeStatus;
  validation: StoredValidationRun | null;
  approval: ChangeApproval | null;
  merge: ChangeMerge | null;
}): ChangeHistoryOutcome {
  if (input.status === "discarded") return "discarded";
  if (input.status === "failed") return "failed";
  if (input.status === "preparing") return "preparing";

  const merge = input.merge;
  if (merge !== null) {
    if (merge.status === "merged") return "merged";
    if (merge.status === "merging" || merge.status === "failed") return "merge_stopped";
    if (merge.status === "blocked") return "merge_refused";
    /* `preflight`: authorized, nothing attempted. The approval is the fact. */
  }

  if (input.approval?.status === "approved") return "approved";
  if (input.validation?.status === "failed") return "checks_failed";

  return "waiting";
}

/**
 * The history, from four reads that do not grow with the number of changes.
 *
 * One list plus three batched lifecycle reads. That is the whole cost, and it
 * is the property worth protecting: the surface this feeds is the one a
 * founder opens after a month of runs, so a read per row is exactly the shape
 * that would make it slow precisely when it becomes useful.
 *
 * What is deliberately **not** read: the preview session, the review artifact,
 * the outcome chain, the review classification, the live default branch and
 * every signed URL. A history says what became of a change. Deciding what to
 * do about one happens on the change's own screen, which pays for all of that
 * and asks the authority questions fresh (rules 55, 70).
 */
export async function listChangeHistory(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    /** For the branch link. Null when no repository is connected. */
    repositoryFullName: string | null;
    limit?: number;
  },
): Promise<ChangeHistoryEntry[]> {
  const prepared = await listAllPreparedChangesForProject(supabase, {
    projectId: params.projectId,
    ...(params.limit === undefined ? {} : { limit: params.limit }),
  });

  if (prepared.length === 0) return [];

  const scope = {
    projectId: params.projectId,
    preparedChangeIds: prepared.map((change) => change.id),
  };

  const [validations, approvals, merges] = await Promise.all([
    getLatestValidationsForPreparedChanges(supabase, scope),
    getLatestApprovalsForPreparedChanges(supabase, scope),
    getLatestMergesForPreparedChanges(supabase, scope),
  ]);

  return prepared.map((change) => ({
    preparedChangeId: change.id,
    createdAt: change.createdAt,
    branchName: change.branchName,
    branchUrl: params.repositoryFullName
      ? buildBranchUrl(params.repositoryFullName, change.branchName)
      : null,
    filesChanged: change.files.length,
    opportunityId: change.opportunityId,
    operationRunId: change.operationRunId,
    outcome: changeHistoryOutcome({
      status: change.status,
      validation: validations.get(change.id) ?? null,
      approval: approvals.get(change.id) ?? null,
      merge: merges.get(change.id) ?? null,
    }),
  }));
}
