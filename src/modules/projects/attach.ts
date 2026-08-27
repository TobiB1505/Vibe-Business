import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RepositorySummary } from "@/modules/github/types";
import { anyConnections } from "./repository-connection";

export type AttachRepositoryResult =
  | { ok: true; connectionId: string }
  | { ok: false; error: "already_connected" }
  | { ok: false; error: "unknown" };

/**
 * Connects a repository to a project that already exists (VB-001 M5).
 *
 * The counterpart to `createProjectWithRepository`, and the thing that makes a
 * detached project recoverable rather than an archive: every connection used to
 * be created together with its project, so a project that lost one could never
 * get another.
 *
 * Runs as the caller, so both RLS insert policies apply unchanged — the project
 * and the installation must both be theirs. `already_connected` covers the two
 * partial unique indexes from part 1, which are one sentence to a founder: this
 * project already has a repository, or this repository is live on another
 * project.
 *
 * The database message is dropped rather than returned, for the reason
 * `disconnect.ts` records (VB-003): the only caller is a Server Action.
 */
export async function attachRepositoryToProject(
  supabase: SupabaseClient,
  params: { projectId: string; installationRowId: string; repository: RepositorySummary },
): Promise<AttachRepositoryResult> {
  const { data, error } = await supabase
    .rpc("attach_repository_to_project", {
      p_project_id: params.projectId,
      p_installation_row_id: params.installationRowId,
      p_github_repository_id: params.repository.githubRepositoryId,
      p_owner: params.repository.owner,
      p_repository_name: params.repository.name,
      p_full_name: params.repository.fullName,
      p_default_branch: params.repository.defaultBranch,
      p_private: params.repository.private,
      p_html_url: params.repository.htmlUrl,
    })
    .single<{ connection_id: string | null; failure: string | null }>();

  if (error || !data) return { ok: false, error: "unknown" };
  if (data.failure === "already_connected") return { ok: false, error: "already_connected" };
  if (!data.connection_id) return { ok: false, error: "unknown" };
  return { ok: true, connectionId: data.connection_id };
}

/**
 * The GitHub installation a detached project should reconnect through.
 *
 * Read from the project's connection **history** — the one place `anyConnections`
 * is the right question. A detached row is exactly what this needs: it records
 * which installation the founder was using before, so reconnecting can go
 * straight to that account's repository picker instead of walking them back
 * through account selection and a fresh authorization.
 *
 * Returns null when the project has never had a connection, or when the
 * installation behind its last one is gone. The caller then falls back to the
 * ordinary connect flow, which starts from authorization.
 */
export async function findReconnectInstallationId(
  supabase: SupabaseClient,
  projectId: string,
): Promise<string | null> {
  const { data } = await anyConnections(supabase, "github_installation_id, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // The boundary widens the select string, so the row shape is stated here.
  const row = data as { github_installation_id: string } | null;
  return row?.github_installation_id ?? null;
}
