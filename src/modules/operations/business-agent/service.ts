import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import {
  MAX_FOUNDER_MESSAGE_CHARS,
  MIN_FOUNDER_MESSAGE_CHARS,
} from "@/modules/business-agent/orchestrator/budgets";
import type { OperationExecutor } from "../executor";
import { buildOperationView, type OperationView } from "../view";
import { createOperationRun, failOperationRun, attachExecutionRun } from "../store";
import { AGENT_TURN_VERSIONS } from "./execution";
import {
  appendMessage,
  createConversation,
  createTurnRun,
  deriveConversationTitle,
  getConversation,
  getLatestConversation,
} from "./store";

/**
 * Starting a turn: the sequence, and why it is in this order.
 *
 * ```
 * own the project (session client, RLS)
 *   → bound the founder's text at the door
 *   → find or create the conversation, persist the founder's message
 *   → claim the operation (start limits, kill switch)
 *   → claim the turn (one live turn per conversation, in the database)
 *   → enqueue
 * ```
 *
 * ## The founder's message is persisted before anything can fail
 *
 * Deliberately. If the operation cannot start, the question is still in the
 * thread and the failure is written under it — which is what a person expects
 * from something they typed and sent. The alternative, persisting it only once
 * the turn succeeds, loses the founder's own words on every failure path.
 *
 * ## Two clients, and the reason for each
 *
 * Ownership is proved with the caller's session client, because RLS is what
 * makes that proof mean something. The writes then use the service-role client,
 * because these five tables have no client write policy at all — a founder's
 * browser can read the thread and cannot author a turn (rule 53). Both are here
 * rather than in a Server Action for the same reason: this module is the one
 * allowed to hold the service-role client.
 *
 * ## Double submission is refused by an index, not by a check
 *
 * `agent_turn_runs_single_live_idx` admits one live turn per conversation. Two
 * requests can both pass an application check and only one can win an index,
 * and this is the shape every other paid start in the product already uses.
 */

export type StartAgentTurnOutcome =
  | { kind: "started"; conversationId: string; operation: OperationView }
  | { kind: "active"; conversationId: string }
  | { kind: "failed"; error: "project_not_found" | "message_rejected" | "start_refused" };

export type StartAgentTurnParams = {
  projectId: string;
  userId: string;
  /** Null starts a new conversation; an id continues one this project owns. */
  conversationId: string | null;
  text: string;
};

/** One block, bounded at the door. Nothing unbounded reaches a row or a model. */
export function sanitizeFounderMessage(text: string): string | null {
  const oneBlock = text.replace(/\s+/g, " ").trim();
  if (oneBlock.length < MIN_FOUNDER_MESSAGE_CHARS) return null;
  return oneBlock.slice(0, MAX_FOUNDER_MESSAGE_CHARS);
}

export async function startAgentTurn(
  supabase: SupabaseClient,
  executor: OperationExecutor,
  params: StartAgentTurnParams,
): Promise<StartAgentTurnOutcome> {
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", params.projectId)
    .eq("user_id", params.userId)
    .maybeSingle();
  if (!project) return { kind: "failed", error: "project_not_found" };

  const text = sanitizeFounderMessage(params.text);
  if (!text) return { kind: "failed", error: "message_rejected" };

  const service = createServiceClient();

  const conversation = params.conversationId
    ? await getConversation(service, {
        conversationId: params.conversationId,
        // The predicate, not the caller's word for it: a conversation id from
        // another project resolves to nothing.
        projectId: params.projectId,
      })
    : await getLatestConversation(service, {
        projectId: params.projectId,
        userId: params.userId,
      });

  const thread =
    conversation ??
    (await createConversation(service, {
      projectId: params.projectId,
      userId: params.userId,
      title: deriveConversationTitle(text),
    }));

  const founderMessage = await appendMessage(service, {
    conversationId: thread.id,
    projectId: params.projectId,
    role: "founder",
    content: text,
    origin: "typed",
  });

  const created = await createOperationRun(supabase, {
    projectId: params.projectId,
    userId: params.userId,
    operationType: "agent_turn",
    // Identity is the message, which is unique by its own primary key. A turn
    // is never "the same work" as an earlier turn: two identical questions an
    // hour apart are two questions, because the evidence may have moved.
    inputIdentity: founderMessage.id,
    subjectId: thread.id,
    initiatedBy: "customer",
  });
  if (!created.ok) {
    return created.error === "already_active"
      ? { kind: "active", conversationId: thread.id }
      : { kind: "failed", error: "start_refused" };
  }

  const turn = await createTurnRun(service, {
    conversationId: thread.id,
    projectId: params.projectId,
    userId: params.userId,
    operationRunId: created.operation.id,
    founderMessageId: founderMessage.id,
    ...AGENT_TURN_VERSIONS,
  });
  if (!turn.ok) {
    await failOperationRun(supabase, {
      operationId: created.operation.id,
      failureCode: "already_running",
    });
    return { kind: "active", conversationId: thread.id };
  }

  // The operation points at the turn, so a step can find it from an id alone —
  // which is the only thing that crosses the workflow boundary (rule 52).
  await claimTurnAsResult(service, created.operation.id, turn.turn.id);

  const started = await executor.start({
    operationId: created.operation.id,
    operationType: "agent_turn",
  });
  if (!started.ok) {
    await failOperationRun(supabase, {
      operationId: created.operation.id,
      failureCode: "execution_start_failed",
    });
    return { kind: "failed", error: "start_refused" };
  }

  await attachExecutionRun(service, {
    operationId: created.operation.id,
    workflowRunId: started.runId,
    executionProvider: executor.name,
  });

  return {
    kind: "started",
    conversationId: thread.id,
    operation: buildOperationView({
      operationId: created.operation.id,
      status: created.operation.status,
      stage: created.operation.stage,
      failureCode: created.operation.failureCode,
      resultId: turn.turn.id,
      startedAt: created.operation.startedAt,
      completedAt: created.operation.completedAt,
      createdAt: created.operation.createdAt,
    }),
  };
}

async function claimTurnAsResult(
  supabase: SupabaseClient,
  operationId: string,
  turnRunId: string,
): Promise<void> {
  const { error } = await supabase
    .from("operation_runs")
    .update({ result_id: turnRunId })
    .eq("id", operationId)
    .is("result_id", null);
  if (error) throw error;
}
