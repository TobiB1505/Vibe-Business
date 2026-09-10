import { scoreDisplay } from "./score-display";
import { statusForScoreTone } from "@/components/system/status-vocabulary";
import { statusToneText } from "./status-pill";
import { figureClasses } from "./figure";
import { cn } from "@/lib/utils/cn";

/**
 * A business-readiness score, drawn.
 *
 * ## Why the arc animates and the number does not
 *
 * A count-up from 0 to 46 displays 0, 7, 19, 31 — four readings the audit never
 * produced. `DESIGN.md` forbids animating a fabricated value, and a *number* is
 * the one thing on this ring a founder reads as a value. So the figure is
 * present and correct at the first frame.
 *
 * The arc is different: it is a length, not a reading, and a length growing to
 * its true size is "this is being drawn" rather than "this is climbing". It
 * carries no intermediate label, so there is nothing to misread. That line is
 * where this component sits, and it is the reason the two halves behave
 * differently.
 *
 * ## The three obligations
 *
 * Reduced motion and the hidden-tab pause come from `.vibe-ring-draw` in
 * `globals.css`, which is the same mechanism `vibe-reveal` uses rather than a
 * second one. Geometry is reserved by construction: the box is a fixed square
 * from `size`, and only `stroke-dashoffset` moves.
 */

const SIZES = {
  /** In a row, beside a name. */
  sm: { box: 56, stroke: 5, figure: "sm" as const, denominator: false },
  /** The subject of a card. */
  lg: { box: 152, stroke: 9, figure: "lg" as const, denominator: true },
};

export type ScoreRingSize = keyof typeof SIZES;

export function ScoreRing({
  score,
  size = "lg",
  className,
}: {
  /** A real score. An unscored product does not draw a ring — it says so. */
  score: number;
  size?: ScoreRingSize;
  className?: string;
}) {
  const { box, stroke, figure, denominator } = SIZES[size];
  const radius = (box - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const { tone, fillPercent } = scoreDisplay(score);
  const toneClass = statusToneText(statusForScoreTone(tone));

  return (
    <div
      className={cn("relative shrink-0", className)}
      style={{ width: box, height: box }}
      data-score-ring={size}
    >
      <svg
        aria-hidden
        viewBox={`0 0 ${box} ${box}`}
        className={cn("size-full -rotate-90", toneClass)}
        fill="none"
      >
        <circle
          cx={box / 2}
          cy={box / 2}
          r={radius}
          className="stroke-line-strong"
          strokeWidth={stroke}
        />
        <circle
          cx={box / 2}
          cy={box / 2}
          r={radius}
          className="vibe-ring-draw stroke-current"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fillPercent / 100)}
          /* The keyframe reads these, so one rule serves every size and no
             component computes a delay or a length in JavaScript. */
          style={
            {
              "--vibe-ring-length": circumference,
            } as React.CSSProperties
          }
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={figureClasses(figure, toneClass)}>{score}</span>
        {denominator && <span className="text-fg-meta mt-1 text-body font-medium">/ 100</span>}
      </div>
    </div>
  );
}
