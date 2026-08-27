import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { liveConnections } from "./repository-connection";
/**
 * Every repository this account has connected (CORE-6).
 *
 * ## Why it is its own read and not a widening of the dashboard
 *
 * Because it answers a different question. `getDashboardOverview` answers
 * "where does each product stand"; this answers "what code is Vibe attached
 * to, and where". The product cards on `/app` deliberately carry no
 * `owner/repo` line — a repository string on every card is the account level
 * borrowing the project level's density — and this is where that fact went
 * rather than being lost.
 *
 * ## Cost
 *
 * Two queries, whether the account has one repository or sixty. Same shape as
 * the dashboard read model and for the same reason: the projects, then their
 * connections by `.in(...)`. Nothing here is per-project, and nothing calls
 * GitHub — every field was captured at connection time and is stored.
 *
 * ## What it does not do
 *
 * It does not check whether the installation is still accessible, whether the
 * default branch has moved, or whether the repository still exists. Those are
 * live questions with a network call behind each one, and an index page is the
 * wrong place to ask them — the workspace asks, freshly, where the answer
 * gates something.
 */

export type ConnectedRepository = {
  projectId: string;
  projectName: string;
  owner: string;
  name: string;
  /** `owner/name`, as captured when the repository was connected. */
  fullName: string;
  defaultBranch: string;
  private: boolean;
  htmlUrl: string;
  connectedAt: string;
};

type ProjectRow = { id: string; name: string };
type ConnectionRow = {
  project_id: string;
  owner: string;
  name: string;
  full_name: string;
  default_branch: string;
  private: boolean;
  html_url: string;
  created_at: string;
};

export async function listConnectedRepositories(
  supabase: SupabaseClient,
  userId: string,
): Promise<ConnectedRepository[]> {
  // RLS already scopes this to the caller; the explicit filter is the second
  // layer, consistent with every other read in the product.
  const { data: projectRows, error: projectsError } = await supabase
    .from("projects")
    .select("id, name")
    .eq("user_id", userId);

  if (projectsError) throw projectsError;

  const projects = (projectRows ?? []) as ProjectRow[];
  if (projects.length === 0) return [];

  const { data: connectionRows, error: connectionsError } = await liveConnections(supabase, "project_id, owner, name, full_name, default_branch, private, html_url, created_at")
    .in(
      "project_id",
      projects.map((project) => project.id),
    )
    .order("created_at", { ascending: false });

  if (connectionsError) throw connectionsError;

  const nameByProject = new Map(projects.map((project) => [project.id, project.name]));

  return ((connectionRows ?? []) as unknown as ConnectionRow[]).map((row) => ({
    projectId: row.project_id,
    projectName: nameByProject.get(row.project_id) ?? "Unknown product",
    owner: row.owner,
    name: row.name,
    fullName: row.full_name,
    defaultBranch: row.default_branch,
    private: row.private,
    htmlUrl: row.html_url,
    connectedAt: row.created_at,
  }));
}
