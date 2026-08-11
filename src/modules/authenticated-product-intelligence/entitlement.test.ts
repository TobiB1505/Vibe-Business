import { describe, expect, it } from "vitest";

import {
  START_ATTEMPT_LIMITS,
  authorizeDeepScan,
  consumesIncludedEntitlement,
  toDeepScanAccessStatus,
  type DeepScanEntitlementFacts,
} from "./entitlement";

const NOW = new Date("2026-08-11T20:00:00.000Z");

function facts(overrides: Partial<DeepScanEntitlementFacts> = {}): DeepScanEntitlementFacts {
  return {
    hasSuccessfulIncludedScan: false,
    hasLiveSession: false,
    recentStartCount: 0,
    lastAbandonedAt: null,
    productionOrigin: "https://app.example.com",
    now: NOW,
    ...overrides,
  };
}

describe("authorizeDeepScan — included first scan", () => {
  it("allows a new project's included scan", () => {
    expect(authorizeDeepScan(facts())).toEqual({
      allowed: true,
      accessMode: "included_first_scan",
    });
  });

  it("blocks a second scan with credits_required once one succeeded", () => {
    expect(authorizeDeepScan(facts({ hasSuccessfulIncludedScan: true }))).toEqual({
      allowed: false,
      reason: "credits_required",
    });
  });

  it("evaluates credits_required before anything that could cost provider money", () => {
    // Every other gate is simultaneously open; the entitlement still decides.
    // This ordering is what stops us paying Browserbase and only then telling
    // the user they cannot run a scan.
    const decision = authorizeDeepScan(
      facts({ hasSuccessfulIncludedScan: true, hasLiveSession: false, recentStartCount: 0 }),
    );
    expect(decision).toEqual({ allowed: false, reason: "credits_required" });
  });

  it("refuses when no production origin is configured", () => {
    expect(authorizeDeepScan(facts({ productionOrigin: null }))).toEqual({
      allowed: false,
      reason: "production_origin_missing",
    });
  });

  it("never returns the credits access mode while credits are unimplemented", () => {
    for (const override of [{}, { recentStartCount: 2 }, { hasSuccessfulIncludedScan: true }]) {
      const decision = authorizeDeepScan(facts(override));
      if (decision.allowed) expect(decision.accessMode).toBe("included_first_scan");
    }
  });
});

describe("authorizeDeepScan — failures do not consume the entitlement", () => {
  // Each of these is a run that did not persist a snapshot, so
  // `hasSuccessfulIncludedScan` stays false and the scan is still offered.
  it.each([
    ["a failed analysis"],
    ["a cancelled session"],
    ["a session that expired before analysis"],
    ["an unreachable authenticated origin"],
    ["a Browserbase outage"],
    ["our own persistence failing"],
  ])("still allows the included scan after %s", () => {
    expect(authorizeDeepScan(facts({ hasSuccessfulIncludedScan: false }))).toEqual({
      allowed: true,
      accessMode: "included_first_scan",
    });
  });

  it("cannot be reset by a simple retry once genuinely consumed", () => {
    const consumed = facts({ hasSuccessfulIncludedScan: true });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(authorizeDeepScan(consumed)).toEqual({ allowed: false, reason: "credits_required" });
    }
  });
});

describe("authorizeDeepScan — abuse protection", () => {
  it("allows only one live session per project", () => {
    expect(authorizeDeepScan(facts({ hasLiveSession: true }))).toEqual({
      allowed: false,
      reason: "scan_already_running",
    });
  });

  it("enforces a cooldown after an abandoned attempt", () => {
    const justAbandoned = new Date(NOW.getTime() - 30_000);
    expect(authorizeDeepScan(facts({ lastAbandonedAt: justAbandoned }))).toEqual({
      allowed: false,
      reason: "cooldown_active",
    });
  });

  it("allows a retry once the cooldown has elapsed", () => {
    const old = new Date(NOW.getTime() - START_ATTEMPT_LIMITS.cooldownAfterAbandonedMs - 1);
    expect(authorizeDeepScan(facts({ lastAbandonedAt: old }))).toEqual({
      allowed: true,
      accessMode: "included_first_scan",
    });
  });

  it("bounds session starts inside the window", () => {
    expect(
      authorizeDeepScan(facts({ recentStartCount: START_ATTEMPT_LIMITS.maxStartsPerWindow })),
    ).toEqual({ allowed: false, reason: "start_attempts_exhausted" });
  });

  it("does not count provider failures toward the attempt limit", () => {
    // Encoded as policy so an outage cannot look like abuse.
    expect(START_ATTEMPT_LIMITS.providerFailuresCountTowardLimit).toBe(false);
  });
});

