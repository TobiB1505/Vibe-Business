import { creditsToUnits, type CreditUnits } from "./units";

/**
 * Internal, non-production operation economics (EXECUTION CORE-4 §18, §35).
 *
 * ## Why this is a separate file from `retail.ts`
 *
 * `retail.ts` is the customer rate card. It is founder-approved, calibrated
 * against measured provider cost, and it deliberately does **not** contain
 * Agentic Execution — because no price for it has been approved and none can be
 * until there is a measured cost, which is what the CORE-4 dogfood exists to
 * produce. Putting a made-up Agent price in there would activate a customer
 * price by accident, which §18 forbids in as many words:
 *
 * > NO production Agent retail price has been approved yet. Do NOT activate a
 * > customer-facing production Agent price.
 *
 * But Billing still has to *participate* — §18 also requires exercising quote →
 * reservation → real usage → settlement/release before any provider spend, and
 * a path that skips billing entirely would prove none of that and would leave
 * agentic execution as the one operation with no spending ceiling at all.
 *
 * So: a second, explicitly internal book. Reachable only through
 * `resolveAgentEconomics`, which requires the project to be on an operator-
 * managed allowlist. A customer path cannot arrive here, because a customer
 * project is not on the list and the resolver returns null before this file is
 * consulted.
 *
 * ## What the number means
 *
 * Nothing about pricing. 100 Credits is a *ceiling* chosen so that the reserve
 * → settle → release machinery has a real amount to move, and so that a
 * runaway dogfood exhausts an internal balance rather than running unbounded.
 * It is not a price, not a forecast of one, and not an input to one. The real
 * price will be derived from the cost distribution these runs produce.
 */

export const INTERNAL_OPERATION_KINDS = ["agent_execution_dogfood"] as const;
export type InternalOperationKind = (typeof INTERNAL_OPERATION_KINDS)[number];

export type InternalPricePolicy = {
  version: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  prices: Readonly<Record<InternalOperationKind, CreditUnits>>;
};

const INTERNAL_V1: InternalPricePolicy = {
  version: "internal-dogfood-v1",
  effectiveFrom: "2026-08-18T00:00:00.000Z",
  effectiveTo: null,
  prices: {
    // Matches `CORE4_DOGFOOD_BUDGET_POLICY.budget.maxCredits` exactly. They are
    // required to agree: the reservation must cover the spec's authorized
    // ceiling or `checkBudgetBinding` refuses admission, and two numbers that
    // could drift apart would make that refusal fire for a configuration
    // mistake rather than for a real shortfall.
    agent_execution_dogfood: creditsToUnits(100),
  },
};

export const INTERNAL_PRICE_POLICIES: readonly InternalPricePolicy[] = [INTERNAL_V1];

export function isInternalOperationKind(value: string): value is InternalOperationKind {
  return (INTERNAL_OPERATION_KINDS as readonly string[]).includes(value);
}

/**
 * The internal ceiling in force at an instant.
 *
 * Half-open `[effectiveFrom, effectiveTo)`, matching `resolveRetailPolicy` and
 * `resolveRateCard` exactly so the books cannot develop different date
 * semantics at a boundary instant.
 */
export function internalChargeFor(
  operation: InternalOperationKind,
  at: Date = new Date(),
  policies: readonly InternalPricePolicy[] = INTERNAL_PRICE_POLICIES,
): { creditUnits: CreditUnits; policyVersion: string } | null {
  const timestamp = at.getTime();

  for (const policy of policies) {
    const from = Date.parse(policy.effectiveFrom);
    const to =
      policy.effectiveTo === null ? Number.POSITIVE_INFINITY : Date.parse(policy.effectiveTo);
    if (timestamp >= from && timestamp < to) {
      return { creditUnits: policy.prices[operation], policyVersion: policy.version };
    }
  }

  return null;
}
