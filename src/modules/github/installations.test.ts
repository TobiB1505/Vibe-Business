import { describe, expect, it } from "vitest";
import { listUserInstallations, verifyInstallationAccessibleToUser, type InstallationsLister } from "./installations";

function fakeClient(installations: unknown[]): InstallationsLister {
  return {
    rest: {
      apps: {
        listInstallationsForAuthenticatedUser: async () => ({
          data: { installations: installations as never },
        }),
      },
    },
  };
}

const validInstallation = {
  id: 42,
  account: { id: 7, login: "octo-org", type: "Organization" },
  repository_selection: "selected",
};

describe("listUserInstallations", () => {
  it("normalizes a valid installation", async () => {
    const result = await listUserInstallations(fakeClient([validInstallation]));
    expect(result).toEqual([
      {
        installationId: 42,
        accountId: 7,
        accountLogin: "octo-org",
        accountType: "Organization",
        repositorySelection: "selected",
      },
    ]);
  });

  it("drops installations with a missing account", async () => {
    const result = await listUserInstallations(fakeClient([{ ...validInstallation, account: null }]));
    expect(result).toEqual([]);
  });

  it("drops installations with an unexpected account type", async () => {
    const result = await listUserInstallations(
      fakeClient([{ ...validInstallation, account: { id: 7, login: "bot", type: "Bot" } }]),
    );
    expect(result).toEqual([]);
  });

  it("drops installations with an unexpected repository_selection value", async () => {
    const result = await listUserInstallations(
      fakeClient([{ ...validInstallation, repository_selection: "unexpected" }]),
    );
    expect(result).toEqual([]);
  });
});

describe("verifyInstallationAccessibleToUser", () => {
  it("returns the installation when it is in the user's accessible list", async () => {
    const result = await verifyInstallationAccessibleToUser(fakeClient([validInstallation]), 42);
    expect(result?.installationId).toBe(42);
  });

  it("returns null when the installation is not accessible to the user — the ADR 0009 rejection case", async () => {
    const result = await verifyInstallationAccessibleToUser(fakeClient([validInstallation]), 999);
    expect(result).toBeNull();
  });

  it("returns null when the user has no installations at all", async () => {
    const result = await verifyInstallationAccessibleToUser(fakeClient([]), 42);
    expect(result).toBeNull();
  });
});
