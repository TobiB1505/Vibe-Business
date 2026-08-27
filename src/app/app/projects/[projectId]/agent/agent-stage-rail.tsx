"use client";

import { motion, useReducedMotion } from "motion/react";
import { useDocumentVisible } from "@/lib/client/use-document-visible";
import { cn } from "@/lib/utils/cn";
import type {
  AgentStageState,
  AgentStageStep,
} from "@/modules/coding-agent/observability/agent-stages";

/**
 * The five stages, as the design's tracker (UI-19).
 *
 * ## Not the Move stepper
 *
 * `plan/move-stepper.tsx` looks similar and is a different kind of object: a
 * tab interface over persisted Move order, which is why its earlier circles
 * carry no ticks — being ranked ahead of the active Move does not mean the work
 * is done. This one *is* a completion indicator. Merging them would give one of
 * the two the wrong semantics.
 *
 * ## Three states in the design, six in the system
 *
 * The imported tracker knows done, active and pending. The run has three more,
 * and each exists because leaving it out would have made the rail lie:
 *
 *   failed          the run stopped here and went no further
 *   paused          it is waiting on an answer only the founder has
 *   skipped         it ended before ever reaching this stage
 *   not_applicable  this stage does not apply to this change and never will
 *
 * `skipped` and `pending` are the pair worth the extra vocabulary. Every
 * stepper that lacks the distinction renders them identically, and they mean
 * "this is never coming" and "not yet" — opposite answers to the only question
 * somebody staring at a slow run is actually asking. Here they differ in mark,
 * in fill, in label and in words.
 *
 * ## What it will not draw
 *
 * A connector that fills part way. The design's travelling band deliberately
 * loops rather than advancing: it says *this is where the work is*, never how
 * far along it is, because no honest fraction of "Making the change" exists.
 * A band that crept forward would be a progress bar nobody could justify.
 */

/** Design tokens per state: ring, fill, number colour, label and status. */
const RING: Record<AgentStageState, string> = {
  done: "border-mint bg-mint-tint-soft text-mint",
  active: "border-mint bg-mint-tint text-mint",
  paused: "border-amber bg-amber/10 text-amber",
  failed: "border-coral bg-coral/10 text-coral",
  skipped: "border-line-2 bg-surface-2 text-fg-disabled",
  not_applicable: "border-line-2 bg-surface-2 text-fg-disabled",
  pending: "border-line-3 bg-surface-2 text-fg-meta",
};

const STATUS_TONE: Record<AgentStageState, string> = {
  done: "text-mint-dim",
  active: "text-mint",
  paused: "text-amber",
  failed: "text-coral",
  skipped: "text-fg-disabled",
  not_applicable: "text-fg-disabled",
  pending: "text-fg-meta",
};

/** The word under each stage. Never colour alone. */
const STATE_WORDS: Record<AgentStageState, string> = {
  pending: "Pending",
  active: "In progress",
  paused: "Waiting for you",
  done: "Completed",
  failed: "Stopped",
  skipped: "Never reached",
  not_applicable: "Not applicable",
};

function markFor(state: AgentStageState, position: number): { glyph: string; sr: string } {
  switch (state) {
    case "done":
      return { glyph: "✓", sr: "completed" };
    case "failed":
      return { glyph: "!", sr: "stopped" };
    case "paused":
      return { glyph: "?", sr: "waiting for you" };
    case "skipped":
      return { glyph: "–", sr: "never reached" };
    case "not_applicable":
      return { glyph: "–", sr: "not applicable" };
    default:
      return { glyph: String(position), sr: state === "active" ? "in progress" : "pending" };
  }
}

const BEHIND: readonly AgentStageState[] = ["done", "skipped", "not_applicable"];

