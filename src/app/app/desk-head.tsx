import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { ArrowRightIcon, InfoIcon } from "@/components/ui/dashboard-icons";
import { ProductMark } from "@/components/brand/product-mark";
import { RatingChip, statusToneChip, StatusPill } from "@/components/ui/status-pill";
import { ScoreRing } from "@/components/ui/score-ring";
import { Sparkline, sparklineBreakCaption } from "@/components/ui/sparkline";
import { VibeCard } from "@/components/ui/surface";
import { MonoLabel } from "@/components/ui/typography";
import { Reveal } from "@/components/ui/motion";
import { formatDate, formatTimestamp } from "@/lib/utils/format-datetime";
import { cn } from "@/lib/utils/cn";
import { EFFORT_LABELS, IMPACT_LABELS } from "@/modules/opportunities/schema";
import { planMoveHref } from "@/modules/action-plans/source";
import { productDisplayName } from "@/modules/projects/display-name";
import { buildScoreSeries, type ScoreSeries } from "@/modules/projects/score-series";
import type { AttentionTier } from "@/modules/projects/attention";
import type { DeskEntry } from "./desk";

/**
 * The first thing on the desk, opened.
 *
 * ## What this is
 *
 * One decision, stated as a decision: what is waiting, on which product, what
 * Vibe observed, and the single way to answer it — with that product's reading
 * beside it as context rather than as the subject.
 *
 * That inversion is the whole redesign. The screen used to lead with a *score*
 * and put the move underneath it, which meant the founder read a number before
 * they read a task, and a blocked validation appeared nowhere at all. The
 * ranking decides what the head is about; the score is what makes it legible.
 *
 * ## Why the move replaces the detail rather than sitting beside it
 *
 * `attention.ts` writes one honest sentence per item — "Vibe ranked these from
 * your latest business audit." When the item is `moves_waiting` and the project
 * carries a rank-1 Move, that sentence is a worse version of something the
 * product already knows: the move's own title and problem. So the richer text
 * wins, and the generic line is not also printed. Two descriptions of one
 * decision is how a card becomes a paragraph.
 *
 * ## Container, not viewport
 *
 * The split is a container query. This card sits in a column whose width is not
 * the viewport's, and a viewport breakpoint on it was measured hanging a chart
 * 77px outside its own card and over the panel beside it.
 */

const TIER_TONE: Record<AttentionTier, Parameters<typeof StatusPill>[0]["tone"]> = {
  blocked: "problem",
  decision: "waiting",
  ready: "active",
  setup: "neutral",
};

const TIER_LABEL: Record<AttentionTier, string> = {
  blocked: "Blocked",
  decision: "Needs you",
  ready: "Ready",
  setup: "Setup",
};

/** A line needs three readings to have a shape. Two is a segment; one is a dot. */
const READINGS_FOR_A_LINE = 3;

