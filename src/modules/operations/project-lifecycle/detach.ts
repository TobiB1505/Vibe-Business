import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { findBlockingWork, type BlockingWork } from "./store";

export type DetachRepositoryFailure = "project_not_found" | BlockingWork | "detach_failed";

export type DetachRepositoryResult =
  | { ok: true }
  | { ok: false; reason: DetachRepositoryFailure };

/**
 * Severs Vibe's link to a project's repository, and keeps everything else
 * (ADR 0056 §1).
 *
 * ## What this is not
 *
 * It is not a deletion, and until M5 the control that said "Disconnect" was
 * one. The project, its intelligence, its audits, plans and execution history
 * all remain; what stops is Vibe reading from or writing to the repository. The
 * connection row itself is retained too — execution specs, merges and snapshots
 * reference it with `ON DELETE RESTRICT`, so removing it would destroy the
 * evidence that points at it.
 *
 * ## Why it is gated at all
 *
 * Detaching is not destructive, so the gate is a safety rail rather than a
 * security boundary. What it prevents is incoherence: a running agent still
 * writing to a repository the founder just told Vibe to let go, or a merge
 * moving a default branch after the link was severed.
 *
 * It reuses `findBlockingWork` rather than restating the question. Deletion and
 * detachment ask exactly the same thing — is anything still live for this
 * project — and two definitions that must agree are one definition that
 * eventually will not.
 */
export async function detachRepository(params: {
  projectId: string;
  /** Always from `requireSession()`. Never accepted from a client argument. */
  userId: string;
}): Promise<DetachRepositoryResult> {
  const supabase = createServiceClient();

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id")
    .eq("id", params.projectId)
    .eq("user_id", params.userId)
    .maybeSingle();
  if (projectError || !project) return { ok: false, reason: "project_not_found" };

  let blocking: BlockingWork | null;
  try {
    blocking = await findBlockingWork(supabase, params.projectId);
  } catch {
    return { ok: false, reason: "detach_failed" };
  }
  if (blocking) return { ok: false, reason: blocking };

  const { data, error } = await supabase.rpc("detach_repository", {
    p_project_id: params.projectId,
    p_user_id: params.userId,
  });

  // A PostgREST message names the table, constraint or trigger that refused.
  // It never leaves this module (VB-003).
  if (error) return { ok: false, reason: "detach_failed" };

  // `not_found` here means the project has no live connection — it was already
  // disconnected, or a concurrent call won. Reported as the same closed reason
  // the ownership check uses, because to a founder they are one sentence.
  if (data !== "detached") return { ok: false, reason: "project_not_found" };

  return { ok: true };
}
