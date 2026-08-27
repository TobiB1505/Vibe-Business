"use client";

import { motion, useReducedMotion } from "motion/react";
import { MonoLabel } from "@/components/ui/typography";
import { Well } from "@/components/ui/surface";
import { cn } from "@/lib/utils/cn";
import { LENS_LABELS } from "@/modules/business-audit/map-view";
import type { BusinessLens } from "@/modules/business-audit/schema";

/**
 * The task the agent is working on (UI-19, artboards 2a–2c).
 *
 * ## Everything here is stored, or absent
 *
 * The headline, the lens, the impact and effort chips, the problem and the
 * "why this" line are the Move's own fields. The checklist is the Action Plan's
 * steps, by their titles. Nothing is generated for the screen: a Move without
 * a plan shows no checklist rather than an invented one, and a Move with no
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
  /** Step titles from the stored Action Plan. Empty when there is no plan. */
  steps: string[];
};

export function AgentTaskPanel({ task, compact = false }: { task: AgentTask; compact?: boolean }) {
  const reduceMotion = useReducedMotion();

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="agent-task">
      <MonoLabel className="text-mint">Current task</MonoLabel>

      <h2
        className={cn(
          "text-fg leading-tight font-bold tracking-[-0.03em] text-balance",
          compact ? "text-2xl" : "text-[2rem]",
        )}
      >
        {task.title}
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

      <p className="text-fg-prose max-w-[46ch] text-base leading-relaxed text-pretty">
        {task.problem}
      </p>

      {task.steps.length > 0 && (
        <div className="border-line-3 mt-1.5 flex flex-col gap-3.5 border-t pt-5">
          <MonoLabel className="text-mint">Vibe will</MonoLabel>
          <ul className="flex flex-col gap-3">
            {task.steps.map((step, index) => (
              <motion.li
                key={step}
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
                  className="border-mint-line bg-mint-tint text-mint flex size-5 flex-none items-center justify-center rounded-full border text-[11px]"
                >
                  ✓
                </span>
                {step}
              </motion.li>
            ))}
          </ul>
        </div>
      )}

      {task.whyNow !== null && (
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
