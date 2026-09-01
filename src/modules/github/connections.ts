import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { GithubIdentity, InstallationAccountType, VerifiedInstallation } from "./types";
import type { InstallationAccess } from "./repositories";

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
  /**
   * When GitHub last said this installation no longer exists (VB-041).
   *
   * Null is "no such observation", not "confirmed working" — nothing probes
   * on a schedule, so an installation revoked five minutes ago still reads
   * null until something asks GitHub.
   */
  accessRevokedAt: string | null;
};

type InstallationRow = {
  id: string;
  installation_id: number;
  github_account_login: string;
  account_type: InstallationAccountType;
  access_revoked_at: string | null;
};

function mapInstallationRow(row: InstallationRow): VerifiedInstallationRecord {
  return {
    id: row.id,
    installationId: row.installation_id,
    accountLogin: row.github_account_login,
    accountType: row.account_type,
    accessRevokedAt: row.access_revoked_at ?? null,
  };
}

const INSTALLATION_COLUMNS =
  "id, installation_id, github_account_login, account_type, access_revoked_at";

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

/**
 * Writes down what GitHub just said about an installation (VB-041).
 *
 * Called only where a probe actually happened, so the column records an
 * observation rather than an inference. `unavailable` writes nothing at all:
 * GitHub being down, or our own App credential being wrong, is not evidence
 * that the customer removed anything — and marking it as revocation would tell
 * them their connection was withdrawn when it was not.
 *
 * `accessible` clears the mark, so reinstalling the App fixes this without an
 * operator, which is the only acceptable recovery for a state the customer
 * created themselves.
 */
export async function recordInstallationAccess(
  supabase: SupabaseClient,
  params: { installationRowId: string; userId: string; access: InstallationAccess },
): Promise<void> {
  if (params.access === "unavailable") return;

  const { error } = await supabase
    .from("github_installations")
    .update({ access_revoked_at: params.access === "revoked" ? new Date().toISOString() : null })
    .eq("id", params.installationRowId)
    .eq("user_id", params.userId);

  if (error) throw error;
}
