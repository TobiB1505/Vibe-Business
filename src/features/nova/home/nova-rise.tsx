"use client";

import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";

/**
 * Home's entrance: the ranking, made visible (UI Sourcing Spec §10.8).
 *
 * ## What the stagger is saying
 *
 * The primary settles first and the rest follows it, so the founder's eye
 * lands where the answer is before the supporting material arrives. That is
 * not decoration — it is `deriveNovaFocus`'s output drawn in time rather than
 * only in space, and it is the same claim the Focus Card's depth treatment
 * makes in the other dimension.
 *
 * ## Why it is bounded
 *
 * Four steps, the last at 0.3s, all finished well inside `--duration-reveal`'s
 * budget for anything readable. A longer cascade would make the last item feel
 * forgotten, and a founder who arrives to *read* would be waiting on an
 * animation to tell them what they already came to find out.
 *
 * Under reduced motion the finished state renders immediately with every item
 * present — the obligation `DESIGN.md` puts on every motion language in the
 * product, new ones included.
 */
export function NovaRise({
  delay = 0,
  children,
  className,
}: {
  delay?: number;
  children: ReactNode;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();

  if (reduceMotion) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
