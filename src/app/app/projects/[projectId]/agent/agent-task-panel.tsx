"use client";

import { motion, useReducedMotion } from "motion/react";
import { MonoLabel } from "@/components/ui/typography";
import { Well } from "@/components/ui/surface";
import { cn } from "@/lib/utils/cn";
import { LENS_LABELS } from "@/modules/business-audit/map-view";
import { buildChainCompletionNote } from "@/modules/coding-agent/view";
import type { BusinessLens } from "@/modules/business-audit/schema";

/**
 * The task the agent is working on (UI-19, artboards 2a–2c).
 *
 * ## Everything here is stored, or absent
 *
 * The lens, the impact and effort chips, the problem and the "why this" line
 * are the Move's own fields. The **headline is the run's own step** once a run
 * is bound to one, with the Move kept above it as context — a run executes one
 * step, never a whole Move, and a screen that named only the Move could not say
 * which part was being built.
 *
 * The checklist is that step plus the preparation folded into it, taken from
 * the run's immutable instruction package rather than from the newest Action
 * Plan. That is a stronger guarantee than the one it replaced: a spec cannot
 * drift, while the plan it came from can be regenerated underneath it.
 *
 * Nothing is generated for the screen: a run with no bound step shows the
 * Move's title and no checklist rather than an invented one, and a Move with no
 * lens shows no lens chip.
 *
 * ## Why the checklist is titles only
 *
 * Each step also carries a description, a purpose and a completion criterion,
 * and all three belong on the Action Plan where a founder is deciding. Here
 * the question is narrower — *what is Vibe about to do* — and four one-line
 * answers are the honest size of it.
 *
 * ## The ticks
 *
 * They are the plan's shape, not progress. A step is not "done" because the
 * run started; the rail above says where the work is. Rendering them as filled
 * circles would claim completion this component cannot see.
 */

const IMPACT_LABELS = { high: "High impact", medium: "Medium impact", low: "Low impact" } as const;
const EFFORT_LABELS = { high: "High effort", medium: "Medium effort", low: "Low effort" } as const;

export type AgentTask = {
  title: string;
  /** The Move's current-state problem, in its own words. */
  problem: string;
  /** Why it deserves attention now. Absent on a Move that did not say. */
  whyNow: string | null;
  /** Absent when the task came from a stored origin, which carries no rating. */
  impact: keyof typeof IMPACT_LABELS | null;
  effort: keyof typeof EFFORT_LABELS | null;
  lens: BusinessLens | null;
  /**
   * The one plan step this run is doing. Null before a run is bound to one.
   *
   * A run executes a *step*, never a whole Move — the start action submits a
   * step key and the spec records it — and until this existed the screen said
   * only the Move, so a founder watching the agent work could not tell which
   * part of a five-step plan was being built.
   */
  step: { order: number; title: string } | null;
  /**
   * What this run will do: its absorbed preparation and every step it delivers,
   * in plan order. Not the whole plan — see `resolveTask`.
   *
   * The kinds are not decoration. Preparation is work the run performs on the
   * way to its objective and the plan step for it is never marked done;
   * a delivery is a step this one run completes. Before build chains the list
   * was one delivery and its preparation, so a flat list of titles was
   * unambiguous. With a chain it is not: three bullets could be one delivery
   * with two preparations, or three deliveries, and those are different offers
   * at different prices.
   */
  steps: { title: string; kind: "preparation" | "delivery" }[];
};

