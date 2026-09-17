"use server";

import { revalidatePath } from "next/cache";

import { getAIProvider } from "@/modules/ai/anthropic/client";
import { NOVA_CONVERSATION_CONFIG } from "@/modules/ai/operations";
import { recordAIUsage } from "@/modules/ai/usage";
import { allowQuestion } from "@/modules/nova/conversation/limits";
import {
  computeConversationContextHash,
  MAX_QUESTION_CHARS,
  NOVA_CONVERSATION_POLICY_VERSION,
} from "@/modules/nova/conversation/payload";
import { answerNovaQuestion } from "@/modules/nova/conversation/service";
import { isNovaConversationEnabled } from "@/modules/nova/conversation/switch";
import { resolveNovaIntent } from "@/modules/nova/intent/resolve";
import {
  appendConversationTurn,
  countFounderQuestions,
  countFounderQuestionsSince,
  ensureOpenThread,
} from "@/modules/nova/threads/store";
import { ACCOUNT_QUESTION_WINDOW_MS } from "@/modules/nova/conversation/limits";
import { FIRST_THREAD_TITLE } from "@/modules/operations/nova-thread";
import { requireProjectAccess } from "@/modules/projects/workspace-context";
import { threadsPath } from "@/lib/routing/project-urls";
import { readNovaHomeData } from "@/features/nova/home/nova-home-data";
import { buildQuestionContext } from "../queries";

/**
 * A founder asks Nova something (ADR 0109 §5, ADR 0110).
 *
 * ## Why generation lives in a command and can live nowhere else
 *
 * ADR 0109 §5: **generation happens in a founder-initiated command, never in a
 * read or a render.** That is stronger than ADR 0086's condition 5 and it is
 * what keeps the cost of *looking at a screen* knowable — a thread renders from
 * rows, and only this function can reach a provider.
 *
 * ## The order of the checks, and why it is this order
 *
 * 1. **Access**, from the session and the project row. Never from an argument.
 * 2. **The bound**, before anything is spent (ADR 0110 §2). Free and unbounded
 *    is the shape that ends in an incident, and a refusal is a sentence rather
 *    than a silent failure.
 * 3. **Deterministic intent**, before a model. *"merge it"* resolves to the
 *    control the ranking already offers, instantly and without spending — and
 *    it resolves to the **control**, never to the merge: generated text is
 *    never the last thing before a consequential effect, a press is.
 * 4. **The model**, for everything else, against a pack Vibe assembled.
 * 5. **The ledger**, for successes and failures alike (rule 47).
 * 6. **The transcript**, in one atomic write.
 *
 * ## What this returns, and what it never does
 *
 * A shape the composer renders. It starts nothing, spends no Credits, and
 * writes no canonical state — the only rows it creates are the two turns and
 * their optional pointers, in `nova_messages`. A proposal is rendered as the
 * control `NOVA_ACTION_META` already defines, with its existing label, price,
 * consequence and confirmation, and the founder presses it.
 */

export type AskNovaResult =
  | { ok: true; reply: string; artifactKind: string | null; actionId: string | null }
  /** A bound, a refused question, or a project that cannot be reached. */
  | { ok: false; message: string };

