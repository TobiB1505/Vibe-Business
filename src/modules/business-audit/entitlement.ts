import type { CreditUnits } from "@/modules/credits/units";
import { SUPPORTED_AUDIT_CONTRACT_VERSIONS } from "./schema";

/**
 * Free Business Audit entitlement (CORE-2 §16, §17).
 *
 * The product rule: **the first qualified Business Audit is free.** Additional
 * audits are credit-gated, and since Billing Core-2 that gate is one a customer
 * can actually pass — Credits exist, the audit has an approved price, and the
 * start path reserves against a real balance.
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
  /** The project's one included audit. */
  | "included_first_audit"
  /**
   * The customer paid for this one (BILLING CORE-2 §39).
   *
   * No longer reserved. `authorizeAudit` still never returns it — a wallet is
   * not an entitlement fact, and this function decides entitlement only. It is
   * chosen where the payment actually is: the audit's prepare step reads the
   * live Credit hold on the operation and records the run as Credit-funded.
   *
   * `consumesIncludedEntitlement` is false for it, so a paid audit writes no
   * free-audit grant and the included one stays exactly as spent as it was.
   */
  | "credits"
  /**
   * A replacement Vibe owed the user because **Vibe** changed (CORE-2a.2 §18).
   *
   * Not an entitlement. It funds an audit that exists only because the stored
   * one stopped being an acceptable answer when the audit contract moved — so
   * it is free to the customer, costs us real money, and pointedly does **not**
   * restore the included audit (§19). `consumesIncludedEntitlement` returns
   * false for it, so no grant is written and the customer's one free audit
   * stays spent.
   *
   * The authority is server state — a stored contract version below the
   * minimum — never a caller-supplied flag (§26).
   */
  | "system_contract_refresh"
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
  /**
   * The included audit is spent, so another one is payable with Credits.
   *
   * **No longer terminal** (BILLING CORE-2 §39). It was, when it was written:
   * Credits did not exist, so "you have used your free audit" was the end of
   * the road. Core-2 made it a route into paying, and `operations/service.ts`
   * has treated it as one ever since — it checks affordability and reserves.
   *
   * The name is kept because a stored operation failure may carry it and must
   * keep meaning what it meant. What changed is what a caller does with it: a
   * start path routes it to Credits, and a UI must not render it as a wall.
   */
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

/**
 * Whether a stored audit is still an acceptable answer (CORE-2a.2 §25).
 *
 * A pure membership check, deliberately not "is it the newest version": an
 * additive contract may raise `AUDIT_CONTRACT_VERSION` without invalidating a
 * still-truthful older result.
 *
 * An audit with no recorded contract version is obsolete. That is not a
 * fallback — an audit that cannot say which contract it followed demonstrably
 * did not follow the current one.
 */
export function isAuditContractCurrent(storedContractVersion: string | null | undefined): boolean {
  return SUPPORTED_AUDIT_CONTRACT_VERSIONS.some((version) => version === storedContractVersion);
}

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
  /**
   * The newest completed audit, or null when there is none at all.
   *
   * The nesting is load-bearing. A bare `contractVersion: string | null`
   * cannot tell "an old audit that predates the contract" from "no audit
   * exists" — and those need opposite answers. The second happens whenever a
   * project is disconnected and reconnected: the durable grant survives, every
   * audit row does not, and reading that as an obsolete audit would hand out a
   * refresh of something that was never stored.
   */
  storedAudit: { contractVersion: string | null } | null;
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

  /*
   * 2. Who, if anyone, is paying — decided but not yet acted on.
   *
   * The two questions are separate (CORE-2a.2 §18): "has the customer received
   * their included audit?" is about the customer, and "is the stored result
   * still valid?" is about us. When the audit contract moves, the second
   * changes while the first does not.
   *
   * Resolved here and *returned* below, after the guards. An earlier version
   * returned the refresh straight from this branch, which let it skip the
   * concurrency and rate limits entirely — so an obsolete audit could start a
   * second run while one was already going, and could keep starting them. Both
   * cases are now covered by the same guards as any other run (§28, §34).
   */
  const entitlementSpent = facts.hasCompletedIncludedAudit || facts.hasRepositoryGrant;
  const refreshOwed =
    entitlementSpent &&
    facts.storedAudit !== null &&
    !isAuditContractCurrent(facts.storedAudit.contractVersion);

  if (entitlementSpent && !refreshOwed) {
    /*
     * Not terminal (BILLING CORE-2 §39).
     *
     * This function answers one question — *is another audit included?* — and
     * the answer here is no. It deliberately does not answer "can this
     * customer pay for one", because that is a question about a wallet at an
     * instant, and folding it in would make an entitlement decision go stale.
     *
     * `startBusinessAudit` reads this refusal and routes it into Credits. Any
     * other caller must do the same or say why not; rendering it as a wall is
     * what put "credits aren't available yet" on a screen beside a working
     * 6,080-Credit balance.
     */
    return { allowed: false, reason: "credits_required" };
  }

  // 3. One audit at a time per project. Applies to refreshes too.
  if (facts.hasRunningAudit) {
    return { allowed: false, reason: "audit_already_running" };
  }

  // 4. Bounded starts per window — what stops a contract that always fails
  //    from starting an expensive audit on every attempt (§34).
  if (facts.recentStartCount >= AUDIT_START_LIMITS.maxStartsPerWindow) {
    return { allowed: false, reason: "start_attempts_exhausted" };
  }

  return {
    allowed: true,
    accessMode: refreshOwed ? "system_contract_refresh" : "included_first_audit",
  };
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
  // `system_contract_refresh` is deliberately absent: a replacement Vibe owed
  // the user must never spend the entitlement a second time, and must never
  // restore it either (CORE-2a.2 §19, §36).
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
/**
 * What another audit costs, and whether this customer can fund it now
 * (BILLING CORE-2 §43).
 *
 * Null when no payment applies — the included audit is still available, or
 * Vibe owes a contract refresh. Present means the customer is being asked to
 * spend, and then both numbers are required: §43 wants the UI able to say
 * "you need 35, you have 20" rather than an unexplained refusal.
 *
 * `affordable` is a read, not authority. It can be stale by the time it is
 * rendered; the reservation in the start path is the real gate. It exists so
 * the screen can be honest before the click, not so it can decide.
 */
