import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { GithubIdentity, VerifiedInstallation } from "./types";

/**
 * Persists the verified GitHub identity/installation from a successful
 * connect flow (ADR 0009). Only ever called after
 * verifyInstallationAccessibleToUser has succeeded — never persists
 * anything from an unverified callback. Never receives or stores a token:
 * only identity/installation metadata.
 *
 * Upserts (rather than always inserting) so reconnecting an already-linked
 * GitHub identity/installation updates the existing row instead of
 * violating the unique constraints in the migration.
 */
export async function upsertGithubConnection(
  supabase: SupabaseClient,
  userId: string,
  identity: GithubIdentity,
): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from("github_connections")
    .upsert(
      {
        user_id: userId,
        github_user_id: identity.githubUserId,
        github_login: identity.githubLogin,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    )
    .select("id")
    .single();

  if (error) throw error;
  return data;
}

export async function upsertGithubInstallation(
  supabase: SupabaseClient,
  userId: string,
  installation: VerifiedInstallation,
): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from("github_installations")
    .upsert(
      {
        user_id: userId,
        installation_id: installation.installationId,
        github_account_id: installation.accountId,
        github_account_login: installation.accountLogin,
        account_type: installation.accountType,
        repository_selection: installation.repositorySelection,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,installation_id" },
    )
    .select("id")
    .single();

  if (error) throw error;
  return data;
}
