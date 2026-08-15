/**
 * How a score becomes pixels (UI-0).
 *
 * This is a pure module, separate from `score-meter.tsx`, for one reason: the
 * rule it encodes is a product safety rule, not a styling preference, and the
 * project has no React rendering harness to assert it through a component.
 *
 * ## The rule
 *
 * A dimension the evidence cannot support scores `null`. It is excluded from
 * averages, it is never counted as zero, and — the part that lives here — it
 * must never be *drawn* as zero either. A meter with an empty track and a "0"
 * beside it is a claim that the product scored badly. `null` renders as an
 * empty track and the text `n/a`, which is a different claim: nothing was
 * measurable.
 *
 * See CLAUDE.md rule 44 and ARCHITECTURE.md §3.4 ("unknown ≠ bad").
 */

export type ScoreTone = "strong" | "partial" | "weak" | "unscored";

export type ScoreDisplay = {
  tone: ScoreTone;
  /** Percentage of the track to fill, 0–100. Always 0 for an unscored value. */
  fillPercent: number;
  /** What is printed next to the meter. */
  text: string;
  /** True when there is no score at all, as opposed to a low one. */
  unscored: boolean;
};

/**
 * Default bands. A domain with its own thresholds should pass an explicit tone
 * rather than have them re-derived here — these exist so a meter without an
 * opinion still renders something honest.
 */
function defaultTone(value: number, max: number): ScoreTone {
  const ratio = value / max;
  if (ratio >= 0.6) return "strong";
  if (ratio >= 0.35) return "partial";
  return "weak";
}

export function scoreDisplay(
  value: number | null | undefined,
  { max = 100, unscoredText = "n/a" }: { max?: number; unscoredText?: string } = {},
): ScoreDisplay {
  // `null` and `undefined` mean the same thing here — nothing was measurable.
  // NaN is treated the same rather than propagating into a width calculation.
  if (value === null || value === undefined || Number.isNaN(value)) {
    return { tone: "unscored", fillPercent: 0, text: unscoredText, unscored: true };
  }

  // A genuine zero is a real score and keeps its tone and its "0". It is only
  // *absence* that becomes n/a — collapsing the two is the whole bug.
  const clamped = Math.max(0, Math.min(value, max));
  const fillPercent = max === 0 ? 0 : (clamped / max) * 100;

  return {
    tone: defaultTone(clamped, max),
    fillPercent,
    text: String(value),
    unscored: false,
  };
}
