import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AGENT_TURN_CONFIG } from "@/modules/ai/operations";
import type { AIToolCallingProvider } from "@/modules/ai/provider";
import { recordAIUsage } from "@/modules/ai/usage";
import { buildAgentContextBrief } from "@/modules/business-agent/context/brief";
import { agentFallbackReply } from "@/modules/business-agent/orchestrator/fallback";
import { MAX_TRANSCRIPT_MESSAGES } from "@/modules/business-agent/orchestrator/budgets";
import { AGENT_POLICY_VERSION, runAgentTurn } from "@/modules/business-agent/orchestrator/loop";
import { AGENT_PROMPT_VERSION } from "@/modules/business-agent/orchestrator/prompt";
import { TOOL_REGISTRY_VERSION } from "@/modules/business-agent/tools/registry";
import { SKILL_REGISTRY_VERSION } from "@/modules/business-agent/skills/registry";
import { getProjectWorkspaceContext } from "@/modules/projects/workspace-context";
import { getProjectOperationRunById, setOperationStage } from "../store";
import { completeOperationRun, failOperationRun } from "../store";
import type { OperationFailureCode } from "../failures";
import {
  appendMessage,
  completeTurnRun,
  getTurnRun,
  listMessages,
  markTurnInferenceStarted,
  recordToolCalls,
} from "./store";

/**
 * The `agent_turn` steps.
 *
 * ## Plain functions, so they can be tested without a workflow platform
 *
 * Same division every other operation family uses: `workflow.ts` carries the
 * directives and nothing else; the bodies live here and take their dependencies
 * as an argument. A step returns its failure rather than throwing it, so the
 * platform cannot retry an expected outcome.
 *
 * ## One step does the whole loop, and that is deliberate
 *
 * The audit sketched a step per model call, and the transcript rebuilt from
 * rows between them. That is the right shape when steps are checkpoints a
 * platform may replay — and it is the wrong shape here, because replaying the
 * *middle* of a turn means re-sending a transcript to a model that was already
 * billed for it. `runTurnStep` therefore runs the loop once, with
 * `maxRetries = 0`, and its re-entry guard is the turn's own
 * `inference_started_at`: if a replay finds it set, the turn failed, because a
 * second attempt is a second charge for a question already asked (rule 50).
 *
 * ## What crosses a step boundary (rule 52)
 *
 * The operation id. Nothing else. The transcript, the tool results and the
 * reply are read from and written to Supabase inside the step that produced
 * them; no prompt, no model output and no untrusted source content is ever
 * handed to the durable log.
 */

export type AgentTurnDeps = { supabase: SupabaseClient; provider: AIToolCallingProvider };

export type StepOutcome<T> = ({ ok: true } & T) | { ok: false; failureCode: OperationFailureCode };

/** Both halves of a turn's identity, read once so the steps agree on it. */
async function loadTurn(deps: AgentTurnDeps, operationId: string) {
  const operation = await getProjectOperationRunById(deps.supabase, operationId);
  if (!operation) return null;
  if (!operation.resultId) return null;
  const turn = await getTurnRun(deps.supabase, operation.resultId);
  if (!turn) return null;
  // The operation row owns the project, and the turn must belong to it. A
  // mismatch is not a state this code tries to reconcile.
  if (turn.projectId !== operation.projectId) return null;
  return { operation, turn };
}

