import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { AIProvider } from "@/modules/ai/provider";

import {
  DEFAULT_NOVA_VOICE_LOCALE,
  NOVA_VOICE_POLICY_VERSION,
  NOVA_VOICE_PROMPT_VERSION,
} from "./payload";
import type { NovaVoiceLocale, NovaVoicePayload, NovaVoiceSlot } from "./payload";
import { speakNovaMessage } from "./service";
import type { NovaVoiceFallbackReason, NovaVoiceOutcome } from "./service";

/**
 * The durable half of Nova's voice: claimed once, stored, never retried.
 *
 * ## What this makes safe
 *
 * §M of the Nova audit refuses "a Nova copy LLM call per message, per visit,
 * per founder, with no reuse key and no ledger row that means anything".
 * [ADR 0086](../../../../docs/decisions/0086-nova-presentation-is-claimed-stored-and-attempted-once.md)
 * amends that to five conditions, and this module is four of them: the
 * persisted result, the atomic claim, the deterministic fallback, and a read
 * path with no way to reach a provider. The fifth — the identity — is
 * `computeNovaVoiceIdentity` in `payload.ts`.
 *
 * ## Reads cannot spend
 *
 * `readNovaVoiceMessage` takes no provider, and this module's only import from
 * `@/modules/ai/provider` is a type. That is structural rather than careful: a
 * render that wanted to generate would have to be rewritten, not merely
 * edited, and a source contract in `store.test.ts` asserts the import stays a
 * type import.
 *
 * ## Nothing calls `ensureNovaVoiceMessage`
 *
 * It composes claim → speak → resolve and is reachable from tests only, as
 * `speakNovaMessage` has been since Slice 9. Wiring it to a feed, a page or an
 * operation is a separate decision, including where the usage event is
 * written — nothing has been billed yet, so nothing is recorded yet.
 */

const TABLE = "nova_voice_messages";

/** What a read resolves an identity to. Never empty, whatever is stored. */
export type NovaVoiceRead = {
  message: string;
  source: "voice" | "template";
  /** Why the template is being shown. Null when the model's words are stored. */
  fallbackReason: NovaVoiceFallbackReason | null;
  /**
   * Whether the single attempt for this identity has finished.
   *
   * False covers two states a reader does not need to tell apart: nobody has
   * claimed it, and somebody claimed it and never came back. Both show the
   * template, and neither is a reason for the reader to do anything.
   */
  resolved: boolean;
  /**
   * The attempt **this caller** made, or null if it made none.
   *
   * Null on every read, on a lost claim, and on an identity somebody else
   * already resolved — so a caller that did not spend cannot accidentally
   * write a usage row for somebody else's call. Non-null exactly once per
   * identity, in the process that won the claim, which is what makes the
   * ledger row and the single attempt the same event.
   */
  attempt: NovaVoiceOutcome | null;
};

/** The identity's inputs, stored beside the hash so a row can be read by a person. */
export type NovaVoiceClaim = {
  identity: string;
  projectId: string;
  slot: NovaVoiceSlot;
  locale?: NovaVoiceLocale;
  promptVersion?: string;
  policyVersion?: string;
  model: string;
};

type StoredRow = {
  source: "voice" | "template" | null;
  fallback_reason: NovaVoiceFallbackReason | null;
  message: string | null;
  resolved_at: string | null;
};

/**
 * Resolve one identity to what a founder should read.
 *
 * The template is supplied rather than stored, and that is the point: a
 * fallback row records *that* this identity resolved to the template and why,
 * never a copy of its text. So a reworded template takes effect immediately
 * instead of leaving yesterday's sentence in a row nobody would think to look
 * at (ADR 0086).
 *
 * A stored `voice` row whose message is somehow null resolves to the template
 * as well. The database forbids that combination; this does not trust it to,
 * because the next thing that happens to this value is that a founder reads
 * it — the same reason `service.ts` re-checks the model's response shape after
 * the adapter has already validated it.
 */
export async function readNovaVoiceMessage(
  supabase: SupabaseClient,
  params: { identity: string; template: string },
): Promise<NovaVoiceRead> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("source, fallback_reason, message, resolved_at")
    .eq("identity", params.identity)
    .maybeSingle<StoredRow>();

  if (error) throw error;

  const fallback = (reason: NovaVoiceFallbackReason | null, resolved: boolean): NovaVoiceRead => ({
    message: params.template,
    source: "template",
    fallbackReason: reason,
    resolved,
    /* A read never spends, so there is never an attempt to report. */
    attempt: null,
  });

  if (data === null) return fallback(null, false);
  if (data.resolved_at === null || data.source === null) return fallback(null, false);
  if (data.source === "template") return fallback(data.fallback_reason, true);
  if (data.message === null) return fallback(null, true);

  return {
    message: data.message,
    source: "voice",
    fallbackReason: null,
    resolved: true,
    attempt: null,
  };
}

