import { VibeMark } from "@/components/brand/vibe-mark";
import { MarketingShell } from "@/components/layout/marketing-shell";
import { LandingAgent } from "@/components/marketing/landing-agent";
import { LandingBoundary } from "@/components/marketing/landing-boundary";
import { LandingBusinessMap } from "@/components/marketing/landing-business-map";
import { LandingMove } from "@/components/marketing/landing-move";
import { LandingFlow } from "@/components/marketing/landing-flow";
import { LandingHeroDeck } from "@/components/marketing/landing-hero-deck";
import { LandingNova } from "@/components/marketing/landing-nova";
import { LandingPrice } from "@/components/marketing/landing-price";
import { LandingOutcome } from "@/components/marketing/landing-outcome";
import { LandingProblem } from "@/components/marketing/landing-problem";
import { LandingScan } from "@/components/marketing/landing-scan";
import { LandingTrust } from "@/components/marketing/landing-trust";
import { Reveal } from "@/components/marketing/reveal";
import { MarketingCta } from "@/components/marketing/marketing-cta";
import { ArrowRightIcon } from "@/components/ui/dashboard-icons";
import { MonoLabel } from "@/components/ui/typography";

export default function HomePage() {
  return (
    <MarketingShell>
      {/*
        Every block below the hero arrives as it is scrolled to, and the server
        renders them hidden. This is what a reader with JavaScript switched off
        sees instead of nothing — see `Reveal`, whose reduced-motion half of the
        same guarantee is a media query in `globals.css`.
      */}
      <noscript>
        <style>
          {"[data-reveal]{opacity:1!important;transform:none!important}" +
            "[data-gate-leaf]{transform:translateX(var(--gate-part,0%))!important}"}
        </style>
      </noscript>

      {/*
        The hero is the deck, and it carries the whole claim: eyebrow, headline,
        promise, the one action and the two assurances, on one object standing
        on its own lit ground. Chosen from four hero shapes built from scratch
        and compared at 1440 and 390 — see `LandingHeroDeck`.

        It is deliberately not wrapped in `Reveal`. A landing page whose first
        screen fades in is a landing page that is briefly blank, and the thing a
        reveal says — *this is the block you are on now* — is not worth saying
        about the block everybody starts on.
      */}
      <section id="top">
        <LandingHeroDeck />
      </section>

      {/*
        Before the product, the gap it exists in. The page used to go from the
        claim straight to a preview of the Business Brain — *here is the thing*
        ahead of *here is why you would want a thing* — and every block after it
        was another feature at the same rhythm.

        `LandingProblem` brings its own reveals rather than being wrapped in
        one, because its two halves arrive from opposite sides and the list
        staggers. That is the exception; everything else on this page is one
        block, one arrival.
      */}
      <LandingProblem />

      {/*
        Step one, and the first thing the gap's questions get answered by.
        Brings its own two reveals — the object from one side, the argument
        from the other.
      */}
      <LandingScan />

      {/*
        Step two, and the radial map is deliberately not here.

        `LandingBusinessBrain` drew all nine areas as one picture, which is the
        right shape in the product — where they are looked at together and the
        relationships between them are the point — and the wrong one on a page
        a stranger is scrolling. `LandingBusinessMap` unrolls the same nine
        orbs down the scroll, one to a tread, so each is read rather than
        decoded.
      */}
      <LandingBusinessMap />

      {/*
        Step three, and the narrowing the two above it were building to. Its
        card came out of `LandingFlow`'s *Prioritize* tab rather than being
        copied from it — the same dissolution the Product Scan started.
      */}
      <LandingMove />

      {/*
        Step four, and the one a founder is actually deciding about: whether a
        machine gets near the branch they ship from. Its panels came out of
        `LandingFlow`'s *Execute* tab, the third step to leave the tab bar.
      */}
      <LandingAgent />

      {/*
        Step five, and the one that is not about mechanism: who says all of
        this. It closes the walk's first half — four blocks explaining what
        Vibe does, and then the voice they arrive in.

        `Reveal` is not wrapped around it, and around none of the numbered
        steps: each block reveals its own parts as they are reached, and a
        reveal around the whole of a block two thousand pixels tall waits for
        its top and then hands over a page that has already been scrolled past.
      */}
      <LandingNova />

      {/*
        Step six, and the end of the loop the walk has been following: what
        Vibe says once a change has landed, and the two rungs above it that it
        will not climb without evidence. Its panel came out of `LandingFlow`'s
        *Measure* tab, the fourth step to leave the tab bar.
      */}
      <LandingOutcome />

      {/*
        Step seven, and the objection every block above it postpones: a product
        that asks for the repository a company is built on has to say what it
        keeps. Its "no stored copy" tile came out of `LandingTrust`.
      */}
      <LandingBoundary />

      {/*
        Step eight, and the last of the walk's arguments: what any of it costs.
        Its "never a surprise charge" tile came out of `LandingTrust`; the plan
        table further down answers a different question — what a month costs —
        and stays where it is.
      */}
      <LandingPrice />

      <Reveal className="pb-16 sm:pb-20">
        <div className="mt-12 flex flex-col items-center gap-3">
          <MonoLabel>Built for products made with</MonoLabel>
          <div className="text-fg-secondary flex flex-wrap justify-center gap-x-6 gap-y-2 text-body font-semibold">
            {["Cursor", "Replit", "Lovable", "Bolt", "Claude Code", "Codex"].map((tool) => (
              <span key={tool}>{tool}</span>
            ))}
          </div>
        </div>
      </Reveal>

      <Reveal>
        <div className="border-line-1 flex flex-col items-center gap-5 border-y py-7">
          <MonoLabel>Works with your stack</MonoLabel>
          <div className="flex flex-wrap justify-center gap-2.5">
            {["GitHub", "Next.js", "Stripe", "Vercel", "Supabase"].map((tool) => (
              <span
                key={tool}
                className="border-line-2 bg-surface-2 text-fg-secondary rounded-nav border px-4 py-2 text-body font-medium"
              >
                {tool}
              </span>
            ))}
            <span className="border-line-1 text-fg-muted rounded-nav border px-4 py-2 text-body">
              + more
            </span>
          </div>
        </div>
      </Reveal>

      <Reveal>
        <LandingFlow />
      </Reveal>

      <Reveal>
        <LandingTrust />
      </Reveal>

      <Reveal>
        <section className="border-line-2 bg-surface-2 rounded-card relative mb-8 overflow-hidden border px-6 py-14 sm:px-12 sm:py-16">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 -left-24 size-80 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgb(0_229_160/0.16),transparent_68%)]"
          />
          <div className="relative grid gap-10 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center">
            <span className="business-brain-core flex size-28 items-center justify-center rounded-full">
              <VibeMark size={46} />
            </span>
            <div>
              <h2 className="text-fg text-[clamp(2rem,4vw,3.25rem)] leading-[1.04] font-bold tracking-[-0.045em]">
                From product to business, together.
              </h2>
              <p className="text-fg-prose mt-3 max-w-[52ch] leading-relaxed">
                Bring the product you already built. Vibe will show you what matters next.
              </p>
            </div>
            <MarketingCta href="/signup" assurance="No credit card to start">
              Start for free <ArrowRightIcon size={17} />
            </MarketingCta>
          </div>
        </section>
      </Reveal>
    </MarketingShell>
  );
}
