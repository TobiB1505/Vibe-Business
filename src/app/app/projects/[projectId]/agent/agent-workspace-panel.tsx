"use client";

import { useCallback, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Surface } from "@/components/ui/surface";
import { MonoLabel } from "@/components/ui/typography";
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
 * The reference builds this screen as three fixed regions and then varies only
 * the last one:
 *
 *   the header    what Vibe is working on — the same on every stage
 *   the rail      where the work is, and what else there is to look at
 *   the body      the one stage the founder is looking at, in its own layout
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
   * What Vibe is working on, above the rail and constant across stages.
   *
   * It used to live inside the Understand body, which meant it vanished the
   * moment the founder looked at any other stage — leaving five steps and no
   * statement of what they were steps toward.
   */
  header?: React.ReactNode;
  /** The stage the run is actually on. Where the founder lands. */
  initialStage: AgentStage | null;
  /** One body per stage that has something to show. */
  bodies: Partial<Record<AgentStage, React.ReactNode>>;
  /** The second column, per stage — each stage reports its own kind of progress. */
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

  return (
    <StageNavigationProvider value={go}>
      <Surface
        level="panel"
        padding="none"
        className="overflow-hidden p-4 sm:p-5 lg:p-6"
      >
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <MonoLabel as="h2" className="text-fg-secondary">
              Agent
            </MonoLabel>
            <span className="text-fg-meta font-mono text-[0.6875rem]">
              {stages.length} stages · nothing is applied without you
            </span>
          </div>

          {header}

          <AgentStageRail
            steps={stages}
            selected={shown}
            openable={openable}
            onSelect={setSelected}
          />

          <motion.div
            className={
              aside
                ? "grid min-w-0 gap-7 lg:grid-cols-[minmax(0,1.6fr)_minmax(19rem,1fr)] lg:items-start"
                : "min-w-0"
            }
            /* Keyed on the stage so a switch fades rather than snapping, and
               settles well inside the entrance budget. */
            key={shown ?? "none"}
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, ease: [0.2, 0.7, 0.2, 1] }}
          >
            <div className="min-w-0">{body}</div>
            {aside && <div className="min-w-0">{aside}</div>}
          </motion.div>
        </div>
      </Surface>
    </StageNavigationProvider>
  );
}
