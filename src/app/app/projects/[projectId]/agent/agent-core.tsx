"use client";

import { motion, useReducedMotion } from "motion/react";
import { VibeMark } from "@/components/brand/vibe-mark";
import { useDocumentVisible } from "@/lib/client/use-document-visible";
import { cn } from "@/lib/utils/cn";

/**
 * The Agent's core (UI-19).
 *
 * ## Why this surface gets one at all
 *
 * DESIGN.md names Business Brain and Product Scan as the only surfaces allowed
 * cinematic motion, and says the exception must not be copied. Agent is the
 * third, added deliberately: it is the one screen where a founder is watching
 * software change their product and cannot see any of it happening. The core is
 * the only honest thing to look at during a wait that has no percentage.
 *
 * ## What it may and may not say
 *
 * It is a **state**, not a meter. Three of them:
 *
 *   idle      still, dim, waiting to be started
 *   working   a slow breath and one orbit — something is happening
 *   settled   bright and still — the work is done
 *
 * The orbit's speed is constant. It is tempting to make it accelerate as a run
 * progresses, and that would be a progress bar with extra steps: there is no
 * measured fraction behind it, so any speed change would be a claim nobody can
 * support. It moves the same way at minute one and minute forty.
 *
 * ## Motion budget
 *
 * Entrance settles inside 1.5s. After that exactly two things move — the core's
 * breath and one orbiting dot — and only while `working`. Both stop when the
 * tab is hidden. `prefers-reduced-motion` renders the final state immediately
 * and moves nothing, without removing anything a reader needs.
 */

export type AgentCoreState = "idle" | "working" | "settled";

const ENTRANCE = { duration: 0.6, ease: [0.2, 0.7, 0.2, 1] as const };

/** One breath, slow enough to read as alive rather than as a loader. */
const BREATH = { duration: 4.2, repeat: Infinity, ease: "easeInOut" as const };

/** Constant, deliberately. A speed that changed would be an unmeasured claim. */
const ORBIT = { duration: 14, repeat: Infinity, ease: "linear" as const };

export function AgentCore({
  state,
  caption,
  className,
}: {
  state: AgentCoreState;
  /** One line under the core, written by the caller from real state. */
  caption: string;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const visible = useDocumentVisible();
  const alive = state === "working" && !reduceMotion && visible;

  return (
    <div
      className={cn("relative flex flex-col items-center gap-5", className)}
      data-testid="agent-core"
      data-state={state}
    >
      <div className="relative flex size-56 items-center justify-center">
        {/* Atmosphere. Static in every state; only its opacity differs. */}
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-0 rounded-full transition-opacity duration-700",
            state === "idle" ? "opacity-30" : "opacity-100",
          )}
          style={{
            background:
              "radial-gradient(circle at 50% 50%, color-mix(in oklab, var(--color-mint) 22%, transparent) 0%, transparent 62%)",
          }}
        />

        {/* The orbit ring. Drawn in every state so the geometry never jumps. */}
        <span
          aria-hidden="true"
          className={cn(
            "absolute inset-6 rounded-full border transition-[border-color] duration-700",
            state === "idle" ? "border-line-2" : "border-mint/25",
          )}
        />

        {/*
          One dot, one path. The Business Brain is allowed a single bounded
          signal path and this is the same allowance spent the same way — not a
          particle field, which would imply activity nobody counted.
        */}
        {alive && (
          <motion.span
            aria-hidden="true"
            className="absolute inset-6"
            animate={{ rotate: 360 }}
            transition={ORBIT}
          >
            <span className="bg-mint absolute top-0 left-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-[0_0_12px_2px_color-mix(in_oklab,var(--color-mint)_60%,transparent)]" />
          </motion.span>
        )}

        <motion.div
          className={cn(
            "border-line-2 bg-app/80 relative flex size-32 items-center justify-center rounded-full border backdrop-blur-sm transition-[border-color] duration-700",
            state !== "idle" && "border-mint/45",
          )}
          initial={reduceMotion ? false : { opacity: 0, scale: 0.94 }}
          animate={
            alive
              ? { opacity: 1, scale: [1, 1.035, 1] }
              : { opacity: 1, scale: 1 }
          }
          transition={alive ? BREATH : ENTRANCE}
        >
          {/* Sized through the component's own prop, not a class that would
              fight the intrinsic width/height Next's Image renders. */}
          <VibeMark
            size={48}
            className={cn(
              "transition-opacity duration-700",
              state === "idle" ? "opacity-45" : "opacity-100",
            )}
          />
        </motion.div>
      </div>

      {/*
        `aria-live` is deliberately absent. The caption changes when the stage
        changes, and the stage rail already announces that; two announcements
        for one event is how a screen reader turns into noise.
      */}
      <p className="text-fg-muted max-w-[34ch] text-center text-sm leading-relaxed text-balance">
        {caption}
      </p>
    </div>
  );
}
