/**
 * Deep Scan entitlement policy (Sprint 5 §2–§5, §10).
 *
 * The product rule: **each project receives one included successful Deep Scan;
 * additional Deep Scans are credit-gated.**
 *
 * Why the first one is included: many seriously-built products keep most of
 * their value behind a login. If Vibe reports on a repository and a marketing
 * page and stops, a new user reasonably concludes Vibe does not understand
 * their product — before Vibe was ever allowed to look at the part that
 * matters. The included scan is product activation, not a discount.
 *
 * This module is a **pure decision function**. It holds no provider
 * knowledge, and the browser service holds no pricing knowledge (§10), so the
 * credits system can later add a mode here without touching orchestration.
 *
 * The consumption rule is deliberately strict, and it is the part most likely
 * to be got wrong under pressure to look tidy:
 *
 *   a successfully persisted snapshot  →  entitlement consumed
 *   anything else                      →  entitlement still available
 *
 * A provider outage, an expired login, a cancelled window, or our own
 * persistence failing must never cost the user their one included scan. The
 * authoritative signal is therefore the existence of a completed snapshot
 * (§5) — not a boolean anyone can flip, and not the creation of a browser
 * session (§2).
 */

/** How a Deep Scan run is paid for. Persisted with the run. */
export type DeepScanAccessMode =
  /** The project's one included scan. */
  | "included_first_scan"
  /**
   * Paid for out of the account's Vibe Credit balance, at `launch-v1`'s Deep
   * Scan price. Reachable only once the included scan has been consumed.
   */
  | "credits";

export type DeepScanDenialReason =
  /**
   * The included scan is used and no Credit price is in force.
   *
   * Kept, and still reachable: a policy with no Deep Scan price resolves here
   * rather than running a scan for free. Under `launch-v1` an additional scan
   * has a price, so the ordinary path past a consumed entitlement is
   * `insufficient_credits` — which is a different sentence to a customer, and
   * the one that has a checkout behind it.
   */
  | "credits_required"
  /** An additional scan is priced, and this balance does not cover it. */
  | "insufficient_credits"
  /** A live session already exists for this project. */
  | "scan_already_running"
  /** Too many recent starts — see START_ATTEMPT_LIMITS. */
  | "start_attempts_exhausted"
  /** Cooling off after an abandoned or cancelled attempt. */
  | "cooldown_active"
  /** No production origin configured, so there is nothing to sign in to. */
  | "production_origin_missing";

export type DeepScanAuthorization =
  | { allowed: true; accessMode: DeepScanAccessMode }
  | { allowed: false; reason: DeepScanDenialReason };

/**
 * Abuse limits (Sprint 5 §3).
 *
 * Failed scans do not consume the entitlement — but a remote browser costs
 * real money whether or not the scan succeeds, so "free retries" cannot mean
 * "unbounded retries". These are deliberately small and centralized here
 * rather than a general rate-limit platform.
 *
 * The distinction that matters: a genuine infrastructure failure should not be
 * punished like abuse. `providerFailuresCountTowardLimit: false` is what
 * encodes that — a provider outage burns neither the entitlement nor the
 * user's attempt budget.
 */
export const START_ATTEMPT_LIMITS = {
  /** Session starts allowed per project inside the window below. */
  maxStartsPerWindow: 5,
  windowMs: 60 * 60 * 1000,
  /** Pause after the user abandons or cancels a login. */
  cooldownAfterAbandonedMs: 2 * 60 * 1000,
  /** A provider failure is our problem, not the user's quota. */
  providerFailuresCountTowardLimit: false,
} as const;

/** Everything the decision needs, gathered by the caller. */
export type DeepScanEntitlementFacts = {
  /** True once a Deep Scan snapshot has been successfully persisted. */
  hasSuccessfulIncludedScan: boolean;
  /** A session in `created` / `waiting_for_login` / `analyzing`. */
  hasLiveSession: boolean;
  /** Session starts inside `windowMs`, excluding provider-caused failures. */
  recentStartCount: number;
  /** When the last attempt was abandoned, cancelled, or expired. */
  lastAbandonedAt: Date | null;
  /** The project's configured production origin, if any. */
  productionOrigin: string | null;
  /**
   * What an additional scan costs right now, or null when the policy in force
   * does not price one.
   *
   * Passed in rather than resolved here for the reason this module's header
   * states: it holds no pricing knowledge, so that pricing can change without
   * touching the entitlement rule. Null and zero are different — null means
   * "not for sale", and it is why `credits_required` still exists.
   */
  additionalScanPrice: number | null;
  /** Spendable balance, in credit units. */
  availableCredits: number;
  now?: Date;
};

/**
 * Decides whether a Deep Scan may start, and under which access mode.
 *
 * Ordering is load-bearing. `credits_required` is evaluated **before** any
 * provider work can begin (§18): discovering that a user cannot run a scan
 * only after paying for a session would be both a cost leak and an
 * insult. Cheap local checks come first for the same reason.
 */
