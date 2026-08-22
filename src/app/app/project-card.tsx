import Link from "next/link";
import { statusToneText, type StatusTone } from "@/components/ui/status-pill";
import { scoreDisplay, type ScoreTone } from "@/components/ui/score-display";
import { buttonClasses } from "@/components/ui/button";
import { Sparkline } from "@/components/ui/sparkline";
import { StatusDot } from "@/components/ui/status-pill";
import { Surface } from "@/components/ui/surface";
import { MonoLabel } from "@/components/ui/typography";
import type { DashboardProject } from "@/modules/projects/dashboard";

/**
 * A project as a business object (Sprint UI-3, rebuilt as a card in UI-8).
 *
 * ## Why a card and not the row it was
 *
 * `ProjectRow` laid the name, the score, the counts and the action out
 * horizontally. That reads fine with one project and falls apart with four:
 * every value competes with the same value one row down, the score — the
 * number this whole product exists to move — is the same size as a repository
 * path, and nothing groups a project's facts into a project.
 *
 * A card puts one project's facts inside one boundary and lets the grid do the
 * comparing. It also has room for the thing a row never had: which way the
 * score is going.
 *
 * ## Three rules it holds
 *
 * - **`null` is never `0`.** A project that was never audited says "Not
 *   analysed"; one that was audited but had too little evidence says so
 *   separately. Neither becomes a zero, and neither is styled as a bad score.
 * - **A trend needs two scores.** One audit renders no line and no delta —
 *   see `buildScoreHistory`. A flat line beside a single measurement is a
 *   claim that nothing changed.
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
    return { label: "Review change", href: `${base}/prepared`, accent: false };
  }
  if (project.nextMovesCount !== null && project.nextMovesCount > 0) {
    return { label: "Review moves", href: `${base}/moves`, accent: false };
  }
  if (project.scoreState === "not_audited") {
    return { label: "Analyse project", href: `${base}/score`, accent: true };
  }
  return { label: "Open", href: base, accent: false };
}

/**
 * The score's direction, as a sentence with a line beside it.
 *
 * ## Why a fall is amber and not coral
 *
 * Coral is reserved across this product for failure — a validation that did
 * not pass, a merge that was refused, a real gap. A business score that went
 * down is not a failure; it is something that needs looking at, which is what
 * amber has always meant here. Spending the failure colour on a trend would
 * make the two indistinguishable on the one screen that shows both.
 *
 * Renders nothing when the domain produced no delta. There is no third state
 * where a trend is drawn without a number to read.
 */
function ScoreTrend({ history, delta }: { history: number[]; delta: number | null }) {
  if (delta === null) return null;

  const tone = delta > 0 ? "text-mint" : delta < 0 ? "text-amber" : "text-fg-meta";
  const sign = delta > 0 ? "+" : "";
  const wording =
    delta === 0 ? "Unchanged since the last audit" : `${sign}${delta} since the last audit`;

  return (
    // Wrapped in a fixed-width box rather than passing `w-16` to the sparkline:
    // `cn` is a plain join with no conflict resolution, so a width on the
    // caller and the component's own `w-full` would both land in the class
    // list and the stylesheet would decide. `flex-wrap` lets the sentence drop
    // to its own line on a narrow card instead of running off the edge.
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${tone}`}>
      <span className="w-16 shrink-0">
        <Sparkline values={history} />
      </span>
      <span className="font-mono text-meta tabular-nums">{wording}</span>
    </div>
  );
}

export function ProjectCard({ project }: { project: DashboardProject }) {
  const score = projectScore(project);
  const action = primaryAction(project);
  const connected = project.repositoryFullName !== null;

  // Counts are shown only where there is something to count. A row of zeroes
  // is noise, and "0 moves" reads as a problem.
  const pending = [
    project.nextMovesCount ? `${project.nextMovesCount} moves` : null,
    project.preparedCount ? `${project.preparedCount} prepared` : null,
  ].filter(Boolean);

  return (
    <li>
      <Surface
        as="article"
        level="section"
        padding="none"
        // Level 2, not 3. A card surface is for the one primary object on a
        // view, and a grid of twelve of them is the "card inside card inside
        // card" the hierarchy exists to prevent (`surface.tsx`).
        className="hover:border-line-4 flex h-full flex-col gap-5 p-5 transition-[border-color] duration-150 sm:p-6"
      >
        <div className="flex min-w-0 items-start gap-3">
          <StatusDot tone={connected ? "active" : "neutral"} className="mt-1.5" />
          <div className="flex min-w-0 flex-col gap-1">
            <h3 className="text-fg truncate text-base font-semibold tracking-[-0.02em]">
              {project.name}
            </h3>
            <p className="text-fg-muted truncate font-mono text-xs">
              {project.repositoryFullName ?? "No repository connected"}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <MonoLabel className="tracking-[0.14em]">Business score</MonoLabel>
          <span
            className={`${score.tone} ${
              score.mono ? "font-mono text-display font-bold tabular-nums" : "text-sm"
            }`}
          >
            {score.value}
            {score.mono && <span className="text-fg-muted text-sm font-normal"> / 100</span>}
          </span>
          {/* Only where the latest audit actually produced a score. A trend
              printed under "Not enough evidence" would be describing numbers
              the card is not showing. */}
          {project.scoreState === "scored" && (
            <ScoreTrend history={project.scoreHistory} delta={project.scoreDelta} />
          )}
        </div>

        <div className="flex flex-col gap-2">
          <MonoLabel className="tracking-[0.14em]">Waiting</MonoLabel>
          {pending.length > 0 ? (
            <ul className="flex flex-wrap gap-2">
              {pending.map((label) => (
                <li
                  key={label}
                  className="bg-surface-hover text-fg-prose rounded-full px-2.5 py-0.5 font-mono text-meta"
                >
                  {label}
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-fg-meta text-sm">Nothing pending</span>
          )}
        </div>

        {/* `mt-auto` so the button sits on the card's floor whatever the rows
            above it measure — otherwise a project with no trend and no counts
            puts its action three lines higher than the card beside it. */}
        <div className="mt-auto pt-1">
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
      </Surface>
    </li>
  );
}
