"use client";

import { motion, useReducedMotion } from "motion/react";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * One numbered step on the landing page's spine (UI-34).
 *
 * ## The reference, and what was taken from it
 *
 * The founder's: *"durch das Endlos-Scroll kann es sich anfühlen wie diese
 * typischen Whiteboard-Tutorial-Illustrationen … und dann erklären wir den
 * Ablauf und die Module von Vibe Business."*
 *
 * A whiteboard explainer is a line that gets drawn while somebody talks, with
 * numbered steps hanging off it and short notes pointing at the thing being
 * explained. Three things transfer to a scrolling page and one does not:
 *
 * - **The path.** A spine runs down the page and each step's segment draws
 *   itself as that step arrives. The scroll becomes the narrator's hand.
 * - **The numbering.** Steps are counted, so a reader always knows where in
 *   the walk they are and how much of it is left.
 * - **The annotation.** A short mono note beside the subject, not a paragraph
 *   about it.
 * - **Not the skin.** No handwriting face, no marker, no white board.
 *   `DESIGN.md` owns the type scale and the ground; a felt-tip drawn on a dark
 *   product page is a costume, and it would make every real screenshot beside
 *   it look pasted in.
 *
 * ## Geometry
 *
 * The rail is a column of its own at `lg`, so the content beside it keeps a
 * full measure rather than being indented into a narrower one. Below that the
 * rail would eat a quarter of a phone's width for decoration, so it is gone and
 * the number sits inline above the block — the walk is still counted, which is
 * the part that carries information.
 *
 * The rail element occupies its full height from first paint and only its fill
 * grows, so nothing below a step moves while it draws.
 */
export function LandingStep({
  /** `01`, `02` — written out rather than derived, so the page's order is readable in the page. */
  index,
  /** The last step closes the line rather than running it into the block below. */
  last = false,
  id,
  labelledBy,
  className,
  children,
}: {
  index: string;
  last?: boolean;
  id?: string;
  labelledBy?: string;
  className?: string;
  children: ReactNode;
}) {
  const reduced = useReducedMotion();

  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      className={cn(
        "relative isolate scroll-mt-24 lg:grid lg:grid-cols-[3.5rem_minmax(0,1fr)]",
        className,
      )}
    >
      {/*
        The ground, lit from one side and alternating down the page.

        The hero stands on a field and everything under it stood on nothing —
        sampled at the Product Scan the ground read `12,14,16` at both edges
        against the hero's `9,45,35`. The mask fades the field in and out
        vertically, so where two steps meet the light travels rather than
        restarting, which is the difference between a flowing page and the same
        patch stamped once per module.

        It bleeds past the section's own measure because the shell's content
        column is narrower than the window, and an atmosphere that stops at a
        text column is a rectangle.
      */}
      <div
        aria-hidden
        style={{ "--step-side": Number(index) % 2 === 1 ? "16%" : "84%" } as CSSProperties}
        className="landing-step-field pointer-events-none absolute -inset-y-24 -left-[6vw] -z-10 w-[112vw]"
      />
      {/*
        The rail. `aria-hidden` because it is the drawing of a structure the
        headings already carry: a screen reader walking this page meets
        "Module one · Product Scan" and does not need a line described to it.
      */}
      {/*
        A class, not a position. This was found by `#scan > [aria-hidden]` until
        the step gained a second decorative layer above it and the selector
        silently started measuring the ground instead of the rail.
      */}
      <div aria-hidden className="landing-step-rail relative hidden lg:block">
        <motion.span
          initial={reduced ? false : { opacity: 0, scale: 0.6 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true, margin: "0px 0px -20% 0px" }}
          transition={{ duration: 0.4, ease: [0.22, 0.61, 0.36, 1] }}
          className={cn(
            /*
              `top-0` puts the number level with the block's own eyebrow, which
              is the thing it numbers. At `6.5rem` it sat beside the preview
              tile instead — 104px below the line it was supposed to be
              counting, because the rail column starts where the section's
              padding ends and the eyebrow does too.
            */
            "border-mint-line bg-app text-mint absolute top-0 left-2 z-10",
            "flex size-9 items-center justify-center rounded-full border font-mono text-meta font-semibold",
          )}
        >
          {index}
        </motion.span>

        {/*
          The segment, drawn top-down. It starts at the node and runs to the
          foot of the step, so the line arrives before the next number does —
          which is the order a narrator draws it in.
        */}
        <motion.span
          initial={reduced ? false : { scaleY: 0 }}
          whileInView={{ scaleY: 1 }}
          viewport={{ once: true, margin: "0px 0px -12% 0px" }}
          transition={{ duration: 0.9, ease: [0.22, 0.61, 0.36, 1], delay: 0.1 }}
          style={{ transformOrigin: "top center" }}
          className={cn(
            /*
              A steady hairline with the mint concentrated at the node, not a
              fade to nothing: the spine is continuous down the page, and a
              segment that dies out halfway reads as an unfinished drawing
              rather than a path between two steps.
            */
            "from-mint/40 via-line-strong to-line-strong absolute w-px bg-gradient-to-b",
            "left-[1.5625rem] top-[3.25rem]",
            last ? "bottom-[6rem]" : "bottom-0",
          )}
        />
      </div>

      <div className="min-w-0">
        {/* The number, where there is no room for a rail. */}
        <p
          aria-hidden
          className="border-mint-line bg-app text-mint mb-6 flex size-9 items-center justify-center rounded-full border font-mono text-meta font-semibold lg:hidden"
        >
          {index}
        </p>
        {children}
      </div>
    </section>
  );
}
