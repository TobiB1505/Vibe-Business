import { describe, expect, it } from "vitest";
import { buildInstallationSettingsUrl } from "./urls";

describe("buildInstallationSettingsUrl", () => {
  it("uses the personal settings path for a user installation", () => {
    expect(
      buildInstallationSettingsUrl({
        installationId: 12345,
        accountLogin: "octocat",
        accountType: "User",
      }),
    ).toBe("https://github.com/settings/installations/12345");
  });

  it("uses the organization settings path for an organization installation", () => {
    expect(
      buildInstallationSettingsUrl({
        installationId: 67890,
        accountLogin: "acme-inc",
        accountType: "Organization",
      }),
    ).toBe("https://github.com/organizations/acme-inc/settings/installations/67890");
  });

  // "Manage repository access" must send the user to GitHub's grant
  // settings, never back into Vibe Business's project-connection flow.
  it("always points at github.com settings, never at a Vibe Business route", () => {
    const url = buildInstallationSettingsUrl({
      installationId: 1,
      accountLogin: "octocat",
      accountType: "User",
    });

    expect(url.startsWith("https://github.com/")).toBe(true);
    expect(url).toContain("/settings/installations/");
    expect(url).not.toContain("/app/connect");
  });
});
