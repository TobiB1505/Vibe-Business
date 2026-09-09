import Link from "next/link";
import { VibeMark } from "@/components/brand/vibe-mark";
import { MarketingShell } from "@/components/layout/marketing-shell";
import { LandingAgent } from "@/components/marketing/landing-agent";
import { LandingBusinessMap } from "@/components/marketing/landing-business-map";
import { LandingMove } from "@/components/marketing/landing-move";
import { LandingFlow } from "@/components/marketing/landing-flow";
import { LandingHeroDeck } from "@/components/marketing/landing-hero-deck";
import { LandingNova } from "@/components/marketing/landing-nova";
import { LandingProblem } from "@/components/marketing/landing-problem";
import { LandingScan } from "@/components/marketing/landing-scan";
import { LandingTrust } from "@/components/marketing/landing-trust";
import { Reveal } from "@/components/marketing/reveal";
import { buttonClasses } from "@/components/ui/button";
import { MarketingCta } from "@/components/marketing/marketing-cta";
import { ArrowRightIcon, CheckIcon } from "@/components/ui/dashboard-icons";
import { MonoLabel } from "@/components/ui/typography";
import { listPlans, WELCOME_CREDIT_UNITS } from "@/modules/billing/catalog";
import { formatCreditsForDisplay } from "@/modules/credits/units";

const PLAN_FEATURES: Record<string, string[]> = {
  free: ["100 Welcome Credits", "No recurring monthly grant", "Start with one product"],
  builder: [
    "1,000 Credits each paid month",
    "Credits tracked in one ledger",
    "Add extra Credits when needed",
  ],
  pro: [
    "3,000 Credits each paid month",
    "Credits tracked in one ledger",
    "Add extra Credits when needed",
  ],
};

export default function HomePage() {
  const plans = listPlans();

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

      {/*
        Nova, immediately after the hero that names her — before the flow,
        because "who is doing this" comes before "how does it work".
      */}
      <Reveal>
        <LandingNova />
      </Reveal>

      <Reveal>
        <LandingFlow />
      </Reveal>

      <Reveal>
        <LandingTrust />
      </Reveal>

      <Reveal>
        <section
          id="pricing"
          aria-labelledby="pricing-heading"
          className="border-line-1 scroll-mt-24 border-t py-20 sm:py-28"
        >
          <div className="mx-auto flex max-w-3xl flex-col items-center gap-5 text-center">
            <MonoLabel className="text-mint">Simple plans</MonoLabel>
            <h2
              id="pricing-heading"
              className="text-fg text-[clamp(2.25rem,4vw,3.5rem)] leading-[1.04] font-bold tracking-[-0.045em] text-balance"
            >
              Start free. Add capacity when the work grows.
            </h2>
            <p className="text-fg-prose max-w-[60ch] leading-relaxed">
              Plans use Vibe Credits for AI work. Paid plans add a fresh Credit grant after each
              successfully paid month.
            </p>
          </div>

          <div className="mt-12 grid gap-4 lg:grid-cols-3">
            {plans.map((plan) => {
              const featured = plan.key === "builder";
              const credits = formatCreditsForDisplay(
                plan.key === "free" ? WELCOME_CREDIT_UNITS : plan.monthlyCreditUnits,
              );

              return (
                <article
                  key={plan.key}
                  className={`rounded-card flex flex-col border p-6 sm:p-7 ${
                    featured
                      ? "border-mint-line bg-mint-tint/35 shadow-mint"
                      : "border-line-2 bg-surface-2"
                  }`}
                >
                  <div className="flex items-center justify-between gap-4">
                    <h3 className="text-fg text-title font-semibold">{plan.name}</h3>
                    {featured && (
                      <span className="text-mint rounded-full border border-mint-line bg-mint-tint px-3 py-1 text-caption font-semibold">
                        For active builders
                      </span>
                    )}
                  </div>
                  <p className="text-fg mt-7 text-display font-bold">
                    {plan.priceCents === 0 ? "€0" : `€${plan.priceCents / 100}`}
                    <span className="text-fg-muted ml-2 text-body font-normal tracking-normal">
                      / month
                    </span>
                  </p>
                  <p className="text-fg-secondary mt-3 text-body">
                    {credits}{" "}
                    {plan.key === "free" ? "Welcome Credits once" : "Credits each paid month"}
                  </p>
                  <ul className="my-7 flex flex-col gap-3">
                    {PLAN_FEATURES[plan.key]?.map((feature) => (
                      <li key={feature} className="text-fg-body flex items-start gap-3 text-body">
                        <CheckIcon className="text-mint mt-0.5 shrink-0" size={15} />
                        {feature}
                      </li>
                    ))}
                  </ul>
                  <Link
                    /*
                     * A paid plan's button carries where it was going.
                     *
                     * Every card sent a visitor to `/signup` and no further, so
                     * someone who had just chosen Builder arrived signed in with
                     * nothing on screen about paying and no route named. `next`
                     * is read and sanitized once, in `signup/page.tsx`, and the
                     * free plan keeps the plain destination because there is
                     * nothing to pay for.
                     */
                    href={
                      plan.key === "free"
                        ? "/signup"
                        : `/signup?next=${encodeURIComponent("/app/settings/billing")}`
                    }
                    className={`${buttonClasses({
                      variant: featured ? "primary" : "secondary",
                    })} mt-auto w-full`}
                  >
                    Start with {plan.name} <ArrowRightIcon size={15} />
                  </Link>
                </article>
              );
            })}
          </div>
        </section>
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
