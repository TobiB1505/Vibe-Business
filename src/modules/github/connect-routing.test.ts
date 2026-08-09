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
