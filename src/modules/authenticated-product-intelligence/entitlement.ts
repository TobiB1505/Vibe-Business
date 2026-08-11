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
 * This module is a **pure decision function**. It holds no Browserbase
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
  /** The project's one included scan. The only executable mode today. */
  | "included_first_scan"
  /**
   * Reserved. Vibe Credits do not exist yet: nothing in this sprint returns
   * this mode, and no balance, price, or purchase is represented anywhere.
   */
  | "credits";

export type DeepScanDenialReason =
  /** The included scan is used and credits are not implemented yet. */
  | "credits_required"
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
 * encodes that — a Browserbase outage burns neither the entitlement nor the
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
  now?: Date;
};

/**
 * Decides whether a Deep Scan may start, and under which access mode.
 *
 * Ordering is load-bearing. `credits_required` is evaluated **before** any
 * provider work can begin (§18): discovering that a user cannot run a scan
 * only after paying Browserbase for a session would be both a cost leak and an
 * insult. Cheap local checks come first for the same reason.
 */
export function authorizeDeepScan(facts: DeepScanEntitlementFacts): DeepScanAuthorization {
  const now = facts.now ?? new Date();

  // 1. Nothing to sign in to.
  if (!facts.productionOrigin) {
    return { allowed: false, reason: "production_origin_missing" };
  }

  // 2. Entitlement. First, because it is the decision that must never be made
  //    after spending provider money.
  if (facts.hasSuccessfulIncludedScan) {
    // Credits are not implemented. This is the honest terminal answer, not a
    // route into a checkout that does not exist.
    return { allowed: false, reason: "credits_required" };
  }

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

  return { allowed: true, accessMode: "included_first_scan" };
}

/**
 * The safe, derived status the application and UI may see (Sprint 5 §6).
 *
 * Contains no provider session id, no Browserbase internals, no provider cost,
 * and no key — by construction, because there is no field for any of them.
 */
export type DeepScanAccessStatus = {
  includedScanAvailable: boolean;
  /** Always true while credits are unimplemented; the UI explains, never sells. */
  additionalScansRequireCredits: true;
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
