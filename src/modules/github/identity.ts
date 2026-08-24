import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { GithubIdentity } from "./types";

/**
 * The signed-in person's GitHub identity, for display (CORE-6).
 *
 * ## Why this is the account's identity
 *
 * Because it is the only one that exists. There is no profile table, no
 * `user_metadata`, no display name and no avatar anywhere in this codebase —
 * `signUp` passes nothing but an email and a password, and the dashboard's own
 * headline carries a comment refusing to invent a name from the local part.
 *
 * What *is* stored, and has been since the first connect flow, is the GitHub
 * login and numeric user id. That is a real name a person chose, recorded
 * because they authenticated with it — not a guess derived from an address.
 *
 * ## What it costs
 *
 * One row. `github_connections` is `unique (user_id)`, so this is a primary-key
 * lookup that does not scale with anything, which is what makes it affordable
 * in a layout that renders on every account navigation.
 *
 * ## Absence is normal
 *
 * A user who signed up with a password and has not connected GitHub has no row.
 * That returns `null`, and the caller falls back to the email — never to an
 * invented name.
 */
export async function getGithubIdentity(
  supabase: SupabaseClient,
  userId: string,
): Promise<GithubIdentity | null> {
  const { data, error } = await supabase
    .from("github_connections")
    .select("github_user_id, github_login")
    .eq("user_id", userId)
    .maybeSingle();

  /*
   * A failure here loses an avatar, not a session. The rail must render
   * regardless — the same call the credit balance makes when no wallet exists.
   */
  if (error || !data) return null;

  return {
    githubUserId: data.github_user_id as number,
    githubLogin: data.github_login as string,
  };
}

/**
 * Where GitHub serves that user's avatar.
 *
 * Derived from the stored numeric id rather than fetched: GitHub's avatar
 * endpoint is addressable by user id, so this costs no request and cannot go
 * stale in a way a stored URL would. `?s=` asks for a size close to what the
 * rail renders instead of a full-resolution image.
 */
export function githubAvatarUrl(githubUserId: number, size = 96): string {
  return `https://avatars.githubusercontent.com/u/${githubUserId}?s=${size}`;
}