export type AuditCreditCost = {
  requiredCredits: CreditUnits;
  availableCredits: CreditUnits;
  affordable: boolean;
};

export type AuditAccessStatus = {
  freeAuditAvailable: boolean;
  /**
   * True once the included audit is spent.
   *
   * The name still reads correctly and the value is unchanged — what moved is
   * what it implies. It used to mean "and therefore nothing more can happen";
   * since Billing Core-2 it means "and therefore this one is payable". See
   * {@link AuditAccessStatus.creditCost}.
   */
  additionalAuditsRequireCredits: true;
  /**
   * The price and the balance, when the customer is the one paying.
   *
   * Null on the free and Vibe-owed paths. Resolved by the service, because
   * this module is a pure function of entitlement facts and a wallet is not
   * one of them.
   */
  creditCost: AuditCreditCost | null;
  /** Present when an audit cannot start right now, so the UI can explain why. */
  blockedReason: AuditDenialReason | null;
  /**
   * Vibe owes a replacement because its own audit contract moved on
   * (CORE-2a.2 §32).
   *
   * The UI must not say "you've used your free audit" in this state — that is
   * true and completely beside the point, since the reason a new audit is
   * available has nothing to do with the customer's entitlement.
   */
  systemRefreshAvailable: boolean;
};

export function toAuditAccessStatus(facts: AuditEntitlementFacts): AuditAccessStatus {
  const decision = authorizeAudit(facts);

  return {
    freeAuditAvailable: !facts.hasCompletedIncludedAudit && !facts.hasRepositoryGrant,
    additionalAuditsRequireCredits: true,
    // Left null here on purpose: this function is pure over entitlement facts,
    // and a balance is not one. `getAuditAccessStatus` fills it in.
    creditCost: null,
    blockedReason: decision.allowed ? null : decision.reason,
    systemRefreshAvailable: decision.allowed && decision.accessMode === "system_contract_refresh",
  };
}

/**
 * What `credits_required` means for a surface that has to draw it.
 *
 * One function, so a button's `disabled`, a notice's wording and any future
 * surface cannot disagree about the same refusal. The screenshot that started
 * this had them disagreeing in the worst possible way: a disabled control, a
 * sentence saying Credits were unavailable, and the 35-Credit price rendered
 * between them, on an account holding thousands.
 *
 * The split is on the **balance**, not the entitlement. A spent entitlement
 * that the customer can afford to replace is a purchase; only an empty wallet
 * is still a wall.
 */
export type AuditCreditGate =
  /** Nothing to pay: the audit is included, Vibe owes a refresh, or something else blocks. */
  | { kind: "not_applicable" }
  /** Payable now. The control stays enabled. */
  | { kind: "payable"; requiredCredits: CreditUnits; availableCredits: CreditUnits }
  /** Payable in principle, not today. Both numbers, so the screen can say which. */
  | { kind: "unaffordable"; requiredCredits: CreditUnits; availableCredits: CreditUnits }
  /**
   * The included audit is spent and no retail price resolved.
   *
   * Reachable only if the audit is removed from the price policy, or a policy
   * gap opens. Represented rather than collapsed into "unaffordable" because
   * "you cannot afford 0 Credits" is not a sentence anyone should be shown.
   */
  | { kind: "unpriced" };

export function resolveAuditCreditGate(status: AuditAccessStatus): AuditCreditGate {
  if (status.blockedReason !== "credits_required") return { kind: "not_applicable" };
  if (!status.creditCost) return { kind: "unpriced" };

  const { requiredCredits, availableCredits, affordable } = status.creditCost;
  return { kind: affordable ? "payable" : "unaffordable", requiredCredits, availableCredits };
}

/**
 * Whether Credits are the reason an audit cannot start *right now*.
 *
 * True only for the two states a customer cannot act their way out of on this
 * screen. `payable` is deliberately false: it is a price, and a price does not
 * disable a button.
 */
export function auditBlockedByCredits(gate: AuditCreditGate): boolean {
  return gate.kind === "unaffordable" || gate.kind === "unpriced";
}
