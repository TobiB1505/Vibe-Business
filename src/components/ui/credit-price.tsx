import { resolveRetailPrice, type RetailOperationKind } from "@/modules/credits/retail";
import { formatCreditsForDisplay } from "@/modules/credits/units";

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
 * and free operations are simply not part of the Credit conversation.
 */
export function CreditPrice({
  operation,
  className,
}: {
  operation: RetailOperationKind;
  className?: string;
}) {
  const resolved = resolveRetailPrice(operation);

  // No policy in force, or a free operation — nothing to say.
  if (!resolved || resolved.price.kind === "free") return null;

  return (
    <span className={className ?? "text-fg-meta text-[0.8125rem] tabular-nums"}>
      {formatCreditsForDisplay(resolved.price.creditUnits)} Credits
    </span>
  );
}

/**
 * The same price as plain text, for a sentence rather than a label.
 *
 * Returns null for a free operation, so a caller can render the whole clause
 * conditionally instead of building a sentence around a missing number.
 */
export function creditPriceLabel(operation: RetailOperationKind): string | null {
  const resolved = resolveRetailPrice(operation);
  if (!resolved || resolved.price.kind === "free") return null;

  return `${formatCreditsForDisplay(resolved.price.creditUnits)} Credits`;
}
