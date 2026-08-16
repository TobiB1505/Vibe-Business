import { describe, expect, it } from "vitest";
import {
  AUDIT_START_LIMITS,
  authorizeAudit,
  consumesIncludedEntitlement,
  retryAllowedAfterFailure,
  toAuditAccessStatus,
  type AuditEntitlementFacts,
} from "./entitlement";

/**
 * Free audit entitlement (CORE-2 §16, §17).
 *
 * The rules worth testing are the ones that cost a user something when they are
 * wrong: what consumes the free audit, what a failure costs, and whether
 * disconnecting a repository can mint a second one.
 */

function facts(overrides: Partial<AuditEntitlementFacts> = {}): AuditEntitlementFacts {
  return {
    hasCompletedIncludedAudit: false,
    hasRepositoryGrant: false,
    hasRunningAudit: false,
    recentStartCount: 0,
    hasProductProfile: true,
    productProfileCurrent: true,
    ...overrides,
  };
}

describe("authorizeAudit", () => {
  it("allows the first audit on the included entitlement", () => {
    expect(authorizeAudit(facts())).toEqual({
      allowed: true,
      accessMode: "included_first_audit",
    });
  });

  it("refuses a second audit, and says credits rather than inventing a price", () => {
    expect(authorizeAudit(facts({ hasCompletedIncludedAudit: true }))).toEqual({
      allowed: false,
      reason: "credits_required",
    });
  });

  it("refuses while one is already running", () => {
    expect(authorizeAudit(facts({ hasRunningAudit: true }))).toEqual({
      allowed: false,
      reason: "audit_already_running",
    });
  });

  it("refuses once the start window is exhausted", () => {
    const decision = authorizeAudit(
      facts({ recentStartCount: AUDIT_START_LIMITS.maxStartsPerWindow }),
    );
    expect(decision).toEqual({ allowed: false, reason: "start_attempts_exhausted" });
  });

  describe("the Product Profile prerequisite (CORE-2 §3, §8)", () => {
    it("refuses when no profile exists", () => {
      expect(authorizeAudit(facts({ hasProductProfile: false }))).toEqual({
        allowed: false,
        reason: "product_profile_missing",
      });
    });

    it("refuses a stale profile with its own reason, not the missing one", () => {
      // Different remedies: one needs a first analysis, the other a refresh.
      expect(authorizeAudit(facts({ productProfileCurrent: false }))).toEqual({
        allowed: false,
        reason: "product_profile_stale",
      });
    });

    it("checks prerequisites before entitlement, so the message is actionable", () => {
      const decision = authorizeAudit(
        facts({ hasProductProfile: false, hasCompletedIncludedAudit: true }),
      );
      expect(decision).toEqual({ allowed: false, reason: "product_profile_missing" });
    });
  });

  /**
   * CORE-2 §16: the free audit must not be resettable by disconnecting and
   * reconnecting the repository. A project row is deletable; the grant is keyed
   * on the GitHub repository id and is not.
   */
  it("stays consumed after a disconnect wiped the project's audits", () => {
    const afterReconnect = facts({
      // The project is new, so nothing project-scoped survives …
      hasCompletedIncludedAudit: false,
      // … but the durable grant does.
      hasRepositoryGrant: true,
    });

    expect(authorizeAudit(afterReconnect)).toEqual({
      allowed: false,
      reason: "credits_required",
    });
  });
});

describe("consumesIncludedEntitlement", () => {
  it("consumes only when an audit actually completed", () => {
    expect(
      consumesIncludedEntitlement({ accessMode: "included_first_audit", auditCompleted: true }),
    ).toBe(true);
  });

  /**
   * CORE-2 §17, and the rule this module exists to make structural: a provider
   * outage, an internal timeout, a validation failure in Vibe's own
   * infrastructure, or our persistence failing must never cost the free audit.
   * All of them arrive here as `auditCompleted: false`.
   */
  it("does not consume when the run failed for any reason", () => {
    expect(
      consumesIncludedEntitlement({ accessMode: "included_first_audit", auditCompleted: false }),
    ).toBe(false);
  });

  it("does not consume the included entitlement when credits funded the run", () => {
    expect(consumesIncludedEntitlement({ accessMode: "credits", auditCompleted: true })).toBe(false);
  });
});

describe("retryAllowedAfterFailure", () => {
  it("allows a retry after an internal failure", () => {
    expect(
      retryAllowedAfterFailure({ accessMode: "included_first_audit", recentStartCount: 1 }),
    ).toBe(true);
  });

  /**
   * Free retries are not unbounded retries. The bound is the start window, not
   * the entitlement — so an outage is never mistaken for abuse, and abuse is
   * never mistaken for an outage.
   */
  it("stops allowing retries once the start window is exhausted", () => {
    expect(
      retryAllowedAfterFailure({
        accessMode: "included_first_audit",
        recentStartCount: AUDIT_START_LIMITS.maxStartsPerWindow,
      }),
    ).toBe(false);
  });

  it("does not punish a provider failure with the user's quota", () => {
    expect(AUDIT_START_LIMITS.providerFailuresCountTowardLimit).toBe(false);
  });
});

describe("toAuditAccessStatus", () => {
  it("reports availability and never a price", () => {
    const status = toAuditAccessStatus(facts());

    expect(status).toEqual({
      freeAuditAvailable: true,
      additionalAuditsRequireCredits: true,
      blockedReason: null,
    });
    // CORE-2 §46: no fake pricing, no invented balance.
    expect(JSON.stringify(status)).not.toMatch(/\$|price|balance|credits_remaining/i);
  });

  it("reports the free audit as spent once it is consumed", () => {
    const status = toAuditAccessStatus(facts({ hasCompletedIncludedAudit: true }));
    expect(status.freeAuditAvailable).toBe(false);
    expect(status.blockedReason).toBe("credits_required");
  });

  /**
   * Availability and startability are different questions. A profile that is
   * merely stale blocks *this* start; it does not spend the free audit.
   */
  it("keeps the free audit available while a prerequisite blocks the start", () => {
    const status = toAuditAccessStatus(facts({ productProfileCurrent: false }));
    expect(status.freeAuditAvailable).toBe(true);
    expect(status.blockedReason).toBe("product_profile_stale");
  });
});
