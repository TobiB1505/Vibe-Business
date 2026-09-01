"use client";

import { motion, useReducedMotion } from "motion/react";
import { useDocumentVisible } from "@/lib/client/use-document-visible";
import { cn } from "@/lib/utils/cn";
import { MonoLabel } from "@/components/ui/typography";
import type { TimelineStep, TimelineStepState } from "@/modules/coding-agent/observability/timeline";

/**
 * Live activity (UI-19, artboard 2b).
 *
 * ## What the rows are
 *
 * The run's own timeline — the six phases `buildExecutionTimeline` derives
 * from stored events. Not a feed of invented lines, and not a fixed script: a
 * phase appears here because an event put it there, and its detail is a number
 * Vibe measured.
 *
 * ## The connector
 *
 * A single line down the left, in mint behind the work and grey ahead of it.
 * It is the design's way of saying the rows are one sequence rather than a
 * list, and like everything else on this surface it never fills part way.
 *
 * ## The spinner
 *
 * On the active row only, and only while the tab is watched. It says *this is
 * where the work is*. It carries no rate, because the run has none to report.
 */

const MARK: Record<TimelineStepState, { glyph: string; sr: string }> = {
  done: { glyph: "✓", sr: "completed" },
  active: { glyph: "", sr: "in progress" },
  failed: { glyph: "!", sr: "stopped" },
  skipped: { glyph: "–", sr: "never reached" },
  pending: { glyph: "", sr: "pending" },
};

const RING: Record<TimelineStepState, string> = {
  done: "border-mint bg-mint-tint text-mint",
  active: "border-mint text-mint",
  failed: "border-coral bg-coral/10 text-coral",
  skipped: "border-line-2 bg-surface-2 text-fg-disabled",
  pending: "border-line-3 bg-surface-2 text-fg-meta",
};

const STATUS: Record<TimelineStepState, string> = {
  done: "Completed",
  active: "In progress",
  failed: "Stopped",
  skipped: "Never reached",
  pending: "Pending",
};

const STATUS_TONE: Record<TimelineStepState, string> = {
  done: "text-mint-dim",
  active: "text-mint",
  failed: "text-coral",
  skipped: "text-fg-disabled",
  pending: "text-fg-meta",
};

export function AgentActivity({
  steps,
  title = "Live activity",
  live = true,
}: {
  steps: readonly TimelineStep[];
  title?: string;
  /** Shows the pulsing dot beside the heading. Off once a run has ended. */
  live?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const visible = useDocumentVisible();
  const animate = !reduceMotion && visible;

  return (
    <section
      className="rounded-panel border-line-3 bg-surface-3 flex flex-col gap-4 border p-5"
      data-testid="agent-activity"
    >
      <div className="flex items-center justify-between gap-2.5">
        <MonoLabel as="h3" className="text-mint">
          {title}
        </MonoLabel>
        {live && (
          <span
            aria-hidden="true"
            className="bg-mint shadow-dot-mint size-[7px] rounded-full"
            style={
              animate
                ? { animation: "vibe-soft-pulse var(--duration-pulse) var(--ease-vibe) infinite" }
                : undefined
            }
          />
        )}
      </div>

      <ol className="flex flex-col">
        {steps.map((step, index) => {
          const mark = MARK[step.state];
          const behind = step.state === "done";
          const last = index === steps.length - 1;

          return (
            <motion.li
              key={step.phase}
              className="relative flex gap-3.5 py-2.5"
              initial={reduceMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.4,
                ease: [0.2, 0.7, 0.2, 1],
                delay: reduceMotion ? 0 : index * 0.08,
              }}
              data-phase={step.phase}
              data-state={step.state}
            >
              <span className="relative flex w-[22px] flex-none justify-center">
                {!last && (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute top-6 -bottom-2.5 w-px",
                      behind ? "bg-mint/40" : "bg-line-2",
                    )}
                  />
                )}
                <span
                  aria-hidden="true"
                  className={cn(
                    "relative flex size-[22px] items-center justify-center rounded-full border-[1.5px] text-[11px]",
                    RING[step.state],
                  )}
                  style={
                    step.state === "active" && animate
                      ? {
                          borderTopColor: "transparent",
                          animation: "vibe-spin-ring 1s linear infinite",
                        }
                      : undefined
                  }
                >
                  {mark.glyph}
                </span>
              </span>

              <span className="flex min-w-0 flex-col gap-0.5">
                <span
                  className={cn(
                    "text-sm leading-snug",
                    step.state === "active"
                      ? "text-fg font-semibold"
                      : step.state === "pending"
                        ? "text-fg-muted"
                        : "text-fg-body font-medium",
                  )}
                >
                  {step.label}
                </span>
                <span className={cn("text-[0.8125rem]", STATUS_TONE[step.state])}>
                  {STATUS[step.state]}
                  {step.detail !== null && <span className="text-fg-meta"> · {step.detail}</span>}
                </span>
              </span>

              <span className="sr-only">{mark.sr}</span>
            </motion.li>
          );
        })}
      </ol>
    </section>
  );
}
