"use client";

import { motion, useReducedMotion } from "motion/react";
import {
  BusinessLensIcon,
  planetStyle,
} from "@/app/app/projects/[projectId]/business-brain/business-map";
import { LandingStep } from "@/components/marketing/landing-step";
import { Reveal } from "@/components/marketing/reveal";
import { MonoLabel } from "@/components/ui/typography";
import { cn } from "@/lib/utils/cn";
import { LENS_LABELS } from "@/modules/business-audit/map-view";
import { BUSINESS_LENSES, type BusinessLens } from "@/modules/business-audit/schema";

/**
 * The Business Brain, walked down as a staircase (UI-34).
 *
 * ## Why not the map
 *
 * The founder: *"die Business Map so darstellen … ein Orb, rechts daneben was
 * damit gemeint ist, dann versetzt nach unten beim Scroll der nächste Orb …
 * und das wechselt immer rechts links, wie so eine Wendeltreppe. Das sieht halt
 * nicht wie eine Liste aus."*
 *
 * The radial map is the right shape **in the product**, where the nine areas
 * are looked at together and the relationships between them are the point. On a
 * landing page it is one picture a visitor has to decode before it says
 * anything, and its nine labels are 12px because nine things have to fit a
 * circle.
 *
 * Unrolled down a scroll, each area gets a screen of its own: the orb at one
 * side, what the area asks beside it, and the next one below and on the other
 * side. Nothing is decoded; it is read.
 *
 * ## What makes it a staircase rather than a zigzag list
 *
 * The alternation alone would be a list with the margin flipping. Two more
 * things: each tread's text sits lower than its orb, so the eye steps *down*
 * into it rather than across; and a curve is drawn between consecutive orbs, so
 * the thread is visible rather than implied.
 *
 * That curve is where `stroke-dashoffset` finally earns its place. The spine in
 * `LandingStep` is straight and a transform beats a stroke there — here the
 * path bends, so the length has to be measured and walked, which is exactly
 * what the technique is for.
 *
 * ## The orbs are the product's orbs
 *
 * `BusinessLensIcon` and `planetStyle` come from `business-map.tsx`, and
 * `.business-brain-planet` is the same material the map draws. The alternative
 * was four RGB triples copied into a marketing file.
 *
 * ## Every one of them says "Not assessed"
 *
 * Which is the truth about a visitor who has no product connected, and it is
 * also the sentence this block exists to make: an area Vibe cannot see stays
 * unscored. It is never scored zero, and it never drags an average down. Nine
 * dashes on a landing page is a strange thing to show and the correct one.
 */

/** What each area asks. Read from the product's own vocabulary, not written here. */
const LENS_QUESTIONS: Record<BusinessLens, string> = {
  offer: "Why should someone choose this product?",
  audience: "Who cares enough about this problem to act?",
  revenue_economics: "How does the value become sustainable revenue?",
  acquisition: "How do the right people discover it?",
  conversion: "How does interest become value and payment?",
  retention: "Why would someone return and keep paying?",
  measurement: "Can the founder tell what is working?",
  business_readiness: "What still blocks this becoming a credible business?",
  scalability: "What happens to cost and operations as it grows?",
};

/**
 * The orb every tread draws: no product, no score, no colour.
 *
 * `unclear` rather than a word like "unscored", because that is the health a
 * lens actually carries when Vibe has not assessed it — the value the deleted
 * radial preview also gave its nodes, and the one `planetStyle` falls through
 * to its neutral palette on.
 */
const UNSCORED = planetStyle({ health: "unclear" });

