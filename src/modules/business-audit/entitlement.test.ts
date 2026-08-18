import { describe, expect, it } from "vitest";
import { MIN_SUPPORTED_AUDIT_CONTRACT_VERSION } from "./schema";
import { creditsToUnits } from "@/modules/credits/units";
import {
  AUDIT_START_LIMITS,
  auditBlockedByCredits,
  authorizeAudit,
  isAuditContractCurrent,
  consumesIncludedEntitlement,
  resolveAuditCreditGate,
  retryAllowedAfterFailure,
  toAuditAccessStatus,
  type AuditAccessStatus,
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
    // Current by default, so the refresh path stays out of the way of the
    // entitlement cases below.
    storedAudit: { contractVersion: MIN_SUPPORTED_AUDIT_CONTRACT_VERSION },
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

  /**
   * A pre-CORE-2 audit ran when nothing was gated and the audit was freely
   * repeatable. It consumed no entitlement, because there was none — and this
   * has to hold even though such a row *is* a completed audit.
   */
  it("does not consume anything for an audit that predates the entitlement", () => {
    expect(
      consumesIncludedEntitlement({ accessMode: "legacy_pre_entitlement", auditCompleted: true }),
    ).toBe(false);
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
  /**
   * The pure function still resolves no price — but for a different reason
   * than it used to. It is no longer that Credits do not exist; it is that a
   * wallet is not an entitlement fact, so this function has nothing to read a
   * balance from. `getAuditAccessStatus` fills `creditCost` in, and only on the
   * path where the customer is actually the one paying.
   */
  it("reports availability and resolves no price of its own", () => {
    const status = toAuditAccessStatus(facts());

    expect(status).toEqual({
      freeAuditAvailable: true,
      additionalAuditsRequireCredits: true,
      creditCost: null,
      blockedReason: null,
      systemRefreshAvailable: false,
    });
    // CORE-2 §46: no invented balance, and no amount this module made up.
    expect(JSON.stringify(status)).not.toMatch(/\$|balance|credits_remaining/i);
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

/**
 * System contract refresh (CORE-2a.2 §18–§20, §36–§39).
 *
 * The separation this whole half exists to make:
 *
 *   free entitlement  →  "has the customer received their included audit?"
 *   contract refresh  →  "is the stored result still valid, given Vibe changed?"
 *
 * Conflating them is what left every existing user stranded on whichever audit
 * version they first ran, fixable only by deleting a row by hand.
 */
describe("system contract refresh", () => {
  const consumed = { hasCompletedIncludedAudit: true, hasRepositoryGrant: true };

  it("permits a refresh when the stored audit predates the current contract", () => {
    const decision = authorizeAudit(
      facts({ ...consumed, storedAudit: { contractVersion: "business-audit-contract-v1" } }),
    );

    expect(decision).toEqual({ allowed: true, accessMode: "system_contract_refresh" });
  });

  /** An audit that cannot say which contract it followed did not follow this one. */
  /**
   * A grant with no stored audit is the disconnect/reconnect case, not an
   * obsolete result. There is nothing to refresh, so the entitlement answer
   * stands.
   */
  it("does not offer a refresh when no audit is stored at all", () => {
    const decision = authorizeAudit(facts({ ...consumed, storedAudit: null }));
    expect(decision).toEqual({ allowed: false, reason: "credits_required" });
  });

  it("treats an audit with no recorded contract version as obsolete", () => {
    const decision = authorizeAudit(facts({ ...consumed, storedAudit: { contractVersion: null } }));
    expect(decision).toEqual({ allowed: true, accessMode: "system_contract_refresh" });
  });

  it("does NOT refresh an audit already on the current contract (§37)", () => {
    const decision = authorizeAudit(facts({ ...consumed }));
    expect(decision).toEqual({ allowed: false, reason: "credits_required" });
  });

  /**
   * §19, §36 — the load-bearing one. A refresh is Vibe paying for its own
   * change; it must not hand the customer a second free audit.
   */
  it("never restores the free entitlement", () => {
    expect(
      consumesIncludedEntitlement({ accessMode: "system_contract_refresh", auditCompleted: true }),
    ).toBe(false);

    const status = toAuditAccessStatus(
      facts({ ...consumed, storedAudit: { contractVersion: null } }),
    );
    expect(status.freeAuditAvailable).toBe(false);
    expect(status.systemRefreshAvailable).toBe(true);
  });

  /**
   * §32: the UI must not say "you've used your free audit" here. It is true
   * and entirely beside the point — the reason an audit is available has
   * nothing to do with the customer's entitlement.
   */
  it("reports a refresh rather than a credits block", () => {
    const status = toAuditAccessStatus(facts({ ...consumed, storedAudit: { contractVersion: null } }));
    expect(status.blockedReason).toBeNull();
    expect(status.systemRefreshAvailable).toBe(true);
  });

  /** Prerequisites still come first: a refresh cannot run on a stale profile. */
  it("does not bypass the Product Profile prerequisites", () => {
    const decision = authorizeAudit(
      facts({ ...consumed, storedAudit: { contractVersion: null }, productProfileCurrent: false }),
    );
    expect(decision).toEqual({ allowed: false, reason: "product_profile_stale" });
  });

  /** §34: a broken contract must not start an audit on every page load. */
  it("stays bounded by the start window", () => {
    const decision = authorizeAudit(
      facts({
        ...consumed,
        storedAudit: { contractVersion: null },
        recentStartCount: AUDIT_START_LIMITS.maxStartsPerWindow,
      }),
    );
    expect(decision).toEqual({ allowed: false, reason: "start_attempts_exhausted" });
  });

  it("does not start a second refresh while one is running (§28)", () => {
    const decision = authorizeAudit(
      facts({ ...consumed, storedAudit: { contractVersion: null }, hasRunningAudit: true }),
    );
    expect(decision).toEqual({ allowed: false, reason: "audit_already_running" });
  });
});

describe("isAuditContractCurrent", () => {
  it("accepts exactly the supported minimum", () => {
    expect(isAuditContractCurrent(MIN_SUPPORTED_AUDIT_CONTRACT_VERSION)).toBe(true);
  });

  it.each([null, undefined, "", "business-audit-contract-v1"])(
    "treats %p as obsolete",
    (version) => {
      expect(isAuditContractCurrent(version)).toBe(false);
    },
  );
});

/**
 * What a screen is allowed to do with `credits_required`
 * (BILLING CORE-2 §39, §43).
 *
 * These exist because the failure this replaces was not a wrong value — it was
 * two surfaces reading one correct value differently. The score page disabled
 * its button and said Credits "aren't available yet"; the button beside it
 * rendered the 35-Credit price; the account held thousands. Every test passed.
 *
 * So the classification is a function now, and these are its cases.
 */
describe("resolveAuditCreditGate", () => {
  const status = (overrides: Partial<AuditAccessStatus> = {}): AuditAccessStatus => ({
    freeAuditAvailable: false,
    additionalAuditsRequireCredits: true,
    creditCost: null,
    blockedReason: "credits_required",
    systemRefreshAvailable: false,
    ...overrides,
  });

  const cost = (required: number, available: number) => ({
    requiredCredits: creditsToUnits(required),
    availableCredits: creditsToUnits(available),
    affordable: creditsToUnits(available) >= creditsToUnits(required),
  });

  it("calls an affordable re-run payable, and does not block on it", () => {
    const gate = resolveAuditCreditGate(status({ creditCost: cost(35, 6080) }));

    expect(gate).toEqual({
      kind: "payable",
      requiredCredits: creditsToUnits(35),
      availableCredits: creditsToUnits(6080),
    });
    // The regression, stated directly: a price does not disable a button.
    expect(auditBlockedByCredits(gate)).toBe(false);
  });

  it("carries both numbers when the wallet is short, so the screen can name them", () => {
    const gate = resolveAuditCreditGate(status({ creditCost: cost(35, 20) }));

    expect(gate).toEqual({
      kind: "unaffordable",
      requiredCredits: creditsToUnits(35),
      availableCredits: creditsToUnits(20),
    });
    expect(auditBlockedByCredits(gate)).toBe(true);
  });

  /** Exact change is enough. A boundary that blocks here is money kept for nothing. */
  it("treats an exactly-sufficient balance as payable", () => {
    expect(resolveAuditCreditGate(status({ creditCost: cost(35, 35) })).kind).toBe("payable");
  });

  it("distinguishes an unpriced audit from an unaffordable one", () => {
    const gate = resolveAuditCreditGate(status({ creditCost: null }));

    expect(gate).toEqual({ kind: "unpriced" });
    expect(auditBlockedByCredits(gate)).toBe(true);
  });

  it.each([null, "audit_already_running", "product_profile_missing"] as const)(
    "says nothing about Credits when the refusal is %p",
    (blockedReason) => {
      const gate = resolveAuditCreditGate(status({ blockedReason, creditCost: cost(35, 0) }));

      expect(gate).toEqual({ kind: "not_applicable" });
      // Every other refusal keeps its own meaning — this only reclassifies the
      // one that stopped being terminal.
      expect(auditBlockedByCredits(gate)).toBe(false);
    },
  );
});