export function AgentTaskPanel({
  task,
  compact = false,
  summary = false,
}: {
  task: AgentTask;
  compact?: boolean;
  /**
   * The condensed task identity used above stages three to five. It keeps the
   * same stored task data, but leaves the execution checklist and rationale in
   * the stage where they are useful instead of making the header a second
   * page.
   */
  summary?: boolean;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <div
      className={cn("flex min-w-0 flex-col", summary ? "gap-3" : "gap-4")}
      data-testid="agent-task"
      data-variant={summary ? "summary" : compact ? "compact" : "full"}
    >
      <MonoLabel className="text-mint">Current task</MonoLabel>

      {/*
        The step is the headline once a run is bound to one, and the Move stays
        above it as context. Both, deliberately: the step says what is being
        built, the Move says what it is for — and the summary variant sits above
        the approval stages, which is exactly where knowing which step's change
        is being approved matters most.
      */}
      {task.step !== null && (
        <p className="text-fg-muted text-sm" data-testid="agent-task-move">
          Step {String(task.step.order).padStart(2, "0")} · {task.title}
        </p>
      )}

      <h2
        className={cn(
          "text-fg leading-tight font-bold tracking-[-0.03em] text-balance",
          summary ? "text-[1.625rem]" : compact ? "text-2xl" : "text-[2rem]",
        )}
        data-testid="agent-task-headline"
      >
        {task.step?.title ?? task.title}
      </h2>

      <div className="flex flex-wrap items-center gap-3">
        {task.lens !== null && (
          <span className="text-fg-body flex items-center gap-2.5 text-[0.9375rem] font-medium">
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              className="text-mint"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="8.5" />
              <circle cx="12" cy="12" r="4.5" />
              <circle cx="12" cy="12" r=".9" />
            </svg>
            {LENS_LABELS[task.lens]}
          </span>
        )}
        {/* Ratings are the Move's own. A task recovered from a stored origin
            has none, and guessing "medium" would be an assessment nobody made. */}
        {task.impact !== null && (
          <span className="rounded-full border-mint-line bg-mint-tint text-mint border px-3 py-1 text-xs font-semibold">
            {IMPACT_LABELS[task.impact]}
          </span>
        )}
        {task.effort !== null && (
          <span className="rounded-full border-amber-line bg-amber-tint text-amber border px-3 py-1 text-xs font-semibold">
            {EFFORT_LABELS[task.effort]}
          </span>
        )}
      </div>

      <p
        className={cn(
          "text-fg-prose text-pretty",
          summary
            ? "max-w-[56ch] text-[0.9375rem] leading-relaxed"
            : "max-w-[46ch] text-base leading-relaxed",
        )}
      >
        {task.problem}
      </p>

      {!summary && task.steps.length > 0 && (
        <div className="border-line-3 mt-1.5 flex flex-col gap-3.5 border-t pt-5">
          <MonoLabel className="text-mint">Vibe will</MonoLabel>
          <ul className="flex flex-col gap-3">
            {task.steps.map((step, index) => (
              <motion.li
                key={`${step.kind}:${step.title}`}
                data-testid={`agent-task-step-${step.kind}`}
                className="text-fg-body flex items-center gap-3 text-[0.9375rem]"
                initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.4,
                  ease: [0.2, 0.7, 0.2, 1],
                  delay: reduceMotion ? 0 : index * 0.08,
                }}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-5 flex-none items-center justify-center rounded-full border text-[11px]",
                    step.kind === "delivery"
                      ? "border-mint-line bg-mint-tint text-mint"
                      : "border-line-3 text-fg-meta",
                  )}
                >
                  {step.kind === "delivery" ? "✓" : "·"}
                </span>
                {step.title}
                {step.kind === "preparation" && (
                  /* Named rather than left to the marker alone. A founder
                     reading three bullets is deciding what they are paying
                     for, and colour is not a word. */
                  <span className="text-fg-meta text-xs">groundwork</span>
                )}
              </motion.li>
            ))}
          </ul>
          {task.steps.filter((step) => step.kind === "delivery").length > 1 && (
            /*
              What a chained run actually produces, said where the steps are
              listed. "3 steps done" would imply three changes and three
              verdicts; there is one of each, and rule 66 is the standard for
              not letting a screen imply a stronger claim than was made.
            */
            <p className="text-fg-meta text-xs" data-testid="agent-task-chain-note">
              {buildChainCompletionNote(
                task.steps.filter((step) => step.kind === "delivery").length,
              )}
            </p>
          )}
        </div>
      )}

      {!summary && task.whyNow !== null && (
        <Well className="mt-2 flex gap-3.5 p-4">
          <svg
            viewBox="0 0 24 24"
            width="19"
            height="19"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-mint mt-px flex-none"
            aria-hidden="true"
          >
            <path d="M12 3c.6 3.5 2.5 5.4 6 6-3.5.6-5.4 2.5-6 6-.6-3.5-2.5-5.4-6-6 3.5-.6 5.4-2.5 6-6Z" />
            <path d="M18.5 15.5c.25 1.6 1.1 2.45 2.5 2.75-1.4.3-2.25 1.15-2.5 2.75-.25-1.6-1.1-2.45-2.5-2.75 1.4-.3 2.25-1.15 2.5-2.75Z" />
          </svg>
          <span className="flex flex-col gap-1.5">
            <span className="text-fg-body text-[0.9375rem] font-semibold">Why this task?</span>
            <span className="text-fg-muted max-w-[48ch] text-sm leading-relaxed">
              {task.whyNow}
            </span>
          </span>
        </Well>
      )}
    </div>
  );
}
