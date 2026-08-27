"use client";

import { motion, useReducedMotion } from "motion/react";
import { Surface } from "@/components/ui/surface";
import { MonoLabel } from "@/components/ui/typography";
import type {
  AgentCoreState,
  AgentStageStep,
} from "@/modules/coding-agent/observability/agent-stages";
import { AgentCore } from "./agent-core";
import { AgentStageRail } from "./agent-stage-rail";

/**
 * The Agent's signature panel (UI-19).
 *
 * ## The composition, and why it is this way round
 *
 * The rail sits above and the core beside the work. A founder arriving mid-run
 * asks two questions in this order — *where is this* and *what is it doing* —
 * and the rail answers the first in one glance while the core answers the
 * second without pretending to know how much is left.
 *
 * The core is not the hero. It is the thing to look at during a wait that has
 * no percentage, which is a smaller job than the reference composition implies
 * and the only honest one available.
 *
 * ## Geometry is reserved
 *
 * The panel's shape does not change as stages complete. Product Scan learned
 * this the expensive way: a surface that grows as events arrive moves the text
 * somebody is reading. Stages change their marks and their words in place.
 */
export function AgentWorkspacePanel({
  stages,
  core,
  caption,
  children,
}: {
  stages: AgentStageStep[];
  core: AgentCoreState;
  caption: string;
  /** The current stage's own body, rendered by the route. */
  children?: React.ReactNode;
}) {
  const reduceMotion = useReducedMotion();

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

        <AgentStageRail steps={stages} />

        {/*
          One column on a phone, and the core second there: on a narrow screen
          the words matter more than the picture, and a founder should not have
          to scroll past an animation to find out what is happening.
        */}
        <motion.div
          className="grid min-w-0 gap-7 lg:grid-cols-[minmax(0,1.5fr)_minmax(18rem,1fr)] lg:items-start"
          initial={reduceMotion ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.2, 0.7, 0.2, 1], delay: reduceMotion ? 0 : 0.3 }}
        >
          <div className="order-2 min-w-0 lg:order-1">{children}</div>
          <div className="order-1 flex justify-center lg:order-2 lg:justify-end">
            <AgentCore state={core} caption={caption} />
          </div>
        </motion.div>
      </div>
    </Surface>
  );
}
