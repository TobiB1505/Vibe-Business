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
 * **Reserved geometry.** `opacity` and `translateY` only. The block occupies
 * its full height from first paint, so nothing below it moves when it arrives
 * — which is what makes a long page scrollable while it is still revealing.
 *
 * ## What happens with no JavaScript
 *
 * The server ships the hidden state, so the page needs the `<noscript>` rule in
 * `globals.css` to make every block visible. A landing page that is blank
 * without JavaScript is not a landing page.
 */
export function Reveal({
  children,
  /** Seconds. Use sparingly — a stagger inside one block, never between blocks. */
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();

  return (
    <motion.div
      data-reveal
      className={className}
      initial={reduced ? false : { opacity: 0, y: 26 }}
      whileInView={{ opacity: 1, y: 0 }}
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
