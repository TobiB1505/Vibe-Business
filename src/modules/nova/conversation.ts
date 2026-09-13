import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentArtifactKind } from "@/modules/business-agent/artifacts";
import { getLatestOpportunities } from "@/modules/opportunities/service";
import type { BusinessOpportunity } from "@/modules/opportunities/schema";
import { getOperationRunById } from "@/modules/operations/store";
import { buildOperationView, type OperationView } from "@/modules/operations/view";

/**
 * What the thread shows, read with the founder's own client.
 *
 * ## The reads are RLS reads, on purpose
 *
 * Writing a conversation needs the service-role client, because these tables
 * have no client write policy. *Reading* one does not, and using the session
 * client here means the founder's own row-level security is what decides which
 * thread they see — the same proof the rest of the product relies on, rather
 * than a project id this code remembered to filter on.
 *
 * ## Artifacts resolve on render, and may resolve to nothing
 *
 * A message stores `(kind, subject_id)` and never a copy. So the Move a reply
 * pointed at is fetched from the canonical set *now*: if it was replanned it
 * renders as it is now, and if the set was regenerated and the id is gone, the
 * reference renders as absent rather than as an invented card. That is the
 * ADR 0058 rule — a stale id degrades, it never substitutes.
 */

export type NovaConversationArtifact =
  | { kind: "opportunity"; subjectId: string; opportunity: BusinessOpportunity }
  | { kind: "audit"; subjectId: string };

export type NovaConversationMessage = {
  id: string;
  sequence: number;
  role: "founder" | "assistant";
  content: string;
  /** Whether the founder is reading Nova's words or Vibe's own. */
  origin: "typed" | "model" | "template";
  createdAt: string;
  artifacts: readonly NovaConversationArtifact[];
};

export type NovaConversationView = {
  conversationId: string | null;
  messages: readonly NovaConversationMessage[];
  /** The turn currently being answered, if one is. */
  working: OperationView | null;
};

type MessageRow = {
  id: string;
  sequence: number;
  role: "founder" | "assistant";
  content: string;
  origin: "typed" | "model" | "template";
  created_at: string;
};

type ArtifactRow = { message_id: string; kind: AgentArtifactKind; subject_id: string };

type LiveTurnRow = { operation_run_id: string };

/** How much of a thread one screen shows. Older messages are still stored. */
export const NOVA_TRANSCRIPT_LIMIT = 30;

export async function readNovaConversation(
  supabase: SupabaseClient,
  params: { projectId: string; userId: string },
): Promise<NovaConversationView> {
  const { data: conversationRow } = await supabase
    .from("agent_conversations")
    .select("id")
    .eq("project_id", params.projectId)
    .eq("user_id", params.userId)
    .is("archived_at", null)
    .order("last_message_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const conversationId = (conversationRow as { id: string } | null)?.id ?? null;
  if (!conversationId) return { conversationId: null, messages: [], working: null };

  const [{ data: messageData }, { data: liveTurnData }] = await Promise.all([
    supabase
      .from("agent_messages")
      .select("id, sequence, role, content, origin, created_at")
      .eq("conversation_id", conversationId)
      .order("sequence", { ascending: false })
      .limit(NOVA_TRANSCRIPT_LIMIT),
    supabase
      .from("agent_turn_runs")
      .select("operation_run_id")
      .eq("conversation_id", conversationId)
      .in("status", ["queued", "running"])
      .limit(1)
      .maybeSingle(),
  ]);

  // Read newest-first so the limit takes the *latest* window, then reversed so
  // the thread reads in the order it happened.
  const rows = ((messageData ?? []) as MessageRow[]).slice().reverse();

  const [artifacts, opportunities, working] = await Promise.all([
    rows.length === 0
      ? Promise.resolve([] as ArtifactRow[])
      : supabase
          .from("agent_message_artifacts")
          .select("message_id, kind, subject_id")
          .in(
            "message_id",
            rows.map((row) => row.id),
          )
          .order("position", { ascending: true })
          .then(({ data }) => (data ?? []) as ArtifactRow[]),
    getLatestOpportunities(supabase, params.projectId),
    readWorkingTurn(supabase, (liveTurnData as LiveTurnRow | null)?.operation_run_id ?? null),
  ]);

  const movesById = new Map(
    (opportunities?.set.opportunities ?? []).map((move) => [move.id, move] as const),
  );

  return {
    conversationId,
    working,
    messages: rows.map((row) => ({
      id: row.id,
      sequence: row.sequence,
      role: row.role,
      content: row.content,
      origin: row.origin,
      createdAt: row.created_at,
      artifacts: artifacts
        .filter((artifact) => artifact.message_id === row.id)
        .flatMap((artifact): NovaConversationArtifact[] => {
          if (artifact.kind === "audit") {
            return [{ kind: "audit", subjectId: artifact.subject_id }];
          }
          const move = movesById.get(artifact.subject_id);
          // Resolved to nothing: the Move is no longer in the current set. The
          // message stays; the card it pointed at does not come back as a guess.
          return move
            ? [{ kind: "opportunity", subjectId: artifact.subject_id, opportunity: move }]
            : [];
        }),
    })),
  };
}

async function readWorkingTurn(
  supabase: SupabaseClient,
  operationRunId: string | null,
): Promise<OperationView | null> {
  if (!operationRunId) return null;
  const operation = await getOperationRunById(supabase, operationRunId);
  if (!operation) return null;
  return buildOperationView({
    operationId: operation.id,
    status: operation.status,
    stage: operation.stage,
    failureCode: operation.failureCode,
    resultId: operation.resultId,
    startedAt: operation.startedAt,
    completedAt: operation.completedAt,
    createdAt: operation.createdAt,
  });
}
