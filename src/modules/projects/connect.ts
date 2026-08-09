import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RepositorySummary } from "@/modules/github/types";

export type CreateProjectWithRepositoryParams = {
  userId: string;
  /** Internal github_installations.id (uuid) — never the raw GitHub installation_id. */
  installationRowId: string;
  repository: RepositorySummary;
};

export type CreateProjectResult =
  | { ok: true; projectId: string }
  | { ok: false; error: "duplicate_repository" }
  | { ok: false; error: "unknown"; message: string };

const POSTGRES_UNIQUE_VIOLATION = "23505";

/**
 * Creates a Project + its one RepositoryConnection (Sprint 1 §9). Two
 * sequential inserts rather than a single transactional RPC — a
 * deliberate Sprint 1 simplification (see
 * docs/sprints/0001-github-app-connection.md Risks/Notes): on repository
 * insert failure we best-effort delete the project row we just created,
 * rather than leaving an orphaned project. This does not close every
 * failure window (e.g. a crash between the two calls), but the caller-
 * visible outcome for the common failure case — a rejected unique
 * constraint on an already-connected repository — is fully correct.
 */
export async function createProjectWithRepository(
  supabase: SupabaseClient,
  params: CreateProjectWithRepositoryParams,
): Promise<CreateProjectResult> {
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .insert({ user_id: params.userId, name: params.repository.name })
    .select("id")
    .single();

  if (projectError || !project) {
    return { ok: false, error: "unknown", message: projectError?.message ?? "Failed to create project." };
  }

  const { error: repoError } = await supabase.from("repository_connections").insert({
    project_id: project.id,
    github_installation_id: params.installationRowId,
    github_repository_id: params.repository.githubRepositoryId,
    owner: params.repository.owner,
    name: params.repository.name,
    full_name: params.repository.fullName,
    default_branch: params.repository.defaultBranch,
    private: params.repository.private,
    html_url: params.repository.htmlUrl,
  });

  if (repoError) {
    await supabase.from("projects").delete().eq("id", project.id);

    if (repoError.code === POSTGRES_UNIQUE_VIOLATION) {
      return { ok: false, error: "duplicate_repository" };
    }
    return { ok: false, error: "unknown", message: repoError.message };
  }

  return { ok: true, projectId: project.id };
}
