import { resolveRetailPrice, type RetailOperationKind } from "@/modules/credits/retail";
import { formatCreditsForDisplay, type CreditUnits } from "@/modules/credits/units";
import type { ExecutionPricingClass } from "@/modules/economy/execution-class";

/**
 * What to render in the price slot: a number of Credits, the word for an
 * operation that costs nothing, or nothing at all.
 *
 * The three are different answers and stay different. `free` is the policy
 * saying this costs nothing; `not_priced` is the policy having no price and
 * refusing, which has nothing to disclose.
 */
export type PriceDisplay =
  | { kind: "credits"; credits: CreditUnits }
  | { kind: "included" }
  | { kind: "silent" };

export function priceDisplayFor(
  operation: RetailOperationKind,
  pricingClass?: ExecutionPricingClass | null,
): PriceDisplay {
  const resolved = resolveRetailPrice(operation);
  if (!resolved) return { kind: "silent" };

  switch (resolved.price.kind) {
    case "free":
      return { kind: "included" };
    case "not_priced":
      return { kind: "silent" };
    case "fixed":
      return { kind: "credits", credits: resolved.price.creditUnits };
    case "by_execution_class":
      return pricingClass
        ? { kind: "credits", credits: resolved.price.creditUnitsByClass[pricingClass] }
        : { kind: "silent" };
  }
}

/** The word a free operation shows in place of a number. */
export const INCLUDED_WORD = "Included";

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
 * A free operation renders the word "Included", never "0 Credits"
 * ([ADR 0094](../../../docs/decisions/0094-a-free-operation-says-so.md)). The
 * zero is still out of bounds for the reason §56 gave — a number in a currency
 * invites arithmetic about when it stops being that number — but silence was
 * read as an unloaded price rather than as free, beside controls that state
 * theirs. An operation the policy does not price still renders nothing, for a
 * different reason: there is no price, and showing one would invent it.
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
  const display = priceDisplayFor(operation, pricingClass);
  if (display.kind === "silent") return null;

  return (
    <span className={className ?? "text-fg-meta text-ui tabular-nums"}>
      {display.kind === "included"
        ? INCLUDED_WORD
        : `${formatCreditsForDisplay(display.credits)} Credits`}
    </span>
  );
}
