import type { ScorePoint, ScoreSegment } from "@/modules/projects/score-series";
import { cn } from "@/lib/utils/cn";

/**
 * The Business Signal, drawn (CORE-6).
 *
 * ## What is deliberately not here
 *
 * No axis, no gridlines, no legend, no tooltip, no hover, no animation. The
 * reference this screen was drawn from has a `0/25/50/75/100` scale down the
 * side and horizontal rules across it; on the calmest screen in the product
 * that is furniture around a shape. The number beside the line is the reading.
 * This is the shape.
 *
 * ## The scale is fixed at 0–100, and that is a decision
 *
 * Auto-scaling to the data would make 39, 43, 45 look like a climb up a
 * mountain. With no axis drawn, nothing on screen would tell the reader that
 * the vertical span is six points rather than a hundred — so the line would
 * say something the numbers do not. Fixed to the full range, a small movement
 * looks small, which is what it is.
 *
 * ## Two shapes the data can force, and what each means
 *
 * - **A break.** `score-series.ts` splits the readings wherever the audit's
 *   reproducibility set changed. The line stops and restarts, with a marker
 *   between, because a stroke drawn across that boundary would claim two
 *   numbers measured by different rulers are one trend.
 * - **A gap.** An audit that completed with too little coverage scores `null`.
 *   The line lifts and resumes; it never dives to the floor. "We looked and
 *   could not say" is not a reading of zero (rule 44).
 *
 * ## Accessibility
 *
 * The SVG is `aria-hidden` and carries no information of its own — every fact
 * in it is also on the panel around it as text (the score, the change, and the
 * caption below when the line is broken). A screen reader gets the sentences;
 * it does not get a description of a polyline.
 */

const WIDTH = 240;
const HEIGHT = 56;
/**
 * Horizontal breathing room, so the first and last readings are not flush
 * against the edge of the box.
 *
 * There is deliberately no *vertical* inset. There used to be, and it is what
 * made the chart wrong: the axis beside it draws `100`, `50` and `0` against
 * the edges of the plot box, so a data band inset from those edges labels
 * every reading with a number it is not at. Measured on the dashboard, a score
 * of 0 drew 7px below the line marked `0`.
 *
 * A stroke at exactly 0 or 100 therefore hangs half its width outside the
 * viewBox, which is why the element is `overflow-visible`. Spilling 1.25px is
 * invisible; labelling the data wrong is not.
 */
const INSET = 3;

/** A run of consecutive scored readings — what actually becomes a stroke. */
type Run = { x: number; y: number }[];

function xFor(index: number, total: number): number {
  if (total <= 1) return WIDTH / 2;
  return INSET + (index / (total - 1)) * (WIDTH - INSET * 2);
}

function yFor(score: number): number {
  const clamped = Math.max(0, Math.min(score, 100));
  return HEIGHT - (clamped / 100) * HEIGHT;
}

/**
 * Split one segment into the runs a stroke can be drawn through.
 *
 * A segment is already one audit contract; a run is one uninterrupted stretch
 * of *scored* readings inside it. `points` carries its own global index so the
 * x positions stay on the series' timeline rather than restarting per segment.
 */
function runsIn(points: { point: ScorePoint; index: number }[], total: number): Run[] {
  const runs: Run[] = [];
  let current: Run = [];

  for (const { point, index } of points) {
    if (point.score === null) {
      if (current.length > 0) runs.push(current);
      current = [];
      continue;
    }
    current.push({ x: xFor(index, total), y: yFor(point.score) });
  }

  if (current.length > 0) runs.push(current);
  return runs;
}

/**
 * The one sentence that explains a broken line.
 *
 * It says what changed and what that means for the reader, and it does not say
 * the business changed — which is the claim the break exists to prevent. It
 * never appears on an unbroken line, so a founder whose audits are all
 * comparable never reads a caveat about a thing that did not happen.
 */
export function sparklineBreakCaption(breakCount: number): string | null {
  if (breakCount < 1) return null;
  return breakCount === 1
    ? "The line breaks where Vibe changed how it scores. Readings either side are not comparable."
    : `The line breaks ${breakCount} times where Vibe changed how it scores. Readings either side of a break are not comparable.`;
}

/**
 * A round marker at one reading.
 *
 * A zero-length line with a round cap rather than a `<circle>`, for the reason
 * the file already gives once: `preserveAspectRatio="none"` stretches the
 * viewBox horizontally, and a circle stretches with it into an ellipse. A cap
 * is drawn in stroke space, and `non-scaling-stroke` keeps that in pixels.
 */
function Dot({ x, y, size, className }: { x: number; y: number; size: number; className: string }) {
  return (
    <line
      x1={x}
      y1={y}
      x2={x}
      y2={y}
      className={className}
      strokeWidth={size}
      strokeLinecap="round"
      vectorEffect="non-scaling-stroke"
    />
  );
}

