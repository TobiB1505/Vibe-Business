import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { InfoIcon } from "@/components/ui/dashboard-icons";
import { scoreDisplay, type ScoreTone } from "@/components/ui/score-display";
import { Sparkline, sparklineBreakCaption } from "@/components/ui/sparkline";
import { statusToneText, type StatusTone } from "@/components/ui/status-pill";
import { Surface } from "@/components/ui/surface";
import { formatDate, formatTimestamp } from "@/lib/utils/format-datetime";
import { cn } from "@/lib/utils/cn";
import type { DashboardProject } from "@/modules/projects/dashboard";
import { productDisplayName } from "@/modules/projects/display-name";
import { buildScoreSeries, type ScoreSeries } from "@/modules/projects/score-series";

const SCORE_TONE: Record<ScoreTone, StatusTone> = {
  strong: "success",
  partial: "waiting",
  weak: "problem",
  unscored: "neutral",
};

const RING_SIZE = 152;
const RING_STROKE = 9;
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
        <span
          className={cn(
            "text-[3.25rem] leading-none font-bold tracking-[-0.06em] tabular-nums",
            statusToneText(SCORE_TONE[tone]),
          )}
        >
          {score}
        </span>
        <span className="text-fg-meta mt-1 text-sm font-medium">/ 100</span>
      </div>
    </div>
  );
}

function SignalCopy({ project }: { project: DashboardProject }) {
  const tone = scoreDisplay(project.score).tone;
  const heading =
    tone === "strong"
      ? "A strong business foundation"
      : tone === "partial"
        ? "The foundation is taking shape"
        : "This product needs attention";

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <h3 className="text-fg text-xl font-semibold tracking-[-0.025em]">{heading}</h3>
      <p className="text-fg-prose max-w-[34ch] text-sm leading-relaxed">
        Vibe ranked this product first based on its latest audit and the work currently waiting.
      </p>
      <Link
        href={`/app/projects/${project.id}`}
        className="text-mint hover:text-mint-hover mt-1 w-fit text-sm font-semibold transition-interactive"
      >
        {productDisplayName(project)}
      </Link>
    </div>
  );
}

function TrendPill({ delta }: { delta: number | null }) {
  if (delta === null) {
    return <p className="text-fg-meta text-xs">No comparable reading before this one.</p>;
  }

  const tone = delta > 0 ? "success" : delta < 0 ? "problem" : "neutral";
  const sign = delta > 0 ? "+" : "";

  return (
    <span
      className={cn(
        "w-fit rounded-full border px-3 py-1 text-xs font-semibold tabular-nums",
        tone === "success" && "bg-mint-tint border-mint-line text-mint",
        tone === "problem" && "bg-coral-tint border-coral-line text-coral",
        tone === "neutral" && "bg-surface-hover border-line-4 text-fg-muted",
      )}
    >
      {sign}
      {delta} since previous audit
    </span>
  );
}

function ScoreChart({ series, tone }: { series: ScoreSeries; tone: "mint" | "amber" | "coral" }) {
  const points = series.segments.flatMap((segment) => segment.points);
  const firstDate = formatDate(points[0]?.recordedAt);
  const lastDate = formatDate(points[points.length - 1]?.recordedAt);

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="relative min-h-44 pl-9">
        <div className="text-fg-meta absolute inset-y-0 left-0 flex flex-col justify-between py-0.5 text-[0.6875rem] tabular-nums">
          <span>100</span>
          <span>75</span>
          <span>50</span>
          <span>25</span>
          <span>0</span>
        </div>
        <div className="relative h-40">
          <div className="absolute inset-0 flex flex-col justify-between py-1" aria-hidden>
            {[0, 1, 2, 3, 4].map((line) => (
              <span key={line} className="border-line-1 block border-t" />
            ))}
          </div>
          <div className="relative z-10">
            <Sparkline segments={series.segments} variant="chart" tone={tone} />
          </div>
        </div>
        {(firstDate || lastDate) && (
          <div className="text-fg-meta flex justify-between pt-2 text-xs">
            <span>{firstDate !== lastDate ? firstDate : null}</span>
            <span>{lastDate}</span>
          </div>
        )}
      </div>
      <TrendPill delta={series.delta} />
    </div>
  );
}

export function BusinessSignalPanel({ project }: { project: DashboardProject }) {
  const series = buildScoreSeries(project.scoreHistory);
  const analysed = formatTimestamp(project.lastAnalysedAt);
  const caption = sparklineBreakCaption(series.breakCount);
  const scored = project.scoreState === "scored" && project.score !== null;
  const chartTone =
    scoreDisplay(project.score).tone === "strong"
      ? "mint"
      : scoreDisplay(project.score).tone === "partial"
        ? "amber"
        : "coral";

  return (
    <Surface level="card" padding="lg" className="flex flex-col gap-7">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <h2 className="text-fg text-sm font-semibold">Business signal</h2>
          <span title="The latest comparable business-readiness readings">
            <InfoIcon size={16} className="text-fg-meta" />
          </span>
        </div>
        {analysed && <p className="text-fg-meta hidden text-xs sm:block">Analysed {analysed}</p>}
      </div>

      {scored ? (
        <div className="grid items-center gap-8 xl:grid-cols-[9.5rem_minmax(13rem,0.8fr)_minmax(20rem,1.4fr)]">
          <ScoreRing score={project.score as number} />
          <SignalCopy project={project} />
          <ScoreChart series={series} tone={chartTone} />
        </div>
      ) : (
        <div className="flex flex-col items-start gap-4 py-3">
          <h3 className="text-fg text-xl font-semibold">
            {project.scoreState === "insufficient_coverage"
              ? "More evidence is needed"
              : "Your first signal is waiting"}
          </h3>
          <p className="text-fg-prose max-w-[58ch] text-sm leading-relaxed">
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

      {caption && <p className="text-fg-meta max-w-[62ch] text-xs leading-relaxed">{caption}</p>}
    </Surface>
  );
}
