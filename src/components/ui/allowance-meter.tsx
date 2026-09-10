import { cn } from "@/lib/utils/cn";

/**
 * How much of a monthly allowance is left (UI-22).
 *
 * ## Why a bar and not another number
 *
 * The billing page already prints both numbers — *720 of 1,000 monthly Credits
 * left* — and a reader still has to divide them to know whether that is
 * comfortable or nearly gone. Proportion is the one thing a number does not
 * show and a bar shows immediately, which is why every reference billing screen
 * that survives contact with real users has one.
 *
 * This is not the sparkline Sprint 0146 removed. That was a shape beside a
 * number that already *was* the reading; this is the reading the numbers do not
 * give.
 *
 * ## Why it is written here rather than installed
 *
 * A progress bar's whole contract is `role="progressbar"` with its three
 * values, an accessible name, and `aria-valuetext` so a screen reader hears
 * *"720 of 1,000 Credits left"* rather than *"72 percent"*. That is four
 * attributes and two divs; a registry component would be the same markup with
 * a dependency in front of it.
 *
 * ## What it refuses to do
 *
 * Turn amber or red as the bar empties. A low balance is not an error and not a
 * warning — the billing page's own guards say the screen must not scold, warn
 * or block — and a colour that changes as somebody spends their own Credits is
 * exactly that in paint. It is one colour at every value.
 */
export function AllowanceMeter({
  label,
  remaining,
  total,
  valueText,
  className,
}: {
  /** The accessible name, e.g. "Monthly Credits remaining". Not rendered. */
  label: string;
  remaining: number;
  total: number;
  /** What a screen reader hears instead of a bare percentage. */
  valueText: string;
  className?: string;
}) {
  /*
   * Clamped, because neither end is impossible: a hold can be settled against
   * a grant after it renewed, and a legacy grant can exceed today's allowance.
   * A bar that renders past its own track, or at a negative width, is a
   * rendering bug reported as a billing bug.
   */
  const safeTotal = total > 0 ? total : 1;
  const ratio = Math.min(1, Math.max(0, remaining / safeTotal));

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={Math.max(0, Math.min(total, remaining))}
      aria-valuetext={valueText}
      data-testid="allowance-meter"
      className={cn("bg-surface-3 h-1.5 w-full overflow-hidden rounded-full", className)}
    >
      {/*
        Inline width because the value is data, not a design decision — there
        is no token for "72%". Everything else about the bar is tokens.
      */}
      <div
        className="bg-mint h-full rounded-full"
        style={{ width: `${(ratio * 100).toFixed(2)}%` }}
      />
    </div>
  );
}
