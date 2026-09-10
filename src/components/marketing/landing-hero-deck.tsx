"use client";

import { motion, useReducedMotion } from "motion/react";
import { GithubMark } from "@/components/brand/provider-marks";
import { MarketingCta } from "@/components/marketing/marketing-cta";
import { NovaPresence } from "@/components/nova/nova-presence";
import { BranchIcon, LockIcon } from "@/components/ui/dashboard-icons";
import { MonoLabel } from "@/components/ui/typography";
import { cn } from "@/lib/utils/cn";

/**
 * The landing hero: the sequence as depth (UI-34).
 *
 * ## What this replaced
 *
 * A centred column of type with the Business Brain below it. The claim and the
 * product were two separate things stacked, and neither was an object — a
 * visitor arrived at a headline floating on a page.
 *
 * Four hero shapes were built from scratch and compared at 1440 and 390 in the
 * v2 palette (`study-hero-shape`): a product window, a 55/45 split, this deck,
 * and a wide sill. The deck was chosen.
 *
 * ## Why a deck
 *
 * Vibe's sequence is Scan → Audit → Move, and a landing page has to say there
 * is more than one step without drawing three boxes side by side and asking
 * for a diagram to be read. Stacking them says it in one glance: two cards
 * cropped behind, the one that matters sharp in front. The front card is the
 * Move, which is the step a founder is actually buying.
 *
 * The two behind are `aria-hidden`. A screen reader meeting three stacked
 * headings would meet a sequence the page is *showing* rather than saying, and
 * the front card carries every word and every action that matters. `LandingFlow`
 * further down names the same three steps in text, so nothing is only visual.
 *
 * ## The ground
 *
 * `.landing-hero-field` in `globals.css` — a masked grid with a mint centre.
 * V2's surfaces are translucent films built to sit on the app's opaque ground,
 * so a card over a lit field lets the grid through and reads as a ghost;
 * `.landing-hero-card` composites the same film over `--color-ground` and gives
 * the deck something solid to be.
 *
 * ## Motion
 *
 * A Signature-tier entrance that settles once: the two behind arrive after the
 * front card so the depth resolves rather than appearing assembled. `initial`
 * is `false` under reduced motion, which renders every card at its `animate`
 * target directly — so the deck's geometry is identical either way, and what
 * reduced motion removes is the arrival, not the shape.
 */

const DECK = [
  { label: "Scan", line: "Repository and live product read." },
  { label: "Audit", line: "Nine business areas, scored against evidence." },
] as const;

/** How far each card behind the front one peeks out, in pixels. */
const PEEK = 40;

/**
 * The places a product gets built now.
 *
 * The founder's list, and it is a category rather than a roster: these are the
 * builder sites somebody arrives from, and the line after them says the list is
 * not exhaustive rather than pretending it is.
 */
const BUILDERS = ["Lovable", "Emergent", "v0", "Bolt", "Base44", "Replit"];

