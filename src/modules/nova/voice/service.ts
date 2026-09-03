import { NOVA_PRESENTATION_CONFIG } from "@/modules/ai/operations";
import type { AIProvider, AIUsage, StructuredRequest } from "@/modules/ai/provider";

import { checkNovaMessage } from "./checks";
import type { NovaCheckResult } from "./checks";
import { NOVA_PRESENTATION_OUTPUT_SCHEMA } from "./payload";
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
 * ## Who is allowed to call this
 *
 * Nobody, directly. §H.6 of the Nova audit rejects "a call per message, per
 * visit, per founder, with no reuse key and no ledger row that means
 * anything", and [ADR 0084](../../../../docs/decisions/0084-nova-presentation-is-claimed-stored-and-attempted-once.md)
 * amends that to five conditions rather than to a yes. This function satisfies
 * exactly one of them — the deterministic fallback. The other four are
 * `store.ts`'s: the identity, the persisted result, the atomic claim, and a
 * read path that cannot reach a provider.
 *
 * So the entry point is `ensureNovaVoiceMessage`, which claims the one attempt
 * this identity gets before reaching here and records the outcome after. This
 * function no longer computes an identity of its own: one definition of what
 * makes two messages the same message, in `payload.ts`, used by the code that
 * claims against it.
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
  const fallback = (reason: NovaVoiceFallbackReason, extra?: Partial<NovaVoiceOutcome>) => ({
    message: params.template,
    source: "template" as const,
    fallbackReason: reason,
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
    usage: result.usage,
    check,
  };
}
