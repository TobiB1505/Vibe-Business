import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RepositorySummary } from "@/modules/github/types";

export type ProjectDetail = {
  id: string;
  name: string;
  userId: string;
  /** Normalized public production URL, or null when not configured (Sprint 3 §3). */
  productionUrl: string | null;
  repository: (RepositorySummary & { installationId: number }) | null;
};

/** Project detail page (Sprint 1 §9). Returns null when not found or (via RLS) not owned by the caller. */
export async function getProjectWithRepository(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ProjectDetail | null> {
  /*
   * The project and its repository connection are both keyed on the project
   * id, so neither read waits on the other (UI-4 §3). Only the installation
   * lookup below genuinely depends on a previous answer. This read sits in
   * every workspace render, which is why one round trip is worth removing.
   *
   * A connection is read for a project that turns out not to exist or not to
   * belong to the caller — RLS scopes it either way, and the row is dropped
   * unread a line later.
   */
  const [
    { data: project, error: projectError },
    { data: repoConnection, error: repoError },
  ] = await Promise.all([
    supabase.from("projects").select("id, name, user_id, production_url").eq("id", projectId).maybeSingle(),
    supabase
      .from("repository_connections")
      .select("github_repository_id, owner, name, full_name, default_branch, private, html_url, github_installation_id")
      .eq("project_id", projectId)
      .maybeSingle(),
  ]);

  if (projectError) throw projectError;
  if (!project) return null;

  if (repoError) throw repoError;

  let repository: ProjectDetail["repository"] = null;
  if (repoConnection) {
    const { data: installation, error: installationError } = await supabase
      .from("github_installations")
      .select("installation_id")
      .eq("id", repoConnection.github_installation_id)
      .maybeSingle();

    if (installationError) throw installationError;

    repository = {
      githubRepositoryId: repoConnection.github_repository_id,
      owner: repoConnection.owner,
      name: repoConnection.name,
      fullName: repoConnection.full_name,
      defaultBranch: repoConnection.default_branch,
      private: repoConnection.private,
      htmlUrl: repoConnection.html_url,
      installationId: installation?.installation_id ?? -1,
    };
  }

  return {
    id: project.id,
    name: project.name,
    userId: project.user_id,
    productionUrl: project.production_url ?? null,
    repository,
  };
}
