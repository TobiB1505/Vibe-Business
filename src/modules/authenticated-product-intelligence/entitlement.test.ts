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
    // The default fixture is a project on `launch-v1`: an additional scan is
    // priced and the wallet covers it. Tests that care about the unpriced world
    // set `additionalScanPrice: null` explicitly, which is what `retail-v1`
    // resolved to and what a future policy without a Deep Scan price would.
    additionalScanPrice: 25_000,
    availableCredits: 100_000,
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

  it("moves a second scan onto Credits once one succeeded", () => {
    expect(authorizeDeepScan(facts({ hasSuccessfulIncludedScan: true }))).toEqual({
      allowed: true,
      accessMode: "credits",
    });
  });

  it("blocks a second scan with credits_required when no policy prices one", () => {
    // The state `retail-v1` was in for the whole of its life, and the one a
    // future policy without a Deep Scan price would return to. Null is not
    // zero: it means "not for sale", and the honest answer is a refusal rather
    // than a free scan.
    expect(
      authorizeDeepScan(facts({ hasSuccessfulIncludedScan: true, additionalScanPrice: null })),
    ).toEqual({ allowed: false, reason: "credits_required" });
  });

  it("blocks a second scan when the balance does not cover it", () => {
    expect(
      authorizeDeepScan(facts({ hasSuccessfulIncludedScan: true, availableCredits: 24_999 })),
    ).toEqual({ allowed: false, reason: "insufficient_credits" });
  });

  it("decides how a scan is paid for before anything could cost provider money", () => {
    // Every other gate is simultaneously open; the entitlement still decides
    // first. This ordering is what stops us paying for a browser and only then
    // telling the user they cannot run a scan.
    const decision = authorizeDeepScan(
      facts({
        hasSuccessfulIncludedScan: true,
        additionalScanPrice: null,
        hasLiveSession: false,
        recentStartCount: 0,
      }),
    );
    expect(decision).toEqual({ allowed: false, reason: "credits_required" });
  });

  it("applies the abuse limits to a paid scan exactly as to an included one", () => {
    // Paying buys a scan, not the right to hammer a login page. A live session,
    // a cooldown and an exhausted start window each still refuse.
    const paid = { hasSuccessfulIncludedScan: true } as const;

    expect(authorizeDeepScan(facts({ ...paid, hasLiveSession: true }))).toEqual({
      allowed: false,
      reason: "scan_already_running",
    });
    expect(
      authorizeDeepScan(
        facts({ ...paid, recentStartCount: START_ATTEMPT_LIMITS.maxStartsPerWindow }),
      ),
    ).toEqual({ allowed: false, reason: "start_attempts_exhausted" });
  });

  it("refuses when no production origin is configured", () => {
    expect(authorizeDeepScan(facts({ productionOrigin: null }))).toEqual({
      allowed: false,
      reason: "production_origin_missing",
    });
  });

  it("never charges for a scan the included entitlement still covers", () => {
    // The direction that would be expensive to get wrong: a project with its
    // free scan intact must never resolve `credits`, whatever else is true of
    // its wallet.
    for (const override of [{}, { recentStartCount: 2 }, { availableCredits: 1_000_000 }]) {
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
    ["a browser-provider outage"],
    ["our own persistence failing"],
  ])("still allows the included scan after %s", () => {
    expect(authorizeDeepScan(facts({ hasSuccessfulIncludedScan: false }))).toEqual({
      allowed: true,
      accessMode: "included_first_scan",
    });
  });

  it("cannot be reset by a simple retry once genuinely consumed", () => {
    // Retrying does not give the free scan back. It resolves to `credits`
    // forever after, which is a purchase and not the entitlement.
    const consumed = facts({ hasSuccessfulIncludedScan: true });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(authorizeDeepScan(consumed)).toEqual({ allowed: true, accessMode: "credits" });
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
      additionalScanPrice: 25_000,
      retryAvailableAt: null,
      activeSession: null,
      blockedReason: null,
    });
  });

  it("reports the included scan as used, and the price of another", () => {
    const status = toDeepScanAccessStatus(facts({ hasSuccessfulIncludedScan: true }), null);
    expect(status.includedScanAvailable).toBe(false);
    expect(status.additionalScanPrice).toBe(25_000);
    // Nothing is blocking: it is purchasable, which is the whole change.
    expect(status.blockedReason).toBeNull();
  });

  it("names credits_required only when no additional scan is for sale", () => {
    const status = toDeepScanAccessStatus(
      facts({ hasSuccessfulIncludedScan: true, additionalScanPrice: null }),
      null,
    );
    expect(status.blockedReason).toBe("credits_required");
    expect(status.additionalScanPrice).toBeNull();
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
    // A missing price, an empty wallet and a missing origin are not outlastable;
    // implying otherwise would be a lie the UI would faithfully repeat.
    const unpriced = toDeepScanAccessStatus(
      facts({ hasSuccessfulIncludedScan: true, additionalScanPrice: null }),
      null,
    );
    expect(unpriced.blockedReason).toBe("credits_required");
    expect(unpriced.retryAvailableAt).toBeNull();

    const short = toDeepScanAccessStatus(
      facts({ hasSuccessfulIncludedScan: true, availableCredits: 0 }),
      null,
    );
    expect(short.blockedReason).toBe("insufficient_credits");
    expect(short.retryAvailableAt).toBeNull();

    const noOrigin = toDeepScanAccessStatus(facts({ productionOrigin: null }), null);
    expect(noOrigin.retryAvailableAt).toBeNull();
  });
});
