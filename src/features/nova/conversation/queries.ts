import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getLatestProfile } from "@/modules/product-understanding/store";
import { buildUnderstandingView } from "@/modules/product-understanding/view";
import { buildConversationPayload } from "@/modules/nova/conversation/context";
import type { NovaConversationPayload } from "@/modules/nova/conversation/payload";
import { CONVERSATION_CONTEXT_TURNS } from "@/modules/nova/conversation/payload";
import { readThreadMessages } from "@/modules/nova/threads/store";
import type { NovaHomeData } from "@/features/nova/home/nova-home-data";

/**
 * Everything a question is answered from, composed from the reads a screen makes.
 *
 * ## Why the composition is here and the assembly is in the module
 *
 * `modules/nova/conversation/context.ts` is pure — it holds no database handle,
 * makes no query, and cannot be made to fetch anything by a sentence in a
 * repository. That is the property that makes *"the model has no say in what it
 * reads"* ([ADR 0109](../../../../docs/decisions/0109-nova-first-application-shell.md) §5)
 * checkable rather than asserted, and it only holds if the reads happen
 * somewhere else. This is somewhere else.
 *
 * ## Why the reads are the screens' own
 *
 * `readNovaHomeData` is what the project index renders from, and
 * `getLatestProfile` is what My Product renders from. A founder's conversation
 * therefore sees exactly what their screens see — no more, and never something
 * assembled for the model's benefit, which is the sort of second read model
 * that drifts from the first and then contradicts it on screen.
 */
export async function buildQuestionContext(
  supabase: SupabaseClient,
  params: {
    question: string;
    projectId: string;
    threadId: string;
    /** The Home read the caller already made. Never made twice. */
    home: NovaHomeData;
  },
): Promise<NovaConversationPayload> {
  const [profile, messages] = await Promise.all([
    getLatestProfile(supabase, params.projectId),
    readThreadMessages(supabase, {
      threadId: params.threadId,
      limit: CONVERSATION_CONTEXT_TURNS,
    }),
  ]);

  return buildConversationPayload({
    question: params.question,
    productName: params.home.identity.name,
    founderGoal: null,
    home: params.home.view,
    audit: params.home.audit,
    understanding:
      profile === null ? null : buildUnderstandingView(profile.profile, profile.stored.synthesized),
    /*
     * Words only. An event turn's sentence is composed on read from today's
     * table and a proposal is a control — neither is something Nova said, and
     * sending them as if they were would let a founder's *"do that"* resolve
     * against a line nobody wrote.
     */
    turns: messages.flatMap((message) =>
      message.kind === "text" && message.body !== null && message.author !== "system"
        ? [{ author: message.author as "founder" | "nova", text: message.body }]
        : [],
    ),
  });
}
