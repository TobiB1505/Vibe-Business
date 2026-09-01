import { resolveRetailPrice, type RetailOperationKind } from "@/modules/credits/retail";
import { formatCreditsForDisplay, type CreditUnits } from "@/modules/credits/units";
import type { ExecutionPricingClass } from "@/modules/economy/execution-class";

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
      return pricingClass ? resolved.price.creditUnitsByClass[pricingClass] : null;
  }
}

/**
 * What an operation costs, shown before it starts (BILLING CORE-2 §55, §94).
 *
 * ## Why the price is next to the button and not behind it
 *
 * "Vibe tells me what this costs" is only true if it says so *before* the
 * click. A cost revealed afterwards is a surprise, and a surprise is exactly
 * what a Credit system exists to avoid — so this renders inline with the
 * control that spends the Credits, never in a tooltip, a disclosure or a
 * confirmation dialog.
 *
 * ## Reads the same policy the charge will use
 *
 * The number comes from `resolveRetailPrice`, which is the same function the
 * reservation calls. There is no second copy of the price in the UI to drift
 * out of step with the one that is actually charged.
 *
 * A free operation renders nothing at all rather than "0 Credits" (§56): a
 * zero beside a button invites the question of when it might stop being zero,
 * and free operations are simply not part of the Credit conversation. An
 * operation the policy does not price renders nothing either, for a different
 * reason: there is no price, and showing one would be inventing it.
 *
 * ## Class-priced operations
 *
 * Agentic execution costs one of three amounts, decided by the step. A control
 * that starts a *specific* step knows which — it passes `pricingClass`, and the
 * customer sees the one number they will actually be charged. A surface that
 * has no step in hand renders nothing rather than a range: "150–350 Credits"
 * beside a button is not a price, and the cheapest of three is a lie.
 */
export function CreditPrice({
  operation,
  pricingClass,
  className,
}: {
  operation: RetailOperationKind;
  /** Required for a class-priced operation; ignored for every other. */
  pricingClass?: ExecutionPricingClass | null;
  className?: string;
}) {
  const credits = priceOf(operation, pricingClass);
  if (credits === null) return null;

  return (
    <span className={className ?? "text-fg-meta text-ui tabular-nums"}>
      {formatCreditsForDisplay(credits)} Credits
    </span>
  );
}

/**
 * The same price as plain text, for a sentence rather than a label.
 *
 * Returns null for a free operation, so a caller can render the whole clause
 * conditionally instead of building a sentence around a missing number.
 */
export function creditPriceLabel(
  operation: RetailOperationKind,
  pricingClass?: ExecutionPricingClass | null,
): string | null {
  const credits = priceOf(operation, pricingClass);
  return credits === null ? null : `${formatCreditsForDisplay(credits)} Credits`;
}
