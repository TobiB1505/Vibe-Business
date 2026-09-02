import { describe, expect, it } from "vitest";
import { resolveValidationProfile } from "./profile";
import { fakeValidatableSnapshot } from "./test-support";

/**
 * Validation eligibility (Sprint 10A §5, §33).
 *
 * Almost every case is a refusal, deliberately. A profile is a promise about
 * which commands mean what, so the interesting behaviour is the set of
 * repositories Vibe declines to make that promise about.
 */

describe("supported repositories", () => {
  it("accepts a single-app Next.js repository using pnpm", () => {
    expect(resolveValidationProfile(fakeValidatableSnapshot())).toEqual({
      supported: true,
      profile: "nextjs_node_v1",
      packageManager: "pnpm",
      workspaceRoot: ".",
    });
  });

  it("accepts the same repository using npm", () => {
    const snapshot = fakeValidatableSnapshot({ packageManager: "npm" });

    expect(resolveValidationProfile(snapshot)).toMatchObject({
      supported: true,
      profile: "nextjs_node_v1",
      packageManager: "npm",
    });
  });
});

describe("unsupported ecosystems (§5)", () => {
  it.each([
    ["Django", [{ id: "django", name: "Django" }]],
    ["Rails", [{ id: "rails", name: "Rails" }]],
    ["no framework at all", []],
  ])("refuses %s rather than guessing a command sequence", (_label, frameworks) => {
    expect(resolveValidationProfile(fakeValidatableSnapshot({ frameworks }))).toEqual({
      supported: false,
      reason: "validation_not_supported",
    });
  });

  it.each(["yarn", "bun", "unknown"] as const)("refuses the %s package manager", (packageManager) => {
    // Each has its own lockfile semantics and its own "locked install" flag.
    // Getting one subtly wrong would validate a dependency tree the lockfile
    // never described — a green tick for the wrong thing.
    expect(resolveValidationProfile(fakeValidatableSnapshot({ packageManager }))).toEqual({
      supported: false,
      reason: "validation_not_supported",
    });
  });
});

describe("ambiguous workspaces (§5, §33)", () => {
  it("refuses a detected monorepo", () => {
    // Not because monorepos are hard, but because "which app did we just
    // validate?" has no single answer, and picking the first workspace would
    // be a guess reported as a verdict.
    expect(
      resolveValidationProfile(fakeValidatableSnapshot({ monorepo: { detected: true } })),
    ).toEqual({ supported: false, reason: "ambiguous_workspace" });
  });

  it("refuses a layout the analyzer itself called ambiguous", () => {
    expect(
      resolveValidationProfile(fakeValidatableSnapshot({ monorepo: { ambiguous: true } })),
    ).toEqual({ supported: false, reason: "ambiguous_workspace" });
  });
});

describe("resolution reads structure only (§5)", () => {
  it("ignores everything except the deterministic snapshot", () => {
    // The resolver's whole signature is the snapshot. There is no opportunity,
    // no title, no evidence text and no client input to influence it — the
    // same property capability resolution has in Sprint 9.
    expect(resolveValidationProfile.length).toBe(1);
  });
});
