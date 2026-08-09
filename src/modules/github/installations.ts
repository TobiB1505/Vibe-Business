import "server-only";

import type { InstallationAccountType, VerifiedInstallation } from "./types";

type RawInstallation = {
  id: number;
  // Typed as `unknown` rather than a specific shape: the real GitHub API
  // union (a personal account vs. an organization vs., in principle, other
  // account-like shapes) doesn't structurally match a single narrow
  // interface, and every field is validated at runtime below anyway — see
  // ADR 0009, this is the actual trust boundary, not the type declaration.
  account: unknown;
  repository_selection: string;
};

export interface InstallationsLister {
  rest: {
    apps: {
      listInstallationsForAuthenticatedUser(params?: {
        per_page?: number;
      }): Promise<{ data: { installations: RawInstallation[] } }>;
    };
  };
}

function normalizeInstallation(raw: RawInstallation): VerifiedInstallation | null {
  const account = raw.account;
  if (!account || typeof account !== "object") return null;
  if (!("id" in account) || !("login" in account) || !("type" in account)) return null;

  const { id: accountId, login: accountLogin, type: accountType } = account as Record<string, unknown>;
  if (typeof accountId !== "number" || typeof accountLogin !== "string" || typeof accountType !== "string") {
    return null;
  }
  if (accountType !== "User" && accountType !== "Organization") return null;
  if (raw.repository_selection !== "all" && raw.repository_selection !== "selected") return null;

  return {
    installationId: raw.id,
    accountId,
    accountLogin,
    accountType: accountType as InstallationAccountType,
    repositorySelection: raw.repository_selection,
  };
}

/**
 * Lists installations accessible to the authenticated user behind `client`
 * (a user-access-token-authenticated Octokit — see oauth.ts). Not paginated
 * beyond 100 installations, a reasonable Sprint 1 simplification for real
 * users; revisit if this ever needs to scale further.
 */
export async function listUserInstallations(client: InstallationsLister): Promise<VerifiedInstallation[]> {
  const { data } = await client.rest.apps.listInstallationsForAuthenticatedUser({ per_page: 100 });
  return data.installations
    .map(normalizeInstallation)
    .filter((installation): installation is VerifiedInstallation => installation !== null);
}

/**
 * The core of ADR 0009: confirms `installationId` (received from a GitHub
 * callback and therefore untrusted on its own) actually appears in the
 * list of installations the authorized GitHub user can access. Returns
 * null — not an error — when it does not, so the caller can reject the
 * connection attempt cleanly.
 */
export async function verifyInstallationAccessibleToUser(
  client: InstallationsLister,
  installationId: number,
): Promise<VerifiedInstallation | null> {
  const installations = await listUserInstallations(client);
  return installations.find((installation) => installation.installationId === installationId) ?? null;
}
