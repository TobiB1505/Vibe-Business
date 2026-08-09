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

export type InstallationChoice = { id: string };

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

  // No verified installation yet: this is a genuine first-time install,
  // so run the full ADR 0009 authorization + ownership verification.
  if (installations.length === 0) return { kind: "start_installation" };

  if (installations.length === 1) {
    return { kind: "repository_picker", installationRowId: installations[0].id };
  }

  // Never silently pick one of several accounts/organizations on the
  // user's behalf.
  return { kind: "choose_installation" };
}
