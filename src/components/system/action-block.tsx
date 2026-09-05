import type { ReactNode } from "react";
import { Disclosure } from "@/components/ui/disclosure";
import { cn } from "@/lib/utils/cn";
import { CostDisclosure, type CostBalance } from "./cost-disclosure";
import type { RetailOperationKind } from "@/modules/credits/retail";
import type { ExecutionPricingClass } from "@/modules/economy/execution-class";

/**
 * One control, its price, and what pressing it does (UI Sourcing Spec §14, S12).
 *
 * ## What this merges
 *
 * `NextMoveCard`, `AgentPlanNextNotice`, the Agent's start CTA and the Nova
 * focus control were four places rendering the same three things: a button, a
 * price beside it, and a sentence about the consequence. The start CTA had
 * grown its own coin drawing and its own price formatting on the way.
 *
 * ## Why the control is a slot rather than a prop
 *
 * The actions behind these controls genuinely do not share a signature — two
 * take positional ids, three take a form payload, one takes `confirmed` as a
 * required argument. `NOVA_ACTIONS` records the same thing about its own
 * bindings. So the caller renders the control it owns the arguments for, and
 * this owns the layout, the price and the consequence around it.
 *
 * That is also what keeps confirmation honest: a caller that needs one swaps
 * its own `ConfirmPanel` into the same slot, so the confirmation replaces the
 * control rather than appearing beside it.
 *
 * ## The rules it enforces by shape
 *
 * **The price is beside the control, never behind it.** `cost` renders inline,
 * directly under the button. Never in the consequence disclosure — a price a
 * founder has to expand to see is a price disclosed after the decision.
 *
 * **One primary per block.** There is one control slot. The Agent's two priced
 * primaries are two blocks in a row, which is the honest shape for two
 * different actions at two different prices.
 */
export function ActionBlock({
  control,
  operation = null,
  pricingClass,
  balance,
  /**
   * What will exist afterwards, and what will not. Disclosed rather than
   * always visible because it is long — but never the price, which is not.
   */
  consequence,
  consequenceLabel = "What happens",
  /** A quiet line under the control: a limit, a caveat, what is unchanged. */
  footnote,
  className,
}: {
  control: ReactNode;
  operation?: RetailOperationKind | null;
  pricingClass?: ExecutionPricingClass | null;
  balance?: CostBalance | null;
  consequence?: ReactNode;
  consequenceLabel?: string;
  footnote?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">{control}</div>

      <CostDisclosure operation={operation} pricingClass={pricingClass} balance={balance} />

      {footnote && <p className="text-fg-muted max-w-[62ch] text-ui">{footnote}</p>}

      {consequence && (
        <Disclosure label={consequenceLabel}>
          <div className="text-fg-prose max-w-[62ch] text-sm leading-relaxed">{consequence}</div>
        </Disclosure>
      )}
    </div>
  );
}
