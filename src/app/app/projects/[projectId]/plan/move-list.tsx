"use client";

import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils/cn";
import { MOVE_BAND_LABELS, moveBand } from "@/modules/opportunities/view";
import type { BusinessOpportunity } from "@/modules/opportunities/schema";

/**
 * The Now / Next / Later rail (ACTION PLAN UI-2).
 *
 * Presentation only. The list stays a real `<ol>` in the engine's order, and
 * the rail states that order in words rather than expressing it — a marker and
 * a line are not information a screen reader can read, so each band is also a
 * label beside the number, and each card still carries its own rank.
 *
 * Below `sm` the rail leaves the margin and the band becomes a row above the
 * card, because a two-column layout that squeezes a card to a third of a phone
 * screen is geometry winning over reading.
 */
export function MoveList({
  opportunities,
  children,
}: {
  opportunities: BusinessOpportunity[];
  /** One card per Move, in the same order. */
  children: (opportunity: BusinessOpportunity) => ReactNode;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <ol className="flex flex-col gap-3.5" data-testid="move-list">
      {opportunities.map((opportunity, index) => {
        const band = moveBand(opportunity.rank);
        const isLast = index === opportunities.length - 1;

        return (
          <motion.li
            key={opportunity.id}
            initial={reduceMotion ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={
              reduceMotion
                ? { duration: 0 }
                : { duration: 0.42, delay: Math.min(index * 0.07, 0.21), ease: [0.2, 0.7, 0.2, 1] }
            }
            className="flex flex-col gap-2 sm:flex-row sm:gap-5"
          >
            <div className="flex shrink-0 items-center gap-2 sm:w-16 sm:flex-col sm:gap-2">
              <span
                className={cn(
                  "relative z-10 flex size-10 items-center justify-center rounded-full border font-mono text-sm tabular-nums",
                  band === "now"
                    ? "border-mint bg-mint-tint-soft text-mint shadow-dot-mint"
                    : band === "next"
                      ? "border-amber bg-amber-tint-soft text-amber"
                      : "border-line-3 bg-surface-2 text-fg-meta",
                )}
              >
                {opportunity.rank}
              </span>
              <span className="text-fg-meta font-mono text-meta tracking-[0.14em] uppercase">
                {MOVE_BAND_LABELS[band]}
              </span>
              {/* The connecting line is decoration over an ordered list that
                  already carries the sequence. */}
              {!isLast && (
                <span
                  aria-hidden
                  className={cn(
                    "hidden w-px flex-1 sm:block",
                    band === "now"
                      ? "bg-gradient-to-b from-mint via-mint-dim to-line-3"
                      : band === "next"
                        ? "bg-gradient-to-b from-amber-deep to-line-3"
                        : "bg-line-3",
                  )}
                />
              )}
            </div>

            <div className="min-w-0 flex-1">{children(opportunity)}</div>
          </motion.li>
        );
      })}
    </ol>
  );
}