/**
 * Claim the one attempt this identity gets. True means it is yours.
 *
 * `ignoreDuplicates` compiles to `ON CONFLICT DO NOTHING`, so this is one
 * statement Postgres serializes against a primary key. The insert returns the
 * row it wrote and nothing otherwise — which is how a caller learns it lost,
 * without a second read that could race the first. Two tabs, two regions and
 * one page rendered twice all reduce to one winner.
 *
 * A losing caller must not call the provider. It reads instead, and gets the
 * template until the winner resolves.
 */
export async function claimNovaVoiceGeneration(
  supabase: SupabaseClient,
  claim: NovaVoiceClaim,
): Promise<boolean> {
  const { data, error } = await supabase
    .from(TABLE)
    .upsert(
      {
        identity: claim.identity,
        project_id: claim.projectId,
        slot: claim.slot,
        locale: claim.locale ?? DEFAULT_NOVA_VOICE_LOCALE,
        prompt_version: claim.promptVersion ?? NOVA_VOICE_PROMPT_VERSION,
        policy_version: claim.policyVersion ?? NOVA_VOICE_POLICY_VERSION,
        model: claim.model,
        /*
         * Written rather than defaulted, so "claimed and unresolved" is the
         * same four values everywhere it is read — an absent column and a null
         * one are the same thing in Postgres and not in every double.
         */
        resolved_at: null,
        source: null,
        fallback_reason: null,
        message: null,
      },
      { onConflict: "identity", ignoreDuplicates: true },
    )
    .select("identity");

  if (error) throw error;
  return (data ?? []).length > 0;
}

/**
 * Write the outcome of the claimed attempt, whatever it was.
 *
 * Both outcomes land here. A refusal, an outage, a malformed response and a
 * switch that was off are as final as an accepted sentence: the identity is
 * resolved, so nothing claims it again and no refresh pays a second time.
 *
 * `resolved_at is null` in the filter makes this once-only at the database
 * rather than in the caller — a resolve that arrives twice writes once.
 */
export async function resolveNovaVoiceGeneration(
  supabase: SupabaseClient,
  params: { identity: string; outcome: NovaVoiceOutcome },
): Promise<void> {
  const accepted = params.outcome.source === "voice";

  const { error } = await supabase
    .from(TABLE)
    .update({
      resolved_at: new Date().toISOString(),
      source: params.outcome.source,
      fallback_reason: accepted ? null : params.outcome.fallbackReason,
      /* Never a copy of the template. See the docblock above. */
      message: accepted ? params.outcome.message : null,
    })
    .eq("identity", params.identity)
    .is("resolved_at", null);

  if (error) throw error;
}

/**
 * The whole tier, once: read, and generate only if this caller won the claim.
 *
 * Called by nothing. It exists so the one-generation-maximum property is a
 * tested behaviour rather than a described one, and so that whatever
 * eventually triggers generation has one function to call rather than three to
 * sequence correctly.
 *
 * The order is deliberate. The read comes first so a resolved identity costs
 * one query and no claim; the claim comes before the provider so a loser never
 * spends; and the resolve comes after the outcome so a crash between them
 * leaves the identity permanently on the template rather than open to a second
 * attempt (ADR 0086).
 */
export async function ensureNovaVoiceMessage(params: {
  supabase: SupabaseClient;
  provider: AIProvider;
  claim: NovaVoiceClaim;
  payload: NovaVoicePayload;
  template: string;
  forbiddenSubstrings?: readonly string[];
  enabled?: boolean;
}): Promise<NovaVoiceRead> {
  const stored = await readNovaVoiceMessage(params.supabase, {
    identity: params.claim.identity,
    template: params.template,
  });
  if (stored.resolved) return stored;

  const won = await claimNovaVoiceGeneration(params.supabase, params.claim);
  if (!won) return stored;

  const outcome = await speakNovaMessage({
    provider: params.provider,
    payload: params.payload,
    template: params.template,
    forbiddenSubstrings: params.forbiddenSubstrings,
    enabled: params.enabled,
  });

  await resolveNovaVoiceGeneration(params.supabase, {
    identity: params.claim.identity,
    outcome,
  });

  return {
    message: outcome.message,
    source: outcome.source,
    fallbackReason: outcome.fallbackReason,
    resolved: true,
    attempt: outcome,
  };
}
