import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { scoreDisplay, type ScoreTone } from "@/components/ui/score-display";
import { Sparkline, sparklineBreakCaption } from "@/components/ui/sparkline";
import { statusToneText, type StatusTone } from "@/components/ui/status-pill";
import { Surface } from "@/components/ui/surface";
import { MonoLabel } from "@/components/ui/typography";
import { formatTimestamp } from "@/lib/utils/format-datetime";
import type { DashboardProject } from "@/modules/projects/dashboard";
import { buildScoreSeries } from "@/modules/projects/score-series";
import { cn } from "@/lib/utils/cn";

/**
 * The Business Signal, for one named product (CORE-6).
 *
 * ## Why it names a product instead of scoring the account
 *
 * The reference shows one number for everything. There is no such number, and
 * there must not be: an average across three audits would be a figure no audit
 * produced, taken over readings that `score-series.ts` says are frequently not
 * comparable with each other at all. Averaging incomparable numbers is exactly
 * the dishonesty the whole comparability rule exists to prevent, done once more
 * at a higher level.
 *
 * So the hero is **the product that most needs attention** — the same one
 * `orderProjectsByAttention` puts first in the grid below. With one product it
 * reads exactly like the reference. With three it says which of the three it
 * is talking about, which also settles what the Next Move card beside it is
 * about.
 *
 * ## What it deliberately does not show
 *
 * - **The audit's conclusion sentence.** "Your business is on track" is
 *   `synthesis.overall`, and it lives inside the audit's JSONB document. The
 *   dashboard read model does not open that document, by contract, and
 *   weakening a load-bearing guard for one sentence is a bad trade. It is one
 *   click away on Business Health.
 * - **A date-range filter.** "Last 7 days" implies a time filter over data
 *   that does not exist: audits happen when someone runs one, not on a
 *   schedule, and a founder can have two readings in a year.
 * - **A zero.** An unscored product gets a sentence where the number would be.
 */

const SCORE_TONE: Record<ScoreTone, StatusTone> = {
  strong: "success",
  partial: "waiting",
  weak: "problem",
  unscored: "neutral",
};

/** Geometry for the ring. The arc is a stroked circle, rotated to start at 12. */
const RING_SIZE = 132;
const RING_STROKE = 8;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function ScoreRing({ score }: { score: number }) {
  const { tone, fillPercent } = scoreDisplay(score);

  return (
    <div className="relative shrink-0" style={{ width: RING_SIZE, height: RING_SIZE }}>
      <svg
        aria-hidden
        viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
        className={cn("size-full -rotate-90", statusToneText(SCORE_TONE[tone]))}
        fill="none"
      >
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          className="stroke-line-track"
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
      {/*
        The number sits inside the ring rather than beside it: one object, read
        once. `text-hero` is used here and nowhere else on this screen — the
        hierarchy is what replaces the rows this dashboard removed.
      */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className={cn(
            "font-mono text-hero leading-none tabular-nums",
            statusToneText(SCORE_TONE[tone]),
          )}
        >
          {score}
        </span>
        <span className="text-fg-meta font-mono text-meta">/ 100</span>
      </div>
    </div>
  );
}

/**
 * How the score moved, in words.
 *
 * Null delta is the common case and it is not a failure to report — it means
 * there is no second reading measured the same way, which is the truth far
 * more often than a dashboard would like. It says so rather than printing a
 * neutral "0".
 */
function TrendReading({ delta }: { delta: number | null }) {
  if (delta === null) {
    return (
      <p className="text-fg-meta text-meta">No comparable reading before this one.</p>
    );
  }

  const tone = delta > 0 ? "success" : delta < 0 ? "problem" : "neutral";
  const sign = delta > 0 ? "+" : "";

  return (
    <p className="text-fg-meta text-meta">
      <span className={cn("font-mono tabular-nums", statusToneText(tone))}>
        {sign}
        {delta}
      </span>{" "}
      since the previous audit
    </p>
  );
}

export function BusinessSignalPanel({ project }: { project: DashboardProject }) {
  const series = buildScoreSeries(project.scoreHistory);
  const analysed = formatTimestamp(project.lastAnalysedAt);
  const caption = sparklineBreakCaption(series.breakCount);
  const scored = project.scoreState === "scored" && project.score !== null;

  return (
    <Surface level="card" padding="lg" className="flex h-full flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <MonoLabel>Business Signal</MonoLabel>
        {/*
          Which product this is about. A link, because the number is a summary
          of a screen that explains it.
        */}
        <Link
          href={`/app/projects/${project.id}/health`}
          className="text-fg hover:text-mint text-title w-fit font-bold transition-interactive"
        >
          {project.name}
        </Link>
      </div>

      {scored ? (
        <div className="flex flex-wrap items-center gap-x-8 gap-y-6">
          <ScoreRing score={project.score as number} />

          <div className="flex min-w-[15rem] flex-1 flex-col gap-2">
            <Sparkline segments={series.segments} />
            <TrendReading delta={series.delta} />
            {analysed && (
              <p className="text-fg-meta font-mono text-meta">Analysed {analysed}</p>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-4">
          <p className="text-fg-prose max-w-[52ch] text-base leading-relaxed">
            {project.scoreState === "insufficient_coverage"
              ? "Vibe looked and there wasn't enough evidence to score this product. Connecting more of it, or publishing a live site, gives the audit something to read."
              : "Vibe hasn't analysed this product yet. The business audit is what produces a score and the moves that follow from it."}
          </p>
          <Link
            href={`/app/projects/${project.id}/health`}
            className={buttonClasses({ variant: "primary", size: "sm" })}
          >
            {project.scoreState === "insufficient_coverage" ? "Open Business Health" : "Analyse product"}
          </Link>
        </div>
      )}

      {caption && <p className="text-fg-meta max-w-[52ch] text-meta leading-relaxed">{caption}</p>}
    </Surface>
  );
}
