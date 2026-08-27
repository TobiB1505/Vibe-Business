import {
  agentCoreCaption,
  agentCoreState,
  agentStageSteps,
  type AgentCoreState,
  type AgentStageStep,
} from "@/modules/coding-agent/observability/agent-stages";
import type { ChangeStage } from "@/modules/execution/change-progress";
import type { OperationStatus } from "@/modules/operations/schema";
import type { TimelineStep } from "@/modules/coding-agent/observability/timeline";

/**
 * The Agent rail's states, in a browser (UI-19).
 *
 * ## Why these need a browser at all
 *
 * The unit tests already prove the *view model* — which stage is active, which
 * is skipped, that no caption estimates. What they cannot see is the thing this
 * sprint is actually about: whether a founder can tell those states apart on a
 * screen. A rail that renders `skipped` and `pending` identically passes every
 * unit test in the file and still tells somebody to keep waiting for work that
 * will never happen.
 *
 * And reduced motion is only real in a browser. `prefers-reduced-motion` is a
 * media query; no assertion about it means anything until something has
 * evaluated it.
 *
 * The steps come from the real `agentStageSteps`, so a change to the rules
 * reaches these screens rather than leaving a fixture behind.
 */

const PHASES = [
  "preparing",
  "working",
  "reviewing_change",
  "preparing_branch",
  "validating",
  "finished",
] as const;

function timeline(states: Partial<Record<(typeof PHASES)[number], TimelineStep["state"]>>): TimelineStep[] {
  return PHASES.map((phase) => ({
    phase,
    label: phase,
    state: states[phase] ?? "pending",
    detail: null,
  }));
}

function progress(stage: ChangeStage) {
  return {
    stage,
    headline: `Headline for ${stage}.`,
    earlySettled: false,
    approved: false,
    merged: stage === "merged",
  };
}

type Fixture = { steps: AgentStageStep[]; core: AgentCoreState; caption: string };

function build(input: Parameters<typeof agentStageSteps>[0]): Fixture {
  const steps = agentStageSteps(input);
  return { steps, core: agentCoreState(steps), caption: agentCoreCaption(steps) };
}

const running = (status: OperationStatus = "running") => ({
  timeline: timeline({ preparing: "done", working: "active" }),
  runStatus: status,
  changeProgress: null,
  filesInspected: 6,
});

export const E2E_AGENT_STAGE_SCENARIOS = {
  /** Nothing has ever run. Five pending stages and an idle core. */
  "agent-stages-idle": () =>
    build({ timeline: null, runStatus: null, changeProgress: null }),

  /** Mid-run. One stage lit, the rest ahead of it. */
  "agent-stages-building": () => build(running()),

  /** The run stopped to ask a question. Amber, and nothing claiming progress. */
  "agent-stages-paused": () => build(running("needs_user")),

  /**
   * The state the rail exists for: a run that ended without reaching three of
   * its stages. Those must not read as "not yet".
   */
  "agent-stages-stopped": () =>
    build({
      timeline: timeline({ preparing: "done", working: "failed" }),
      runStatus: "failed",
      changeProgress: null,
    }),

  /** A change that reached review without a preview ever existing. */
  "agent-stages-no-preview": () =>
    build({
      timeline: timeline({
        preparing: "done",
        working: "done",
        reviewing_change: "done",
        preparing_branch: "done",
        validating: "done",
        finished: "done",
      }),
      runStatus: "completed",
      changeProgress: progress("review_unavailable"),
      filesInspected: 12,
      filesChanged: 3,
    }),
} as const;

export type E2eAgentStageScenario = keyof typeof E2E_AGENT_STAGE_SCENARIOS;

export function isE2eAgentStageScenario(value: string): value is E2eAgentStageScenario {
  return value in E2E_AGENT_STAGE_SCENARIOS;
}
