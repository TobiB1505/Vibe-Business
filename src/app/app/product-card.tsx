import Link from "next/link";
import { ArrowRightIcon } from "@/components/ui/dashboard-icons";
import { scoreDisplay, type ScoreTone } from "@/components/ui/score-display";
import { Sparkline } from "@/components/ui/sparkline";
import { statusToneText, type StatusTone } from "@/components/ui/status-pill";
import { Surface } from "@/components/ui/surface";
import { formatDate } from "@/lib/utils/format-datetime";
import { cn } from "@/lib/utils/cn";
import { ProductLogo } from "@/components/brand/product-logo";
import { initialsFrom } from "@/modules/auth/initials";
import type { DashboardProject } from "@/modules/projects/dashboard";
import { productDisplayName } from "@/modules/projects/display-name";
import { buildScoreSeries } from "@/modules/projects/score-series";

const SCORE_TONE: Record<ScoreTone, StatusTone> = {
  strong: "success",
  partial: "waiting",
  weak: "problem",
  unscored: "neutral",
};

function primaryAction(project: DashboardProject): { label: string; href: string } {
  const base = `/app/projects/${project.id}`;

  if (project.repositoryFullName === null) return { label: "Finish setup", href: base };
  if (project.preparedCount > 0) return { label: "Review change", href: `${base}/agent` };
  if (project.nextMovesCount !== null && project.nextMovesCount > 0) {
    return { label: "Review moves", href: `${base}/plan` };
  }
  if (project.scoreState === "not_audited") {
    return { label: "Analyse product", href: base };
  }
  return { label: "Open dashboard", href: base };
}

function ScoreValue({ project }: { project: DashboardProject }) {
  if (project.scoreState === "scored" && project.score !== null) {
    const { tone } = scoreDisplay(project.score);
    return (
      <span className="flex items-baseline gap-1 font-semibold tabular-nums">
        <span className={statusToneText(SCORE_TONE[tone])}>{project.score}</span>
        <span className="text-fg-meta text-xs">/100</span>
      </span>
    );
  }

  return (
    <span className="text-fg-muted text-xs">
      {project.scoreState === "insufficient_coverage" ? "Not enough evidence" : "Not analysed"}
    </span>
  );
}

export function ProductCard({ project }: { project: DashboardProject }) {
  /*
   * The name the product goes by, falling back to the label the founder typed.
   * The repository line below is this card's anchor back to the project, so
   * unlike the My Products row it needs no second name of its own.
   */
  const displayName = productDisplayName(project);
  const action = primaryAction(project);
  const series = buildScoreSeries(project.scoreHistory);
  const analysed = formatDate(project.lastAnalysedAt);
  const analysedState = project.scoreState === "scored" && project.score !== null;
  const sparklineTone =
    scoreDisplay(project.score).tone === "strong"
      ? "mint"
      : scoreDisplay(project.score).tone === "partial"
        ? "amber"
        : scoreDisplay(project.score).tone === "weak"
          ? "coral"
          : "neutral";

  return (
    <Surface
      as="article"
      level="panel"
      padding="none"
      className="group flex h-full flex-col overflow-hidden transition-[border-color,background-color] duration-200 hover:border-line-strong hover:bg-surface-4"
      data-testid="product-card"
    >
      <div className="flex items-start gap-3 p-5 pb-4">
        <span
          aria-hidden
          className={cn(
            "bg-mint-tint text-mint border-mint-line flex size-11 shrink-0 items-center",
            "justify-center rounded-nav border text-sm font-bold tracking-[-0.02em]",
          )}
        >
          {/*
           * The logo sits inside the tile rather than replacing it, so the row
           * keeps its height whether or not one loads. The fallback is the
           * initials rather than ProductLogo's default Vibe mark: on a list of
           * the customer's own products, Vibe's mark would read as a claim
           * about whose product a card is.
           */}
          {project.logoUrl ? (
            <ProductLogo
              src={project.logoUrl}
              alt=""
              className="size-7 object-contain"
              fallback={initialsFrom(displayName)}
            />
          ) : (
            initialsFrom(displayName)
          )}
        </span>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 className="text-fg truncate text-sm font-semibold" title={displayName}>
            {displayName}
          </h3>
          <p
            className="text-fg-meta truncate text-xs"
            title={project.repositoryFullName ?? undefined}
          >
            {project.repositoryFullName ?? "Setup not finished"}
          </p>
        </div>

        <div className="flex w-16 shrink-0 flex-col items-end gap-2">
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-[0.625rem] font-semibold",
              analysedState
                ? "bg-mint-tint border-mint-line text-mint"
                : "bg-surface-hover border-line-4 text-fg-muted",
            )}
          >
            {analysedState ? "Analysed" : "Setup"}
          </span>
          {series.readingCount > 0 && <Sparkline segments={series.segments} tone={sparklineTone} />}
        </div>
      </div>

      <dl className="flex flex-1 flex-col gap-3 px-5 pb-5 text-xs">
        <div className="flex items-center justify-between gap-4">
          <dt className="text-fg-muted">Business signal</dt>
          <dd className="text-fg-body text-right">
            <ScoreValue project={project} />
          </dd>
        </div>
        <div className="flex items-start justify-between gap-4">
          <dt className="text-fg-muted shrink-0">Next move</dt>
          <dd className="text-fg-body line-clamp-2 max-w-[14rem] text-right font-medium">
            {project.topMove?.title ??
              (project.nextMovesCount === null ? "Run business audit" : "Nothing waiting")}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-fg-muted">Last analysed</dt>
          <dd className="text-fg-body text-right font-medium">{analysed ?? "Not yet"}</dd>
        </div>
      </dl>

      <Link
        href={action.href}
        className={cn(
          "border-line-2 text-fg-body hover:bg-surface-hover hover:text-fg flex items-center",
          "justify-between border-t px-5 py-4 text-sm font-semibold transition-interactive",
        )}
      >
        {action.label}
        <ArrowRightIcon
          size={16}
          className="text-fg-meta transition-transform duration-200 group-hover:translate-x-0.5"
        />
      </Link>
    </Surface>
  );
}
