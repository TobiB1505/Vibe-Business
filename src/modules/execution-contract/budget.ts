import { creditsToUnits, type CreditUnits } from "@/modules/credits/units";

/**
 * The execution budget contract (EXECUTION CORE-3 §24, §25, §26).
 *
 * ## Two different ceilings, and why both are here
 *
 * ```
 * maxCredits          what the customer authorized to be spent      money
 * everything else     what the run may consume before it stops      blast radius
 * ```
 *
 * The Credit ceiling is the one the customer sees and approves; the rest exist
 * so that "the agent looped for an hour" and "the agent rewrote four hundred
 * files" are impossible rather than merely expensive. Both belong to the same
 * object because a run stops on whichever is reached first, and splitting them
 * would let one be enforced while the other was forgotten.
 *
 * ## Why there are no production numbers
 *
 * §25 is explicit: do not choose arbitrary production numbers now. There is
 * also a harder reason, and it is the same one `credits/rating.ts` records for
 * its rate cards — Vibe has no measured cost for an agent run, because no agent
 * run has ever happened. A number invented today would look like a decision and
 * be a guess, and it would be baked into every spec produced before the first
 * real dogfood corrected it.
 *
 * So {@link EXECUTION_BUDGET_POLICIES} is empty, {@link resolveExecutionBudget}
 * returns null, and admission refuses with `agentic_pricing_not_configured`.
 * That is not a gap — it is the honest state of the product, and it is exactly
 * how `retail.ts` already describes Agentic Execution: *"Deliberately absent:
 * Deep Scan and Agentic Execution. Neither has an approved price."*
 *
 * Tests supply a fixture policy. Nothing in production does.
 */

/**
 * Everything a bounded run may consume (§25).
 *
 * Every field is a hard ceiling, never a target. A run that reaches one stops
 * with a structural stop reason (`EXECUTION_STOP_REASONS`) rather than
 * degrading quietly — a half-finished change that nobody was told about is
 * worse than a refusal.
 */
export type ExecutionBudget = {
  budgetPolicyVersion: string;

  /**
   * The maximum Credits this work may cost the customer (§26).
   *
   * A hard authority, not an estimate. If a future agent determines more work
   * is required it pauses with `additional_credits_required` and the customer
   * decides; there is no path that spends past this number.
   */
  maxCredits: CreditUnits;

  /** Paid provider calls. */
  maxAiCalls: number;
  /** Turns of the future agent loop. */
  maxAgentTurns: number;
  /** Attempts to fix a failing required validation before stopping (§23). */
  maxRepairAttempts: number;
  maxWallClockMs: number;
  maxSandboxMs: number;
  /** Mirrors the policy's write scope, so a run stops before producing an illegal diff. */
  maxChangedFiles: number;
  maxChangedBytes: number;
  /** Zero under a `none` network policy. Present so widening it is explicit. */
  maxNetworkRequests: number;
  /**
   * A hard USD ceiling handed to the agent provider itself (CORE-4 §17, §18).
   *
   * The second of two independent cost stops, and it exists because the first
   * one is not enough. `maxCredits` is Vibe's authority over the *customer's*
   * bill; this is Vibe's authority over its own provider invoice, enforced
   * inside the provider's own loop so a runaway agent stops mid-run rather than
   * at the next point Vibe happens to look.
   *
   * Deliberately not an accounting figure. The number a provider counts against
   * this is its own client-side estimate, which §19 forbids treating as billing
   * authority — so it is a guard rail, and the authoritative usage is metered
   * separately from reported tokens.
   */
  maxProviderSpendUsd: number;
};

/**
 * A versioned, effective-dated budget policy.
 *
 * Same conventions as `credits/retail.ts` — half-open intervals, integer credit
 * units, policy in reviewable code rather than an editable table — so the three
 * layers cannot develop different date semantics at a boundary instant.
 */
export type ExecutionBudgetPolicy = {
  version: string;
  /** Inclusive ISO instant. */
  effectiveFrom: string;
  /** Exclusive ISO instant; null means "current". */
  effectiveTo: string | null;
  budget: Omit<ExecutionBudget, "budgetPolicyVersion">;
};

/**
 * Every approved budget policy, newest last.
 *
 * **Empty, deliberately.** Adding an entry is a commercial and safety decision
 * with a measured cost behind it, made after the first real agent dogfood in
 * Core-4 — not an implementation detail somebody fills in to make a test pass.
 */
export const EXECUTION_BUDGET_POLICIES: readonly ExecutionBudgetPolicy[] = [];

