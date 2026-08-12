import "server-only";

import { getInstallationOctokit } from "./app-client";

/**
 * A raw installation access token, for the one case that needs it.
 *
 * ## Why this exists, and why it is uncomfortable
 *
 * Everywhere else in Vibe, the installation token stays inside an Octokit
 * instance and is never handed to a caller — that is the whole design of
 * `app-client.ts`. Source acquisition breaks that pattern for a single
 * unavoidable reason: the sandbox provider performs the `git clone` itself,
 * inside the microVM, so it needs a credential we cannot keep behind an
 * Octokit boundary.
 *
 * Because the pattern is broken deliberately, the compensating controls are
 * strict and live in `validation/orchestrator.ts`:
 *
 *  - the token is minted immediately before `Sandbox.create` and never stored,
 *    logged, or written to the database;
 *  - it is passed as the clone credential only — never into the sandbox
 *    environment, where repository code could read it (§8);
 *  - `.git` is destroyed before any repository-controlled command runs, and
 *    its absence is verified rather than assumed (§7);
 *  - GitHub is removed from the network allowlist immediately after the clone,
 *    so a leaked token has nowhere to be used from.
 *
 * "It expires in an hour" is not the boundary. The controls above are.
 */

/** GitHub's convention for token-as-password over HTTPS. */
export const GIT_CLONE_USERNAME = "x-access-token";

export async function mintInstallationCloneCredential(
  installationId: number,
): Promise<{ username: string; password: string } | null> {
  try {
    const octokit = getInstallationOctokit(installationId);
    const auth = (await octokit.auth({ type: "installation" })) as { token?: string };

    if (typeof auth.token !== "string" || auth.token.length === 0) return null;
    return { username: GIT_CLONE_USERNAME, password: auth.token };
  } catch {
    // Never surfaces the provider error: it can carry request context, and a
    // failed mint means exactly one thing to the caller — no credential.
    return null;
  }
}
