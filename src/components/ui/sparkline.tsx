import { cn } from "@/lib/utils/cn";
import { SPARKLINE_VIEWBOX, sparklinePolyline } from "./sparkline-geometry";

/**
 * A score's direction, drawn small (UI-8).
 *
 * Inline SVG and no dependency. The product has no chart library, and adding
 * one to draw a polyline would be infrastructure arriving by accident
 * (CLAUDE.md rule 3) — a hundred kilobytes and a render mode for eleven
 * points.
 *
 * ## The graphic never carries the fact
 *
 * The SVG is `aria-hidden` and the caller always prints the change as text
 * beside it. That is the same rule the status system holds everywhere else: a
 * state is never communicated by colour alone, and a trend is never
 * communicated by a shape alone. Screen readers get the sentence; everyone
 * else gets the sentence and the line.
 *
 * ## Why the stroke does not stretch
 *
 * `preserveAspectRatio="none"` lets the 100×28 coordinate space fill whatever
 * width the card gives it — which would also stretch the stroke into an
 * uneven, direction-dependent weight. `vector-effect="non-scaling-stroke"` is
 * what keeps the line the same thickness on a narrow card and a wide one.
 *
 * Colour comes from `currentColor`, so the tone is a text class on the caller
 * and lives with the sentence it belongs to rather than being a second
 * decision here.
 */
export function Sparkline({
  values,
  className,
}: {
  /** Oldest first. Fewer than two points renders nothing. */
  values: readonly number[];
  className?: string;
}) {
  const points = sparklinePolyline(values);
  if (!points) return null;

  return (
    <svg
      aria-hidden
      focusable="false"
      viewBox={`0 0 ${SPARKLINE_VIEWBOX.width} ${SPARKLINE_VIEWBOX.height}`}
      preserveAspectRatio="none"
      className={cn("h-6 w-full", className)}
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
