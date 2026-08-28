"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Surface } from "@/components/ui/surface";
import { MonoLabel } from "@/components/ui/typography";
import type {
  AgentCoreState,
  AgentStage,
  AgentStageStep,
} from "@/modules/coding-agent/observability/agent-stages";
import { AgentCore } from "./agent-core";
import { AgentStageRail } from "./agent-stage-rail";

/**
 * The Agent's signature panel (UI-19).
 *
 * ## Why the stage switch is client-side
 *
 * It was a `?stage=` link, and every click cost three to four seconds. Not
 * because a stage body is expensive — because the *page* is: the prepared-change
 * workspace read makes up to four GitHub calls per change, signs image URLs and
 * asks the sandbox provider for a preview origin. A server navigation re-ran all
 * of it to change which of five already-fetched things was on screen.
 *
 * So the route renders every stage's body once and this holds which one is
 * shown. The unselected ones are React elements that never mount, so no panel
 * below them starts a poller it does not need. Switching is now free, which is
 * what it always should have been: the founder is looking at one run from five
 * angles, not navigating between five pages.
 *
 * ## What each region answers
 *
 *   the rail      where the work is, and what else there is to look at
 *   the core      whether Vibe is doing something right now
 *   the body      the one stage the founder is looking at
 *   the aside     what has happened, in that stage's own terms
 */
export function AgentWorkspacePanel({
  stages,
  core,
  caption,
  headline,
  initialStage,
  bodies,
  asides,
}: {
  stages: AgentStageStep[];
  core: AgentCoreState;
  caption: string;
  headline?: string;
  /** The stage the run is actually on. Where the founder lands. */
  initialStage: AgentStage | null;
  /** One body per stage that has something to show. */
  bodies: Partial<Record<AgentStage, React.ReactNode>>;
  /** The third column, per stage — each stage reports its own kind of progress. */
  asides?: Partial<Record<AgentStage, React.ReactNode>>;
}) {
  const reduceMotion = useReducedMotion();
  const [selected, setSelected] = useState<AgentStage | null>(initialStage);

  const shown = selected !== null && bodies[selected] ? selected : initialStage;
  const body = shown !== null ? bodies[shown] : undefined;
  const aside = shown !== null ? asides?.[shown] : undefined;

  return (
    <Surface level="panel" padding="none" className="overflow-hidden p-4 sm:p-5 lg:p-6">
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <MonoLabel as="h2" className="text-fg-secondary">
            Agent
          </MonoLabel>
          <span className="text-fg-meta font-mono text-[0.6875rem]">
            {stages.length} stages · nothing is applied without you
          </span>
        </div>

        <AgentStageRail
          steps={stages}
          selected={shown}
          openable={Object.keys(bodies) as AgentStage[]}
          onSelect={setSelected}
        />

        <motion.div
          className={
            aside
              ? "grid min-w-0 gap-7 lg:items-start xl:grid-cols-[minmax(0,1fr)_minmax(20rem,auto)_minmax(0,1fr)]"
              : "grid min-w-0 gap-7 lg:grid-cols-[minmax(0,1.5fr)_minmax(18rem,1fr)] lg:items-start"
          }
          /* Keyed on the stage so a switch fades rather than snapping, and
             settles well inside the entrance budget. */
          key={shown ?? "none"}
          initial={reduceMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: [0.2, 0.7, 0.2, 1] }}
        >
          <div className="order-2 min-w-0 lg:order-1">{body}</div>
          <div className="order-1 flex justify-center lg:order-2">
            <AgentCore
              state={core}
              caption={caption}
              headline={headline}
              size={core === "working" || core === "waiting" ? "compact" : "hero"}
            />
          </div>
          {aside && <div className="order-3 min-w-0">{aside}</div>}
        </motion.div>
      </div>
    </Surface>
  );
}
