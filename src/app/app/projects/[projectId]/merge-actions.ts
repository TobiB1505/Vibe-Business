"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/modules/auth/session";
import { createGithubMergePort } from "@/modules/merge/github/adapter";
import { mergeFailureMessage } from "@/modules/merge/messages";
import type { MergeFailureCode } from "@/modules/merge/schema";
import { resolveMergeTarget, startMerge } from "@/modules/merge/service";
import { VercelWorkflowExecutor } from "@/modules/operations/vercel/executor";
import type { OperationView } from "@/modules/operations/view";

/**
 * The merge server action (Sprint 11C §14, §16).
 *
 * The most consequential boundary in the product: everything downstream of it
 * can move a customer's default branch.
 *
 * ## What the client can say
 *
 * A project id, a prepared change id, an approval id, and an explicit
 * confirmation. That is the entire surface.
 *
 * It cannot name the repository, the owner, the installation, the default
 * branch, the base SHA, the target SHA, the branch name or the merge strategy.
 * Not because they are validated and rejected — because there is no parameter
 * to put them in (§14). Every one of them is resolved on the server from
 * persisted state and from GitHub itself.
 *
 * ## The confirmation is an argument, not a dialog
 *
 * `confirmed` travels to the server explicitly, and the service refuses before
 * reading any state without it. A dialog closing is a fact about a browser; it
 * authorizes nothing, and it certainly does not authorize a write to `main`.
 *
 * ## What this action does not do
 *
 * It does not merge. It enqueues a durable operation that will run a fresh
 * preflight and then decide. Nothing on this request path writes to GitHub —
 * which is also why a closed browser tab cannot leave a half-finished merge.
 */

export type MergeActionState =
  | { ok: true; kind: "started" | "active"; operation: OperationView }
  | { ok: false; error: MergeFailureCode; message: string }
  | null;

export async function mergeApprovedChangeAction(
  projectId: string,
  preparedChangeId: string,
  changeApprovalId: string,
  confirmed: boolean,
): Promise<NonNullable<MergeActionState>> {
  const session = await requireSession();
  const supabase = await createClient();

  const target = await resolveMergeTarget(supabase, projectId);
  if (!target) {
    return {
      ok: false,
      error: "merge_repository_unavailable",
      message: mergeFailureMessage("merge_repository_unavailable"),
    };
  }

  const outcome = await startMerge(
    supabase,
    new VercelWorkflowExecutor(),
    createGithubMergePort(target),
    { projectId, userId: session.userId, preparedChangeId, changeApprovalId, confirmed },
  );

  switch (outcome.kind) {
    case "started":
    case "active":
      revalidatePath(`/app/projects/${projectId}`);
      return { ok: true, kind: outcome.kind, operation: outcome.operation };
    case "blocked":
      return {
        ok: false,
        error: outcome.reason,
        message: mergeFailureMessage(outcome.reason),
      };
  }
}