/**
 * The CORE-4 internal dogfood budget (CORE-4 §17, §18).
 *
 * **Not a production policy, and structurally unable to become one by accident.**
 * It lives in its own array, `resolveExecutionBudget` never sees it, and
 * `coding-agent/authorization.ts` is the only thing that resolves it — for a
 * project on an explicit internal allowlist. A customer path reaching this
 * would have to add the project to that list first, which is a deployment
 * action with a person attached.
 *
 * ## Where the numbers come from
 *
 * Nowhere, and that is stated rather than hidden. Vibe has never run an agent,
 * so every value below is a *conservative ceiling chosen to bound the first
 * experiment*, not a measurement and not a price. §17 asks for exactly this:
 * deliberately small limits, versioned, labelled as dogfood.
 *
 * They are sized against what is already measured elsewhere in this codebase:
 *
 *  - `maxWallClockMs` 20 minutes — the sandbox's own lifetime bound is 15
 *    minutes (`SANDBOX_BUDGETS.totalLifetimeMs`), so the agent cannot outlive
 *    its workspace; the extra five minutes cover provisioning and teardown.
 *  - `maxSandboxMs` matches that sandbox lifetime exactly, because the sandbox
 *    is the thing being bounded and two different numbers would mean one of
 *    them is decoration.
 *  - `maxChangedFiles` 8 and `maxChangedBytes` 60 KB — a *bounded* change to
 *    application source. The first real Vibe-prepared change was two files;
 *    eight is generous for one Planner step and small enough that a runaway
 *    rewrite stops rather than arriving at review.
 *  - `maxAgentTurns` 40 and `maxRepairAttempts` 3 — enough for inspect → edit →
 *    check → repair three times over, which is the loop §16 asks to be proven.
 *  - `maxProviderSpendUsd` 3.00 — roughly two orders of magnitude above a
 *    Business Audit's measured provider cost, and low enough that a stuck loop
 *    costs less than a coffee before the provider stops it.
 *  - `maxCredits` 0 in *effect*: see `credit.ts`. The dogfood account is
 *    internal, and §18 forbids inventing a customer-facing Agent price, so the
 *    ceiling exists to exercise reserve → settle → release rather than to
 *    price anything.
 */
export const CORE4_DOGFOOD_BUDGET_POLICY: ExecutionBudgetPolicy = {
  version: "core4-dogfood-budget-v1",
  effectiveFrom: "2026-08-18T00:00:00.000Z",
  effectiveTo: null,
  budget: {
    // An internal test ceiling, priced by `credits/dogfood.ts`. Never shown to
    // a customer and never charged to one.
    maxCredits: creditsToUnits(100),
    maxAiCalls: 60,
    maxAgentTurns: 40,
    maxRepairAttempts: 3,
    maxWallClockMs: 20 * 60 * 1000,
    maxSandboxMs: 15 * 60 * 1000,
    maxChangedFiles: 8,
    maxChangedBytes: 60 * 1024,
    maxNetworkRequests: 0,
    maxProviderSpendUsd: 3,
  },
};

/**
 * The dogfood policy set, kept apart from production (§18).
 *
 * A separate array rather than a flag on the policy, because a flag is one
 * `if` away from being ignored and a separate array has to be *reached for*.
 */
export const EXECUTION_DOGFOOD_BUDGET_POLICIES: readonly ExecutionBudgetPolicy[] = [
  CORE4_DOGFOOD_BUDGET_POLICY,
];

/**
 * The budget in force at an instant, or null when none is.
 *
 * Half-open `[effectiveFrom, effectiveTo)`, matching `resolveRetailPolicy` and
 * `resolveRateCard` exactly.
 */
export function resolveExecutionBudget(
  at: Date = new Date(),
  policies: readonly ExecutionBudgetPolicy[] = EXECUTION_BUDGET_POLICIES,
): ExecutionBudget | null {
  const timestamp = at.getTime();

  for (const policy of policies) {
    const from = Date.parse(policy.effectiveFrom);
    const to =
      policy.effectiveTo === null ? Number.POSITIVE_INFINITY : Date.parse(policy.effectiveTo);
    if (timestamp >= from && timestamp < to) {
      return { budgetPolicyVersion: policy.version, ...policy.budget };
    }
  }

  return null;
}

/* ---------------------------------------------------------------------------
 * Credit binding (§24, §26, §49)
 * ------------------------------------------------------------------------ */

/**
 * The Billing identities a spec is bound to.
 *
 * The quote is recorded at spec creation — it is what the customer was shown,
 * and §24 requires the spec and the future run to name it. The reservation is
 * bound at admission, immediately before work would start, because a hold taken
 * hours earlier is not evidence of anything at the moment of spending.
 *
 * Neither is a balance and neither is a price. Billing Core-1 owns those, and
 * this module holds identities so a later audit can join the two.
 */
export type ExecutionCreditBinding = {
  quoteId: string | null;
  maxAuthorizedCredits: CreditUnits | null;
};

/** An active reservation, as admission needs to see it. */
export type BoundReservation = {
  id: string;
  status: string;
  reservedCredits: CreditUnits;
};

export type BudgetBindingRefusal =
  | "agentic_pricing_not_configured"
  | "credit_reservation_required"
  | "credit_reservation_insufficient"
  | "credit_reservation_not_active";

/**
 * Whether a reservation actually authorizes this spec's ceiling (§26, §49).
 *
 * Three checks, and the third is the one that matters: a reservation for 200
 * Credits does not authorize a 700-Credit ceiling, and admitting it would let a
 * run discover that fact half way through — which is precisely the surprise
 * overage §26 forbids.
 *
 * No enforcement of *actual* spend happens here. Metering and settlement are
 * Core-4's, against Billing Core-2's existing reservation lifecycle.
 */
export function checkBudgetBinding(params: {
  budget: ExecutionBudget | null;
  reservation: BoundReservation | null;
}): { ok: true } | { ok: false; refusal: BudgetBindingRefusal } {
  if (!params.budget) return { ok: false, refusal: "agentic_pricing_not_configured" };
  if (!params.reservation) return { ok: false, refusal: "credit_reservation_required" };
  if (params.reservation.status !== "active") {
    return { ok: false, refusal: "credit_reservation_not_active" };
  }
  if (params.reservation.reservedCredits < params.budget.maxCredits) {
    return { ok: false, refusal: "credit_reservation_insufficient" };
  }
  return { ok: true };
}
