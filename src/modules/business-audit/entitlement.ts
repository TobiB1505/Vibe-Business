/**
 * Free Business Audit entitlement (CORE-2 §16, §17).
 *
 * The product rule: **the first qualified Business Audit is free.** Additional
 * audits are credit-gated, and Vibe Credits do not exist yet.
 *
 * This module is a **pure decision function**, deliberately mirroring
 * `authenticated-product-intelligence/entitlement.ts`. It holds no Supabase
 * knowledge and no provider knowledge, so it can be tested exhaustively
 * without a database, a key, or a bill.
 *
 * ## Consumption
 *
 * The rule is the one this codebase already paid to learn on Deep Scan:
 *
 *     a completed audit, funded by the included entitlement  →  consumed
 *     anything else                                          →  still available
 *
 * A provider outage, an internal timeout, a validation failure in Vibe's own
 * infrastructure, or our persistence failing must never cost a user their free
 * audit (CORE-2 §17). So consumption is **derived from the existence of a
 * completed audit**, never from a boolean anyone can flip and never from the
 * user pressing a button. There is deliberately no field that could claim the
 * free audit was used while no readable audit exists.
 *
 * ## Why availability is not simply "no completed audit for this project"
 *
 * Because a project is deletable. Disconnecting and reconnecting the same
 * repository would mint a fresh free audit, which CORE-2 §16 names explicitly
 * as something that must not work. `hasRepositoryGrant` is the durable half,
 * keyed on the GitHub repository id rather than the project — see the
 * `free_audit_grants` table.
 *
 * The two facts are OR-ed rather than either one being sufficient on its own:
 * the project-scoped one is what makes the in-flight and freshly-completed
 * cases correct, and the repository-scoped one is what makes disconnect
 * pointless.
 */

/** How an audit run is paid for. Persisted with the run. */
export type AuditAccessMode =
  /** The project's one included audit. The only executable mode today. */
  | "included_first_audit"
  /**
   * Reserved. Vibe Credits do not exist yet: nothing in CORE-2 returns this
   * mode, and no balance, price, or purchase is represented anywhere
   * (CORE-2 §46).
   */
  | "credits"
  /**
   * Historical. Audits written before the entitlement existed, when the audit
   * was ungated and repeatable.
   *
   * Declared so a stored row can be read back honestly, and written by nothing:
   * the migration sets it once and no code path produces it. It is neither of
   * the other two values because neither is true of those rows — they consumed
   * no one-per-project entitlement, and they spent no credits.
   */
  | "legacy_pre_entitlement";

export type AuditDenialReason =
  /** The free audit is used and credits are not implemented yet. */
  | "credits_required"
  /** An audit for this exact input is already running. */
  | "audit_already_running"
  /** Too many recent starts — see AUDIT_START_LIMITS. */
  | "start_attempts_exhausted"
  /** The Product Profile prerequisite is not satisfied (CORE-2 §8). */
  | "product_profile_missing"
  /** The profile is older than the evidence that exists now (CORE-2 §8). */
  | "product_profile_stale";

export type AuditAuthorization =
  | { allowed: true; accessMode: AuditAccessMode }
  | { allowed: false; reason: AuditDenialReason };

/**
 * Abuse limits (CORE-2 §59).
 *
 * Failed audits do not consume the entitlement — but inference costs real
 * money whether or not the audit succeeds, so "free retries" cannot mean
 * "unbounded retries". Deliberately small, and centralized here rather than
 * spread across a general rate-limit platform.
 *
 * The distinction that matters, and the reason this is not one number: a
 * genuine infrastructure failure must not be punished like abuse.
 * `providerFailuresCountTowardLimit: false` is what encodes that — an
 * Anthropic outage burns neither the entitlement nor the user's retry budget.
 */
export const AUDIT_START_LIMITS = {
  /** Audit starts allowed per project inside the window below. */
  maxStartsPerWindow: 5,
  windowMs: 60 * 60 * 1000,
  /** A provider failure is our problem, not the user's quota. */
  providerFailuresCountTowardLimit: false,
} as const;

