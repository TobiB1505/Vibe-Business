import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { ArrowRightIcon, InfoIcon } from "@/components/ui/dashboard-icons";
import { scoreDisplay } from "@/components/ui/score-display";
import { statusForScoreTone } from "@/components/system/status-vocabulary";
import { Sparkline, sparklineBreakCaption } from "@/components/ui/sparkline";
import { statusToneChip, statusToneText } from "@/components/ui/status-pill";
import { VibeCard } from "@/components/ui/surface";
import { MonoLabel } from "@/components/ui/typography";
import { figureClasses } from "@/components/ui/figure";
import { RatingChip } from "@/components/ui/status-pill";
import { formatDate, formatTimestamp } from "@/lib/utils/format-datetime";
import { cn } from "@/lib/utils/cn";
import { EFFORT_LABELS, IMPACT_LABELS } from "@/modules/opportunities/schema";
import { planMoveHref } from "@/modules/action-plans/source";
import type { DashboardProject } from "@/modules/projects/dashboard";
import { productDisplayName } from "@/modules/projects/display-name";
import { buildScoreSeries, type ScoreSeries } from "@/modules/projects/score-series";

/**
 * The reading and the move for the product that needs attention first.
 *
 * ## Why this is one card and not two
 *
 * It was two — a Business signal panel and a Next move panel, stacked, each
 * full width, each with its own control. On an unanalysed product they said
 * the same sentence twice and offered two buttons for it: "Analyse product"
 * beside "Open action plan", the second of which opens a plan that does not
 * exist. The product card below then said it a third time. Three instructions,
 * three controls, one instruction's worth of meaning.
 *
 * The audit calls this exact shape out as the failure to fix — equally
 * weighted doors on arrival, where a ranking should have removed the choice
 * (§9.2.1). So the two panels become one primary object with **one** control:
 * the reading, then the move that follows from it, then the single way in.
 *
 * `Surface` level 3 is "one primary object per view" and this is it. Everything
 * else on the dashboard — the product grid, the connect row — is level 2 or
 * quieter, so the hierarchy states what the screen is about instead of leaving
 * a founder to infer it from three same-sized rectangles.
 *
 * ## Why the chart comes and goes
 *
 * A score history of two readings either side of a scoring change is not a
 * line; it is two isolated dots on an empty grid, and it was taking forty
 * percent of the panel's width to say what the delta pill beside it already
 * said. The chart is drawn when some segment holds enough readings to have a
 * shape, and the trend is stated in words when it does not.
 *
 * This is the instrument matching the evidence, which is the same rule the
 * rest of the product follows: an unassessable dimension scores `—` rather
 * than drawing an empty axis (rule 44). A chart is not more honest for being
 * present, and an empty one implies a history the product has not accumulated.
 */

const RING_SIZE = 152;
const RING_STROKE = 9;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/**
 * A line needs three readings to have a shape. Two draw a segment with no
 * trend in it, and one draws a dot — both of which the delta says better.
 */
const READINGS_FOR_A_LINE = 3;

function hasDrawableLine(series: ScoreSeries): boolean {
  return series.segments.some((segment) => segment.points.length >= READINGS_FOR_A_LINE);
}

