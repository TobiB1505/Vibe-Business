import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { AIProvider } from "@/modules/ai/provider";
import { readBriefingView } from "@/modules/nova/briefing/read";
import {
  buildNovaBriefingTemplate,
  buildNovaBriefingVoicePayload,
} from "@/modules/nova/voice/briefing-slot";

import { speakAfterOperation } from "./nova-voice";
import type { NovaVoiceOperation } from "./nova-voice";

/**
 * Nova says where the founder stands, after the operation that changed it.
 *
 * ## Why this slot is generated from several operations rather than one
 *
 * Every other voice slot describes one document, so it speaks at the tail of
 * the one operation that produced it. The briefing describes the whole
 * evidence chain, and three operations move it: a Product Scan refreshes the
 * scans and the understanding, a business audit replaces the diagnosis and
 * makes the Move set stale, and generating Moves makes it current again.
 *
 * Each of those completions leaves the founder in a genuinely different
 * situation, and each therefore has a different reuse identity and gets its
 * own single attempt. There is no double-spend in that: the identity is a hash
 * of the payload, so an operation that happens to leave the chain exactly as
 * it found it claims an identity that is already resolved and calls nothing.
 *
 * ## Why the clock is not one of those triggers, and what that costs
 *
 * The briefing ages on its own — that is what `freshness.ts` is for — so a
 * bucket can flip with no operation behind it, and the identity moves with it.
 * When that happens nothing generates, and the founder reads Vibe's own
 * sentence about the new age instead of a written one.
 *
 * That is a deliberate limit rather than an oversight. Generating on a clock
 * would need a caller that is not an operation tail, which is precisely what
 * ADR 0086's five conditions are arranged around: a render may not spend, and
 * a Server Action cannot write the usage ledger. The template covers the case
 * completely, which is the whole reason the template is the product.
 *
 * ## Why it does not read the project's name
 *
 * Because the name is a display field of the briefing and never reaches the
 * voice payload — so it cannot affect what is generated or which identity it
 * is stored under, and a query to fill it would be a query for nothing.
 * `briefing-slot.test.ts` asserts the payload is identical whatever the name
 * is, so that stays checked rather than claimed.
 *
 * ## What this may never do
 *
 * Fail anything. `speakAfterOperation` returns `void` and never throws; this
 * adds one read in front of it and is held to the same standing. A step that
 * calls it behaves exactly like a step that does not.
 */
export async function speakAboutTheBriefing(params: {
  /** The durable step's own service-role client. Never created here. */
  supabase: SupabaseClient;
  provider: AIProvider;
  /** Fields of a **loaded operation row**, never a caller's arguments (rule 53). */
  operation: NovaVoiceOperation;
}): Promise<void> {
  let view;

  try {
    const read = await readBriefingView(params.supabase, {
      projectId: params.operation.projectId,
      userId: params.operation.userId,
    });
    view = read.view;
  } catch (error) {
    /*
     * A briefing that cannot be assembled is a sentence not written, never a
     * failed operation. The founder's screen builds its own on the next visit
     * from the same state, and shows Vibe's words.
     */
    console.error("[nova-voice] could not assemble the briefing to speak about", {
      operationId: params.operation.id,
      message: error instanceof Error ? error.message : "unknown",
    });
    return;
  }

  await speakAfterOperation({
    supabase: params.supabase,
    provider: params.provider,
    operation: params.operation,
    payload: buildNovaBriefingVoicePayload(view),
    template: buildNovaBriefingTemplate(view),
  });
}