export async function askNovaAction(projectId: string, question: string): Promise<AskNovaResult> {
  const trimmed = question.trim();
  if (trimmed.length === 0) {
    return { ok: false, message: "Ask me something and I will answer from what I know." };
  }
  if (trimmed.length > MAX_QUESTION_CHARS) {
    return {
      ok: false,
      message: "That is longer than I can take in one go. Ask me the shorter version of it.",
    };
  }

  const access = await requireProjectAccess(projectId);

  const home = await readNovaHomeData(access.supabase, {
    projectId,
    userId: access.userId,
    projectName: access.project.name,
    repositoryFullName: access.project.repository?.fullName ?? null,
  });

  const thread = await ensureOpenThread(access.supabase, {
    projectId,
    userId: access.userId,
    title: FIRST_THREAD_TITLE,
  });

  /*
   * The bound stands in for a price, so it is checked where a price would be:
   * before anything is spent, and with a sentence the founder can act on.
   */
  const [turnsInThread, questionsInWindow] = await Promise.all([
    countFounderQuestions(access.supabase, { threadId: thread.id }),
    countFounderQuestionsSince(access.supabase, {
      userId: access.userId,
      since: new Date(Date.now() - ACCOUNT_QUESTION_WINDOW_MS).toISOString(),
    }),
  ]);

  const allowance = allowQuestion({ turnsInThread, questionsInWindow });
  if (!allowance.allowed) return { ok: false, message: allowance.message };

  const payload = await buildQuestionContext(access.supabase, {
    question: trimmed,
    projectId,
    threadId: thread.id,
    home,
  });

  /*
   * An instruction, resolved without a model. It is cheap, instant and
   * inspectable — and it resolves to the control the ranking already offers,
   * never to the effect. `resolveNovaIntent` refuses anything it is not sure
   * of, which is the only direction this may be wrong in.
   */
  const intent = resolveNovaIntent({
    text: trimmed,
    offerable: payload.availableActions.map((action) => action.actionId),
    available: payload.availableArtifacts.map((artifact) => artifact.kind),
  });

  if (intent.kind !== "none") {
    const reply =
      intent.kind === "action"
        ? "Here is the control for that. Press it when you are ready — I never start anything myself."
        : "Here it is.";

    await appendConversationTurn(access.supabase, {
      threadId: thread.id,
      question: trimmed,
      reply,
      artifact: intent.kind === "artifact" ? { kind: intent.artifact, ref: null } : null,
      actionId: intent.kind === "action" ? intent.actionId : null,
    });

    revalidatePath(threadsPath(projectId));
    return {
      ok: true,
      reply,
      artifactKind: intent.kind === "artifact" ? intent.artifact : null,
      actionId: intent.kind === "action" ? intent.actionId : null,
    };
  }

  const outcome = await answerNovaQuestion({
    provider: getAIProvider(),
    payload,
    enabled: isNovaConversationEnabled(),
  });

  /*
   * Rule 47: a call that was billed is recorded whether or not its words were
   * kept, and a call that never happened is not recorded at all. `disabled` and
   * `over_input_budget` are the two that produce no event.
   */
  if (outcome.providerInvoked) {
    await recordAIUsage(access.supabase, {
      userId: access.userId,
      projectId,
      operation: "nova_conversation",
      provider: "anthropic",
      model: NOVA_CONVERSATION_CONFIG.model,
      jobId: null,
      status: outcome.source === "model" ? "succeeded" : "failed",
      usage: outcome.usage ?? undefined,
      estimatedInputTokens: outcome.estimatedInputTokens,
      latencyMs: outcome.latencyMs ?? 0,
      failureCode: outcome.providerFailureCode,
    });
  }

  await appendConversationTurn(access.supabase, {
    threadId: thread.id,
    question: trimmed,
    reply: outcome.reply.message,
    artifact:
      outcome.reply.artifact == null
        ? null
        : { kind: outcome.reply.artifact.kind, ref: outcome.reply.artifact.ref ?? null },
    actionId: outcome.reply.actionId ?? null,
    /*
     * The shape of what this was answered from, never its content (rule 43).
     * Only for a real answer: the template was not answered from anything.
     */
    contextVersion: outcome.source === "model" ? NOVA_CONVERSATION_POLICY_VERSION : null,
    contextHash:
      outcome.source === "model"
        ? computeConversationContextHash({
            projectId,
            payload,
            model: NOVA_CONVERSATION_CONFIG.model,
          })
        : null,
  });

  revalidatePath(threadsPath(projectId));

  return {
    ok: true,
    reply: outcome.reply.message,
    artifactKind: outcome.reply.artifact?.kind ?? null,
    actionId: outcome.reply.actionId ?? null,
  };
}
