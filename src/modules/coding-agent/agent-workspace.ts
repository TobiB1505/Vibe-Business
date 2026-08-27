import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PreparedChangeWorkspaceItem } from "@/modules/execution/workspace";
import { findLatestOperation } from "@/modules/operations/store";
import {
  agentCoreState,
  agentStageSteps,
  type AgentCoreState,
  type AgentStageStep,
} from "./observability/agent-stages";
import { buildAgentExecutionLiveModel, type AgentExecutionLiveModel } from "./observability/live-view";
import { readAgentRunForLiveView } from "./observability/run-view";
import { getAgentExecutionStatus } from "./service";

/**
 * What the Agent route needs to draw itself (UI-19).
 *
 * ## One read, because the five stages are one story
 *
 * The stages span an agent run and the prepared change it produced. Asking for
 * those separately from the component tree is how two halves of one stepper end
 * up disagreeing — the run says finished while the change still says
 * unvalidated, and the screen shows both.
 *
 * ## What it costs when nothing has run
 *
 * One row. A project that has never started the agent has no operation, so
 * there is no live model to build and no change to look up, and the page
 * renders its idle state off a single miss. The expensive reads only happen for
 * a project that has something to show.
 */
export type AgentWorkspaceView = {
  stages: AgentStageStep[];
  core: AgentCoreState;
  /** Null until a run exists. Drives the stage bodies for Understand → Validate. */
  live: AgentExecutionLiveModel | null;
  /** The change this run produced, once it has produced one. */
  change: PreparedChangeWorkspaceItem | null;
};

export async function readAgentWorkspace(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    userId: string;
    /**
     * The prepared changes the route already read. Passed in rather than read
     * again: the workspace read is the expensive one on this route, and paying
     * for it twice to answer one question about one change would be the cost
     * UI-2 split it apart to avoid.
     */
    changes: readonly PreparedChangeWorkspaceItem[];
  },
): Promise<AgentWorkspaceView> {
  const { projectId, userId, changes } = params;

  const stored = await findLatestOperation(supabase, {
    projectId,
    operationType: "agent_execution",
  });

  const idle = () => {
    const stages = agentStageSteps({ timeline: null, runStatus: null, changeProgress: null });
    return { stages, core: agentCoreState(stages), live: null, change: null };
  };

  if (stored === null) return idle();

  /*
   * Delegated rather than rebuilt. This is the call that also repairs a run
   * whose workflow died holding Credits — a read is the right moment for that
   * because it is the moment somebody cares — and reassembling the view here
   * would quietly skip it.
   */
  const operation = await getAgentExecutionStatus(supabase, {
    projectId,
    userId,
    operationId: stored.id,
  });
  if (operation === null) return idle();

  const runId = operation.agentExecutionRunId;

  const runView = runId ? await readAgentRunForLiveView(supabase, { runId, projectId }) : null;

  const live = await buildAgentExecutionLiveModel(supabase, {
    operation,
    projectId,
    run: runView?.run ?? null,
    limits: runView?.limits ?? null,
    gatewayRequestCeiling: runView?.gatewayRequestCeiling ?? null,
    validation: runView?.validation ?? "not_started",
  });

  /*
   * `resultId` is the prepared change a completed run wrote. Matched by id
   * rather than by taking the newest change: a project can hold several, and
   * the stepper is about *this* run's change. Taking the newest would show a
   * founder the gates of a change their last run did not produce.
   */
  const change = operation.resultId
    ? (changes.find((candidate) => candidate.id === operation.resultId) ?? null)
    : null;

  const stages = agentStageSteps({
    timeline: live.timeline,
    runStatus: operation.status,
    changeProgress: change?.progress ?? null,
    // Files the harness actually read, from its own tool stream.
    filesInspected: live.metrics.filesRead,
    // Vibe's verified candidate count — never the number of files the runtime
    // touched, which is a different and larger number.
    filesChanged: live.files.filter((file) => file.kind === "candidate").length,
  });

  return { stages, core: agentCoreState(stages), live, change };
}
