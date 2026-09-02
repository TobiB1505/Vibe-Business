import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAuditEvent } from "@/modules/audit-log/events";
import { getLatestApprovalForPreparedChange } from "@/modules/approvals/store";
import { getLatestMergeForPreparedChange } from "@/modules/merge/store";
import { discardPreparedChange, getPreparedChange } from "./store";

/**
 * Rejecting a prepared change.
 *
 * ## Why this exists
 *
 * Because until now there was no way to say no. A change a founder did not want
 * stayed `prepared` indefinitely: it kept answering "this Move already has a
 * prepared change" on the Agent screen, and it held
 * `prepared_changes_single_active_idx` against its own execution identity, so
 * the step that produced it could not be run again either. The only options
 * were to approve something unwanted or to abandon the Move.
 *
 * ## What discarding does, exactly
 *
 * One column. The row's status becomes `discarded`, which removes it from every
 * query that asks for `prepared` — the reuse lookup, the project list, the
 * approval gate, the merge gate — and from the partial unique index, which is
 * what makes the step runnable again. Nothing is deleted, nothing on GitHub is
 * touched, and the branch stays exactly where it is (rule 71). A discarded
 * change is a decision recorded, not an artifact destroyed.
 *
 * ## The two refusals, and why they are refusals rather than cascades
 *
 * A **standing approval** blocks it. Rule 68 says `human_approved` records that
 * a person looked at one specific reviewed commit and said yes; quietly
 * unwinding that as a side effect of a different button is precisely the class
 * of thing the approval model exists to prevent. Revoking is its own deliberate
 * act with its own audit event, and it already exists — so the honest sequence
 * is two decisions, not one that silently makes both.
 *
 * A **merge that reached the default branch** blocks it permanently. The commit
 * is in the customer's history; calling that "discarded" would be a false
 * statement about the world, and the product would be the one making it.
 */

export const DISCARD_BLOCK_REASONS = [
  "discard_not_authorized",
  "discard_change_not_found",
  /** Not `prepared` — still being written, already failed, or already discarded. */
  "discard_not_discardable",
  "discard_approval_standing",
  "discard_already_merged",
] as const;

export type DiscardBlockReason = (typeof DISCARD_BLOCK_REASONS)[number];

export const DISCARD_BLOCK_MESSAGES: Record<DiscardBlockReason, string> = {
  discard_not_authorized: "This change is not yours to discard.",
  discard_change_not_found: "That change could not be found.",
  discard_not_discardable: "Only a finished, unapproved change can be discarded.",
  discard_approval_standing:
    "You approved this change. Withdraw the approval first, then discard it.",
  discard_already_merged:
    "This change is already on your default branch, so it cannot be discarded.",
};

export type DiscardOutcome =
  | { kind: "discarded" }
  /** The row was already not `prepared`. A second click says the same thing. */
  | { kind: "already_discarded" }
  | { kind: "blocked"; reason: DiscardBlockReason };

export async function discardChange(
  supabase: SupabaseClient,
  params: { projectId: string; userId: string; preparedChangeId: string },
): Promise<DiscardOutcome> {
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", params.projectId)
    .eq("user_id", params.userId)
    .maybeSingle();

  if (!project) return { kind: "blocked", reason: "discard_not_authorized" };

  // Scoped by project as well as id, so a valid project the caller owns plus
  // someone else's change id resolves to nothing rather than to that change.
  const change = await getPreparedChange(supabase, {
    projectId: params.projectId,
    preparedChangeId: params.preparedChangeId,
  });
  if (!change) return { kind: "blocked", reason: "discard_change_not_found" };

  if (change.status === "discarded") return { kind: "already_discarded" };
  if (change.status !== "prepared") {
    return { kind: "blocked", reason: "discard_not_discardable" };
  }

  const merge = await getLatestMergeForPreparedChange(supabase, {
    projectId: params.projectId,
    preparedChangeId: params.preparedChangeId,
  });

  // `merged` means the default branch points at this commit and Vibe read it
  // back (rule 74). Nothing undoes that, least of all a status column.
  if (merge?.status === "merged") {
    return { kind: "blocked", reason: "discard_already_merged" };
  }

  const approval = await getLatestApprovalForPreparedChange(supabase, {
    projectId: params.projectId,
    preparedChangeId: params.preparedChangeId,
  });

  if (approval?.status === "approved") {
    return { kind: "blocked", reason: "discard_approval_standing" };
  }

  const discarded = await discardPreparedChange(supabase, {
    preparedChangeId: params.preparedChangeId,
  });

  // Lost a race with something else that moved the row off `prepared`. The
  // caller asked for it to be gone and it is; saying so is more useful than
  // reporting a conflict nobody can act on.
  if (!discarded) return { kind: "already_discarded" };

  await recordAuditEvent(supabase, {
    userId: params.userId,
    eventType: "change_preparation.discarded",
    metadata: {
      project_id: params.projectId,
      prepared_change_id: params.preparedChangeId,
      opportunity_id: change.opportunityId,
      // What was discarded, so the log identifies content rather than a row id.
      prepared_commit_sha: change.commitSha,
      branch_name: change.branchName,
    },
  });

  return { kind: "discarded" };
}
