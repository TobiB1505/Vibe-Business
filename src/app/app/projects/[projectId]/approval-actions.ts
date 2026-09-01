"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { approveChange, revokeChangeApproval } from "@/modules/approvals/service";
import { approvalBlockMessage } from "@/modules/approvals/messages";
import type { ApprovalBlockReason } from "@/modules/approvals/schema";
import { requireSession } from "@/modules/auth/session";
import { resolveReviewClassification } from "@/modules/review/classification-service";

/**
 * Approval server actions (Sprint 11B §8, §9).
 *
 * The narrowest boundary in the product, because it is the first one that
 * records human authority.
 *
 * ## What the client can say
 *
 * A project id, a prepared change id, a review artifact id *or null*, and an
 * explicit confirmation. That is the entire surface.
 *
 * It cannot name the approver, the commit, the base, the validation run, the
 * policy version, the timestamp, the resulting status — or which kind of review
 * this change deserves, which is resolved below from Vibe's own analysis of the
 * changed paths. A client that could name that could approve a visible change
 * on a diff nobody looked at (ADR 0040). Those are resolved by
 * the service from persisted state, so an approval cannot be recorded against
 * bytes no human ever saw — which matters because Sprint 11C will treat these
 * rows as the reason it is allowed to write to someone's default branch.
 *
 * ## The confirmation is an argument, not a dialog
 *
 * `confirmed` travels to the server explicitly. A dialog closing is a fact
 * about a browser; it authorizes nothing. Calling this action without the
 * boolean is refused before any state is read, exactly as the preview's
 * public-exposure confirmation is (Sprint 10B-3 §5).
 */

export type ApproveActionState =
  | { ok: true; kind: "approved" | "already_approved"; approvalId: string }
  | { ok: false; error: ApprovalBlockReason; message: string }
  | null;

export type RevokeActionState =
  | { ok: true; kind: "revoked" | "already_inactive" }
  | { ok: false; error: ApprovalBlockReason; message: string }
  | null;

/**
 * Records one human approval of one exact reviewed change.
 *
 * Nothing is merged, nothing is deployed, and no repository is touched — by
 * this action or by anything it calls. Approval is a database row that says a
 * person decided.
 */
export async function approveChangeAction(
  projectId: string,
  preparedChangeId: string,
  reviewArtifactId: string | null,
  confirmed: boolean,
): Promise<NonNullable<ApproveActionState>> {
  const session = await requireSession();
  const supabase = await createClient();

  const outcome = await approveChange(supabase, {
    projectId,
    userId: session.userId,
    preparedChangeId,
    reviewArtifactId,
    // Resolved here rather than accepted from the client, and resolved *again*
    // rather than trusted from the render that drew the button: the page a
    // person is looking at may be minutes old.
    classification: await resolveReviewClassification(supabase, { projectId, preparedChangeId }),
    confirmed,
  });

  switch (outcome.kind) {
    case "approved":
    case "already_approved":
      revalidatePath(`/app/projects/${projectId}`);
      return { ok: true, kind: outcome.kind, approvalId: outcome.approval.id };
    case "blocked":
      return {
        ok: false,
        error: outcome.reason,
        message: approvalBlockMessage(outcome.reason),
      };
  }
}

/** Withdraws a standing approval. Preserves the record; touches no repository. */
export async function revokeApprovalAction(
  projectId: string,
  approvalId: string,
  confirmed: boolean,
): Promise<NonNullable<RevokeActionState>> {
  const session = await requireSession();
  const supabase = await createClient();

  const outcome = await revokeChangeApproval(supabase, {
    projectId,
    userId: session.userId,
    approvalId,
    confirmed,
  });

  switch (outcome.kind) {
    case "revoked":
    case "already_inactive":
      revalidatePath(`/app/projects/${projectId}`);
      return { ok: true, kind: outcome.kind };
    case "blocked":
      return {
        ok: false,
        error: outcome.reason,
        message: approvalBlockMessage(outcome.reason),
      };
  }
}
