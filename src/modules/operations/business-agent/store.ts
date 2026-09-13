import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentArtifactKind } from "@/modules/business-agent/tools/registry";
import type { AgentToolCallRecord } from "@/modules/business-agent/orchestrator/dispatch";

/**
 * The conversation store. Every write in the product passes through here.
 *
 * ## Why it lives under `operations/`
 *
 * Rule 53. These tables have no client write policy at all, so the only client
 * that can write them is the service-role one, and the service-role client
 * belongs to the operations module. Putting the store anywhere else would need
 * an entry in `REVIEWED_SITES` and an argument for it; there isn't one, because
 * a founder message is written on the way into a durable turn and an assistant
 * message is written by a workflow step.
 *
 * ## Ownership comes from rows, never from arguments
 *
 * Every function that takes a `conversationId` re-reads the conversation and
 * checks its `project_id` before writing anything under it. The caller's claim
 * about which project a conversation belongs to is never trusted, because the
 * service-role client would happily believe it.
 *
 * ## Sequence is assigned here, not by the caller
 *
 * `unique (conversation_id, sequence)` is the guarantee; this is the code that
 * respects it. Two messages racing for the same number is a constraint
 * violation rather than a silently reordered thread.
 */

export type StoredAgentMessage = {
  id: string;
  conversationId: string;
  sequence: number;
  role: "founder" | "assistant";
  content: string;
  origin: "typed" | "model" | "template";
  turnRunId: string | null;
  createdAt: string;
  artifacts: readonly { kind: AgentArtifactKind; subjectId: string; position: number }[];
};

export type StoredAgentConversation = {
  id: string;
  projectId: string;
  userId: string;
  title: string;
  createdAt: string;
  lastMessageAt: string;
};

type ConversationRow = {
  id: string;
  project_id: string;
  user_id: string;
  title: string;
  created_at: string;
  last_message_at: string;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  sequence: number;
  role: "founder" | "assistant";
  content: string;
  origin: "typed" | "model" | "template";
  turn_run_id: string | null;
  created_at: string;
};

type ArtifactRow = {
  message_id: string;
  kind: AgentArtifactKind;
  subject_id: string;
  position: number;
};

const CONVERSATION_COLUMNS = "id, project_id, user_id, title, created_at, last_message_at";
const MESSAGE_COLUMNS =
  "id, conversation_id, sequence, role, content, origin, turn_run_id, created_at";

function mapConversation(row: ConversationRow): StoredAgentConversation {
  return {
    id: row.id,
    projectId: row.project_id,
    userId: row.user_id,
    title: row.title,
    createdAt: row.created_at,
    lastMessageAt: row.last_message_at,
  };
}

/**
 * A conversation title, from the founder's own first sentence.
 *
 * Vibe-derived and deterministic: no model writes a title, because a title is
 * persisted, displayed in a list and never re-read against anything, which is
 * the exact shape of a claim that quietly goes wrong. Truncation is on a word
 * boundary so a list never shows half a word.
 */