function ScoreRing({ score }: { score: number }) {
  const { tone, fillPercent } = scoreDisplay(score);

  return (
    <div className="relative shrink-0" style={{ width: RING_SIZE, height: RING_SIZE }}>
      <svg
        aria-hidden
        viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
        className={cn("size-full -rotate-90", statusToneText(statusForScoreTone(tone)))}
        fill="none"
      >
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          className="stroke-line-strong"
          strokeWidth={RING_STROKE}
        />
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          className="stroke-current"
          strokeWidth={RING_STROKE}
          strokeLinecap="round"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={RING_CIRCUMFERENCE * (1 - fillPercent / 100)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={figureClasses("lg", statusToneText(statusForScoreTone(tone)))}>
          {score}
        </span>
        <span className="text-fg-meta mt-1 text-body font-medium">/ 100</span>
      </div>
    </div>
  );
}

/** The delta as a word and a number. Never a percentage — this is a score. */
function TrendPill({ delta }: { delta: number | null }) {
  if (delta === null) {
    return <span className="text-fg-meta text-caption">No comparable reading before this one</span>;
  }

  const tone = delta > 0 ? "success" : delta < 0 ? "problem" : "neutral";
  const sign = delta > 0 ? "+" : "";

  return (
    <span
      className={cn(
        "w-fit rounded-full border px-3 py-1 text-caption font-semibold tabular-nums",
        statusToneChip(tone),
      )}
    >
      {sign}
      {delta} since previous audit
    </span>
  );
}

function ScoreChart({
  series,
  tone,
  caption,
  className,
}: {
  className?: string;
  series: ScoreSeries;
  tone: "mint" | "amber" | "coral";
  /** Why the line breaks. Belongs beside the break, not at the card's foot. */
  caption: string | null;
}) {
  const points = series.segments.flatMap((segment) => segment.points);
  const firstDate = formatDate(points[0]?.recordedAt);
  const lastDate = formatDate(points[points.length - 1]?.recordedAt);

  return (
    <div className={cn("flex min-w-0 flex-col", className)}>
      {/*
        The axis is absolute against the plot alone. It used to be absolute
        against everything below it too, so adding the caption inside pushed
        the `0` label down past the baseline it labels.
      */}
      <div className="relative h-36 pl-9">
        <div className="text-fg-meta absolute inset-y-0 left-0 flex flex-col justify-between text-meta tabular-nums">
          <span>100</span>
          <span>50</span>
          <span>0</span>
        </div>
        <div
          className="absolute inset-y-0 right-0 left-9 flex flex-col justify-between"
          aria-hidden
        >
          {[0, 1, 2].map((line) => (
            <span key={line} className="border-line-1 block border-t" />
          ))}
        </div>
        <div className="relative z-10 h-full">
          <Sparkline segments={series.segments} variant="chart" tone={tone} />
        </div>
      </div>
      {(firstDate || lastDate) && (
        <div className="text-fg-meta flex justify-between pt-2 pl-9 text-caption">
          <span>{firstDate !== lastDate ? firstDate : null}</span>
          <span>{lastDate}</span>
        </div>
      )}
      {caption && <p className="text-fg-meta pt-2 pl-9 text-caption leading-relaxed">{caption}</p>}
    </div>
  );
}

/**
 * The move, inside the card that carries the reading it came from.
 *
 * Its own labelled zone rather than a second panel: a founder reading a score
 * of 46 and then a move about pricing should not have to connect two boxes to
 * see that the second is the answer to the first.
 */
function NextMove({ project }: { project: DashboardProject }) {
  const planHref = `/app/projects/${project.id}/plan`;
  const move = project.topMove;
  /*
   * With the id, so the control opens the Move the card named. Without it, it
   * opened whichever Move was rank 1 at click time — the same one almost
   * always, and a different one exactly when it matters, after a re-scan
   * reordered the set (UI-S3 §6).
   */
  const href = move ? planMoveHref(planHref, move.id) : planHref;

  return (
    <div className="border-line-1 flex flex-col gap-3 border-t pt-6">
      <MonoLabel as="h3">Next move</MonoLabel>

      {move ? (
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex min-w-0 flex-col gap-2">
            <p className="text-fg text-title font-semibold text-balance">{move.title}</p>
            <p className="text-fg-prose max-w-[58ch] text-body leading-relaxed">{move.problem}</p>
            <div className="flex flex-wrap gap-2 pt-1">
              {/* The maps carry the noun already — appending one read "High impact impact". */}
              <RatingChip>{IMPACT_LABELS[move.impact]}</RatingChip>
              <RatingChip>{EFFORT_LABELS[move.effort]}</RatingChip>
            </div>
          </div>
          <Link
            href={href}
            className={cn(buttonClasses({ variant: "secondary", size: "md" }), "shrink-0")}
          >
            View action plan
            <ArrowRightIcon size={16} />
          </Link>
        </div>
      ) : (
        /*
         * No control here. The card's one control belongs to whatever this
         * product actually needs next — running the audit, above — and a
         * second button opening an action plan that holds nothing is the dead
         * end this card was merged to remove.
         */
        <p className="text-fg-muted max-w-[58ch] text-body leading-relaxed">
          {project.nextMovesCount === null
            ? "The business audit turns Vibe's findings into a prioritised action plan. Nothing is ranked until it has run."
            : "Vibe looked and didn't find a move worth putting ahead of the others right now."}
        </p>
      )}
    </div>
  );
}

export function SignalCard({ project }: { project: DashboardProject }) {
  const series = buildScoreSeries(project.scoreHistory);
  const analysed = formatTimestamp(project.lastAnalysedAt);
  const caption = sparklineBreakCaption(series.breakCount);
  const scored = project.scoreState === "scored" && project.score !== null;
  const tone = scoreDisplay(project.score).tone;
  const chartTone = tone === "strong" ? "mint" : tone === "partial" ? "amber" : "coral";
  const heading =
    tone === "strong"
      ? "A strong business foundation"
      : tone === "partial"
        ? "The foundation is taking shape"
        : "This product needs attention";

  const drawChart = hasDrawableLine(series);

  return (
    <VibeCard
      as="section"
      /*
       * Two ids, so the region announces what it is *and* what it is about:
       * "Business signal, Payflow". The old panel got the subject in with an
       * `sr-only` heading carrying the product name and nothing else, which
       * named the region for the subject alone — a screen-reader user landing
       * on it heard a product name and had to read on to learn it was a score.
       * The product name is visible text now, so nothing here is hidden.
       */
      aria-labelledby="signal-heading signal-product"
      padding="lg"
      className="@container/hero flex flex-col gap-7"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <h2 id="signal-heading" className="text-fg text-body font-semibold">
            Business signal
          </h2>
          <span title="The latest comparable business-readiness readings">
            <InfoIcon size={16} className="text-fg-meta" />
          </span>
        </div>
        {/*
          The product this card is about, named once. The old panel put it in
          the body as a link and the header carried only a date, so the reading
          and the thing it was a reading of were three lines apart.
        */}
        <p className="text-fg-meta text-caption" id="signal-product">
          <Link
            href={`/app/projects/${project.id}`}
            className="text-fg-secondary hover:text-mint font-medium transition-interactive"
          >
            {productDisplayName(project)}
          </Link>
          {analysed && <span className="hidden sm:inline"> · Analysed {analysed}</span>}
        </p>
      </div>

      {scored ? (
        /*
          Laid out against the *card's* width, not the viewport's.
          `@container` because this card no longer spans the page: the
          dashboard puts the attention panel beside it, so at `xl` the card is
          652px while the viewport is 1440. The old rule was a viewport
          breakpoint, and the moment the card narrowed it kept the three-column
          track list — 696px of hard minimum inside a 586px content box, which
          hung the chart 77px outside the card and over the panel next to it.
          Measured, not guessed; a container query is the only thing that can
          be right for both.

          `@3xl` = 48rem, comfortably above the track minimums. Below it the
          chart takes a row of its own at full width, which is the better
          shape at that size anyway.
        */
        <div
          className={cn(
            "grid items-center gap-x-8 gap-y-6",
            drawChart
              ? "@sm/hero:grid-cols-[9.5rem_minmax(0,1fr)] @3xl/hero:grid-cols-[9.5rem_minmax(12rem,0.9fr)_minmax(18rem,1.3fr)]"
              : "@sm/hero:grid-cols-[9.5rem_minmax(0,1fr)]",
          )}
        >
          <ScoreRing score={project.score as number} />
          <div className="flex min-w-0 flex-col items-start gap-3">
            <p className="text-fg text-moment font-semibold text-balance">{heading}</p>
            <TrendPill delta={series.delta} />
            {!drawChart && (
              <p className="text-fg-meta text-caption">
                {series.readingCount === 1
                  ? "One reading so far. A trend line needs a few more."
                  : `${series.readingCount} readings so far. A trend line needs a few more.`}
              </p>
            )}
          </div>
          {drawChart && (
            <ScoreChart
              series={series}
              tone={chartTone}
              caption={caption}
              className="@sm/hero:col-span-2 @3xl/hero:col-span-1"
            />
          )}
        </div>
      ) : (
        <div className="flex flex-col items-start gap-4">
          <p className="text-fg text-moment font-semibold">
            {project.scoreState === "insufficient_coverage"
              ? "More evidence is needed"
              : "Your first signal is waiting"}
          </p>
          <p className="text-fg-prose max-w-[58ch] text-body leading-relaxed">
            {project.scoreState === "insufficient_coverage"
              ? "Vibe looked and there wasn't enough evidence to score this product. Connecting more of it, or publishing a live site, gives the audit something to read."
              : "Vibe hasn't analysed this product yet. The business audit produces the first score and the moves that follow from it."}
          </p>
          <Link
            href={`/app/projects/${project.id}`}
            className={buttonClasses({ variant: "primary", size: "sm" })}
          >
            {project.scoreState === "insufficient_coverage"
              ? "Open business health"
              : "Analyse product"}
          </Link>
        </div>
      )}

      <NextMove project={project} />
    </VibeCard>
  );
}
