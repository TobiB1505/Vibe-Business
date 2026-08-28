"use client";

import { useCallback, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Surface } from "@/components/ui/surface";
import type {
  AgentStage,
  AgentStageStep,
} from "@/modules/coding-agent/observability/agent-stages";
import { AgentStageRail } from "./agent-stage-rail";
import { StageNavigationProvider } from "./agent-stage-navigation";

/**
 * The Agent's signature panel (UI-19).
 *
 * ## The frame, and what belongs in it
 *
 * The implementation target uses three deliberate compositions rather than a
 * single dashboard template: Understand is a task-and-Agent hero, Build keeps
 * the tracker and the three live columns inside one card, and Validate through
 * Review separate task identity, tracker and stage content into three calm
 * surfaces. This component owns that composition while every body continues
 * to own only the content of its stage.
 *
 * What is *not* a region is the orb. It was one here — a fixed middle column
 * rendered on all five stages — and that is why it appeared beside a finished
 * merge saying "Vibe is preparing what you need in order to decide". The
 * reference gives it exactly two moments: the hero before a run, and the run
 * itself. So it is now something a stage body may contain, and four of them
 * do not.
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
 * below them starts a poller it does not need.
 */
export function AgentWorkspacePanel({
  stages,
  header,
  initialStage,
  bodies,
  asides,
}: {
  stages: AgentStageStep[];
  /**
   * The compact task identity above Validate, Preview and Review. Understand
   * and Build carry the task in their own target composition.
   */
  header?: React.ReactNode;
  /** The stage the run is actually on. Where the founder lands. */
  initialStage: AgentStage | null;
  /** One body per stage that has something to show. */
  bodies: Partial<Record<AgentStage, React.ReactNode>>;
  /** Legacy second-column seam for callers that have not moved the aside into their stage body. */
  asides?: Partial<Record<AgentStage, React.ReactNode>>;
}) {
  const reduceMotion = useReducedMotion();
  const [selected, setSelected] = useState<AgentStage | null>(initialStage);

  const openable = (Object.keys(bodies) as AgentStage[]).filter(
    (name) => bodies[name],
  );

  /*
   * Where to land when nothing is running.
   *
   * `initialStage` is the *active* stage, and a run that has not started has
   * none — which used to render an empty body beside the orb. The first stage
   * with something to show is the honest answer, and for a project that has
   * never run it is Understand, which carries the control that begins work.
   */
  const landing = initialStage ?? openable[0] ?? null;
  const shown = selected !== null && bodies[selected] ? selected : landing;
  const body = shown !== null ? bodies[shown] : undefined;
  const aside = shown !== null ? asides?.[shown] : undefined;

  const go = useCallback((stage: AgentStage) => setSelected(stage), []);

  const content = aside ? (
    <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(19rem,1fr)] lg:items-start">
      <div className="min-w-0">{body}</div>
      <div className="min-w-0">{aside}</div>
    </div>
  ) : (
    <div className="min-w-0">{body}</div>
  );

  const animatedContent = (
    <motion.div
      key={shown ?? "none"}
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.2, 0.7, 0.2, 1] }}
    >
      {content}
    </motion.div>
  );

  const lateStage = shown === "validate" || shown === "preview" || shown === "review";

  return (
    <StageNavigationProvider value={go}>
      <div className="flex min-w-0 flex-col gap-5" data-current-stage={shown ?? "none"}>
        {lateStage && header !== undefined && (
          <Surface level="panel" padding="none" className="p-5 sm:p-6 lg:px-7 lg:py-6">
            {header}
          </Surface>
        )}

        {shown === "understand" && (
          <Surface
            level="card"
            padding="none"
            className="overflow-hidden p-5 sm:p-7 lg:p-[2.125rem]"
          >
            {animatedContent}
          </Surface>
        )}

        {shown === "build" && (
          <Surface
            level="card"
            padding="none"
            className="relative overflow-hidden p-5 sm:p-7 lg:p-[1.875rem_2.125rem_2.125rem]"
          >
            <span
              aria-hidden="true"
              className="pointer-events-none absolute -top-52 left-1/2 h-[28rem] w-[44rem] -translate-x-1/2 rounded-full blur-3xl"
              style={{
                background:
                  "radial-gradient(circle, color-mix(in oklab, var(--color-mint) 10%, transparent), transparent 70%)",
              }}
            />
            <div className="relative flex flex-col gap-8">
              <AgentStageRail
                steps={stages}
                selected={shown}
                openable={openable}
                onSelect={setSelected}
              />
              {animatedContent}
            </div>
          </Surface>
        )}

        {lateStage && (
          <>
            <AgentStageRail
              steps={stages}
              selected={shown}
              openable={openable}
              onSelect={setSelected}
            />
            <Surface
              level="card"
              padding="none"
              className="overflow-hidden p-5 sm:p-7 lg:p-[1.875rem_2.125rem]"
            >
              {animatedContent}
            </Surface>
          </>
        )}
      </div>
    </StageNavigationProvider>
  );
}
