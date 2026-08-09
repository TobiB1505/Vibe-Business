import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RepositorySummary } from "@/modules/github/types";

/**
 * Which repositories are already connected, so the picker can show them
 * as connected rather than letting the user pick one and hit a
 * constraint error after the fact.
 */

/**
 * GitHub repository ids already connected to one of the caller's
 * projects. RLS scopes `repository_connections` through project
 * ownership, so this only ever returns the user's own connections.
 */
export async function listConnectedRepositoryIds(supabase: SupabaseClient): Promise<number[]> {
  const { data, error } = await supabase.from("repository_connections").select("github_repository_id");

  if (error) throw error;
  return (data ?? []).map((row: { github_repository_id: number }) => row.github_repository_id);
}

export type PickableRepository = RepositorySummary & { alreadyConnected: boolean };

/**
 * Marks rather than removes already-connected repositories: a user
 * looking for a repository they connected last week should see *why*
 * it is not selectable, instead of wondering where it went.
 */
export function markConnectedRepositories(
  repositories: RepositorySummary[],
  connectedRepositoryIds: number[],
): PickableRepository[] {
  const connected = new Set(connectedRepositoryIds);
  return repositories.map((repository) => ({
    ...repository,
    alreadyConnected: connected.has(repository.githubRepositoryId),
  }));
}

/** True when nothing in the list can still be connected. */
export function hasSelectableRepository(repositories: PickableRepository[]): boolean {
  return repositories.some((repository) => !repository.alreadyConnected);
}