export function authorizeDeepScan(facts: DeepScanEntitlementFacts): DeepScanAuthorization {
  const now = facts.now ?? new Date();

  // 1. Nothing to sign in to.
  if (!facts.productionOrigin) {
    return { allowed: false, reason: "production_origin_missing" };
  }

  // 2. Entitlement, and how this scan would be paid for. First, because it is
  //    the decision that must never be made after spending provider money.
  //
  //    The included scan is checked before the balance, so a project that still
  //    has its free scan is never told about a price it does not have to pay.
  let accessMode: DeepScanAccessMode = "included_first_scan";

  if (facts.hasSuccessfulIncludedScan) {
    // No price in force: the honest terminal answer, and not a route into a
    // checkout that cannot help.
    if (facts.additionalScanPrice === null) {
      return { allowed: false, reason: "credits_required" };
    }

    // Priced, but this wallet does not cover it. A refusal the customer can act
    // on — and, like every check here, made before a browser exists.
    if (facts.availableCredits < facts.additionalScanPrice) {
      return { allowed: false, reason: "insufficient_credits" };
    }

    accessMode = "credits";
  }

  // 3-5. Abuse limits. Deliberately applied to a paid scan exactly as to an
  //      included one: they bound how *often* a login page can be hammered and
  //      how many browsers can be open at once, and paying buys neither. They
  //      come after the entitlement decision so the user is told the reason
  //      that is actually about them.

  // 3. One live browser per project.
  if (facts.hasLiveSession) {
    return { allowed: false, reason: "scan_already_running" };
  }

  // 4. Cooldown after an abandoned attempt.
  if (facts.lastAbandonedAt) {
    const elapsed = now.getTime() - facts.lastAbandonedAt.getTime();
    if (elapsed < START_ATTEMPT_LIMITS.cooldownAfterAbandonedMs) {
      return { allowed: false, reason: "cooldown_active" };
    }
  }

  // 5. Bounded starts per window.
  if (facts.recentStartCount >= START_ATTEMPT_LIMITS.maxStartsPerWindow) {
    return { allowed: false, reason: "start_attempts_exhausted" };
  }

  return { allowed: true, accessMode };
}

/**
 * The safe, derived status the application and UI may see (Sprint 5 §6).
 *
 * Contains no provider session id, no provider internals, no provider cost,
 * and no key — by construction, because there is no field for any of them.
 */
export type DeepScanAccessStatus = {
  includedScanAvailable: boolean;
  /**
   * Whether an additional scan costs Credits.
   *
   * Was the literal `true` while there was no price and the UI could only
   * explain. It is still `true` under `launch-v1` — an additional scan is
   * Credit-gated, which is what this field has always said — but it is a
   * `boolean` now rather than a literal, because a policy with no Deep Scan
   * price is still reachable and the type should not assert otherwise.
   */
  additionalScansRequireCredits: boolean;
  /**
   * What an additional scan costs, in credit units, or null when none is for
   * sale under the policy in force.
   *
   * The UI shows a price only when there is one. Null renders the same
   * explanation it always did, rather than a zero.
   */
  additionalScanPrice: number | null;
  /** Vibe's own session id and status only. */
  activeSession: { id: string; status: string } | null;
  /** Present when a scan cannot start right now, so the UI can explain why. */
  blockedReason: DeepScanDenialReason | null;
  /**
   * When a cooldown lifts, as an ISO instant.
   *
   * A blocked state the user cannot act on and cannot wait out knowingly is a
   * dead end; this is what lets the UI say "in about two minutes" instead of
   * silently offering nothing.
   */
  retryAvailableAt: string | null;
};

export function toDeepScanAccessStatus(
  facts: DeepScanEntitlementFacts,
  activeSession: { id: string; status: string } | null,
): DeepScanAccessStatus {
  const decision = authorizeDeepScan(facts);

  // Only meaningful for the one denial the user can simply outlast.
  const retryAvailableAt =
    !decision.allowed && decision.reason === "cooldown_active" && facts.lastAbandonedAt
      ? new Date(facts.lastAbandonedAt.getTime() + START_ATTEMPT_LIMITS.cooldownAfterAbandonedMs).toISOString()
      : null;

  return {
    includedScanAvailable: !facts.hasSuccessfulIncludedScan,
    additionalScansRequireCredits: true,
    additionalScanPrice: facts.additionalScanPrice,
    activeSession,
    blockedReason: decision.allowed ? null : decision.reason,
    retryAvailableAt,
  };
}

/**
 * Whether a finished run consumed the included entitlement.
 *
 * Exists as a named function so the invariant is stated once and can be tested
 * directly: consumption follows a persisted snapshot, and nothing else.
 */
export function consumesIncludedEntitlement(run: {
  accessMode: DeepScanAccessMode;
  snapshotPersisted: boolean;
}): boolean {
  return run.accessMode === "included_first_scan" && run.snapshotPersisted;
}

/**
 * Whether a finished run should be charged.
 *
 * The same rule as {@link consumesIncludedEntitlement}, applied to the other
 * access mode, and stated as its own function for the same reason: what a scan
 * costs and what it consumes are one decision made twice, and writing it once
 * per mode is what keeps them from drifting.
 *
 * A provider outage, an expired login, a cancelled window or our own
 * persistence failing must not cost a paid customer Credits any more than they
 * cost a free one their included scan. Everything that does not persist a
 * snapshot releases the hold.
 */
export function consumesCredits(run: {
  accessMode: DeepScanAccessMode;
  snapshotPersisted: boolean;
}): boolean {
  return run.accessMode === "credits" && run.snapshotPersisted;
}
