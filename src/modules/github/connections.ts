import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { GithubIdentity, InstallationAccountType, VerifiedInstallation } from "./types";

/**
 * A verified installation as stored by Vibe Business. `id` is our own
 * row id; `installationId` is GitHub's. Only `id` is ever accepted from
 * a client, and only after re-checking ownership against the session
 * user — a raw GitHub installation id from a client is never trusted
 * (ADR 0009).
 */
export type VerifiedInstallationRecord = {
  id: string;
  installationId: number;
  accountLogin: string;
  accountType: InstallationAccountType;
};

type InstallationRow = {
  id: string;
  installation_id: number;
  github_account_login: string;
  account_type: InstallationAccountType;
};

function mapInstallationRow(row: InstallationRow): VerifiedInstallationRecord {
  return {
    id: row.id,
    installationId: row.installation_id,
    accountLogin: row.github_account_login,
    accountType: row.account_type,
  };
}

const INSTALLATION_COLUMNS = "id, installation_id, github_account_login, account_type";

/**
 * Every verified installation belonging to `userId`. RLS already scopes
 * this; the explicit filter documents the intent and keeps the guarantee
 * visible at the call site.
 */
export async function listVerifiedInstallations(
  supabase: SupabaseClient,
  userId: string,
): Promise<VerifiedInstallationRecord[]> {
  const { data, error } = await supabase
    .from("github_installations")
    .select(INSTALLATION_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return (data ?? []).map((row) => mapInstallationRow(row as InstallationRow));
}

/**
 * One installation, but only if it belongs to `userId`. Returns null for
 * another user's installation, so a guessed or copied row id cannot be
 * used to reach a repository list.
 */
export async function getVerifiedInstallation(
  supabase: SupabaseClient,
  userId: string,
  installationRowId: string,
): Promise<VerifiedInstallationRecord | null> {
  const { data, error } = await supabase
    .from("github_installations")
    .select(INSTALLATION_COLUMNS)
    .eq("id", installationRowId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data ? mapInstallationRow(data as InstallationRow) : null;
}

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
