import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { NOVA_PRESENTATION_CONFIG } from "@/modules/ai/operations";
import type { AIProvider } from "@/modules/ai/provider";
import { recordAIUsage } from "@/modules/ai/usage";
import { computeNovaVoiceIdentity } from "@/modules/nova/voice/payload";
import type { NovaVoiceLocale, NovaVoicePayload } from "@/modules/nova/voice/payload";
import { ensureNovaVoiceMessage } from "@/modules/nova/voice/store";
import type { NovaVoiceOutcome } from "@/modules/nova/voice/service";

/**
 * Where Nova's voice is allowed to speak: after a durable operation has
 * finished, never during a render.
 *
 * ## Why here and nowhere else
 *
 * [ADR 0084](../../../docs/decisions/0084-nova-presentation-is-claimed-stored-and-attempted-once.md)
 * permits presentation inference under five conditions and deliberately left
 * open *which* caller satisfies them. This is that caller, and it is not a
 * free choice — every one of the five is already true at the tail of a durable
 * step and would have to be newly arranged anywhere else:
 *
 *  - **The canonical state is persisted.** A step calls this after writing its
 *    result row, so a message can only ever describe state that survived.
 *  - **There is no open request.** A workflow step runs outside HTTP, so a
 *    render structurally cannot reach a provider through it.
 *  - **The client is already service-role.** `ai_usage_events` lost its
 *    `authenticated` insert grant in `20260827202440`, so a Server Action
 *    could not record usage even if it wanted to; a durable step holds the one
 *    client that can. It is passed in rather than created here, so no new site
 *    obtains one and `REVIEWED_SITES` is unchanged (rule 53).
 *  - **The ledger call already lives here.** Every operation records its own
 *    inference on this line. Nova's is one more row through the same function,
 *    not a second accounting path.
 *
 * A Nova operation type would have added a durable row, a workflow, a failure
 * vocabulary and a state machine to a call that takes a second and is allowed
 * to fail — all to reach a place the existing operations already stand in.
 *
 * ## What this may never do
 *
 * Fail anything. It returns `void`, never throws, and its result is not an
 * input to any decision: a step that calls it and ignores it behaves exactly
 * as a step that does not call it. The voice is a nicety on top of a product
 * that is complete without it, and this function is where that claim is either
 * kept or broken.
 *
 * That is the same standing `meterAiUsage` and `observeAccountSpend` already
 * have — non-authoritative work that follows a canonical write and must not
 * fail the operation that earned it.
 *
 * ## Nothing calls it yet
 *
 * Which slot speaks first is a product decision belonging to the slice that
 * renders it. Attaching this to an operation now would spend money generating
 * sentences no screen can display.
 */

export type NovaVoiceOperation = {
  /**
   * Identifiers from a **loaded operation row**, never from a caller's
   * arguments (rule 53). A durable step has already read the row it is
   * executing; these are its fields, which is what makes ownership
   * re-established rather than asserted.
   */
  id: string;
  userId: string;
  projectId: string;
};

/**
 * Whether an attempt produced a row for the provider-cost ledger.
 *
 * The question is "was `generateStructured` called", not "did tokens come
 * back". A call that died before billing anything still happened and still
 * belongs in the ledger with null counts; a switch that was off produced no
 * call and must not appear there at all. Writing either as the other corrupts
 * the ledger in opposite directions (rule 47).
 */
function shouldRecord(attempt: NovaVoiceOutcome | null): attempt is NovaVoiceOutcome {
  return attempt !== null && attempt.providerInvoked;
}

export async function speakAfterOperation(params: {
  /** The durable step's own client. Never created here — see the docblock. */
  supabase: SupabaseClient;
  provider: AIProvider;
  operation: NovaVoiceOperation;
  payload: NovaVoicePayload;
  /** What Vibe would say without a model. Shown unchanged on every failure. */
  template: string;
  locale?: NovaVoiceLocale;
  forbiddenSubstrings?: readonly string[];
  enabled?: boolean;
}): Promise<void> {
  try {
    const identity = computeNovaVoiceIdentity({
      projectId: params.operation.projectId,
      payload: params.payload,
      model: NOVA_PRESENTATION_CONFIG.model,
      locale: params.locale,
    });

    const { attempt } = await ensureNovaVoiceMessage({
      supabase: params.supabase,
      provider: params.provider,
      claim: {
        identity,
        projectId: params.operation.projectId,
        slot: params.payload.slot,
        locale: params.locale,
        model: NOVA_PRESENTATION_CONFIG.model,
      },
      payload: params.payload,
      template: params.template,
      forbiddenSubstrings: params.forbiddenSubstrings,
      enabled: params.enabled,
    });

    if (!shouldRecord(attempt)) return;

    /*
     * The internal provider-cost ledger, and only that. No Credit hold, no
     * reservation, no `RetailOperationKind` — `nova_presentation` has no
     * retail price because presentation is Vibe's infrastructure cost rather
     * than something a founder buys. Adding one would be a product decision
     * with a disclosure obligation attached (rule 47, PRODUCT.md §12).
     *
     * `jobId` is the operation run's id: a uuid, which the sha256 identity is
     * not, and unused as a `job_id` by every existing caller — all of which
     * pass a result id or an agent run id. It also buys idempotency, since
     * `ai_usage_events_job_idx` is unique on `job_id`.
     *
     * `status: "failed"` covers a rejected message as well as a refused call.
     * The provider was billed and produced nothing Vibe would show, which is
     * what a failed call means to this ledger; `failureCode` says which.
     */
    await recordAIUsage(params.supabase, {
      userId: params.operation.userId,
      projectId: params.operation.projectId,
      operation: NOVA_PRESENTATION_CONFIG.operation,
      provider: params.provider.name,
      model: NOVA_PRESENTATION_CONFIG.model,
      jobId: params.operation.id,
      status: attempt.source === "voice" ? "succeeded" : "failed",
      usage: attempt.usage ?? undefined,
      estimatedInputTokens: attempt.estimatedInputTokens,
      latencyMs: attempt.latencyMs ?? 0,
      failureCode: attempt.providerFailureCode ?? attempt.fallbackReason,
    });
  } catch (error) {
    /*
     * The whole point. A store that refused, a provider that threw rather than
     * returning a failure, a ledger write that could not reach Postgres — none
     * of them may reach the operation that called this, which has already
     * persisted the thing the founder actually asked for.
     */
    console.error("[nova-voice] presentation failed after a completed operation", {
      projectId: params.operation.projectId,
      slot: params.payload.slot,
      message: error instanceof Error ? error.message : "unknown",
    });
  }
}
