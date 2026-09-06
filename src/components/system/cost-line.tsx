import { formatCreditsForDisplay, type CreditUnits } from "@/modules/credits/units";
import { cn } from "@/lib/utils/cn";

/**
 * What a run actually cost, after it finished (audit R23).
 *
 * ## Not the same question as `CostDisclosure`
 *
 * That one answers "what will this cost", from the rate card, before a
 * decision. This answers "what did it cost", from the reservation, after the
 * fact — and the two can differ honestly: a run that was reserved and then
 * released charged nothing, and a founder looking at a merged change deserves
 * to be told that rather than left to assume the reserved figure was taken.
 *
 * ## The four answers
 *
 * `settled` is the only one carrying a number, and it is the number the
 * account was actually charged. `released` says the hold was returned and
 * nothing was spent. `pending` says the run is not finished settling, which is
 * true while validation is still running. `unknown` renders nothing at all —
 * an operation with no reservation was free, and inventing "0 Credits" for it
 * is the same lie ADR 0094 refuses in the other direction.
 */

export type ChangeCost =
  | { kind: "settled"; credits: CreditUnits }
  | { kind: "released" }
  | { kind: "pending" }
  | { kind: "unknown" };

export function CostLine({ cost, className }: { cost: ChangeCost; className?: string }) {
  if (cost.kind === "unknown") return null;

  return (
    <p className={cn("text-fg-muted text-ui", className)} data-testid="cost-line" data-cost={cost.kind}>
      {cost.kind === "settled" && (
        <>
          This change cost{" "}
          <span className="text-fg-secondary tabular-nums">
            {formatCreditsForDisplay(cost.credits)} Credits
          </span>
          .
        </>
      )}
      {cost.kind === "released" && "The hold for this run was returned. Nothing was charged."}
      {cost.kind === "pending" && "What this run cost is not settled yet."}
    </p>
  );
}
