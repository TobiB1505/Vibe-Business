import { VibeMark } from "@/components/brand/vibe-mark";
import { LandingStep } from "@/components/marketing/landing-step";
import { MarketingCta } from "@/components/marketing/marketing-cta";
import { Reveal } from "@/components/marketing/reveal";
import { GithubMark } from "@/components/brand/provider-marks";
import { MonoLabel } from "@/components/ui/typography";

/**
 * The close, and the end of the walk (UI-34).
 *
 * ## The tenth block is a bookend, on purpose
 *
 * Nine shapes, each different, because a long scroll with one rhythm stops
 * being read. This one repeats: an object on a lit ground with a sentence and
 * one control, which is the hero. The page opens on a card and closes on one,
 * and that is the only place a reprise belongs — a reader who has come nine
 * blocks knows where they are, and the thing to give them is the shape they
 * started at with what they have learned in it.
 *
 * It carries the mark rather than a picture of a screen: the last thing on the
 * page is the identity, and everything the product does has already been shown
 * above it.
 *
 * ## `last`, so the spine stops
 *
 * `LandingStep` draws the rail short on its final step, which is what makes
 * the numbered walk end rather than run off the bottom of the page. Nine
 * blocks of drawn line have been leading here.
 *
 * ## The closing sentence is the page's own voice
 *
 * *If there is nothing worth doing yet, Vibe will say that too.* Nothing else
 * in a call to action does that, which is exactly why it belongs in this one:
 * a page that has spent nine blocks refusing to overclaim cannot end by
 * overclaiming, and the honest note is also the memorable one.
 */
export function LandingClose() {
  return (
    <LandingStep index="10" id="start" last labelledBy="close-heading" className="py-20 sm:py-28">
      <Reveal from="up">
        <div className="border-line-2 bg-surface-2 rounded-card relative overflow-hidden border px-6 py-14 sm:px-12 sm:py-16">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 -left-24 size-80 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgb(0_229_160/0.16),transparent_68%)]"
          />

          <div className="relative flex flex-col items-center gap-8 text-center">
            <span className="business-brain-core flex size-28 items-center justify-center rounded-full">
              <VibeMark size={46} />
            </span>

            <div className="flex flex-col items-center gap-4">
              <MonoLabel className="text-mint">Start</MonoLabel>
              <h2
                id="close-heading"
                className="text-fg max-w-[18ch] text-[clamp(2rem,4vw,3.25rem)] leading-[1.04] font-bold tracking-[-0.045em] text-balance"
              >
                From product to business, together.
              </h2>
              <p className="text-fg-prose max-w-[52ch] leading-relaxed">
                Bring the product you already built. Vibe reads it, tells you where the business
                actually stands, and prepares the next step — with your approval before anything
                merges.
              </p>
            </div>

            <MarketingCta href="/signup" assurance="No credit card to start">
              <GithubMark size={19} />
              Start with GitHub
            </MarketingCta>

            {/*
              The last sentence on the page, and the one no other call to
              action would print. Nine blocks of refusing to overclaim cannot
              end in an overclaim.
            */}
            <p className="text-fg-muted max-w-[46ch] text-caption leading-relaxed">
              And if there is nothing worth doing yet, Vibe will say that too.
            </p>
          </div>
        </div>
      </Reveal>
    </LandingStep>
  );
}
