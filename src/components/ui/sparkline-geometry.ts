/**
 * How a series becomes a line (UI-8).
 *
 * A pure module, separate from `sparkline.tsx`, for the same reason
 * `score-display.ts` is separate from its meter: the rules encoded here are
 * about honesty, not about pixels, and the project has no React rendering
 * harness to assert them through a component.
 *
 * ## The rules
 *
 * - **Fewer than two points is not a trend.** One audit tells you where a
 *   project stands, never which way it is going. A single point drawn as a
 *   flat line is a claim that nothing changed, which is a different statement
 *   from "there is nothing to compare against yet" — so this returns `null`
 *   and the caller renders no line at all.
 *
 * - **A flat series is flat, not a crash.** When every value is identical the
 *   range is zero, and the obvious normalisation divides by it. The line sits
 *   on the vertical centre instead.
 *
 * Absent values never reach here: a dimension or an audit that could not be
 * scored is excluded upstream, because a `null` folded into a series as `0`
 * draws a cliff where there was only a gap. See CLAUDE.md rule 44 and
 * `buildScoreHistory` in `src/modules/projects/dashboard.ts`.
 */

/** The coordinate space the polyline is written in. Fixed, so the SVG can be. */
export const SPARKLINE_VIEWBOX = { width: 100, height: 28 } as const;

/**
 * Distance kept from the top and bottom edges, in viewBox units.
 *
 * A stroke centred exactly on `y = 0` is drawn half outside the viewBox and
 * clipped, so the highest point of a rising series would lose its top half.
 */
export const SPARKLINE_INSET = 2;

/** Below this, a series says nothing about direction. */
export const SPARKLINE_MIN_POINTS = 2;

export type SparklinePoint = { x: number; y: number };

/**
 * Normalised points, oldest first, or `null` when there is no trend to draw.
 *
 * `y` is inverted relative to the values, because SVG's origin is the top-left
 * corner: the largest value gets the smallest `y`.
 */
export function sparklinePoints(
  values: readonly number[],
  {
    width = SPARKLINE_VIEWBOX.width,
    height = SPARKLINE_VIEWBOX.height,
    inset = SPARKLINE_INSET,
  }: { width?: number; height?: number; inset?: number } = {},
): SparklinePoint[] | null {
  if (values.length < SPARKLINE_MIN_POINTS) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;

  const top = inset;
  const bottom = height - inset;
  const usable = bottom - top;

  return values.map((value, index) => ({
    x: (index / (values.length - 1)) * width,
    // A zero range means every point is the same; centre the line rather than
    // dividing by it.
    y: range === 0 ? top + usable / 2 : bottom - ((value - min) / range) * usable,
  }));
}

/** The same points as an SVG `points` attribute, or `null` when there is none. */
export function sparklinePolyline(
  values: readonly number[],
  options?: Parameters<typeof sparklinePoints>[1],
): string | null {
  const points = sparklinePoints(values, options);
  if (!points) return null;

  // Three decimals: enough that a 100-unit viewBox scaled to any card width
  // shows no stepping, short enough that the attribute stays readable.
  return points.map((point) => `${round(point.x)},${round(point.y)}`).join(" ");
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