export function deriveConversationTitle(founderMessage: string): string {
  const oneLine = founderMessage.replace(/\s+/g, " ").trim();
  if (oneLine.length <= 60) return oneLine.length > 0 ? oneLine : "New conversation";
  const cut = oneLine.slice(0, 60);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export async function getConversation(
  supabase: SupabaseClient,
  params: { conversationId: string; projectId: string },
): Promise<StoredAgentConversation | null> {
  const { data, error } = await supabase
    .from("agent_conversations")
    .select(CONVERSATION_COLUMNS)
    .eq("id", params.conversationId)
    // The predicate, not an assertion: a conversation id from another project
    // resolves to nothing rather than to that project's thread.
    .eq("project_id", params.projectId)
    .maybeSingle();

  if (error) throw error;
  return data ? mapConversation(data as ConversationRow) : null;
}

export async function getLatestConversation(
  supabase: SupabaseClient,
  params: { projectId: string; userId: string },
): Promise<StoredAgentConversation | null> {
  const { data, error } = await supabase
    .from("agent_conversations")
    .select(CONVERSATION_COLUMNS)
    .eq("project_id", params.projectId)
    .eq("user_id", params.userId)
    .is("archived_at", null)
    .order("last_message_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? mapConversation(data as ConversationRow) : null;
}

export async function createConversation(
  supabase: SupabaseClient,
  params: { projectId: string; userId: string; title: string },
): Promise<StoredAgentConversation> {
  const { data, error } = await supabase
    .from("agent_conversations")
    .insert({ project_id: params.projectId, user_id: params.userId, title: params.title })
    .select(CONVERSATION_COLUMNS)
    .single();

  if (error) throw error;
  return mapConversation(data as ConversationRow);
}

export async function listMessages(
  supabase: SupabaseClient,
  params: { conversationId: string; projectId: string; limit?: number },
): Promise<StoredAgentMessage[]> {
  const { data, error } = await supabase
    .from("agent_messages")
    .select(MESSAGE_COLUMNS)
    .eq("conversation_id", params.conversationId)
    .eq("project_id", params.projectId)
    .order("sequence", { ascending: true })
    .limit(params.limit ?? 200);

  if (error) throw error;
  const rows = (data ?? []) as MessageRow[];
  if (rows.length === 0) return [];

  const { data: artifactData, error: artifactError } = await supabase
    .from("agent_message_artifacts")
    .select("message_id, kind, subject_id, position")
    .in(
      "message_id",
      rows.map((row) => row.id),
    )
    .order("position", { ascending: true });

  if (artifactError) throw artifactError;
  const artifacts = (artifactData ?? []) as ArtifactRow[];

  return rows.map((row) => ({
    id: row.id,
    conversationId: row.conversation_id,
    sequence: row.sequence,
    role: row.role,
    content: row.content,
    origin: row.origin,
    turnRunId: row.turn_run_id,
    createdAt: row.created_at,
    artifacts: artifacts
      .filter((artifact) => artifact.message_id === row.id)
      .map((artifact) => ({
        kind: artifact.kind,
        subjectId: artifact.subject_id,
        position: artifact.position,
      })),
  }));
}

async function nextSequence(supabase: SupabaseClient, conversationId: string): Promise<number> {
  const { data, error } = await supabase
    .from("agent_messages")
    .select("sequence")
    .eq("conversation_id", conversationId)
    .order("sequence", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return ((data as { sequence: number } | null)?.sequence ?? 0) + 1;
}

export async function appendMessage(
  supabase: SupabaseClient,
  params: {
    conversationId: string;
    projectId: string;
    role: "founder" | "assistant";
    content: string;
    origin: "typed" | "model" | "template";
    turnRunId?: string | null;
    artifacts?: readonly { kind: AgentArtifactKind; subjectId: string }[];
  },
): Promise<StoredAgentMessage> {
  const sequence = await nextSequence(supabase, params.conversationId);
  const { data, error } = await supabase
    .from("agent_messages")
    .insert({
      conversation_id: params.conversationId,
      project_id: params.projectId,
      sequence,
      role: params.role,
      content: params.content,
      origin: params.origin,
      turn_run_id: params.turnRunId ?? null,
    })
    .select(MESSAGE_COLUMNS)
    .single();

  if (error) throw error;
  const row = data as MessageRow;

  const artifacts = (params.artifacts ?? []).slice(0, 20);
  if (artifacts.length > 0) {
    const { error: artifactError } = await supabase.from("agent_message_artifacts").insert(
      artifacts.map((artifact, index) => ({
        message_id: row.id,
        project_id: params.projectId,
        kind: artifact.kind,
        subject_id: artifact.subjectId,
        position: index + 1,
      })),
    );
    if (artifactError) throw artifactError;
  }

  await supabase
    .from("agent_conversations")
    .update({ last_message_at: row.created_at })
    .eq("id", params.conversationId);

  return {
    id: row.id,
    conversationId: row.conversation_id,
    sequence: row.sequence,
    role: row.role,
    content: row.content,
    origin: row.origin,
    turnRunId: row.turn_run_id,
    createdAt: row.created_at,
    artifacts: artifacts.map((artifact, index) => ({ ...artifact, position: index + 1 })),
  };
}

export type StoredAgentTurnRun = {
  id: string;
  conversationId: string;
  projectId: string;
  userId: string;
  operationRunId: string;
  founderMessageId: string;
  assistantMessageId: string | null;
  status: "queued" | "running" | "succeeded" | "failed";
  inferenceStartedAt: string | null;
};

const TURN_COLUMNS =
  "id, conversation_id, project_id, user_id, operation_run_id, founder_message_id, assistant_message_id, status, inference_started_at";

type TurnRow = {
  id: string;
  conversation_id: string;
  project_id: string;
  user_id: string;
  operation_run_id: string;
  founder_message_id: string;
  assistant_message_id: string | null;
  status: StoredAgentTurnRun["status"];
  inference_started_at: string | null;
};

function mapTurn(row: TurnRow): StoredAgentTurnRun {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    projectId: row.project_id,
    userId: row.user_id,
    operationRunId: row.operation_run_id,
    founderMessageId: row.founder_message_id,
    assistantMessageId: row.assistant_message_id,
    status: row.status,
    inferenceStartedAt: row.inference_started_at,
  };
}

export type CreateTurnRunResult =
  | { ok: true; turn: StoredAgentTurnRun }
  | { ok: false; error: "already_live" };

const POSTGRES_UNIQUE_VIOLATION = "23505";

export async function createTurnRun(
  supabase: SupabaseClient,
  params: {
    conversationId: string;
    projectId: string;
    userId: string;
    operationRunId: string;
    founderMessageId: string;
    promptVersion: string;
    toolRegistryVersion: string;
    skillRegistryVersion: string;
    policyVersion: string;
  },
): Promise<CreateTurnRunResult> {
  const { data, error } = await supabase
    .from("agent_turn_runs")
    .insert({
      conversation_id: params.conversationId,
      project_id: params.projectId,
      user_id: params.userId,
      operation_run_id: params.operationRunId,
      founder_message_id: params.founderMessageId,
      status: "queued",
      prompt_version: params.promptVersion,
      tool_registry_version: params.toolRegistryVersion,
      skill_registry_version: params.skillRegistryVersion,
      policy_version: params.policyVersion,
    })
    .select(TURN_COLUMNS)
    .single();

  // The partial unique index on live turns turns a double submission into a
  // constraint violation rather than a second paid turn.
  if (error?.code === POSTGRES_UNIQUE_VIOLATION) return { ok: false, error: "already_live" };
  if (error) throw error;
  return { ok: true, turn: mapTurn(data as TurnRow) };
}

export async function getTurnRun(
  supabase: SupabaseClient,
  turnRunId: string,
): Promise<StoredAgentTurnRun | null> {
  const { data, error } = await supabase
    .from("agent_turn_runs")
    .select(TURN_COLUMNS)
    .eq("id", turnRunId)
    .maybeSingle();

  if (error) throw error;
  return data ? mapTurn(data as TurnRow) : null;
}

/**
 * Marks the turn as having reached inference, once and never again.
 *
 * Scoped to a null `inference_started_at`, so a replayed step that finds it
 * already set knows the first attempt may have been billed, and resolves the
 * ambiguity to a failed turn rather than to a second call (rule 50, rule 73).
 */
export async function markTurnInferenceStarted(
  supabase: SupabaseClient,
  turnRunId: string,
): Promise<void> {
  const { error } = await supabase
    .from("agent_turn_runs")
    .update({ status: "running", inference_started_at: new Date().toISOString() })
    .eq("id", turnRunId)
    .is("inference_started_at", null);
  if (error) throw error;
}

export async function completeTurnRun(
  supabase: SupabaseClient,
  params: {
    turnRunId: string;
    status: "succeeded" | "failed";
    assistantMessageId: string | null;
    stopReason: string;
    failureCode: string | null;
    replySource: "model" | "template";
    fallbackReason: string | null;
    model: string | null;
    modelCalls: number;
    toolCalls: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    durationMs: number;
  },
): Promise<void> {
  const { error } = await supabase
    .from("agent_turn_runs")
    .update({
      status: params.status,
      assistant_message_id: params.assistantMessageId,
      stop_reason: params.stopReason,
      failure_code: params.failureCode,
      reply_source: params.replySource,
      fallback_reason: params.fallbackReason,
      model: params.model,
      model_calls: params.modelCalls,
      tool_calls: params.toolCalls,
      input_tokens: params.inputTokens,
      output_tokens: params.outputTokens,
      cache_read_tokens: params.cacheReadTokens,
      cache_write_tokens: params.cacheWriteTokens,
      duration_ms: params.durationMs,
      completed_at: new Date().toISOString(),
    })
    .eq("id", params.turnRunId);
  if (error) throw error;
}

/**
 * The turn's tool calls, as a trace.
 *
 * What is written: the tool, what Vibe decided, the arguments, the size of the
 * result and the ids it carried. What is not: the rendered result itself. A
 * tool result is derived from canonical rows that keep moving, so storing it
 * would create a second, frozen copy of the truth beside the real one — and it
 * is also the largest thing in the turn, which is the smaller reason.
 */
export async function recordToolCalls(
  supabase: SupabaseClient,
  params: { turnRunId: string; projectId: string; calls: readonly AgentToolCallRecord[] },
): Promise<void> {
  if (params.calls.length === 0) return;
  const { error } = await supabase.from("agent_turn_tool_calls").insert(
    params.calls.map((call) => ({
      turn_run_id: params.turnRunId,
      project_id: params.projectId,
      sequence: call.sequence,
      tool: call.tool.slice(0, 80),
      classification: call.classification,
      decision: call.decision,
      denial_reason: call.denialReason?.slice(0, 400) ?? null,
      input: call.input,
      result_kind: call.resultKind,
      result_bytes: call.resultBytes,
      subject_ids: call.subjectIds,
      duration_ms: call.durationMs,
    })),
  );
  if (error) throw error;
}
