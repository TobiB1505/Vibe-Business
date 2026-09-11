import { Suspense } from "react";
import { AgentBuildStage } from "../agent/agent-build-stage";
import { AgentCore } from "../agent/agent-core";
import { NovaAgentLive } from "./nova-agent-live";
import { agentCoreCaption } from "@/modules/coding-agent/observability/agent-stages";
import { readAgentWorkspace } from "@/modules/coding-agent/agent-workspace";
import { requireProjectAccess } from "@/modules/projects/workspace-context";
import type { StoredExecutionEvent } from "@/modules/coding-agent/observability/events";

/**
 * The agent at work, on the Agent's own build stage, inside Nova's thread.
 *
 * ## What was here, and what it was missing
 *
 * `NovaAgentLive` — the polling file list, and nothing else. It is a real
 * piece of the build stage and it was the only piece: a founder who had just
 * spent Credits watched filenames appear and could not see the run itself.
 * `AgentBuildStage` is the screen the Agent route draws for the same run: the
 * task that was asked for, the core that turns while work happens, and that
 * same list beside it.
 *
 * ## Why it streams, and why the fallback is not a skeleton
 *
 * `readNovaHomeData`'s own docblock refuses the Agent workspace read, and it is
 * right to: that read resolves the run view, the interrupt, the reservation and
 * the prepared change — and the last of those signs review images and
 * preflights a merge against GitHub. Home is the most-visited page in the
 * product and its reading was built to make no network call at all.
 *
 * Two things make this affordable rather than a reversal of that decision.
 * The expensive half is conditional: `getPreparedChangeWorkspaceItem` runs only
 * when the operation already has a `resultId`, and a run that is *still
 * writing* has none — so during the stage this component draws, the read is
 * five database queries, no GitHub and no signing. And it happens behind a
 * `Suspense` boundary, so Home's first paint never waits on it, exactly as the
 * Agent route arranges the same read.
 *
 * The fallback is `NovaAgentLive` itself: what the thread showed before this
 * existed. A founder sees the file list immediately and the stage assembles
 * around it — rather than a skeleton pretending to be a screen, which is the
 * loading frame this repository already learned not to draw.
 */
export function NovaAgentStage(props: {
  projectId: string;
  operationId: string;
  initialEvents: readonly StoredExecutionEvent[];
  initialStage: string;
  shouldPoll: boolean;
}) {
  return (
    <Suspense fallback={<NovaAgentLive {...props} />}>
      <NovaAgentStageBody {...props} />
    </Suspense>
  );
}

async function NovaAgentStageBody({
  projectId,
  operationId,
  initialEvents,
  initialStage,
  shouldPoll,
}: {
  projectId: string;
  operationId: string;
  initialEvents: readonly StoredExecutionEvent[];
  initialStage: string;
  shouldPoll: boolean;
}) {
  /*
   * Its own access, the way the Agent route resolves it. Threading a client
   * and a user id through `runningBlockFor` would put a session concern in a
   * function whose job is choosing a component.
   */
  const { supabase, userId, project } = await requireProjectAccess(projectId);

  const workspace = await readAgentWorkspace(supabase, {
    projectId,
    userId,
    repositoryFullName: project.repository?.fullName ?? null,
    /*
     * Null on purpose, and it is the whole reason this is cheap. Naming a
     * change here is what makes the workspace read sign images and preflight a
     * merge; a run that is still writing has no change to name, and the one it
     * produces is drawn by `ReviewBlock` from the card Home already holds.
     */
    selectedPreparedChangeId: null,
  });

  const live = shouldPoll;

  return (
    <AgentBuildStage
      presentation="block"
      task={workspace.task}
      live={live}
      core={
        <AgentCore
          state={workspace.core}
          /* The caption is derived from the stages, never written here: one
             sentence about a run, from the run's own steps. */
          caption={agentCoreCaption(workspace.stages)}
          /* `compact`, not `hero`: the hero size is drawn for a full page and
             the thread column is a fraction of one. */
          size="compact"
        />
      }
      activity={
        <NovaAgentLive
          projectId={projectId}
          operationId={operationId}
          initialEvents={initialEvents}
          initialStage={initialStage}
          shouldPoll={shouldPoll}
        />
      }
    />
  );
}
