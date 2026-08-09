import type { InstallationAccountType } from "./types";

/**
 * GitHub URL construction. Pure — no env, no server-only guard — so it
 * can be used from either side of the boundary and tested directly.
 */

export type InstallationIdentity = {
  installationId: number;
  accountLogin: string;
  accountType: InstallationAccountType;
};

/**
 * The page where a user changes *which repositories* GitHub grants the
 * existing installation access to.
 *
 * Deliberately distinct from connecting a project: this changes GitHub's
 * grant, whereas connecting a project picks from repositories Vibe
 * Business can already see. Personal and organization installations live
 * under different settings paths.
 */
export function buildInstallationSettingsUrl(installation: InstallationIdentity): string {
  if (installation.accountType === "Organization") {
    return `https://github.com/organizations/${installation.accountLogin}/settings/installations/${installation.installationId}`;
  }
  return `https://github.com/settings/installations/${installation.installationId}`;
}
