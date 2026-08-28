/**
 * Where "Connect a project" should send the user.
 *
 * Installing the GitHub App and connecting a project are different
 * actions. Sending an already-installed user back to
 * `/installations/new` makes GitHub show its App *settings* page — valid
 * GitHub behaviour, wrong product behaviour, because the user only
 * wanted to pick another repository they have already granted access to.
 *
 * Pure function so the decision is testable without a session, a
 * database, or GitHub.
 */

export type ConnectDestination =
  | { kind: "start_installation" }
  | { kind: "repository_picker"; installationRowId: string }
  | { kind: "choose_installation" };

export type InstallationChoice = {
  id: string;
  /**
   * Set when GitHub has told us this installation no longer exists (VB-041).
   *
   * A revoked installation is not a choice. Before this, reuse looked only at
   * the row's existence, so a customer who removed the App on GitHub — the
   * ordinary way to withdraw access — clicked "Connect GitHub" and was
   * redirected to a repository picker that could list nothing. The product
   * read as broken rather than as disconnected, and the only actual route back
   * was `?new=1`, which nothing links to.
   */
  accessRevokedAt?: string | null;
};

export type ResolveConnectOptions = {
  /**
   * Set when the user explicitly asked for a *new* GitHub account or
   * organization, or needs to re-authorize after revoked access. Always
   * starts the real installation flow, even if installations exist.
   */
  forceNewInstallation?: boolean;
};

export function resolveConnectDestination(
  installations: InstallationChoice[],
  options: ResolveConnectOptions = {},
): ConnectDestination {
  if (options.forceNewInstallation) return { kind: "start_installation" };

  // A revoked installation cannot be reused, so it is not a candidate. A user
  // whose only installation was removed on GitHub lands on `start_installation`
  // — the same place a first-time user lands, which is exactly right: from
  // Vibe's side those two situations are the same situation (VB-041).
  const usable = installations.filter((installation) => !installation.accessRevokedAt);

  // No verified installation yet: this is a genuine first-time install,
  // so run the full ADR 0009 authorization + ownership verification.
  if (usable.length === 0) return { kind: "start_installation" };

  if (usable.length === 1) {
    return { kind: "repository_picker", installationRowId: usable[0].id };
  }

  // Never silently pick one of several accounts/organizations on the
  // user's behalf.
  return { kind: "choose_installation" };
}
