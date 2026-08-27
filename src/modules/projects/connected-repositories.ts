import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RepositorySummary } from "@/modules/github/types";

import { liveConnections } from "./repository-connection";
/**
 * Which repositories are already connected, so the picker can show them
 * as connected rather than letting the user pick one and hit a
 * constraint error after the fact.
 */

/**
 * GitHub repository ids **currently** connected to one of the caller's
 * projects. RLS scopes `repository_connections` through project ownership, so
 * this only ever returns the user's own connections.
 *
 * Live only, and that is the load-bearing word (VB-001 M5). A detached row is a
 * repository the founder told Vibe to let go; counting it here would leave that
 * repository greyed out in the picker forever, which turns Disconnect into a
 * one-way door.
 */
export async function listConnectedRepositoryIds(supabase: SupabaseClient): Promise<number[]> {
  const { data, error } = await liveConnections(supabase, "github_repository_id");

  if (error) throw error;
  // The boundary widens the select string, so the row shape is stated here
  // rather than inferred — see `repository-connection.ts`.
  const rows = (data ?? []) as unknown as { github_repository_id: number }[];
  return rows.map((row) => row.github_repository_id);
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
