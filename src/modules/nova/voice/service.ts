import { NOVA_PRESENTATION_CONFIG } from "@/modules/ai/operations";
import type { AIProvider, AIUsage, StructuredRequest } from "@/modules/ai/provider";

import { checkNovaMessage } from "./checks";
import type { NovaCheckResult } from "./checks";
import {
  NOVA_PRESENTATION_OUTPUT_SCHEMA,
  NOVA_VOICE_POLICY_VERSION,
  NOVA_VOICE_PROMPT_VERSION,
  computeNovaVoiceIdentity,
} from "./payload";
import type { NovaVoicePayload } from "./payload";
import { buildNovaVoiceSystemPrompt, renderNovaVoiceUserContent } from "./prompt";

/**
 * The voice tier: one already-written sentence, said differently.
 *
 * ## The template is the product
 *
 * Every path through this function returns a message, and the caller supplies
 * the one it would have shown anyway. A provider outage, a refused validation,
 * a budget overrun and a disabled switch are not degraded states — they are
 * the product working, with the tier that was a nicety absent. That is what
 * makes this safe to ship at all, and it is asserted rather than intended:
 * `speakNovaMessage` has no failure path that returns nothing.
 *
 * ## What the model is allowed to decide
 *
 * Which words carry facts Vibe already established. Nothing else. The output
 * schema has one field, so there is no channel through which a model could
 * name a control, a price, a Move or an operation — those live on the
 * Vibe-owned side of a feed entry and never pass through inference (ADR 0011,
 * rule 41).
 *
 * Instructions come only from `buildNovaVoiceSystemPrompt`; everything derived
 * from a repository, a website or a founder's typing reaches the model inside
 * the fenced, untrusted-labelled block `renderNovaVoiceUserContent` builds
 * (rule 42).
 *
 * ## Why the caller must cache
 *
 * §H.6 of the Nova audit rejects "a call per message, per visit, per founder,
 * with no reuse key and no ledger row that means anything", and it is right
 * to. This function returns `identity` for exactly that reason: it is
 * `computeNovaVoiceIdentity`'s hash over the payload, the prompt version, the
 * policy version and the model, and a caller that does not check a store for
 * it before calling is the thing that objection names (rule 48).
 *
 * The store is not built yet. Until it is, this is reachable from tests and
 * from nothing else — which is stated here rather than left to be discovered,
 * because the failure mode is a bill rather than a crash.
 */

export type NovaVoiceFallbackReason =
  /** The switch is off. Nothing was counted, nothing was called. */
  | "disabled"
  /** The payload did not fit the input budget. No billable call was made. */
  | "over_input_budget"
  /** The provider refused, timed out, or could not be reached. */
  | "provider_failed"
  /** The response did not have the one field the schema requires. */
  | "invalid_output"
  /** `checks.ts` refused what the model wrote. */
  | "validation_rejected";

export type NovaVoiceOutcome = {
  /** What to show. Never empty, whatever happened. */
  message: string;
  source: "voice" | "template";
  /** Why the template was used. Null when the model's words were kept. */
  fallbackReason: NovaVoiceFallbackReason | null;
  /** The reuse key. The same payload and prompt must never be paid for twice. */
  identity: string;
  /** Present when a billable call was made, successful or not (rule 47). */
  usage: AIUsage | null;
  /** What the validator said, when it ran. Null when nothing reached it. */
  check: NovaCheckResult | null;
};

function buildRequest(payload: NovaVoicePayload): StructuredRequest {
  const config = NOVA_PRESENTATION_CONFIG;
  return {
    operation: config.operation,
    model: config.model,
    system: buildNovaVoiceSystemPrompt(payload.slot),
    userContent: renderNovaVoiceUserContent(payload),
    outputSchema: NOVA_PRESENTATION_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
    maxOutputTokens: config.maxOutputTokens,
    reasoning: config.reasoning,
    timeoutMs: config.timeoutMs,
  };
}

/**
 * The one field the model may return, read defensively.
 *
 * The schema asks for `{ message: string }` and the adapter validates against
 * it, and this checks again anyway: `StructuredSuccess.data` is typed
 * `unknown` precisely because a schema is a request rather than a guarantee,
 * and the next thing that happens to this value is that a founder reads it.
 */
function messageFrom(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const message = (data as { message?: unknown }).message;
  return typeof message === "string" ? message : null;
}

export async function speakNovaMessage(params: {
  provider: AIProvider;
  payload: NovaVoicePayload;
  /** What Vibe would say without a model. Shown unchanged on every failure. */
  template: string;
  /**
   * Strings that would be false in this exact state — "passed" while a check
   * is still running, or an injected sentence's own payload.
   */
  forbiddenSubstrings?: readonly string[];
  /** Off by default: this tier is opt-in, and its absence changes nothing. */
  enabled?: boolean;
}): Promise<NovaVoiceOutcome> {
  const identity = computeNovaVoiceIdentity({
    payload: params.payload,
    model: NOVA_PRESENTATION_CONFIG.model,
    promptVersion: NOVA_VOICE_PROMPT_VERSION,
    policyVersion: NOVA_VOICE_POLICY_VERSION,
  });

  const fallback = (reason: NovaVoiceFallbackReason, extra?: Partial<NovaVoiceOutcome>) => ({
    message: params.template,
    source: "template" as const,
    fallbackReason: reason,
    identity,
    usage: null,
    check: null,
    ...extra,
  });

  if (params.enabled !== true) return fallback("disabled");

  const request = buildRequest(params.payload);

  /* Count before spending, as every other paid operation does (rule 47). */
  const count = await params.provider.countInputTokens(request);
  if (!count.ok) return fallback("over_input_budget");
  if (count.inputTokens > NOVA_PRESENTATION_CONFIG.maxInputTokens) {
    return fallback("over_input_budget");
  }

  const result = await params.provider.generateStructured(request);
  if (!result.ok) {
    /*
     * A failed call may still have been billed, so its usage travels even
     * though its words do not (rule 47). The provider's own error text stays
     * inside the adapter; only the domain code reaches here.
     */
    return fallback("provider_failed", { usage: result.usage ?? null });
  }

  const message = messageFrom(result.data);
  if (message === null) return fallback("invalid_output", { usage: result.usage });

  /*
   * The validator runs on what the model actually wrote, not on what it was
   * asked for. It is the reason this tier is safe to ship: prompt wording
   * makes a refusal rare, and this makes it impossible for a fabricated
   * numeral or a banned claim to reach a founder.
   */
  const check = checkNovaMessage({
    message,
    allowedNumericFacts: params.payload.allowedNumericFacts,
    forbiddenSubstrings: params.forbiddenSubstrings,
  });

  if (!check.ok) {
    return fallback("validation_rejected", { usage: result.usage, check });
  }

  return {
    message,
    source: "voice",
    fallbackReason: null,
    identity,
    usage: result.usage,
    check,
  };
}