/** Everything the decision needs, gathered by the caller. */
export type AuditEntitlementFacts = {
  /**
   * A completed audit for this project funded by the included entitlement.
   * The project-scoped half of consumption.
   */
  hasCompletedIncludedAudit: boolean;
  /**
   * A durable grant for this user and GitHub repository. The half that
   * survives disconnect/reconnect (CORE-2 §16).
   */
  hasRepositoryGrant: boolean;
  /** An audit in `pending` / `analyzing` for this project. */
  hasRunningAudit: boolean;
  /** Audit starts inside `windowMs`, excluding provider-caused failures. */
  recentStartCount: number;
  /** A completed Product Profile exists for this project (CORE-2 §3). */
  hasProductProfile: boolean;
  /**
   * The profile was built from the evidence that exists now.
   *
   * False means a newer snapshot has appeared since. CORE-2 §8 forbids the
   * audit from quietly building a second product-understanding pipeline in
   * that case, so it blocks and the UI offers a profile refresh instead.
   */
  productProfileCurrent: boolean;
};

/**
 * Whether a free audit may start.
 *
 * Ordering is load-bearing. The prerequisites come first because they are the
 * cheapest and the most actionable; entitlement is checked before anything
 * could spend provider money, for the same reason the Deep Scan checks it
 * first — discovering a user cannot run an audit only after paying for
 * inference would be both a cost leak and an insult.
 */
export function authorizeAudit(facts: AuditEntitlementFacts): AuditAuthorization {
  // 1. Prerequisites. Nothing to reason from.
  if (!facts.hasProductProfile) {
    return { allowed: false, reason: "product_profile_missing" };
  }
  if (!facts.productProfileCurrent) {
    return { allowed: false, reason: "product_profile_stale" };
  }

  // 2. Entitlement, before any spend is possible.
  if (facts.hasCompletedIncludedAudit || facts.hasRepositoryGrant) {
    // Credits are not implemented. This is the honest terminal answer, not a
    // route into a checkout that does not exist (CORE-2 §45, §46).
    return { allowed: false, reason: "credits_required" };
  }

  // 3. One audit at a time per project.
  if (facts.hasRunningAudit) {
    return { allowed: false, reason: "audit_already_running" };
  }

  // 4. Bounded starts per window.
  if (facts.recentStartCount >= AUDIT_START_LIMITS.maxStartsPerWindow) {
    return { allowed: false, reason: "start_attempts_exhausted" };
  }

  return { allowed: true, accessMode: "included_first_audit" };
}

/**
 * Whether a finished run consumed the included entitlement.
 *
 * Exists as a named function so the invariant is stated once and testable
 * directly: consumption follows a persisted, completed audit, and nothing
 * else. In particular it is false for every internal failure, which is what
 * makes CORE-2 §17 a property of the code rather than a promise in a document.
 */
export function consumesIncludedEntitlement(run: {
  accessMode: AuditAccessMode;
  auditCompleted: boolean;
}): boolean {
  return run.accessMode === "included_first_audit" && run.auditCompleted;
}

/**
 * Whether a failed run leaves the user able to try again (CORE-2 §17).
 *
 * Every internal failure is retryable, because none of them consumed
 * anything. The bound on retries is `AUDIT_START_LIMITS`, not the
 * entitlement — the two are separate on purpose, so an outage cannot be
 * mistaken for abuse.
 */
export function retryAllowedAfterFailure(facts: {
  accessMode: AuditAccessMode;
  recentStartCount: number;
}): boolean {
  return (
    facts.accessMode === "included_first_audit" &&
    facts.recentStartCount < AUDIT_START_LIMITS.maxStartsPerWindow
  );
}

/**
 * The safe, derived status the application and UI may see.
 *
 * Contains no provider detail, no cost, and no key — by construction, because
 * there is no field for any of them.
 */
export type AuditAccessStatus = {
  freeAuditAvailable: boolean;
  /** Always true while credits are unimplemented; the UI explains, never sells. */
  additionalAuditsRequireCredits: true;
  /** Present when an audit cannot start right now, so the UI can explain why. */
  blockedReason: AuditDenialReason | null;
};

export function toAuditAccessStatus(facts: AuditEntitlementFacts): AuditAccessStatus {
  const decision = authorizeAudit(facts);

  return {
    freeAuditAvailable: !facts.hasCompletedIncludedAudit && !facts.hasRepositoryGrant,
    additionalAuditsRequireCredits: true,
    blockedReason: decision.allowed ? null : decision.reason,
  };
}
