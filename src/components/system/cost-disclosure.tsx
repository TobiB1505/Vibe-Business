import { resolveRetailPrice, type RetailOperationKind } from "@/modules/credits/retail";
import { formatCreditsForDisplay, type CreditUnits } from "@/modules/credits/units";
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
 * `CreditPrice` — that a free operation renders nothing at all, because a zero
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

function priceOf(
  operation: RetailOperationKind,
  pricingClass?: ExecutionPricingClass | null,
): CreditUnits | null {
  const resolved = resolveRetailPrice(operation);
  if (!resolved) return null;

  switch (resolved.price.kind) {
    case "free":
    case "not_priced":
      return null;
    case "fixed":
      return resolved.price.creditUnits;
    case "by_execution_class":
      // A surface with no step in hand renders nothing rather than a range:
      // "150–350 Credits" is not a price, and the cheapest of three is a lie.
      return pricingClass ? resolved.price.creditUnitsByClass[pricingClass] : null;
  }
}

export function CostDisclosure({
  operation,
  pricingClass,
  balance,
  className,
}: {
  /** Null when the control is free or unpriced. Renders nothing. */
  operation: RetailOperationKind | null;
  pricingClass?: ExecutionPricingClass | null;
  /**
   * The account balance, when the surface has read it. Optional so a control
   * on a page that does not read billing still discloses its price — a missing
   * balance must never suppress a price that exists.
   */
  balance?: CostBalance | null;
  className?: string;
}) {
  if (operation === null) return null;

  const credits = priceOf(operation, pricingClass);
  if (credits === null) return null;

  const affordable = balance ? balance.availableCredits >= credits : true;

  return (
    <span
      className={cn("inline-flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-ui", className)}
    >
      <span className="text-fg-secondary tabular-nums">
        {formatCreditsForDisplay(credits)} Credits
      </span>
      {balance && (
        <span className={cn("tabular-nums", affordable ? "text-fg-meta" : "text-amber")}>
          {affordable
            ? `of ${balance.display} available`
            : `You have ${balance.display}. Not enough for this.`}
        </span>
      )}
    </span>
  );
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
  const credits = priceOf(operation, pricingClass);
  if (credits === null) return true;
  return balance.availableCredits >= credits;
}
