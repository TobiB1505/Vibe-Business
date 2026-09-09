import { LandingStep } from "@/components/marketing/landing-step";
import { Reveal } from "@/components/marketing/reveal";
import { FindingCard } from "@/components/system/finding-card";
import { StatusPill } from "@/components/ui/status-pill";
import { MonoLabel } from "@/components/ui/typography";
import { cn } from "@/lib/utils/cn";
import { LENS_LABELS } from "@/modules/business-audit/map-view";
import type { BusinessLens } from "@/modules/business-audit/schema";

/**
 * The Move: nine findings, one thing to do next (UI-34).
 *
 * ## The shape is the argument
 *
 * Every module block on this page has to make its point as a picture before
 * anybody reads a word, and each has to do it differently or the scroll becomes
 * one rhythm. Step one is two tiles — a thing and an explanation. Step two is a
 * staircase — nine of something, walked. This one is a **narrowing**: several
 * candidates receding above, and one of them sharp and full size below.
 *
 * That is what "prioritized" means, and it is the whole difference between Vibe
 * and a report. A report hands a founder nine findings and calls the ranking
 * their job. This block shows the ranking happening.
 *
 * ## Why the losers are on screen at all
 *
 * Because a single card would be a claim with nothing behind it. The three
 * above it are the ones Vibe did *not* pick, each carrying the reason it ranks
 * lower — which is the only way "one prioritized move" reads as a judgement
 * rather than as a product that found exactly one thing.
 *
 * They recede rather than shrink: same width, falling opacity, drawn behind. A
 * stack of smaller cards would read as a hierarchy of importance among
 * themselves, and their order below the winner is not something Vibe publishes.
 *
 * ## The sentence that is also the sale
 *
 * A Move is a **proposal**. Rule 54 of this repository says model output is an
 * opinion and never authority — `executionReadiness` is a signal, not a licence
 * — and the block says so in the words a founder cares about: nothing runs, no
 * branch is touched, until they say. The strongest thing this page can claim is
 * the thing the architecture already enforces.
 *
 * ## Where the card came from
 *
 * `LandingFlow`'s *Prioritize* tab, moved rather than copied — the same
 * dissolution the Product Scan started. It is the product's own `FindingCard`
 * on `variant="priority"`, so a landing page cannot show a shape the app
 * cannot produce, and `lead="why"` because a ranked finding is read for
 * consequence first.
 */

/** The three Vibe did not pick, and why each ranks below the one it did. */
const RUNNERS_UP: { lens: BusinessLens; finding: string; why: string }[] = [
  {
    lens: "measurement",
    finding: "Nothing is recording what visitors do.",
    why: "Worth fixing, but it changes nothing on its own",
  },
  {
    lens: "retention",
    finding: "No reason to come back is stated anywhere.",
    why: "Matters after people arrive and pay",
  },
  {
    lens: "acquisition",
    finding: "The site does not say who it is for.",
    why: "Cheaper to fix once the offer is decided",
  },
];

export function LandingMove() {
  return (
    <LandingStep index="03" id="move" labelledBy="move-heading" className="py-20 sm:py-28">
      <Reveal from="up">
        <div className="flex flex-col gap-5">
          <MonoLabel className="text-mint">The Move</MonoLabel>
          <h2
            id="move-heading"
            className="text-fg max-w-[22ch] text-[clamp(2rem,3.6vw,3rem)] leading-[1.06] font-bold tracking-[-0.045em] text-balance"
          >
            Nine findings. One thing to do next.
          </h2>
          <p className="text-fg-prose max-w-[58ch] leading-relaxed">
            A report hands you everything it found and calls the ranking your job. Vibe ranks it —
            by what it costs you to leave alone — and shows what it set aside to get there.
          </p>
        </div>
      </Reveal>

      {/*
        The narrowing, drawn. Three candidates receding, then the one that won,
        at full size and full contrast. The stack is `aria-hidden`-free on
        purpose: these are real sentences a reader may want, not decoration.
      */}
      <div className="relative mx-auto mt-16 w-full max-w-3xl sm:mt-20">
        <ol className="flex flex-col gap-3">
          {RUNNERS_UP.map(({ lens, finding, why }, index) => (
            <li key={lens}>
              <Reveal from="up" delay={index * 0.07}>
                <div
                  /*
                    Falling opacity, constant width. Shrinking them would read as
                    a ranking *among themselves*, and the order Vibe puts these
                    three in below the winner is not something it publishes.

                    The floor is set by measurement, not by taste. At
                    0.72 → 0.40 the third row's text rendered at 105,116,114 on
                    an 8,10,12 ground — **4.10:1**, under AA for body text, on a
                    sentence this block's own docblock argues is content rather
                    than decoration. 0.82 → 0.60 clears it.
                  */
                  style={{ opacity: 0.82 - index * 0.11 }}
                  className={cn(
                    "border-line-2 bg-surface-2 rounded-card flex flex-col gap-2 border px-5 py-4",
                    "sm:flex-row sm:items-center sm:justify-between sm:gap-6",
                  )}
                >
                  <span className="flex min-w-0 flex-col gap-1">
                    <MonoLabel as="span" className="text-fg-meta">
                      {LENS_LABELS[lens]}
                    </MonoLabel>
                    <span className="text-fg-body text-body">{finding}</span>
                  </span>
                  <span className="text-fg-muted shrink-0 text-caption">{why}</span>
                </div>
              </Reveal>
            </li>
          ))}
        </ol>

        <Reveal from="up" delay={0.24} className="mt-8">
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <StatusPill tone="problem">Ranked first</StatusPill>
              <span className="text-fg-muted text-caption">
                Because it is the one costing you money today
              </span>
            </div>

            {/*
              The product's own card, with the product's own vocabulary: a
              severity, a confidence that says what kind of confidence it is,
              and a citation naming where the observation came from.
            */}
            <FindingCard
              variant="priority"
              rank={1}
              lead="why"
              title="Decide how customers pay"
              explanation="Vibe found a payments library in your code and no reachable checkout on your site."
              whyItMatters="Every visitor who wanted to buy today could not, and nothing on the page told them why."
              severity="critical"
              confidence={{ kind: "judgment", level: "high" }}
              citations={[
                {
                  detail: "Checkout was not reachable from any page Vibe visited.",
                  source: "Your live site",
                },
              ]}
            />
          </div>
        </Reveal>

        <Reveal from="up" delay={0.3} className="mt-6">
          <p className="text-fg-muted mx-auto max-w-[56ch] text-center text-caption leading-relaxed">
            A Move is a proposal. Vibe does not start it, touch a branch or spend anything until you
            say so — and it tells you what it would cost before you do.
          </p>
        </Reveal>
      </div>
    </LandingStep>
  );
}
