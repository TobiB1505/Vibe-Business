"use server";

import { redirect } from "next/navigation";
import { requireSession } from "@/modules/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  answerExecutionInterrupt,
  findOpenInterruptForRun,
  listAgentActivity,
  type StoredAgentActivity,
  type StoredExecutionInterrupt,
} from "@/modules/coding-agent/store";
import { getAgentExecutionStatus, startAgentExecution } from "@/modules/coding-agent/service";
import type { AgentStartRefusal } from "@/modules/coding-agent/service";
import { previewDogfoodStep } from "@/modules/coding-agent/website-preflight";
import { persistAgentExecutionSpec } from "@/modules/operations/agent-execution/server-writes";
import { VercelWorkflowExecutor } from "@/modules/operations/vercel/executor";
import type { ExecutionInterruptAnswer } from "@/modules/execution-contract/schema";
import {
  buildAgentExecutionLiveModel,
  type AgentExecutionLiveModel,
} from "@/modules/coding-agent/observability/live-view";
import { readAgentRunForLiveView } from "@/modules/coding-agent/observability/run-view";

/**
 * The internal dogfood website actions (EXECUTION CORE-4 website gate, §7,
 * §12, §13, §14, §18, §24).
 *
 * Every action here re-resolves ownership and eligibility from the session —
 * none of it is trusted from a client argument, and the browser never submits
 * anything beyond a project id, a step key and (for the interrupt action) an
 * answer shaped to a schema Vibe already stored (§7, §8).
 */

export type StartDogfoodRunState =
  | { ok: false; error: AgentStartRefusal | "not_eligible" | "spec_not_persisted" }
  | null;

/**
 * The one explicit user action that may start a paid run (§12).
 *
 * Re-runs the *entire* preflight chain fresh — not a cache of what the page
 * rendered a moment ago (§14) — then hands the freshly resolved spec id to
 * `startAgentExecution`, which is itself idempotent by identity (§13, §56):
 * a double submission, a network retry, or two tabs open on the same step all
 * resolve to the one active run.
 *
 * Redirects rather than returning a "success" state, so the URL itself is the
 * durable pointer a reload recovers from (§18) — there is no in-memory step
 * between "admitted" and "the status page is showing it".
 */
export async function startDogfoodRunAction(
  projectId: string,
  stepKey: string,
  _prevState: StartDogfoodRunState,
): Promise<StartDogfoodRunState> {
  const session = await requireSession();
  const supabase = await createClient();

  const preview = await previewDogfoodStep(supabase, {
    projectId,
    userId: session.userId,
    stepKey,
  });

  if (!preview.eligible) return { ok: false, error: "not_eligible" };

  /*
   * The write happens here, on the click, and nowhere else.
   *
   * The preview builds the spec; this persists it. Separated because an
   * immutable audit row is not something a page render should mint, and
   * because `execution_specs` accepts no insert from the caller's own client
   * by design — the service-role writer lives in `operations/`, which is the
   * only place Rule 53 permits it.
   *
   * Idempotent by the spec's identity: a double submission, a retry or two
   * tabs on the same step all resolve to the same row, and then to the same
   * run.
   */
  const persisted = await persistAgentExecutionSpec({
    spec: preview.spec,
    userId: session.userId,
    repositoryConnectionId: preview.repositoryConnectionId,
  });

  if (!persisted.ok) {
    return { ok: false, error: persisted.error === "project_not_found" ? "project_not_found" : "spec_not_persisted" };
  }

  const outcome = await startAgentExecution(supabase, new VercelWorkflowExecutor(), {
    projectId,
    userId: session.userId,
    executionSpecId: persisted.executionSpecId,
  });

  if (outcome.kind === "failed") return { ok: false, error: outcome.error };

  if (outcome.kind === "reused") {
    redirect(`/app/projects/${projectId}/prepared`);
  }

  redirect(
    `/app/projects/${projectId}/agent-dogfood/${encodeURIComponent(stepKey)}?run=${outcome.operation.operationId}`,
  );
}

export type DogfoodRunStatus = {
  /**
   * Everything the reusable live view renders.
   *
   * Assembled by a module rather than by this page, so the same model can be
   * mounted in the production dashboard later without any of this logic moving
   * with it (EXECUTION CORE-4 observability).
   */
  live: AgentExecutionLiveModel;
  activity: StoredAgentActivity[];
  openInterrupt: StoredExecutionInterrupt | null;
};

/** Durable status, re-read from the database on every call (§16, §18, §20). */
export async function getDogfoodRunStatusAction(
  projectId: string,
  operationId: string,
): Promise<DogfoodRunStatus | null> {
  const session = await requireSession();
  const supabase = await createClient();

  const operation = await getAgentExecutionStatus(supabase, {
    projectId,
    userId: session.userId,
    operationId,
  });
  if (!operation) return null;

  if (!operation.agentExecutionRunId) {
    return {
      live: await buildAgentExecutionLiveModel(supabase, { operation, projectId, run: null }),
      activity: [],
      openInterrupt: null,
    };
  }

  const [activity, openInterrupt, runView] = await Promise.all([
    listAgentActivity(supabase, { runId: operation.agentExecutionRunId, projectId }),
    findOpenInterruptForRun(supabase, {
      projectId,
      agentExecutionRunId: operation.agentExecutionRunId,
    }),
    readAgentRunForLiveView(supabase, {
      runId: operation.agentExecutionRunId,
      projectId,
    }),
  ]);

  const live = await buildAgentExecutionLiveModel(supabase, {
    operation,
    projectId,
    run: runView?.run ?? null,
    limits: runView?.limits ?? null,
    gatewayRequestCeiling: runView?.gatewayRequestCeiling ?? null,
    validation: runView?.validation ?? "not_started",
  });

  return { live, activity, openInterrupt };
}

export type AnswerInterruptState =
  | { ok: true }
  | { ok: false; error: "not_found" | "invalid_answer" | "not_open" }
  | null;

/**
 * Answers a raised question (§24, §49).
 *
 * `answerExecutionInterrupt` re-scopes ownership by project *and* user and
 * validates the answer against the stored schema — the browser cannot answer
 * a question it cannot see, and it cannot supply an answer shape the run never
 * offered.
 */
export async function answerDogfoodInterruptAction(
  projectId: string,
  interruptId: string,
  answer: ExecutionInterruptAnswer,
): Promise<AnswerInterruptState> {
  const session = await requireSession();
  const supabase = await createClient();

  const result = await answerExecutionInterrupt(supabase, {
    projectId,
    userId: session.userId,
    interruptId,
    answer,
  });

  if (!result.ok) return { ok: false, error: result.reason };
  return { ok: true };
}
