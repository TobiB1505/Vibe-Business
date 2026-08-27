import type { OperationType } from "./schema";

/**
 * How often one operation may be *started* (VB-008).
 *
 * The Business Audit has had this since CORE-2 — five starts per project per
 * hour, in `AUDIT_START_LIMITS`. Nothing else did. So a product scan, a
 * validation, a preview, a review or an agent execution could be started in a
 * loop, and each of those spends real money: paid inference, sandbox minutes,
 * remote browser time.
 *
 * ## What this bounds, and what it does not
 *
 * It bounds *attempts*, not spend, and not success. A run that fails because
 * Anthropic was down still counts, for the same reason the audit's own limit
 * counts every claimed run: the point is to bound how often the machinery can
 * be asked to start, and a limit that an attacker can reset by making the
 * provider fail is not a limit.
 *
 * It is deliberately not a spend cap. A spend cap belongs to the Credit
 * reservation path, which already refuses an unaffordable operation before it
 * begins. This is the cruder guard underneath: it stops a loop before the
 * reservation machinery has to absorb one.
 *
 * ## Two windows, because they answer different questions
 *
 * The per-project hour bounds a runaway loop against one project. The
 * per-account day bounds the same loop spread thinly across many projects,
 * which the first window cannot see at all — an account can create projects.
 *
 * ## Why the numbers are what they are
 *
 * Each is set well above what the product's own UI can produce in that window,
 * and well below what an unattended loop produces in a minute. They are round
 * numbers rather than measured ones, and that is the honest description: this
 * is a backstop, not a quota anybody is expected to reach.
 */
export type StartLimit = {
  /** Starts of this type allowed on one project within the hour. */
  perProjectPerHour: number;
  /** Starts of this type allowed across one account within the day. */
  perAccountPerDay: number;
};

const PAID_INFERENCE: StartLimit = { perProjectPerHour: 5, perAccountPerDay: 40 };

/** Sandbox minutes, remote browser time, or a real branch write. */
const PAID_INFRASTRUCTURE: StartLimit = { perProjectPerHour: 10, perAccountPerDay: 60 };

/** Free, but still work Vibe performs and a loop still costs something. */
const FREE_WORK: StartLimit = { perProjectPerHour: 20, perAccountPerDay: 120 };

export const START_LIMITS: Record<OperationType, StartLimit> = {
  business_audit: PAID_INFERENCE,
  opportunity_generation: PAID_INFERENCE,
  action_planning: PAID_INFERENCE,
  product_understanding: PAID_INFERENCE,
  agent_execution: PAID_INFERENCE,

  change_validation: PAID_INFRASTRUCTURE,
  change_preview: PAID_INFRASTRUCTURE,
  preview_teardown: PAID_INFRASTRUCTURE,
  change_review: PAID_INFRASTRUCTURE,
  change_preparation: PAID_INFRASTRUCTURE,
  change_merge: PAID_INFRASTRUCTURE,

  product_scan: FREE_WORK,
  change_outcome_verification: FREE_WORK,
  business_measurement: FREE_WORK,

  /**
   * Erasure is exempt in practice rather than by exception: it is
   * account-level, so it has no project window, and `operation_runs`'
   * single-active index already admits one at a time. A person deleting their
   * account must never be told to come back in an hour.
   */
  account_erasure: { perProjectPerHour: Number.MAX_SAFE_INTEGER, perAccountPerDay: 24 },
};

export type StartWindowCounts = {
  /** Starts of this type on this project within the last hour. */
  project: number;
  /** Starts of this type across this account within the last day. */
  account: number;
};

/**
 * Whether another start is allowed, given what the windows already hold.
 *
 * Pure, so the policy is testable without a database — the counting is the
 * store's job and the deciding is this.
 */
export function startAllowed(operationType: OperationType, counts: StartWindowCounts): boolean {
  const limit = START_LIMITS[operationType];
  return counts.project < limit.perProjectPerHour && counts.account < limit.perAccountPerDay;
}

export const PROJECT_WINDOW_MS = 60 * 60 * 1000;
export const ACCOUNT_WINDOW_MS = 24 * 60 * 60 * 1000;