export function Sparkline({
  segments,
  className,
  variant = "compact",
  tone = "neutral",
}: {
  segments: ScoreSegment[];
  className?: string;
  /** `chart` adds a soft area and occupies the hero's full chart height. */
  variant?: "compact" | "chart";
  tone?: "neutral" | "mint" | "amber" | "coral";
}) {
  // Global index across every segment, so a break costs horizontal distance
  // and the timeline reads left to right without restarting.
  let cursor = 0;
  const indexed = segments.map((segment) =>
    segment.points.map((point) => ({ point, index: cursor++ })),
  );
  const total = cursor;

  const scored = segments.some((segment) =>
    segment.points.some((point) => point.score !== null),
  );
  // Nothing to draw is not an empty chart with an empty frame — the panel says
  // in words that there is no history yet.
  if (!scored) return null;

  const runs = indexed.flatMap((points) => runsIn(points, total));

  /*
   * The most recent scored reading, so the chart can say which end of the line
   * is now. Without it a founder reads a shape and has to work out the
   * direction from the dates underneath — the one thing the drawing is for.
   */
  const lastRun = runs[runs.length - 1];
  const latest = lastRun?.[lastRun.length - 1];

  /*
   * Where one contract ended and the next began, placed midway between the two
   * readings so it belongs to neither of them.
   */
  const breaks = indexed
    .slice(1)
    .map((points, position) => {
      const previous = indexed[position];
      const before = previous[previous.length - 1];
      const after = points[0];
      if (!before || !after) return null;
      return (xFor(before.index, total) + xFor(after.index, total)) / 2;
    })
    .filter((x): x is number => x !== null);

  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      /*
       * The default `xMidYMid meet` letterboxes: at a fixed height in a wide
       * column the whole chart shrinks to the middle third and leaves two
       * margins of nothing. Stretching horizontally is right here because
       * nothing in this shape depends on the aspect — every stroke is
       * `non-scaling-stroke`, and the one round marker is a capped zero-length
       * line rather than a circle for exactly this reason.
       */
      preserveAspectRatio="none"
      className={cn(
        // `overflow-visible` so a reading of 0 or 100 keeps its full stroke.
        // See `INSET`: the alternative is a data band that does not reach the
        // lines the axis labels.
        "w-full overflow-visible",
        // The chart fills whatever plot box it was given, because the axis and
        // the gridlines are drawn against that same box. It used to be `h-40`
        // inside an `h-36` frame — 16px of chart hanging below the `0` line.
        variant === "chart" ? "h-full" : "h-8",
        tone === "mint" && "text-mint",
        tone === "amber" && "text-amber",
        tone === "coral" && "text-coral",
        tone === "neutral" && (variant === "chart" ? "text-mint" : "text-fg-secondary"),
        className,
      )}
      fill="none"
    >
      {variant === "chart" && (
        <defs>
          {/*
            The area is a hint that the line has a floor, not a block of
            colour. It used to be a flat 22% wash from the stroke all the way
            down, which on a two-point run at 46 painted a third of the panel
            solid amber and made the *fill* the loudest thing in a card whose
            subject is a number. Three stops instead of two: it leaves the
            stroke at 18% and is gone by the halfway mark.
          */}
          <linearGradient id="business-signal-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.18" />
            <stop offset="45%" stopColor="currentColor" stopOpacity="0.05" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
      )}

      {breaks.map((x) => (
        <line
          key={`break-${x}`}
          x1={x}
          y1={0}
          x2={x}
          y2={HEIGHT}
          className="stroke-line-strong"
          strokeWidth={1}
          strokeDasharray="2 3"
          vectorEffect="non-scaling-stroke"
        />
      ))}

      {runs.map((run) => {
        const key = `run-${run[0].x}`;

        return run.length === 1 ? (
          // A single reading has no line in it, and a path of one point draws
          // nothing. A round cap on a zero-length line is a dot — and unlike a
          // circle it stays round under the horizontal stretch above.
          <line
            key={`point-${run[0].x}`}
            x1={run[0].x}
            y1={run[0].y}
            x2={run[0].x}
            y2={run[0].y}
            className="stroke-current"
            strokeWidth={5}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ) : (
          <g key={key}>
            {variant === "chart" && (
              <polygon
                points={`${run[0].x},${HEIGHT} ${run
                  .map((p) => `${p.x},${p.y}`)
                  .join(" ")} ${run[run.length - 1].x},${HEIGHT}`}
                fill="url(#business-signal-area)"
                stroke="none"
              />
            )}
            <polyline
              points={run.map((p) => `${p.x},${p.y}`).join(" ")}
              className="stroke-current"
              strokeWidth={variant === "chart" ? 2.5 : 2}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
            {/*
              One marker per reading, on the chart only. The compact variant is
              a shape in a row and dots would turn it into noise; the chart is
              the screen's subject, and without markers a founder cannot tell
              four audits from forty — the line looks continuous either way.
            */}
            {variant === "chart" &&
              run.map((point) => (
                <Dot
                  key={`dot-${point.x}`}
                  x={point.x}
                  y={point.y}
                  size={5}
                  className="stroke-current"
                />
              ))}
          </g>
        );
      })}

      {/*
        Now, marked. A halo in the line's own colour rather than a knockout
        ring in the page's: the card behind this is glass in the second
        palette, so "the background colour" is not a thing this component can
        know. A translucent halo is correct over any of them.
      */}
      {variant === "chart" && latest && (
        <>
          <Dot x={latest.x} y={latest.y} size={12} className="stroke-current opacity-20" />
          <Dot x={latest.x} y={latest.y} size={7} className="stroke-current" />
        </>
      )}
    </svg>
  );
}