function Tread({ lens, index, last }: { lens: BusinessLens; index: number; last: boolean }) {
  const reduced = useReducedMotion();
  const onLeft = index % 2 === 0;

  return (
    <li
      className={cn(
        "relative grid items-center gap-6 lg:gap-16",
        "lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]",
      )}
    >
      <Reveal
        from={onLeft ? "left" : "right"}
        /*
          Centred in its half, not pushed to the inside edge. The connector
          leaves and arrives at 25% and 75% of the row, so an orb aligned to the
          column's inner edge sat two hundred pixels away from the end of its
          own thread — measured at 1440, orb centre 640 against a curve starting
          at 425.
        */
        className={cn("flex justify-center", onLeft ? "lg:order-1" : "lg:order-2")}
      >
        <div
          style={UNSCORED}
          className="business-brain-planet flex size-[9.5rem] flex-col items-center justify-center rounded-full border text-center max-sm:size-[7.6rem]"
        >
          <BusinessLensIcon lens={lens} className="business-brain-planet-icon size-6" />
          <span className="text-fg mt-2 max-w-[7rem] text-[0.78rem] leading-[1.15] font-semibold tracking-[-0.018em]">
            {LENS_LABELS[lens]}
          </span>
          <span className="text-fg-muted mt-1.5 text-[0.65rem] font-medium">Not assessed</span>
        </div>
      </Reveal>

      {/*
        The text sits lower than its orb, so the eye steps down into the tread
        rather than straight across it. That, the alternation, and the curve
        below are the three things separating a staircase from a list whose
        margin flips.
      */}
      <Reveal
        from={onLeft ? "right" : "left"}
        delay={0.08}
        className={cn("min-w-0 lg:mt-14", onLeft ? "lg:order-2" : "lg:order-1")}
      >
        <div className={cn("flex flex-col gap-2", onLeft ? "" : "lg:text-right lg:items-end")}>
          <MonoLabel as="p" className="text-fg-meta">
            {LENS_LABELS[lens]}
          </MonoLabel>
          <p className="text-fg-body max-w-[34ch] text-lead leading-relaxed">
            {LENS_QUESTIONS[lens]}
          </p>
        </div>
      </Reveal>

      {/*
        The thread between this orb and the next, drawn as it is reached.

        The viewBox is 112 tall because the box is, so `preserveAspectRatio`
        stretches one axis and not both. A square 100×100 viewBox in a 1440×112
        box is squashed nine times harder vertically than horizontally, and the
        S it should draw arrives as three disconnected scratches — measured
        twice, once with the controls at mid-height and once with them at the
        ends. Matching the height means the only distortion is a mild 1.4×
        horizontal one, which a curve survives.

        `aria-hidden`, `lg` only, and never after the last tread: it is the
        picture of an order the list already has, below `lg` the treads are one
        column where a curve across the page would connect nothing to nothing,
        and a thread trailing off the ninth orb leads nowhere.
      */}
      {!last && (
        <motion.svg
          aria-hidden
          viewBox="0 0 1000 112"
          preserveAspectRatio="none"
          className="pointer-events-none absolute -bottom-28 left-0 hidden h-28 w-full lg:block"
        >
          <motion.path
            d={onLeft ? "M 250 0 C 250 112, 750 0, 750 112" : "M 750 0 C 750 112, 250 0, 250 112"}
            fill="none"
            stroke="var(--color-line-strong)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            initial={reduced ? false : { pathLength: 0 }}
            whileInView={{ pathLength: 1 }}
            viewport={{ once: true, margin: "0px 0px -10% 0px" }}
            transition={{ duration: 0.8, ease: [0.22, 0.61, 0.36, 1] }}
          />
        </motion.svg>
      )}
    </li>
  );
}

export function LandingBusinessMap() {
  return (
    <LandingStep index="02" id="brain" labelledBy="brain-heading" className="py-20 sm:py-28">
      <Reveal from="up">
        <div className="flex flex-col gap-5">
          <MonoLabel className="text-mint">Business Brain</MonoLabel>
          <h2
            id="brain-heading"
            className="text-fg max-w-[24ch] text-[clamp(2rem,3.6vw,3rem)] leading-[1.06] font-bold tracking-[-0.045em] text-balance"
          >
            Nine areas, and an honest answer for each.
          </h2>
          <p className="text-fg-prose max-w-[58ch] leading-relaxed">
            Vibe reads your product against the nine things that decide whether it becomes a
            business. Each one is scored against evidence you can open — and an area it cannot see
            stays <span className="text-fg">unscored</span>. Never scored zero, never averaged in.
            That is the difference between a judgement and a number.
          </p>
        </div>
      </Reveal>

      {/*
        Nine treads. The list is an `ol` because the order is the product's —
        `BUSINESS_LENSES` — rather than a sequence chosen for this page, and a
        reader arriving by keyboard should meet them in it.
      */}
      <ol className="mt-20 flex flex-col gap-24 lg:mt-24 lg:gap-32">
        {BUSINESS_LENSES.map((lens, index) => (
          <Tread key={lens} lens={lens} index={index} last={index === BUSINESS_LENSES.length - 1} />
        ))}
      </ol>
    </LandingStep>
  );
}
