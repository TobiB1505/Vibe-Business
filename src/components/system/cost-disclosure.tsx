import { type RetailOperationKind } from "@/modules/credits/retail";
import { type CreditUnits } from "@/modules/credits/units";
import { CreditAmount } from "@/components/ui/credit-amount";
import { INCLUDED_WORD, priceDisplayFor } from "@/components/ui/credit-price";
import type { ExecutionPricingClass } from "@/modules/economy/execution-class";
import { cn } from "@/lib/utils/cn";

/**
 * What an action costs, before it is pressed (UI Sourcing Spec §14, S9).
 *
 * ## What this adds over `CreditPrice`
 *
 * `CreditPrice` is the right source of truth and too small a contract: it
 * renders a number and knows nothing about whether the founder can afford it.
 * The audit's finding was that money is disclosed at the button and nowhere
 * else — no balance inside a project, and "unaffordable" written separately on
 * every surface that needed it.
 *
 * So this keeps the number and adds the two facts beside it: what is left, and
 * whether that is enough. The price still comes from `resolveRetailPrice`,
 * which is the same function the reservation calls — there is no second copy
 * of a price in the UI to drift out of step with the one actually charged.
 *
 * ## Why "free" still renders nothing
 *
 * The sourcing spec proposed rendering "Free" and "Included" as words. That
 * reverses a recorded decision — BILLING CORE-2 §56, documented on
 * `CreditPrice` — that a free operation names itself rather than printing a zero
 * beside a button invites the question of when it might stop being zero.
 * Reversing it is a billing decision with its own record, not something a UI
 * slice does on the way past, so this component keeps the existing behaviour
 * and the question stays open.
 *
 * The one thing it will not do is stay silent about a price that exists.
 */

export type CostBalance = {
  availableCredits: CreditUnits;
  display: string;
};

export function CostDisclosure({
  operation,
  pricingClass,
  className,
}: {
  /** Null when the control is free or unpriced. Renders nothing. */
  operation: RetailOperationKind | null;
  pricingClass?: ExecutionPricingClass | null;
  className?: string;
}) {
  if (operation === null) return null;

  const display = priceDisplayFor(operation, pricingClass);
  if (display.kind === "silent") return null;

  /*
   * A free operation says so and stops. There is no balance sentence to write
   * beside it — "of 400 Credits available" after "Included" would put the
   * operation back into a conversation about spending that it is not in.
   */
  if (display.kind === "included") {
    return <span className={cn("text-fg-meta text-ui", className)}>{INCLUDED_WORD}</span>;
  }

  // The price, and nothing beside it. The balance moved out of this
  // component: it is shown once in the chrome, where a person can glance at
  // it all day, rather than repeated under every priced control. A refusal
  // then carries the way out — `balance.ts` declines before any hold is
  // placed, so nothing is charged and there is no half-started operation.
  // `md` because this is the price *at* a control — the size the composition
  // was decided at. `CreditPrice` stays `sm`: it renders in dense rows where
  // the price is one column among several rather than the thing being weighed.
  return <CreditAmount credits={display.credits} className={className} />;
}

/**
 * Whether a priced control can be pressed at all.
 *
 * Separate from the component because the answer changes what a caller
 * renders, not just what it prints — an unaffordable action offers a way to
 * buy Credits rather than a button that will fail. Returns `true` when there
 * is no price or no balance to check against: silence about affordability is
 * not a claim that something is unaffordable.
 */
export function canAfford(
  operation: RetailOperationKind | null,
  balance: CostBalance | null | undefined,
  pricingClass?: ExecutionPricingClass | null,
): boolean {
  if (operation === null || !balance) return true;
  const display = priceDisplayFor(operation, pricingClass);
  // Included and unpriced are both "no amount to be short of".
  if (display.kind !== "credits") return true;
  return balance.availableCredits >= display.credits;
}
