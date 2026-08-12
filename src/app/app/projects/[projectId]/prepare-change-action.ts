"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/modules/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getPreparedDiff, type PreparedDiff } from "@/modules/execution/diff";
import { createGithubGitWritePort } from "@/modules/execution/github/adapter";
import { startChangePreparation } from "@/modules/execution/service";
import type { OperationFailureCode } from "@/modules/operations/failures";
import type { OperationView } from "@/modules/operations/view";
import { VercelWorkflowExecutor } from "@/modules/operations/vercel/executor";

/**
 * Starting and reviewing a prepared change (Sprint 9C §4, §12).
 *
 * The client sends a project id and an opportunity id. Nothing else — no
 * repository, no branch, no path, no capability, no generated content. Those
 * are resolved from server state by the 9B service, which is what keeps a
 * scoped capability from becoming an arbitrary write primitive.
 *
 * No repository write happens in this request: the action enqueues durable
 * work and returns.
 */

export type PrepareChangeActionState =
  | { ok: true; kind: "running"; operation: OperationView }
  /** An identical change was already prepared; nothing was written again. */
  | { ok: true; kind: "reused"; preparedChangeId: string }
  | { ok: false; error: OperationFailureCode }
  | null;

export async function prepareChangeAction(
  projectId: string,
  opportunityId: string,
  _prevState: PrepareChangeActionState,
  formData: FormData,
): Promise<PrepareChangeActionState> {
  const session = await requireSession();
  const supabase = await createClient();

  // The confirmation dialog is the authorization for a repository write, so
  // the submission has to carry it. A request without it never reaches the
  // service — which also means a stray POST cannot start a preparation (§3).
  if (formData.get("confirmed") !== "true") {
    return { ok: false, error: "change_preparation_failed" };
  }

  const outcome = await startChangePreparation(supabase, new VercelWorkflowExecutor(), {
    projectId,
    userId: session.userId,
    opportunityId,
  });

  if (outcome.kind === "failed") return { ok: false, error: outcome.error };

  if (outcome.kind === "reused") {
    revalidatePath(`/app/projects/${projectId}`);
    return { ok: true, kind: "reused", preparedChangeId: outcome.preparedChangeId };
  }

  return { ok: true, kind: "running", operation: outcome.operation };
}

export type PreparedDiffActionState =
  | { ok: true; diff: PreparedDiff }
  | { ok: false; error: "not_found" | "not_prepared" | "unavailable" };

/**
 * Fetches the bounded diff for review.
 *
 * Ownership is resolved server-side and the branch/paths come from the stored
 * prepared change, so a caller cannot read an arbitrary ref (§26).
 */
export async function getPreparedDiffAction(
  projectId: string,
  preparedChangeId: string,
): Promise<PreparedDiffActionState> {
  const session = await requireSession();
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, repository:project_repositories(full_name, installation_id)")
    .eq("id", projectId)
    .eq("user_id", session.userId)
    .maybeSingle();

  if (!project) return { ok: false, error: "not_found" };

  const repository = (project as { repository?: { full_name: string; installation_id: number }[] })
    .repository?.[0];
  if (!repository) return { ok: false, error: "unavailable" };

  const [owner, repo] = repository.full_name.split("/");
  const port = createGithubGitWritePort({
    installationId: repository.installation_id,
    owner,
    repo,
  });
  const result = await getPreparedDiff(supabase, port, { projectId, preparedChangeId });
  return result.ok ? { ok: true, diff: result.diff } : { ok: false, error: result.error };
}
