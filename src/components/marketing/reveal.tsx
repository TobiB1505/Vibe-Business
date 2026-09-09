"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

/**
 * One block of the landing page, arriving as it is scrolled to (UI-34).
 *
 * ## Why an entrance and not a loop
 *
 * The landing page is a Signature surface in the motion hierarchy, and the
 * thing this motion tells a reader is **hierarchy**: the page is long, and a
 * block that resolves as it arrives says *this is the one you are on now*.
 * It is a one-shot entrance — `once: true` — not ambience, so nothing here is
 * still moving after the page has settled and there is no loop to pause on a
 * hidden tab. The second obligation is met by there being no continuous motion
 * rather than by a `useDocumentVisible` call that would always read `true`.
 *
 * ## The three obligations
 *
 * **Reduced motion.** `initial={false}` renders the block at its final values
 * with no transform, so a reader who asked for no movement gets the same
 * information at first paint. `useReducedMotion` returns `null` during the
 * server render, so the CSS backstop in `globals.css` — `[data-reveal]` under
 * `prefers-reduced-motion` — is what covers the window before hydration. That
 * backstop is not decoration: without it the server would ship `opacity: 0` to
 * a reader whose whole preference is that nothing should be hidden waiting for
 * JavaScript.
 *
 * **Hidden tab.** No loop, as above.
 *
 * **Reserved geometry.** `opacity` and a translate, never a layout property.
 * The block occupies its full box from first paint, so nothing below it moves
 * when it arrives — which is what makes a long page scrollable while it is
 * still revealing. A sideways entrance translates *outside* the page's own
 * width, which is why `MarketingShell` clips the horizontal axis: without that,
 * a block waiting off to the right is a horizontal scrollbar on every screen
 * the page has not reached yet.
 *
 * ## What happens with no JavaScript
 *
 * The server ships the hidden state, so the page needs the `<noscript>` rule in
 * `globals.css` to make every block visible. A landing page that is blank
 * without JavaScript is not a landing page.
 */
/**
 * Which edge a block comes in from.
 *
 * `up` is the default and the one to reach for. The horizontal pair exists so a
 * two-part block can arrive as two parts — the argument from one side, the
 * evidence from the other — which is a thing the page is *saying* about how
 * those two relate. Alternating sides down a page because alternating looks
 * busy is the failure mode; the motion skill's test applies here as everywhere
 * else, and "it looks nice" is not one of the five answers.
 */
export type RevealFrom = "up" | "left" | "right";

/** Distance in pixels, per direction. Sideways travels further because it has room to. */
const OFFSET: Record<RevealFrom, { x: number; y: number }> = {
  up: { x: 0, y: 26 },
  left: { x: -44, y: 0 },
  right: { x: 44, y: 0 },
};

export function Reveal({
  children,
  /** Seconds. Use sparingly — a stagger inside one block, never between blocks. */
  delay = 0,
  from = "up",
  className,
}: {
  children: ReactNode;
  delay?: number;
  from?: RevealFrom;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const offset = OFFSET[from];

  return (
    <motion.div
      data-reveal
      className={className}
      initial={reduced ? false : { opacity: 0, ...offset }}
      whileInView={{ opacity: 1, x: 0, y: 0 }}
      /*
        `-12%` fires the reveal a little before the block's top edge reaches
        the bottom of the viewport, so a block is already resolving by the time
        it is being read rather than resolving under the reader's eyes.
      */
      viewport={{ once: true, margin: "0px 0px -12% 0px" }}
      transition={{ duration: 0.62, ease: [0.22, 0.61, 0.36, 1], delay }}
    >
      {children}
    </motion.div>
  );
}