export function LandingHeroDeck() {
  const reduced = useReducedMotion();

  /*
    The hero holds a screen: `100dvh` minus the sticky nav, so the deck is
    vertically centred in what a visitor actually sees and the block below it
    starts below the fold — which makes the first scroll a deliberate move
    rather than an accident of where the content happened to end.
  */
  return (
    <div className="relative isolate flex min-h-[calc(100dvh-4.5rem)] flex-col justify-center py-8 sm:py-10">
      <div aria-hidden className="landing-hero-field pointer-events-none absolute inset-0 -z-10" />

      <div className="relative mx-auto w-full max-w-3xl" style={{ paddingTop: PEEK * 2 + 24 }}>
        {DECK.map((card, index) => (
          <motion.div
            key={card.label}
            aria-hidden
            /*
              The offsets are motion values rather than a `style` transform:
              a `motion.div` writes its own `transform`, so a static one in
              `style` is whatever the last write left behind. Under
              `initial={false}` motion renders the `animate` target directly,
              which is how reduced motion gets the identical geometry with no
              movement.
            */
            initial={
              reduced
                ? false
                : { opacity: 0, y: -(index + 1) * PEEK + 12, scale: 1 - (index + 1) * 0.05 }
            }
            animate={{
              opacity: index === 0 ? 0.7 : 0.35,
              y: -(index + 1) * PEEK,
              scale: 1 - (index + 1) * 0.05,
            }}
            transition={{ duration: 0.5, delay: 0.34 + index * 0.12, ease: [0.22, 0.61, 0.36, 1] }}
            style={{ top: PEEK * 2 + 24 }}
            className={cn(
              "border-line-2 landing-hero-card-back absolute inset-x-0 rounded-stage border px-8 py-3.5 max-sm:px-5",
              index === 0 ? "z-10" : "z-0",
            )}
          >
            <div className="flex items-center gap-3">
              <MonoLabel as="span" className="text-fg-meta">
                {card.label}
              </MonoLabel>
              <span className="text-fg-muted truncate text-caption">{card.line}</span>
            </div>
          </motion.div>
        ))}

        <motion.div
          initial={reduced ? false : { opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 0.61, 0.36, 1] }}
          className="border-line-3 landing-hero-card shadow-stage relative z-20 flex flex-col items-center gap-6 rounded-stage border px-10 py-10 text-center max-sm:px-6 max-sm:py-8"
        >
          {/*
            A span, not a paragraph: `NovaPresence` renders a div.

            The tighter type below `sm` is because this eyebrow used to sit in a
            52rem centred column and now sits inside a card with 24px of padding
            either side. At 390 that wrapped "co-founder" onto a second line
            inside the pill, which reads as a broken chip rather than a label.
          */}
          <span className="text-fg-prose inline-flex items-center gap-2.5 rounded-full border border-line-strong bg-surface-2 py-1.5 pr-3.5 pl-2 font-mono text-[0.65rem] font-semibold tracking-[0.16em] whitespace-nowrap uppercase max-sm:gap-2 max-sm:pr-3 max-sm:text-[0.5625rem] max-sm:tracking-[0.12em]">
            <NovaPresence state="listening" seed="vibe" />
            Nova · your AI business co-founder
          </span>

          <h1 className="text-fg max-w-[18ch] text-[clamp(2.5rem,5.2vw,4rem)] leading-[1.02] font-bold tracking-[-0.05em] text-balance">
            You built the product. Now build <span className="text-mint">the business.</span>
          </h1>

          <p className="text-fg-prose max-w-[52ch] text-lead leading-relaxed text-balance">
            Vibe understands what you built, finds what is holding the business back, and prepares
            the next step — with your approval before anything merges.
          </p>

          {/*
            "Start with GitHub" rather than "Start with your GitHub repo", and
            no arrow beside the mark. The label is a length constraint now that
            `MarketingCta` refuses to wrap — the long one did not fit the card
            at 390 — and a mark on the left plus an arrow on the right is two
            ornaments on a control whose whole job is to be one thing.
          */}
          <MarketingCta href="/signup" assurance="No credit card to start">
            <GithubMark size={19} />
            Start with GitHub
          </MarketingCta>

          <ul className="text-fg-muted flex flex-wrap justify-center gap-x-6 gap-y-2 text-caption">
            <li className="flex items-center gap-2">
              <BranchIcon size={15} /> Your approval before merge
            </li>
            <li className="flex items-center gap-2">
              <LockIcon size={15} /> No stored copy of your code
            </li>
          </ul>
        </motion.div>
      </div>

      {/*
        Who this is for, directly under the button.

        It used to sit four blocks down the page, where somebody had already
        decided whether the product was for them. Under the call to action it
        answers the first question a visitor has — *is this for what I built?*
        — and the answer is a list of the places they built it.

        Inside the hero's own screen rather than below it, so it is read at the
        same moment as the button. The hero is `justify-center`, so this pushes
        the deck up rather than off, and a browser guard measures both against
        the viewport.

        Named products, and nothing more: no logos, no "trusted by", no claim
        of a partnership. It says what kind of thing Vibe reads, which is a
        fact about Vibe.
      */}
      <div
        data-builders
        className="mt-7 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 sm:mt-9"
      >
        {/*
          Label and names on one line, not stacked. The stacked version cost
          32px of the hero's own screen, which at 1280×800 was the difference
          between the strip being under the button and being under the fold.
        */}
        <MonoLabel className="text-fg-meta">Built for products made with</MonoLabel>
        <ul className="text-fg-secondary flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-body font-semibold">
          {BUILDERS.map((builder) => (
            <li key={builder}>{builder}</li>
          ))}
          <li className="text-fg-muted font-normal">and whatever else you built it in</li>
        </ul>
      </div>
    </div>
  );
}
