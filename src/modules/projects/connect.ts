import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RepositorySummary } from "@/modules/github/types";

export type CreateProjectWithRepositoryParams = {
  /** Internal github_installations.id (uuid) — never the raw GitHub installation_id. */
  installationRowId: string;
  repository: RepositorySummary;
};

export type CreateProjectResult =
  | { ok: true; projectId: string }
  | { ok: false; error: "duplicate_repository" }
  | { ok: false; error: "unknown" };

/**
 * Creates a Project and its one RepositoryConnection (Sprint 1 §9), as one
 * transaction.
 *
 * ## Why this is an RPC rather than two inserts (VB-001 M1a)
 *
 * It used to be two sequential inserts with a best-effort
 * `.from("projects").delete()` if the second failed — a compensating delete
 * whose own docblock admitted it "does not close every failure window (e.g. a
 * crash between the two calls)".
 *
 * That delete was also the last thing keeping `DELETE ON public.projects` in
 * `authenticated`'s hands, and that privilege is the entry authority for the
 * cascade that reaches `execution_specs`. While a browser-scoped role holds
 * it, M1's lifecycle marker — a forgeable custom GUC — is enough to destroy a
 * project's execution history outside the lifecycle routine. See the
 * [2026-08-26] correction in ADR 0056 §5.
 *
 * `create_project_with_repository` makes both inserts in one function body,
 * which is one transaction: a failed connection insert rolls the project back.
 * There is no orphan to compensate for, so there is no delete, so the
 * privilege can go. The window the old comment named closes as a side effect.
 *
 * The function runs `security invoker`, so both RLS insert policies apply
 * exactly as before, and the project's owner is `auth.uid()` inside the
 * database rather than an argument — a caller cannot name somebody else
 * because there is no argument in which to name them.
 *
 * ## Why the database error is dropped rather than returned
 *
 * The same reason `disconnectProject` drops it (VB-003): a PostgREST message
 * names the table, constraint or trigger that refused, the only caller is a
 * Server Action, and a narrowed union removes the possibility at the type
 * level rather than relying on every future caller to remember. The one
 * failure a caller can act on — a repository already connected — is its own
 * arm, decided in SQL where the constraint actually fires.
 */
export async function createProjectWithRepository(
  supabase: SupabaseClient,
  params: CreateProjectWithRepositoryParams,
): Promise<CreateProjectResult> {
  const { data, error } = await supabase
    .rpc("create_project_with_repository", {
      p_project_name: params.repository.name,
      p_installation_row_id: params.installationRowId,
      p_github_repository_id: params.repository.githubRepositoryId,
      p_owner: params.repository.owner,
      p_repository_name: params.repository.name,
      p_full_name: params.repository.fullName,
      p_default_branch: params.repository.defaultBranch,
      p_private: params.repository.private,
      p_html_url: params.repository.htmlUrl,
    })
    .single<{ project_id: string | null; failure: string | null }>();

  if (error || !data) {
    return { ok: false, error: "unknown" };
  }
  if (data.failure === "duplicate_repository") {
    return { ok: false, error: "duplicate_repository" };
  }
  if (!data.project_id) {
    return { ok: false, error: "unknown" };
  }
  return { ok: true, projectId: data.project_id };
}
