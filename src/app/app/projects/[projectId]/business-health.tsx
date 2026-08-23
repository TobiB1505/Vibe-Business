import { scoreDisplay, type ScoreTone } from "@/components/ui/score-display";
import { Surface } from "@/components/ui/surface";
import { MonoLabel } from "@/components/ui/typography";
import {
  DIMENSION_QUESTIONS,
  type BusinessReadinessAudit,
} from "@/modules/business-audit/schema";
import { cn } from "@/lib/utils/cn";

/**
 * The five scored dimensions, as readings (CORE-5).
 *
 * ## Why these came back
 *
 * Sprint UI-1.2 removed a collapsed technical breakdown of these five from the
 * audit screen, on the argument that "a page that offers two answers has not
 * made one" — the nine business lenses had become the judgment layer, and the
 * dimensions were competing with them for the same job.
 *
 * That argument was about a *second verdict*. CORE-5 puts them back as
 * something else: readings, below the conclusion and below the map, answering
 * "how is each part of this doing" rather than "what should I conclude". The
 * conclusion is still made once, at the top, by the synthesis. Nothing here
 * re-ranks, re-weights or re-scores anything — the numbers are the audit's own
 * and the order is the audit's own.
 *
 * ## The rule that governs every row
 *
 * A dimension the evidence could not support scores `null`. It is excluded
 * from the average, it is never counted as zero, and — the part that matters
 * on screen — it is never *drawn* as zero either. An empty track with a "0"
 * beside it says the business scored badly; an empty track saying "n/a" says
 * nothing was measurable. `scoreDisplay` is what keeps those apart, and it is
 * the only thing here allowed to turn a number into a width (CLAUDE.md rule
 * 44, ARCHITECTURE.md §3.4).
 *
 * The labels are `DIMENSION_QUESTIONS` — "Can you make money from it?" rather
 * than "Monetization: 28". The dimensions keep their real identities and are
 * not relabelled into other business vocabulary, because renaming a scored
 * axis would misreport what was actually measured.
 */

const TONE_CLASSES: Record<ScoreTone, string> = {
  strong: "bg-mint",
  partial: "bg-amber",
  weak: "bg-coral",
  // No fill at all. An unscored dimension has an empty track, and the word
  // beside it — not the absence of colour — is what says so.
  unscored: "bg-transparent",
};

export function BusinessHealth({ audit }: { audit: BusinessReadinessAudit }) {
  if (audit.dimensions.length === 0) return null;

  return (
    <Surface level="panel" padding="lg" className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <MonoLabel as="h3">How each part is doing</MonoLabel>
        <p className="text-fg-muted max-w-[62ch] text-sm">
          Five readings behind the conclusion above. An area Vibe could not
          assess has no reading — that is a limit on the evidence, not a low result.
        </p>
      </div>

      <ul className="flex flex-col gap-4">
        {audit.dimensions.map((dimension) => {
          const display = scoreDisplay(dimension.score);
          const question = DIMENSION_QUESTIONS[dimension.id] ?? dimension.label;

          return (
            <li key={dimension.id} className="flex flex-col gap-2">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="text-fg-body text-sm font-medium">{question}</span>
                <span
                  className={cn(
                    "shrink-0 font-mono text-ui tabular-nums",
                    display.unscored ? "text-fg-muted" : "text-fg-body",
                  )}
                >
                  {/*
                    `display.text` is "n/a" for an unscored dimension and the
                    number for a scored one. The suffix is attached only to a
                    real number, so nothing ever reads "n/a / 100".
                  */}
                  {display.text}
                  {!display.unscored && <span className="text-fg-meta"> / 100</span>}
                </span>
              </div>

              <div
                // Decorative: the figure above says the same thing in text, so
                // the bar carries no information of its own.
                aria-hidden
                className="bg-line-track h-1 w-full overflow-hidden rounded-full"
              >
                <div
                  className={cn("h-full rounded-full", TONE_CLASSES[display.tone])}
                  style={{ width: `${display.fillPercent}%` }}
                />
              </div>

              {display.unscored && (
                <p className="text-fg-muted text-ui">
                  Vibe didn&apos;t find enough to judge this one.
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </Surface>
  );
}