describe("consumesIncludedEntitlement", () => {
  it("consumes only when a snapshot was actually persisted", () => {
    expect(
      consumesIncludedEntitlement({ accessMode: "included_first_scan", snapshotPersisted: true }),
    ).toBe(true);
  });

  it("does not consume when no snapshot was persisted", () => {
    expect(
      consumesIncludedEntitlement({ accessMode: "included_first_scan", snapshotPersisted: false }),
    ).toBe(false);
  });

  it("does not consume the included entitlement for a credits-funded run", () => {
    expect(consumesIncludedEntitlement({ accessMode: "credits", snapshotPersisted: true })).toBe(
      false,
    );
  });
});

describe("toDeepScanAccessStatus", () => {
  it("offers the included scan on a fresh project", () => {
    expect(toDeepScanAccessStatus(facts(), null)).toEqual({
      includedScanAvailable: true,
      additionalScansRequireCredits: true,
      retryAvailableAt: null,
      activeSession: null,
      blockedReason: null,
    });
  });

  it("reports the included scan as used and names why a new one is blocked", () => {
    const status = toDeepScanAccessStatus(facts({ hasSuccessfulIncludedScan: true }), null);
    expect(status.includedScanAvailable).toBe(false);
    expect(status.blockedReason).toBe("credits_required");
  });

  it("exposes only Vibe's own session id and status", () => {
    const status = toDeepScanAccessStatus(facts({ hasLiveSession: true }), {
      id: "vibe-session-1",
      status: "waiting_for_login",
    });

    expect(status.activeSession).toEqual({ id: "vibe-session-1", status: "waiting_for_login" });
    const serialized = JSON.stringify(status);
    // No provider internals, cost, or credentials are representable here.
    expect(serialized).not.toMatch(/browserbase|bb_|connectUrl|debugger|apiKey|cost/i);
  });

  it("keeps two projects' entitlements independent", () => {
    const projectA = toDeepScanAccessStatus(facts({ hasSuccessfulIncludedScan: true }), null);
    const projectB = toDeepScanAccessStatus(facts({ hasSuccessfulIncludedScan: false }), null);

    expect(projectA.includedScanAvailable).toBe(false);
    expect(projectB.includedScanAvailable).toBe(true);
  });
});

/**
 * Regression: after cancelling a scan the panel offered no retry and said
 * nothing about why. The cooldown was doing its job, but silently — reported
 * as "after a failed test I can't retry it".
 *
 * The denial is correct and stays; what was missing is the information needed
 * to wait it out knowingly.
 */
describe("toDeepScanAccessStatus — a cooldown says when, not just no", () => {
  const abandonedAt = new Date("2026-08-11T22:00:00.000Z");
  const duringCooldown = new Date(abandonedAt.getTime() + 30_000);

  it("reports when the cooldown lifts", () => {
    const status = toDeepScanAccessStatus(
      facts({ lastAbandonedAt: abandonedAt, now: duringCooldown }),
      null,
    );

    expect(status.blockedReason).toBe("cooldown_active");
    expect(status.retryAvailableAt).toBe(
      new Date(abandonedAt.getTime() + START_ATTEMPT_LIMITS.cooldownAfterAbandonedMs).toISOString(),
    );
  });

  it("carries no retry time once the cooldown has passed", () => {
    const after = new Date(abandonedAt.getTime() + START_ATTEMPT_LIMITS.cooldownAfterAbandonedMs + 1_000);
    const status = toDeepScanAccessStatus(facts({ lastAbandonedAt: abandonedAt, now: after }), null);

    expect(status.blockedReason).toBeNull();
    expect(status.retryAvailableAt).toBeNull();
  });

  it("does not offer a retry time for denials waiting cannot fix", () => {
    // Credits and a missing origin are not outlastable; implying otherwise
    // would be a lie the UI would faithfully repeat.
    const credits = toDeepScanAccessStatus(facts({ hasSuccessfulIncludedScan: true }), null);
    expect(credits.blockedReason).toBe("credits_required");
    expect(credits.retryAvailableAt).toBeNull();

    const noOrigin = toDeepScanAccessStatus(facts({ productionOrigin: null }), null);
    expect(noOrigin.retryAvailableAt).toBeNull();
  });
});
