import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * A number that is the subject.
 *
 * ## What this is not
 *
 * {@link Metric} — which is a label/value pair at body size, for machine
 * output: a branch name, a SHA, a timestamp, a count in a row. That is a
 * different object and it is used seventy-three times. A figure is the number
 * a screen is *about*: a health score, a balance, how many repositories are
 * connected.
 *
 * ## Why it exists
 *
 * Ten call sites drew one, and between them they had eight sizes, four
 * tracking values and two weights. The same object — a business-map node's
 * score — was 20px in the grid and 21.6px in the detail view. And four of the
 * ten never set `leading-none`, so an 18px numeral sat in a 22.5px line box
 * reserving descender space no digit can reach.
 *
 * None of that is carelessness. A figure needs `tabular-nums`, a line-height
 * of 1 and tracking chosen for its size, and a call site composing that by
 * hand gets it wrong — each one differently. `CreditAmount` learned the same
 * lesson about optical centring and became a component for the same reason.
 *
 * The size steps live in the palette (`--text-figure-sm`, `--text-figure`,
 * `--text-figure-lg`) and carry the leading and the tracking, so this file
 * does not restate them.
 *
 * ## One weight, on purpose
 *
 * Five of the ten were `font-bold` and five `font-semibold`, with no pattern —
 * the same tier appeared as both. Semibold is the one kept: at 52px the
 * heavier the weight the tighter the tracking has to be, and the tracking now
 * belongs to the token, so letting the weight vary per call site would put
 * half of them back off the value the token was set for.
 */

export type FigureTier =
  /** A stat tile: a small number over what it counts. */
  | "sm"
  /** A panel's score, beside what it scores. */
  | "md"
  /** The number a screen is about. */
  | "lg";

const TIER: Record<FigureTier, string> = {
  sm: "text-figure-sm",
  md: "text-figure",
  lg: "text-figure-lg",
};

/**
 * The class list, for a figure inside a composition this component cannot
 * own — a `cn()` that also carries a tone, a motion wrapper, a truncating
 * flex row. The same split `buttonClasses` makes beside `Button`, and for the
 * same reason: not every call site has a slot shaped like a component.
 */
export function figureClasses(tier: FigureTier = "md", className?: string): string {
  return cn(TIER[tier], "font-semibold tabular-nums", className);
}

/**
 * A figure with the thing it counts underneath.
 *
 * `label` is optional because some figures are labelled by what sits beside
 * them rather than under them. When it is given, the pair is one block with
 * one gap, and it is `gap-1` because that is the one four of them already
 * write. The others wrote nothing, `mt-0.5`, `mt-2` and `mt-2.5`.
 */
export function Figure({
  value,
  tier = "md",
  label,
  className,
  tone,
}: {
  /** The number. An absent one renders an em dash, never an empty slot. */
  value: ReactNode | null | undefined;
  tier?: FigureTier;
  label?: ReactNode;
  /** A colour class, for a figure that carries a health or status tone. */
  tone?: string;
  className?: string;
}) {
  const missing = value === null || value === undefined || value === "";
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <span className={figureClasses(tier, missing ? "text-fg-muted" : (tone ?? "text-fg"))}>
        {missing ? "—" : value}
      </span>
      {label && <span className="text-fg-meta text-caption">{label}</span>}
    </div>
  );
}
