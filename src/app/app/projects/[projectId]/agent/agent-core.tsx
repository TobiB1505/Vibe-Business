"use client";

import { motion, useReducedMotion } from "motion/react";
import { VibeMark } from "@/components/brand/vibe-mark";
import { useDocumentVisible } from "@/lib/client/use-document-visible";
import { cn } from "@/lib/utils/cn";
import type { AgentCoreState } from "@/modules/coding-agent/observability/agent-stages";

/**
 * The Agent's core (UI-19), built to the imported design.
 *
 * ## Why this surface gets one
 *
 * DESIGN.md named Business Brain and Product Scan as the only surfaces allowed
 * cinematic motion. Agent is the third, added deliberately: it is the one
 * screen where a founder is watching software change their product and cannot
 * see any of it happening. The core is the honest thing to look at during a
 * wait that has no percentage.
 *
 * ## Four rings, and why none of them measures anything
 *
 * The design's composition: a wide ellipse turning one way, a dashed ring
 * turning the other, a breathing ring, a static inner ring, then the core with
 * its own glow and the mark floating inside it. Four satellites sit at the
 * compass points for code, documents, analytics and data — the things Vibe
 * reads.
 *
 * Every speed is constant. A ring that accelerated with apparent progress
 * would be a progress bar with no measurement behind it, which is the one thing
 * this whole surface refuses to be.
 *
 * ## States
 *
 *   idle      still and dim, waiting to be started
 *   working   everything alive
 *   waiting   amber and held — a question is open and only an answer restarts it
 *   settled   bright and still, the work behind you
 *
 * `prefers-reduced-motion` and a hidden tab both stop every animation without
 * removing anything a reader needs.
 */

/** The four things Vibe reads, at the compass points. */
const SATELLITES = [
  {
    key: "code",
    position: "top-0 left-1/2 -translate-x-1/2",
    path: <path d="m8.5 8-4 4 4 4M15.5 8l4 4-4 4M13.5 5l-3 14" />,
  },
  {
    key: "docs",
    position: "bottom-3.5 left-1/2 -translate-x-1/2",
    path: (
      <>
        <path d="M6 3h7.5L19 8.5V21H6V3Z" />
        <path d="M13.5 3v5.5H19" />
        <path d="M9 13h6" />
        <path d="M9 16.5h4" />
      </>
    ),
  },
  {
    key: "analytics",
    position: "left-3.5 top-1/2 -translate-y-1/2",
    path: (
      <>
        <path d="m4 16 5-5 3 3 7-7" />
        <path d="M15 7h4v4" />
      </>
    ),
  },
  {
    key: "data",
    position: "right-3.5 top-1/2 -translate-y-1/2",
    path: (
      <>
        <ellipse cx="12" cy="5.5" rx="7.5" ry="3.2" />
        <path d="M4.5 5.5v6c0 1.8 3.4 3.2 7.5 3.2s7.5-1.4 7.5-3.2v-6" />
        <path d="M4.5 11.5v6c0 1.8 3.4 3.2 7.5 3.2s7.5-1.4 7.5-3.2v-6" />
      </>
    ),
  },
] as const;

export function AgentCore({
  state,
  caption,
  headline,
  className,
}: {
  state: AgentCoreState;
  /** One line under the core, written by the caller from real state. */
  caption: string;
  /** The bolder line above it, when the caller has one worth saying. */
  headline?: string;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const visible = useDocumentVisible();
  const animate = !reduceMotion && visible;

  const waiting = state === "waiting";
  const lit = state !== "idle";
  /* Only a live run turns the rings. A settled or held core keeps its shape. */
  const alive = state === "working" && animate;
  const anim = (value: string) => (alive ? { animation: value } : undefined);

  /*
   * Spelled out rather than interpolated. `border-${accent}/15` reads fine and
   * produces nothing: Tailwind extracts class names statically, so a computed
   * one is simply absent from the stylesheet.
   */
  const ring = (mint: string, amber: string, idle: string) =>
    !lit ? idle : waiting ? amber : mint;

  return (
    <div
      className={cn("relative flex flex-col items-center gap-5", className)}
      data-testid="agent-core"
      data-state={state}
    >
      <div className="relative flex h-[340px] w-[400px] max-w-full items-center justify-center">
        {/* Outermost: a wide ellipse, turning slowly. */}
        <span
          aria-hidden="true"
          className={cn(
            "absolute h-[270px] w-[400px] max-w-full rounded-[50%] border",
            ring("border-mint/15", "border-amber/15", "border-line-2/60"),
          )}
          style={anim("vibe-orb-spin 46s linear infinite")}
        />
        {/* Counter-turning, dashed — the two directions read as depth. */}
        <span
          aria-hidden="true"
          className={cn(
            "absolute size-[330px] max-w-full rounded-full border border-dashed",
            ring("border-mint/15", "border-amber/15", "border-line-2/50"),
          )}
          style={anim("vibe-orb-spin-back 34s linear infinite")}
        />
        <span
          aria-hidden="true"
          className={cn(
            "absolute size-[262px] rounded-full border",
            ring("border-mint/25", "border-amber/25", "border-line-2/60"),
          )}
          style={anim("vibe-orb-breathe 6s var(--ease-vibe) infinite")}
        />
        <span
          aria-hidden="true"
          className={cn(
            "absolute size-[186px] rounded-full border-[1.5px]",
            ring("border-mint/45", "border-amber/50", "border-line-3"),
          )}
        />

        <span
          className="relative flex size-[158px] items-center justify-center rounded-full"
          style={{
            background: `radial-gradient(circle at 50% 42%, color-mix(in oklab, var(--color-${waiting ? "amber" : "mint"}) ${lit ? 16 : 6}%, transparent), color-mix(in oklab, var(--color-app) 96%, transparent) 66%)`,
            ...anim("vibe-orb-core 5.6s var(--ease-vibe) infinite"),
          }}
        >
          {/* Wrapped rather than widening the shared brand component's API
              for one surface. */}
          <span
            className={cn("transition-opacity duration-700", lit ? "opacity-100" : "opacity-45")}
            style={anim("vibe-mark-float 5.6s var(--ease-vibe) infinite")}
          >
            <VibeMark size={66} />
          </span>
        </span>

        {SATELLITES.map((satellite) => (
          <span
            key={satellite.key}
            aria-hidden="true"
            className={cn(
              "border-line-4 bg-surface-3 absolute flex size-13 items-center justify-center rounded-full border transition-opacity duration-700",
              lit ? "opacity-100" : "opacity-55",
              satellite.position,
            )}
          >
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-fg-prose"
            >
              {satellite.path}
            </svg>
          </span>
        ))}
      </div>

      {headline !== undefined && (
        <motion.p
          className="text-fg max-w-[34ch] text-center text-lg font-semibold tracking-[-0.015em] text-balance"
          initial={reduceMotion ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.2, 0.7, 0.2, 1] }}
        >
          {headline}
        </motion.p>
      )}

      {/*
        `aria-live` is deliberately absent. The caption changes when the stage
        changes and the rail already announces that; two announcements for one
        event is how a screen reader turns into noise.
      */}
      <p className="text-fg-muted max-w-[44ch] text-center text-[0.9375rem] leading-relaxed text-balance">
        {caption}
      </p>
    </div>
  );
}
