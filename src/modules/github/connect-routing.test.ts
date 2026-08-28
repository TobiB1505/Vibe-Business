import { describe, expect, it } from "vitest";
import { resolveConnectDestination } from "./connect-routing";

describe("resolveConnectDestination", () => {
  it("starts the GitHub installation flow when the user has no installation", () => {
    expect(resolveConnectDestination([])).toEqual({ kind: "start_installation" });
  });

  // The bug this fixes: an already-installed user was sent back to
  // /installations/new, which GitHub renders as its App settings page.
  it("goes straight to the repository picker when exactly one installation exists", () => {
    expect(resolveConnectDestination([{ id: "installation-1" }])).toEqual({
      kind: "repository_picker",
      installationRowId: "installation-1",
    });
  });

  it("asks which account to use when several installations exist", () => {
    expect(resolveConnectDestination([{ id: "installation-1" }, { id: "installation-2" }])).toEqual({
      kind: "choose_installation",
    });
  });

  it("never silently picks one of several installations", () => {
    const result = resolveConnectDestination([{ id: "a" }, { id: "b" }, { id: "c" }]);
    expect(result.kind).toBe("choose_installation");
    expect(result).not.toHaveProperty("installationRowId");
  });

  it("starts a new installation when explicitly requested, even with one existing", () => {
    expect(
      resolveConnectDestination([{ id: "installation-1" }], { forceNewInstallation: true }),
    ).toEqual({ kind: "start_installation" });
  });

  it("starts a new installation when explicitly requested, even with several existing", () => {
    expect(
      resolveConnectDestination([{ id: "a" }, { id: "b" }], { forceNewInstallation: true }),
    ).toEqual({ kind: "start_installation" });
  });
});

describe("a revoked installation (VB-041)", () => {
  /**
   * The customer-visible failure this closes: removing the App on GitHub — the
   * ordinary way to withdraw access — left a row that still claimed access, so
   * "Connect GitHub" redirected to a repository picker that could list
   * nothing. The product read as broken rather than as disconnected.
   */
  it("is not a candidate for reuse", () => {
    expect(
      resolveConnectDestination([{ id: "gone", accessRevokedAt: "2026-08-27T00:00:00.000Z" }]),
    ).toEqual({ kind: "start_installation" });
  });

  /**
   * From Vibe's side, "your only installation was removed" and "you have never
   * installed" are the same situation, so they get the same destination — the
   * real install flow, which is the only thing that fixes either.
   */
  it("leaves a user with one revoked and one working installation on the working one", () => {
    expect(
      resolveConnectDestination([
        { id: "gone", accessRevokedAt: "2026-08-27T00:00:00.000Z" },
        { id: "live", accessRevokedAt: null },
      ]),
    ).toEqual({ kind: "repository_picker", installationRowId: "live" });
  });

  it("still asks which account when more than one is usable", () => {
    expect(
      resolveConnectDestination([
        { id: "gone", accessRevokedAt: "2026-08-27T00:00:00.000Z" },
        { id: "a", accessRevokedAt: null },
        { id: "b", accessRevokedAt: null },
      ]),
    ).toEqual({ kind: "choose_installation" });
  });

  /**
   * An installation nothing has probed reads null, and null must keep meaning
   * "no observation" rather than "revoked" — otherwise every first connect
   * would restart the install flow.
   */
  it("treats an unprobed installation as usable", () => {
    expect(resolveConnectDestination([{ id: "fresh" }])).toEqual({
      kind: "repository_picker",
      installationRowId: "fresh",
    });
  });
});