function hasDrawableLine(series: ScoreSeries): boolean {
  return series.segments.some((segment) => segment.points.length >= READINGS_FOR_A_LINE);
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

/**
 * The reading, as context.
 *
 * Deliberately narrow and deliberately second in the DOM: a screen reader meets
 * the decision, then the number that explains it. The old card had this order
 * the other way round.
 */
function Reading({ project, series }: { project: DeskEntry["project"]; series: ScoreSeries }) {
  const scored = project.scoreState === "scored" && project.score !== null;
  const analysed = formatTimestamp(project.lastAnalysedAt);
  const drawChart = scored && hasDrawableLine(series);
  const points = series.segments.flatMap((segment) => segment.points);
  const firstDate = formatDate(points[0]?.recordedAt);
  const lastDate = formatDate(points[points.length - 1]?.recordedAt);
  const caption = sparklineBreakCaption(series.breakCount);

  if (!scored) {
    return (
      <div className="border-line-1 flex flex-col gap-2 border-t pt-5 @3xl/head:border-t-0 @3xl/head:border-l @3xl/head:pt-0 @3xl/head:pl-7">
        <MonoLabel>Business signal</MonoLabel>
        <p className="text-fg-muted max-w-[36ch] text-body leading-relaxed">
          {project.scoreState === "insufficient_coverage"
            ? "Vibe looked and there wasn't enough evidence to score this product."
            : "No score yet. The business audit produces the first one."}
        </p>
      </div>
    );
  }

  return (
    <div className="border-line-1 flex flex-col gap-4 border-t pt-5 @3xl/head:border-t-0 @3xl/head:border-l @3xl/head:pt-0 @3xl/head:pl-7">
      <div className="flex items-center gap-2">
        <MonoLabel>Business signal</MonoLabel>
        <span title="The latest comparable business-readiness readings">
          <InfoIcon size={14} className="text-fg-meta" />
        </span>
      </div>

      <div className="flex items-center gap-5">
        <ScoreRing score={project.score as number} />
        <div className="flex min-w-0 flex-col items-start gap-2">
          <TrendPill delta={series.delta} />
          {analysed && <span className="text-fg-meta text-caption">Analysed {analysed}</span>}
        </div>
      </div>

      {drawChart && (
        <div className="flex flex-col">
          {/* The axis is absolute against the plot alone, so a caption below it
              cannot push the `0` label off the line it labels. */}
          <div className="relative h-28 pl-8">
            <div className="text-fg-meta absolute inset-y-0 left-0 flex flex-col justify-between text-meta tabular-nums">
              <span>100</span>
              <span>50</span>
              <span>0</span>
            </div>
            <div
              className="absolute inset-y-0 right-0 left-8 flex flex-col justify-between"
              aria-hidden
            >
              {[0, 1, 2].map((line) => (
                <span key={line} className="border-line-1 block border-t" />
              ))}
            </div>
            <div className="relative z-10 h-full">
              <Sparkline
                segments={series.segments}
                variant="chart"
                tone={
                  project.score !== null && project.score >= 70
                    ? "mint"
                    : project.score !== null && project.score >= 40
                      ? "amber"
                      : "coral"
                }
              />
            </div>
          </div>
          {(firstDate || lastDate) && (
            <div className="text-fg-meta flex justify-between pt-2 pl-8 text-caption">
              <span>{firstDate !== lastDate ? firstDate : null}</span>
              <span>{lastDate}</span>
            </div>
          )}
          {caption && (
            <p className="text-fg-meta max-w-[44ch] pt-2 pl-8 text-caption leading-relaxed">
              {caption}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function DeskHead({ entry }: { entry: DeskEntry }) {
  const { project } = entry;
  const name = productDisplayName(project);
  const series = buildScoreSeries(project.scoreHistory);

  /*
   * The move replaces the item's own sentence when it has one — see the note
   * at the top. `planMoveHref` carries the id, so the control opens the Move
   * the head named rather than whichever is rank 1 at click time.
   */
  const move =
    entry.kind === "item" && entry.item.kind === "moves_waiting" ? project.topMove : null;
  const action =
    entry.kind === "item"
      ? move
        ? { label: entry.item.action.label, href: planMoveHref(entry.item.action.href, move.id) }
        : entry.item.action
      : { label: "Open dashboard", href: `/app/projects/${project.id}` };

  const headline =
    entry.kind === "item" ? (move ? move.title : entry.item.title) : "Nothing waiting";
  const body =
    entry.kind === "item"
      ? move
        ? move.problem
        : entry.item.detail
      : "Vibe has nothing ranked for this product right now. The reading beside this is the latest one.";

  return (
    <Reveal>
      <VibeCard
        as="section"
        aria-labelledby="desk-head-title"
        padding="lg"
        className="@container/head flex flex-col gap-6"
      >
        <div className="grid items-center gap-6 @3xl/head:grid-cols-[minmax(0,1.35fr)_minmax(17rem,1fr)]">
          <div className="flex min-w-0 flex-col items-start gap-4">
            <div className="flex flex-wrap items-center gap-3">
              {entry.kind === "item" ? (
                <StatusPill tone={TIER_TONE[entry.item.tier]} dot>
                  {TIER_LABEL[entry.item.tier]}
                </StatusPill>
              ) : (
                <StatusPill tone="neutral">Settled</StatusPill>
              )}
              <Link
                href={`/app/projects/${project.id}`}
                className="text-fg-secondary hover:text-mint flex min-w-0 items-center gap-2 text-caption font-medium transition-interactive"
              >
                <ProductMark logoUrl={project.logoUrl} name={name} size="sm" />
                <span className="truncate">{name}</span>
              </Link>
            </div>

            <h2 id="desk-head-title" className="text-fg text-moment font-semibold text-balance">
              {headline}
            </h2>
            <p className="text-fg-prose max-w-[58ch] text-body leading-relaxed">{body}</p>

            {move && (
              <div className="flex flex-wrap gap-2">
                {/* The maps carry the noun already — appending one read "High impact impact". */}
                <RatingChip>{IMPACT_LABELS[move.impact]}</RatingChip>
                <RatingChip>{EFFORT_LABELS[move.effort]}</RatingChip>
              </div>
            )}

            <Link href={action.href} className={cn(buttonClasses({ size: "md" }), "mt-1")}>
              {action.label}
              <ArrowRightIcon size={16} />
            </Link>
          </div>

          <Reading project={project} series={series} />
        </div>
      </VibeCard>
    </Reveal>
  );
}
