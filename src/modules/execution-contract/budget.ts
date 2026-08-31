import { creditsToUnits, type CreditUnits } from "@/modules/credits/units";
import {
  EXECUTION_PRICING_CLASSES,
  type ExecutionPricingClass,
} from "@/modules/economy/execution-class";

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
 * ## Where the production numbers came from
 *
 * §25 was explicit that arbitrary production numbers must not be chosen, and
 * CLAUDE.md rule 78 states the bar they had to clear instead: never activate a
 * customer-facing Agent price without a measured cost behind it. For three
 * sprints {@link EXECUTION_BUDGET_POLICIES} was empty because that measurement
 * did not exist — no agent run had ever happened, and a number invented in its
 * place would have looked like a decision and been a guess.
 *
 * It exists now. The CORE-4 dogfood delivered sixteen agent runs against a real
 * repository, metered into `ai_usage_events` and `sandbox_usage_events`, and
 * {@link LAUNCH_V1_BUDGET_POLICY} is derived from that distribution rather than
 * from a target.
 *
 * What has *not* changed is the shape of the honesty. The evidence is thin and
 * uneven — `standard` carries the sample, `small` has one observation, and
 * `complex` has none — so the per-class ceilings below are not equally
 * well-founded, and `credits/retail.ts`'s `PriceBasis` records which is which.
 * A future policy replaces this one; it never edits it.
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
  /**
   * One budget per execution pricing class.
   *
   * A `Record` rather than a single budget, because `credits/retail.ts` prices
   * agentic execution per class and `checkBudgetBinding` refuses a reservation
   * that does not cover `maxCredits`. One shared budget would therefore force
   * every class to reserve the most expensive tier's ceiling — a customer whose
   * step classified `small` would have to hold 350 Credits to run 150 Credits
   * of work.
   *
   * Every class must be present. A policy that omitted one would resolve
   * `undefined` at exactly the moment money moves.
   */
  budgetsByClass: Readonly<Record<ExecutionPricingClass, Omit<ExecutionBudget, "budgetPolicyVersion">>>;
};

/**
 * Builds a policy whose three classes share one budget.
 *
 * For a policy that genuinely does not vary by class — the internal dogfood
 * ceiling, and every test fixture. Written once here so those callers do not
 * each repeat the same three-key object and risk them drifting apart.
 */
export function uniformBudgetsByClass(
  budget: Omit<ExecutionBudget, "budgetPolicyVersion">,
): Readonly<Record<ExecutionPricingClass, Omit<ExecutionBudget, "budgetPolicyVersion">>> {
  return Object.fromEntries(EXECUTION_PRICING_CLASSES.map((c) => [c, budget])) as Readonly<
    Record<ExecutionPricingClass, Omit<ExecutionBudget, "budgetPolicyVersion">>
  >;
}

/**
 * The launch production budget (`launch-v1`).
 *
 * ## Two ceilings per class, answering two different questions
 *
 * ```
 * maxCredits            what the customer authorized     = the retail class price, exactly
 * maxProviderSpendUsd   what Vibe will pay to deliver it = a floor-margin stop
 * ```
 *
 * `maxCredits` **must** equal the corresponding entry in `credits/retail.ts`'s
 * `launch-v1` `agent_execution` price. `checkBudgetBinding` refuses admission
 * unless the reservation covers it, so a mismatch does not undercharge — it
 * makes every run of that class refuse to start, for what looks like a billing
 * fault. `assertBudgetMatchesRetail` in this module's test holds the two
 * together.
 *
 * `maxProviderSpendUsd` is sized to a 50% floor margin against the class price
 * at €0.016333/Credit (EUR/USD 1.08): the point past which a single run stops
 * being worth delivering. The most expensive agent run ever measured is $0.9237
 * restated at post-2026-09-01 Sonnet rates, so `standard` carries roughly 2x
 * headroom over the worst observation rather than over a typical one.
 *
 * ## Why the blast-radius limits widen with the class
 *
 * They are not a cost dial. A `complex` step is `complex` because it touches a
 * sensitive surface or spans several named business surfaces
 * (`ExecutionPricingClassReason`), and such work legitimately needs more turns
 * and more wall clock to inspect before it edits. A `small` step that wanted 60
 * turns is telling us its classification was wrong, and stopping it is the
 * correct outcome.
 *
 * Every `maxWallClockMs` here stays below `AGENT_SANDBOX_LIFETIME_MS`
 * (30 minutes) in `coding-agent/budget.ts`, so the run's budget expires before
 * its workspace does rather than the other way around.
 *
 * `maxChangedFiles` / `maxChangedBytes` deliberately do **not** widen past the
 * dogfood's 8 / 60 KB for `small` and `standard`. The dogfood observation that
 * one run reached exactly eight files is a reason to watch that ceiling, not to
 * raise it; only `complex`, which is defined by spanning more than one surface,
 * gets more.
 */