export function AgentStageRail({ steps }: { steps: AgentStageStep[] }) {
  const reduceMotion = useReducedMotion();
  const visible = useDocumentVisible();
  const animate = !reduceMotion && visible;

  return (
    <nav aria-label="Agent progress" data-testid="agent-stage-rail">
      <ol className="border-line-2 bg-surface-1 rounded-panel flex flex-col gap-4 border p-4 sm:flex-row sm:items-start sm:gap-0 sm:p-5">
        {steps.map((step, index) => {
          const mark = markFor(step.state, index + 1);
          const last = index === steps.length - 1;
          const glow = step.state === "active" && animate;
          const flow = step.state === "active" && animate;

          return (
            <motion.li
              key={step.stage}
              className={cn("flex min-w-0 items-start", last ? "sm:flex-none" : "sm:flex-1")}
              initial={reduceMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.4,
                ease: [0.2, 0.7, 0.2, 1],
                delay: reduceMotion ? 0 : index * 0.08,
              }}
              data-stage={step.stage}
              data-state={step.state}
            >
              {/*
                `min-w-0` rather than `flex-none`. With a fixed cell and
                `whitespace-nowrap` labels, a long stage name ran straight into
                the next stage's on the live screen — five cells, no give, and
                nowhere for the text to stop.
              */}
              <div className="flex min-w-0 items-center gap-3.5">
                <span
                  className={cn(
                    "flex size-9 flex-none items-center justify-center rounded-full border-[1.5px] font-mono text-sm",
                    RING[step.state],
                  )}
                  style={
                    glow
                      ? { animation: "vibe-step-glow 2s var(--ease-vibe) infinite" }
                      : undefined
                  }
                >
                  <span aria-hidden="true">{mark.glyph}</span>
                </span>

                <span className="flex min-w-0 flex-col gap-0.5">
                  <span
                    className={cn(
                      /* Wrapping, not truncating. "Product understo…" tells a
                         founder less than two short lines do, and the rail has
                         the height for them. */
                      "text-[0.9375rem] leading-snug",
                      step.state === "active" ? "text-fg font-bold" : "font-semibold",
                      step.state === "pending" ? "text-fg-secondary" : "text-fg",
                    )}
                  >
                    {step.label}
                  </span>
                  <span className={cn("text-[0.8125rem]", STATUS_TONE[step.state])}>
                    {STATE_WORDS[step.state]}
                    {step.detail !== null && (
                      <span className="text-fg-meta"> · {step.detail}</span>
                    )}
                  </span>
                </span>
              </div>

              {!last && (
                <div
                  aria-hidden="true"
                  /* Shrinkable, so the connector yields to the labels rather
                     than pushing the last stage off the edge. */
                  className="mx-3 mt-4 hidden min-w-3 flex-1 shrink items-center sm:flex"
                >
                  <div
                    className={cn(
                      "relative h-[1.5px] flex-1 overflow-hidden",
                      BEHIND.includes(step.state) ? "bg-mint-dim" : "bg-line-3",
                    )}
                  >
                    {/*
                      A band that travels and loops, never one that advances.
                      "This is where the work is" is true; "you are 40% through
                      Making the change" is a number nobody measured.
                    */}
                    {flow && (
                      <span
                        className="bg-mint absolute inset-y-0 w-[34%]"
                        style={{ animation: "vibe-step-flow 2.4s var(--ease-vibe) infinite" }}
                      />
                    )}
                  </div>
                  <svg
                    viewBox="0 0 24 24"
                    width="15"
                    height="15"
                    fill="none"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={cn(
                      "-ml-1 flex-none",
                      BEHIND.includes(step.state) ? "stroke-mint-dim" : "stroke-line-3",
                    )}
                  >
                    <path d="m14 6 6 6-6 6" />
                  </svg>
                </div>
              )}

              <span className="sr-only">
                Stage {index + 1} of {steps.length}: {step.label}, {mark.sr}
                {step.detail === null ? "" : `. ${step.detail}`}
              </span>
            </motion.li>
          );
        })}
      </ol>
    </nav>
  );
}
