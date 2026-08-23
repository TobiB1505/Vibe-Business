import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { scoreDisplay, type ScoreTone } from "@/components/ui/score-display";
import { statusToneText, type StatusTone } from "@/components/ui/status-pill";
import { Surface } from "@/components/ui/surface";
import { MonoLabel } from "@/components/ui/typography";
import { formatTimestamp } from "@/lib/utils/format-datetime";
import { initialsFrom } from "@/modules/auth/identity-view";
import type { DashboardProject } from "@/modules/projects/dashboard";
import { cn } from "@/lib/utils/cn";

/**
 * One product, as a card (CORE-6).
 *
 * ## What it shows, and what it deliberately does not
 *
 * A tile, a name, **one number**, **one sentence**, **one action**. The row it
 * replaces carried four columns of label/value pairs; the reference this was
 * drawn from carried three per card, which at three cards is nine metadata
 * pairs in one band on the calmest screen in the product.
 *
 * Three things from that reference are absent on purpose:
 *
 * - **No "Active" badge.** It would appear on every card and therefore
 *   distinguish nothing. The state a founder needs is already in the action:
 *   "Review change" and "Run audit" are different situations.
 * - **No repository line.** `owner/repo` on every card is the account level
 *   borrowing the project level's density. Repositories are their own subject.
 * - **No "Last updated".** That number was built once and removed, because
 *   reading it across projects without an N+1 made it silently wrong for
 *   whichever product you used least (`dashboard.ts`). What is here instead is
 *   exact: when Vibe last analysed this product.
 *
 * ## The rules the numbers follow
 *
 * `scoreDisplay` decides the band, so this file holds no thresholds of its own,
 * and a project with no audit shows a sentence rather than a zero — "not
 * analysed" and "scored 0" are different claims about someone's business.
 */

const SCORE_TONE: Record<ScoreTone, StatusTone> = {
  strong: "success",
  partial: "waiting",
  weak: "problem",
  unscored: "neutral",
};

/** The most useful destination, given what is actually pending. */
function primaryAction(project: DashboardProject): { label: string; href: string; accent: boolean } {
  const base = `/app/projects/${project.id}`;

  if (project.repositoryFullName === null) {
    return { label: "Finish setup", href: base, accent: true };
  }
  if (project.preparedCount > 0) {
    return { label: "Review change", href: `${base}/agent`, accent: false };
  }
  if (project.nextMovesCount !== null && project.nextMovesCount > 0) {
    return { label: "Review moves", href: `${base}/plan`, accent: false };
  }
  if (project.scoreState === "not_audited") {
    return { label: "Analyse product", href: `${base}/health`, accent: true };
  }
  return { label: "Open", href: base, accent: false };
}

function ScoreReading({ project }: { project: DashboardProject }) {
  const analysed = formatTimestamp(project.lastAnalysedAt);

  if (project.scoreState === "scored" && project.score !== null) {
    const { tone } = scoreDisplay(project.score);

    return (
      <div className="flex flex-col gap-1">
        <MonoLabel>Business Signal</MonoLabel>
        <p className="flex items-baseline gap-1.5">
          <span
            className={cn("font-mono text-display leading-none tabular-nums", statusToneText(SCORE_TONE[tone]))}
          >
            {project.score}
          </span>
          <span className="text-fg-meta font-mono text-ui">/ 100</span>
        </p>
        {analysed && <p className="text-fg-meta font-mono text-meta">Analysed {analysed}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <MonoLabel>Business Signal</MonoLabel>
      {/*
        A sentence where the number would be, at the same weight as the rest of
        the card rather than at the number's size — nothing here is a reading.
      */}
      <p className="text-fg-secondary text-sm">
        {project.scoreState === "insufficient_coverage"
          ? "Not enough evidence to score"
          : "Not analysed yet"}
      </p>
    </div>
  );
}

export function ProductCard({ project }: { project: DashboardProject }) {
  const action = primaryAction(project);

  return (
    <Surface
      as="article"
      level="panel"
      padding="lg"
      className="flex h-full flex-col gap-6"
      data-testid="product-card"
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className={cn(
            "bg-surface-hover text-fg-body ring-line-4 flex size-10 shrink-0 items-center",
            "justify-center rounded-well font-mono text-ui ring-1",
          )}
        >
          {initialsFrom(project.name)}
        </span>
        <h3 className="text-fg min-w-0 truncate text-base font-semibold" title={project.name}>
          {project.name}
        </h3>
      </div>

      <ScoreReading project={project} />

      <div className="flex flex-col gap-1">
        <MonoLabel>Next move</MonoLabel>
        {/*
          The Move's own title, or a sentence about Vibe. Null covers two
          different states and the count tells them apart: a set that has never
          been generated, and one that came back empty.
        */}
        <p className="text-fg-prose line-clamp-2 text-sm leading-relaxed">
          {project.topMove?.title ??
            (project.nextMovesCount === null
              ? "Vibe hasn't worked out what to do next yet."
              : "Nothing waiting right now.")}
        </p>
      </div>

      <div className="mt-auto">
        <Link
          href={action.href}
          className={buttonClasses({ variant: action.accent ? "primary" : "secondary", size: "sm" })}
        >
          {action.label}
        </Link>
      </div>
    </Surface>
  );
}
