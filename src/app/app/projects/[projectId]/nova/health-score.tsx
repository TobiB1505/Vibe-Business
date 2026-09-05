import Link from "next/link";
import { CoverageLine } from "@/components/system/confidence";
import { Surface } from "@/components/ui/surface";
import { scoreDisplay } from "@/components/ui/score-display";
import { MonoLabel } from "@/components/ui/typography";
import { cn } from "@/lib/utils/cn";

/**
 * The business reading, small (UI Sourcing Spec C6).
 *
 * ## What Home shows of it, and what it does not
 *
 * The number, what the number covers, and a way through to the map. Not the
 * nine lenses, not the priority stack, not the evidence trails — those are
 * Business Health's, and repeating them here would make Home a second, smaller
 * version of the page it should be sending the founder to.
 *
 * ## The rule this component exists to keep
 *
 * A `null` score is not a zero. `scoreDisplay` is the one function that knows
 * the difference, and an unscored reading renders as `—` with the sentence
 * explaining why — `insufficientCoverageReason`, which the audit found
 * computed by the scorer and rendered nowhere, leaving the founder with a dash
 * and no account of it.
 *
 * There is no ring and no bar. A filled arc reads as a percentage of work
 * done, and this is a score: the Business Brain's centre is the one place in
 * the product that draws one.
 */
export function HealthScore({
  score,
  stateLabel,
  scoredLenses,
  eligibleLenses,
  insufficientCoverageReason,
  healthHref,
  className,
}: {
  score: number | null;
  /** The audit's own word for the reading. Never re-derived here. */
  stateLabel: string;
  scoredLenses: number;
  eligibleLenses: number;
  insufficientCoverageReason?: string | null;
  healthHref: string;
  className?: string;
}) {
  const display = scoreDisplay(score, { unscoredText: "—" });

  return (
    <Surface
      as="section"
      // A real labelled region rather than a bare panel: the heading names it,
      // so the score and its coverage are reachable as one thing by anyone
      // navigating by landmark.
      aria-labelledby="nova-health"
      level="section"
      padding="md"
      className={cn("flex flex-col gap-3", className)}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <MonoLabel as="h2" id="nova-health">
          Business health
        </MonoLabel>
        <Link
          href={healthHref}
          className="text-fg-muted hover:text-fg-body text-ui underline underline-offset-4 transition-interactive"
        >
          See the nine areas
        </Link>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span
          className={cn(
            "text-fg text-display leading-none font-bold tabular-nums",
            display.unscored && "text-fg-muted",
          )}
        >
          {display.text}
        </span>
        <span className="text-fg-prose text-sm">{stateLabel}</span>
      </div>

      {/*
        When there is no score the reason takes the slot, because "scored 0 of
        9 areas" is a coverage count nobody asked for and the founder's actual
        question is why the number is missing.
      */}
      <CoverageLine
        scored={scoredLenses}
        eligible={eligibleLenses}
        reason={display.unscored ? (insufficientCoverageReason ?? null) : null}
      />
    </Surface>
  );
}

/**
 * What Home shows where no audit has ever run.
 *
 * Deliberately not a score of zero and not an error. A project that has not
 * been audited has no reading, and the honest thing is to say so and name the
 * one thing that would change it.
 */
export function HealthScoreAbsent({
  healthHref,
  className,
}: {
  healthHref: string;
  className?: string;
}) {
  return (
    <Surface
      as="section"
      aria-labelledby="nova-health-absent"
      level="section"
      padding="md"
      className={cn("flex flex-col gap-2", className)}
    >
      <MonoLabel as="h2" id="nova-health-absent">
        Business health
      </MonoLabel>
      <p className="text-fg-prose text-sm">
        Vibe has not audited this product yet, so there is no reading to show.
      </p>
      <Link
        href={healthHref}
        className="text-fg-muted hover:text-fg-body self-start text-ui underline underline-offset-4 transition-interactive"
      >
        Go to Business Health
      </Link>
    </Surface>
  );
}