export async function runTurnStep(
  deps: AgentTurnDeps,
  operationId: string,
): Promise<StepOutcome<{ turnRunId: string }>> {
  const loaded = await loadTurn(deps, operationId);
  if (!loaded) return { ok: false, failureCode: "operation_not_found" };
  const { operation, turn } = loaded;

  if (turn.status === "succeeded" || turn.status === "failed") {
    // Already settled. A replay returns what happened rather than doing it again.
    return { ok: true, turnRunId: turn.id };
  }

  /*
   * The ambiguity rule (rule 50, rule 73). If the first attempt reached the
   * provider we do not know whether it was billed, and a durable platform
   * replaying this step would ask the same paid question twice. A turn in that
   * state fails, and the founder reads a Vibe-authored sentence about it.
   */
  if (turn.inferenceStartedAt !== null) {
    await settle(deps, {
      operationId,
      turn,
      stopReason: "inference_interrupted",
      failureCode: "inference_interrupted",
      reply: null,
    });
    return { ok: false, failureCode: "inference_interrupted" };
  }

  await setOperationStage(deps.supabase, {
    operationId,
    stage: "understanding_request",
    markRunning: true,
  });

  const project = await getProjectWorkspaceContext(deps.supabase, {
    projectId: operation.projectId,
    userId: operation.userId,
  });
  if (!project) return { ok: false, failureCode: "project_not_found" };

  const [messages, brief] = await Promise.all([
    listMessages(deps.supabase, {
      conversationId: turn.conversationId,
      projectId: operation.projectId,
    }),
    buildAgentContextBrief(deps.supabase, {
      projectId: operation.projectId,
      projectName: project.name,
    }),
  ]);

  const founderMessage = messages.find((message) => message.id === turn.founderMessageId);
  if (!founderMessage) return { ok: false, failureCode: "operation_not_found" };

  /*
   * The transcript: the last N messages *before* this one, oldest first. Not
   * the whole conversation — a thread that grew for a month would push the
   * per-call input ceiling over before the model read a single tool result.
   */
  const history = messages
    .filter((message) => message.sequence < founderMessage.sequence)
    .slice(-MAX_TRANSCRIPT_MESSAGES)
    .map((message) => ({ role: message.role, text: message.content }));

  await markTurnInferenceStarted(deps.supabase, turn.id);
  await setOperationStage(deps.supabase, { operationId, stage: "consulting_evidence" });

  const result = await runAgentTurn({
    provider: deps.provider,
    config: AGENT_TURN_CONFIG,
    context: {
      supabase: deps.supabase,
      // From the persisted operation row. Never from the model, never from a
      // caller's argument (rule 53).
      projectId: operation.projectId,
      userId: operation.userId,
    },
    contextBrief: brief.rendered,
    history,
    founderMessage: founderMessage.content,
  });

  /*
   * One ledger row per model call, successes and failures alike, before
   * anything else is written (rule 47). `job_id` is the turn run id, which is
   * why the unique index had to exempt `agent_turn` — a turn is many calls
   * under one job.
   */
  for (const call of result.modelCalls) {
    await recordAIUsage(deps.supabase, {
      userId: operation.userId,
      projectId: operation.projectId,
      operation: "agent_turn",
      provider: deps.provider.name,
      model: call.servedModel ?? AGENT_TURN_CONFIG.model,
      jobId: turn.id,
      status: call.failure === null ? "succeeded" : "failed",
      usage: call.usage ?? undefined,
      cacheReadInputTokens: call.usage?.cacheReadInputTokens,
      cacheCreationInputTokens: call.usage?.cacheCreationInputTokens,
      estimatedInputTokens: call.estimatedInputTokens,
      latencyMs: call.latencyMs,
      failureCode: call.failure,
    });
  }

  await recordToolCalls(deps.supabase, {
    turnRunId: turn.id,
    projectId: operation.projectId,
    calls: result.toolCalls,
  });

  await setOperationStage(deps.supabase, { operationId, stage: "composing_reply" });

  const assistant = await appendMessage(deps.supabase, {
    conversationId: turn.conversationId,
    projectId: operation.projectId,
    role: "assistant",
    content: result.reply,
    origin: result.replySource === "model" ? "model" : "template",
    turnRunId: turn.id,
    artifacts: result.artifacts,
  });

  await completeTurnRun(deps.supabase, {
    turnRunId: turn.id,
    // A turn that fell back still answered the founder. `succeeded` is about
    // whether the founder got a reply, and `reply_source` is how it was made.
    status: result.stop === "answered" ? "succeeded" : "failed",
    assistantMessageId: assistant.id,
    stopReason: result.stop,
    failureCode: result.stop === "answered" ? null : result.stop,
    replySource: result.replySource,
    fallbackReason: result.fallbackReason,
    model: result.modelCalls.at(-1)?.servedModel ?? AGENT_TURN_CONFIG.model,
    modelCalls: result.totals.modelCalls,
    toolCalls: result.totals.toolCalls,
    inputTokens: result.totals.inputTokens,
    outputTokens: result.totals.outputTokens,
    cacheReadTokens: result.totals.cacheReadTokens,
    cacheWriteTokens: result.totals.cacheWriteTokens,
    durationMs: result.totals.durationMs,
  });

  return { ok: true, turnRunId: turn.id };
}

/**
 * Completes the operation.
 *
 * The turn already wrote the founder's reply, so this only moves the operation
 * row. The CAS guard is the usual one: a replayed step that loses it returns
 * without emitting a second completion.
 */
export async function completeTurnOperationStep(
  deps: AgentTurnDeps,
  operationId: string,
  turnRunId: string,
): Promise<void> {
  await completeOperationRun(deps.supabase, { operationId, resultId: turnRunId });
}

/**
 * Fails the operation, and makes sure the founder still has something to read.
 *
 * This is the path for a step that fell over before `runAgentTurn` could write
 * anything — a missing project, an interrupted inference, an unexpected throw.
 * It writes the Vibe-authored sentence itself, because the alternative is a
 * thread that shows a question with no answer under it, forever.
 */
export async function failTurnOperationStep(
  deps: AgentTurnDeps,
  operationId: string,
  failureCode: OperationFailureCode,
): Promise<void> {
  const transitioned = await failOperationRun(deps.supabase, { operationId, failureCode });
  if (!transitioned) return;

  const loaded = await loadTurn(deps, operationId);
  if (!loaded) return;
  await settle(deps, {
    operationId,
    turn: loaded.turn,
    stopReason: failureCode,
    failureCode,
    reply: null,
  });
}

/** Writes the fallback reply and settles the turn, if nothing else has. */
async function settle(
  deps: AgentTurnDeps,
  params: {
    operationId: string;
    turn: { id: string; conversationId: string; projectId: string; status: string };
    stopReason: string;
    failureCode: string;
    reply: string | null;
  },
): Promise<void> {
  if (params.turn.status === "succeeded" || params.turn.status === "failed") return;

  const reply =
    params.reply ??
    agentFallbackReply(
      params.failureCode === "inference_interrupted" ? "provider_failed" : "budget_exhausted",
    );

  const assistant = await appendMessage(deps.supabase, {
    conversationId: params.turn.conversationId,
    projectId: params.turn.projectId,
    role: "assistant",
    content: reply,
    origin: "template",
    turnRunId: params.turn.id,
  });

  await completeTurnRun(deps.supabase, {
    turnRunId: params.turn.id,
    status: "failed",
    assistantMessageId: assistant.id,
    stopReason: params.stopReason,
    failureCode: params.failureCode,
    replySource: "template",
    fallbackReason: "provider_failed",
    model: null,
    modelCalls: 0,
    toolCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    durationMs: 0,
  });
}

export const AGENT_TURN_VERSIONS = {
  promptVersion: AGENT_PROMPT_VERSION,
  toolRegistryVersion: TOOL_REGISTRY_VERSION,
  skillRegistryVersion: SKILL_REGISTRY_VERSION,
  policyVersion: AGENT_POLICY_VERSION,
} as const;