export const LAUNCH_V1_BUDGET_POLICY: ExecutionBudgetPolicy = {
  version: "launch-v1-budget",
  // The same instant `retail-v1` gives way to `launch-v1` in `credits/retail.ts`,
  // and the same instant Sonnet 5's price rises in `ai/pricing.ts`. One event.
  effectiveFrom: "2026-09-01T00:00:00.000Z",
  effectiveTo: null,
  budgetsByClass: {
    small: {
      maxCredits: creditsToUnits(150),
      maxAiCalls: 40,
      maxAgentTurns: 30,
      maxRepairAttempts: 3,
      maxWallClockMs: 15 * 60 * 1000,
      maxSandboxMs: 12 * 60 * 1000,
      maxChangedFiles: 8,
      maxChangedBytes: 60 * 1024,
      maxNetworkRequests: 0,
      maxProviderSpendUsd: 1.3,
    },
    standard: {
      maxCredits: creditsToUnits(200),
      maxAiCalls: 60,
      maxAgentTurns: 40,
      maxRepairAttempts: 3,
      maxWallClockMs: 20 * 60 * 1000,
      maxSandboxMs: 15 * 60 * 1000,
      maxChangedFiles: 8,
      maxChangedBytes: 60 * 1024,
      maxNetworkRequests: 0,
      maxProviderSpendUsd: 1.75,
    },
    complex: {
      maxCredits: creditsToUnits(350),
      maxAiCalls: 90,
      maxAgentTurns: 60,
      maxRepairAttempts: 4,
      maxWallClockMs: 25 * 60 * 1000,
      maxSandboxMs: 20 * 60 * 1000,
      maxChangedFiles: 12,
      maxChangedBytes: 90 * 1024,
      maxNetworkRequests: 0,
      maxProviderSpendUsd: 3,
    },
  },
};

/**
 * Every approved budget policy, newest last.
 *
 * No longer empty. It was, for as long as CLAUDE.md rule 78's bar — a measured
 * cost — was unmet; {@link LAUNCH_V1_BUDGET_POLICY} is the first entry, and it
 * is a commercial and safety decision with sixteen delivered dogfood runs
 * behind it, not an implementation detail somebody filled in to make a test
 * pass. A superseded policy is never deleted: a run that named it must stay
 * explainable.
 */
export const EXECUTION_BUDGET_POLICIES: readonly ExecutionBudgetPolicy[] = [
  LAUNCH_V1_BUDGET_POLICY,
];

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
 * They were chosen before Vibe had ever run an agent: every value below is a
 * *conservative ceiling chosen to bound the first experiment*, not a
 * measurement and not a price. §17 asks for exactly this — deliberately small
 * limits, versioned, labelled as dogfood.
 *
 * Runs #3–#8 have since happened, so the ceilings can now be checked against
 * observation rather than only against sibling budgets, and they held: the six
 * real runs cost **$0.1444–$0.3465** (mean $0.2507) against a $3.00 ceiling,
 * and the largest changed eight files — exactly `maxChangedFiles`. See
 * `docs/business/ECONOMY_MODEL.md`. They have deliberately **not** been retuned
 * to fit: a ceiling that tracks the observed maximum stops bounding anything,
 * and the one number the runs argue is wrong — that eight files was reached
 * rather than approached — is a reason to watch it, not to raise it.
 *
 * The original sizing, against what was already measured elsewhere in this
 * codebase:
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
  // One budget for all three classes, unchanged from what the sixteen dogfood
  // runs actually ran under. The dogfood is an experiment with a ceiling, not a
  // rate card, so varying it by pricing class would be inventing a distinction
  // this policy has never made — and would silently reinterpret what those runs
  // were bounded by, which is the whole value of the dataset.
  budgetsByClass: uniformBudgetsByClass({
    // An internal test ceiling, priced by `credits/internal.ts`. Never shown to
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
  }),
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
 * The budget in force for one execution class at an instant, or null when none
 * is.
 *
 * Half-open `[effectiveFrom, effectiveTo)`, matching `resolveRetailPolicy` and
 * `resolveRateCard` exactly.
 *
 * `pricingClass` is required rather than defaulted, for the same reason
 * `retailChargeFor` throws instead of assuming a tier: there is no class that
 * is safe to guess. Defaulting low authorizes the cheapest ceiling for the most
 * expensive work; defaulting high blocks work the customer paid for. The caller
 * classified the step before it got here (`classifyExecutionPricingClass`), and
 * passing that result on is the whole job.
 */
export function resolveExecutionBudget(
  pricingClass: ExecutionPricingClass,
  at: Date = new Date(),
  policies: readonly ExecutionBudgetPolicy[] = EXECUTION_BUDGET_POLICIES,
): ExecutionBudget | null {
  const timestamp = at.getTime();

  for (const policy of policies) {
    const from = Date.parse(policy.effectiveFrom);
    const to =
      policy.effectiveTo === null ? Number.POSITIVE_INFINITY : Date.parse(policy.effectiveTo);
    if (timestamp >= from && timestamp < to) {
      return { budgetPolicyVersion: policy.version, ...policy.budgetsByClass[pricingClass] };
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
