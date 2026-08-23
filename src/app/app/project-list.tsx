import Link from "next/link";
import { statusToneText, type StatusTone } from "@/components/ui/status-pill";
import { scoreDisplay, type ScoreTone } from "@/components/ui/score-display";
import { buttonClasses } from "@/components/ui/button";
import { StatusDot } from "@/components/ui/status-pill";
import { Surface } from "@/components/ui/surface";
import { MonoLabel } from "@/components/ui/typography";
import type { DashboardProject } from "@/modules/projects/dashboard";

/**
 * A project as a business object (Sprint UI-3).
 *
 * UI-0 migrated this row and could only show a name and a repository, because
 * that was all the old project-list query returned. The dashboard read model
 * now supplies the score and the counts, so the row can say what state the
 * *business* is in rather than what the repository is called.
 *
 * There is no "last activity" column: see `dashboard.ts` for why a per-project
 * timestamp could not be read honestly without an N+1.
 *
 * ## Two rules it holds
 *
 * - **`null` is never `0`.** A project that was never audited says "Not
 *   analysed"; one that was audited but had too little evidence says so
 *   separately. Neither becomes a zero, and neither is styled as a bad score.
 * - **The action follows the state.** A project with a prepared change offers
 *   to review it; one with moves offers to review those; one never analysed
 *   offers the audit. Only where nothing is pending does it fall back to
 *   "Open". This is presentation choosing a destination, not a decision engine.
 */

/** Which status tone a score band reads as. */
const SCORE_TONE: Record<ScoreTone, StatusTone> = {
  strong: "success",
  partial: "waiting",
  weak: "problem",
  unscored: "neutral",
};

function projectScore(project: DashboardProject): { value: string; mono: boolean; tone: string } {
  if (project.scoreState === "scored" && project.score !== null) {
    // The bands live in `score-display.ts` and were re-derived here as two
    // magic numbers. One of the two would eventually have moved (UI-6 §8).
    const { tone } = scoreDisplay(project.score);
    return { value: `${project.score}`, mono: true, tone: statusToneText(SCORE_TONE[tone]) };
  }
  if (project.scoreState === "insufficient_coverage") {
    // Vibe looked and could not say. A different sentence from "never looked",
    // and neither of them is a number.
    return { value: "Not enough evidence", mono: false, tone: statusToneText("neutral") };
  }
  return { value: "Not analysed", mono: false, tone: statusToneText("neutral") };
}

/** The most useful destination given what is actually pending. */
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
    return { label: "Analyse project", href: `${base}/health`, accent: true };
  }
  return { label: "Open", href: base, accent: false };
}

export function ProjectRow({ project }: { project: DashboardProject }) {
  const score = projectScore(project);
  const action = primaryAction(project);
  const connected = project.repositoryFullName !== null;

  return (
    <li>
      <Surface
        as="article"
        level="section"
        padding="none"
        className="hover:border-line-4 transition-[border-color] duration-150"
      >
        <div className="flex flex-wrap items-center gap-x-8 gap-y-4 p-5 sm:p-6">
          <div className="flex min-w-0 flex-[2] items-center gap-3.5">
            <StatusDot tone={connected ? "active" : "neutral"} />
            <div className="flex min-w-0 flex-col gap-1">
              <h3 className="text-fg truncate text-base font-semibold tracking-[-0.02em]">
                {project.name}
              </h3>
              <p className="text-fg-muted truncate font-mono text-xs">
                {project.repositoryFullName ?? "No repository connected"}
              </p>
            </div>
          </div>

          <div className="flex flex-none flex-col gap-1">
            <MonoLabel className="tracking-[0.14em]">Business score</MonoLabel>
            <span
              className={`${score.tone} ${score.mono ? "font-mono text-xl font-bold tabular-nums" : "text-sm"}`}
            >
              {score.value}
              {score.mono && <span className="text-fg-muted text-xs font-normal"> / 100</span>}
            </span>
          </div>

          <div className="flex flex-none flex-col gap-1">
            <MonoLabel className="tracking-[0.14em]">Waiting</MonoLabel>
            <span className="text-fg-body text-sm">
              {/* Counts are shown only where there is something to count. A
                  row of zeroes is noise, and "0 moves" reads as a problem. */}
              {[
                project.nextMovesCount ? `${project.nextMovesCount} moves` : null,
                project.preparedCount ? `${project.preparedCount} prepared` : null,
              ]
                .filter(Boolean)
                .join(" · ") || <span className="text-fg-meta">Nothing pending</span>}
            </span>
          </div>

          <div className="ml-auto flex-none">
            <Link
              href={action.href}
              className={buttonClasses({
                variant: action.accent ? "accent" : "secondary",
                size: "sm",
              })}
            >
              {action.label}
              <span className="sr-only"> — {project.name}</span>
            </Link>
          </div>
        </div>
      </Surface>
    </li>
  );
}
