"use client";

import { motion, useReducedMotion } from "motion/react";
import { useDocumentVisible } from "@/lib/client/use-document-visible";
import { cn } from "@/lib/utils/cn";
import type { AgentStageState, AgentStageStep } from "@/modules/coding-agent/observability/agent-stages";

/**
 * The five stages, as a rail (UI-19).
 *
 * ## Not the Move stepper
 *
 * `plan/move-stepper.tsx` looks similar and is a different kind of object: a
 * tab interface over persisted Move order, which is why its earlier circles
 * carry no ticks — being ranked ahead of the active Move does not mean the work
 * is done. This one *is* a completion indicator, so ticks mean what they say.
 * Merging them would give one of the two the wrong semantics.
 *
 * ## What it will not draw
 *
 * A connector that fills part way. A partially-drawn line between two stages
 * is a percentage in disguise, and there is no honest fraction of "Building
 * your change" — the same argument the stage vocabulary already makes. A
 * connector is either behind the work or ahead of it.
 *
 * Nor will it animate a stage that is `pending` while another is `skipped`.
 * Those are the two states that look identical in every stepper ever shipped
 * and mean opposite things: one says keep waiting, the other says this is
 * never coming. Here they differ in mark, in label and in text.
 *
 * ## Motion budget
 *
 * Entrance is one staggered fade-and-rise that settles in well under the 1.5s
 * DESIGN.md allows a signature surface. After that the only thing still moving
 * is a single soft pulse on the active stage's ring — one element, paused when
 * the tab is hidden, gone entirely under `prefers-reduced-motion`. No overshoot
 * easing: this rail carries information, and a bounce reads as sloppy on it.
 */

const ENTRANCE = { duration: 0.42, ease: [0.2, 0.7, 0.2, 1] as const };
/** Below the ~8-child ceiling where the last item starts to feel laggy. */
const STAGGER = 0.07;

type Mark = { glyph: string | null; srLabel: string };

function markFor(state: AgentStageState, position: number): Mark {
  switch (state) {
    case "done":
      return { glyph: "✓", srLabel: "completed" };
    case "failed":
      return { glyph: "!", srLabel: "failed" };
    case "skipped":
      return { glyph: "–", srLabel: "never reached" };
    case "not_applicable":
      return { glyph: "–", srLabel: "not applicable" };
    default:
      return { glyph: String(position), srLabel: state === "active" ? "in progress" : "pending" };
  }
}

/**
 * State words, never colour alone.
 *
 * The same rule the Business Brain follows: coral and mint carry emphasis, and
 * the sentence underneath carries the meaning for anyone who cannot separate
 * them.
 */
const STATE_WORDS: Record<AgentStageState, string> = {
  pending: "Pending",
  active: "In progress",
  done: "Completed",
  failed: "Failed",
  skipped: "Never reached",
  not_applicable: "Not applicable",
};

const RING: Record<AgentStageState, string> = {
  done: "border-mint/70 bg-mint/12 text-mint",
  active: "border-mint bg-mint/16 text-mint",
  failed: "border-coral/70 bg-coral/10 text-coral",
  skipped: "border-line-2 bg-surface-1 text-fg-disabled",
  not_applicable: "border-line-2 bg-surface-1 text-fg-disabled",
  pending: "border-line-3 bg-surface-1 text-fg-meta",
};

export function AgentStageRail({ steps }: { steps: AgentStageStep[] }) {
  const reduceMotion = useReducedMotion();
  const visible = useDocumentVisible();

  return (
    <nav aria-label="Agent progress" data-testid="agent-stage-rail">
      <ol className="border-line-2 bg-surface-1 rounded-panel flex flex-col gap-1 border p-3 sm:flex-row sm:items-stretch sm:gap-0 sm:p-4">
        {steps.map((step, index) => {
          const mark = markFor(step.state, index + 1);
          const pulsing = step.state === "active" && !reduceMotion && visible;

          return (
            <motion.li
              key={step.stage}
              className="flex min-w-0 flex-1 items-center gap-3 sm:flex-col sm:items-start sm:gap-2"
              initial={reduceMotion ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...ENTRANCE, delay: reduceMotion ? 0 : index * STAGGER }}
              data-stage={step.stage}
              data-state={step.state}
            >
              <div className="flex w-full items-center gap-3">
                <span className="relative flex shrink-0 items-center justify-center">
                  {/*
                    One pulse, on one element, only while the tab is watched.
                    It sits behind the ring rather than scaling it, so nothing
                    the eye is reading changes size.
                  */}
                  {pulsing && (
                    <motion.span
                      aria-hidden="true"
                      className="bg-mint/24 absolute inset-0 rounded-full"
                      animate={{ opacity: [0.5, 0, 0.5], scale: [1, 1.7, 1] }}
                      transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
                    />
                  )}
                  <span
                    className={cn(
                      "relative flex size-7 items-center justify-center rounded-full border font-mono text-[0.6875rem]",
                      RING[step.state],
                    )}
                  >
                    <span aria-hidden="true">{mark.glyph}</span>
                  </span>
                </span>

                {/*
                  The connector is behind the work or ahead of it — never
                  partway. A half-filled line is a percentage nobody measured.
                */}
                {index < steps.length - 1 && (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "hidden h-px flex-1 sm:block",
                      step.state === "done" ? "bg-mint/45" : "bg-line-2",
                    )}
                  />
                )}
              </div>

              <div className="flex min-w-0 flex-col gap-0.5 sm:pr-4">
                <span
                  className={cn(
                    "truncate text-sm font-medium",
                    step.state === "active"
                      ? "text-fg"
                      : step.state === "done"
                        ? "text-fg-body"
                        : "text-fg-muted",
                  )}
                >
                  {step.label}
                </span>
                <span className="text-fg-meta truncate font-mono text-[0.625rem] tracking-[0.08em] uppercase">
                  {STATE_WORDS[step.state]}
                  {step.detail !== null && <span className="normal-case"> · {step.detail}</span>}
                </span>
              </div>

              {/* The one place the state is spelled out for a screen reader. */}
              <span className="sr-only">
                Stage {index + 1} of {steps.length}: {step.label}, {mark.srLabel}
                {step.detail === null ? "" : `. ${step.detail}`}
              </span>
            </motion.li>
          );
        })}
      </ol>
    </nav>
  );
}
