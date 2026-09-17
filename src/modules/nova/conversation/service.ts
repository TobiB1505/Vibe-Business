import { NOVA_CONVERSATION_CONFIG } from "@/modules/ai/operations";
import type { ArtifactKind } from "../artifacts";
import type { NovaActionId } from "../actions";
import type { AIFailureCode, AIProvider, AIUsage, StructuredRequest } from "@/modules/ai/provider";

import { checkConversationReply, type ConversationCheckResult } from "./checks";
import {
  MAX_QUESTION_CHARS,
  NOVA_CONVERSATION_OUTPUT_SCHEMA,
  type NovaConversationPayload,
  type NovaConversationReply,
} from "./payload";
import { buildNovaConversationSystemPrompt, renderNovaConversationUserContent } from "./prompt";

/**
 * Nova answering a question, with a deterministic floor underneath every path.
 *
 * ## The floor is the product
 *
 * Every path through this function returns something a founder can read. A
 * provider outage, a refused validation, a budget overrun and a disabled switch
 * are not error screens — they are Nova saying, in Vibe's own words, that she
 * cannot answer this one. That is what makes a generative lane safe to ship at
 * all, and it is the same argument `voice/service.ts` records: the tier that
 * was a nicety is absent, and the product still works.
 *
 * The floor is deliberately not an apology and not a retry prompt. It says what
 * is true — the answer did not arrive — and points at the surfaces that answer
 * without a model, which is every screen the product already has.
 *
 * ## What the model is allowed to decide
 *
 * The words, one pointer and one proposal — and the last two are ids chosen
 * from lists Vibe put in the payload, validated against those lists afterwards.
 * There is no field through which a model could name a price, a repository
 * path, a branch or an operation to start
 * ([ADR 0109](../../../../docs/decisions/0109-nova-first-application-shell.md) §5,
 * rule 41).
 *
 * ## Who is allowed to call this
 *
 * A founder-initiated command, and nothing else. **Generation never happens in
 * a read or a render** (ADR 0109 §5, stronger than ADR 0086's condition 5),
 * which is what keeps the cost of looking at a screen knowable. There is no
 * reuse identity and no claim: the same question asked twice is a second
 * question, because what Vibe knows has usually moved in between — which is why
 * this operation deliberately has no equivalent of ADR 0086's claim row.
 */

export type ConversationFallbackReason =
  /** The switch is off. Nothing was counted, nothing was called. */
  | "disabled"
  /** The question was longer than the row it would be recorded in. */
  | "question_too_long"
  /** The pack did not fit the input budget. No billable call was made. */
  | "over_input_budget"
  /** The provider refused, timed out, or could not be reached. */
  | "provider_failed"
  /** The response did not have the one field the schema requires. */
  | "invalid_output"
  /** `checks.ts` refused what the model wrote. */
  | "validation_rejected";

export type ConversationOutcome = {
  /** What to show. Never empty, whatever happened. */
  reply: NovaConversationReply;
  source: "model" | "template";
  /** Why the template is being shown. Null when the model's words are kept. */
  fallbackReason: ConversationFallbackReason | null;
  /** Whether `generateStructured` was actually called (rule 47). */
  providerInvoked: boolean;
  /** Present when a billable call was made, successful or not. */
  usage: AIUsage | null;
  /** The provider's own typed code, when the call failed. */
  providerFailureCode: AIFailureCode | null;
  latencyMs: number | null;
  estimatedInputTokens: number | null;
  /** What the validator said, when it ran. */
  check: ConversationCheckResult | null;
};

/**
 * What Nova says when she cannot answer.
 *
 * Vibe's own words, and the same words every time. It names what happened
 * rather than apologising for it, and sends the founder somewhere that works —
 * because every screen in this product answers without a model, and a founder
 * who cannot get a sentence has not lost access to their business.
 */
export const CONVERSATION_TEMPLATE =
  "I could not put an answer together just now. Everything I know is still on the screens" +
  " themselves — your business reading, your product, the plan and the change — and nothing" +
  " about your product has changed because of this.";

function buildRequest(payload: NovaConversationPayload): StructuredRequest {
  const config = NOVA_CONVERSATION_CONFIG;
  return {
    operation: config.operation,
    model: config.model,
    system: buildNovaConversationSystemPrompt(),
    userContent: renderNovaConversationUserContent(payload),
    outputSchema: NOVA_CONVERSATION_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
    maxOutputTokens: config.maxOutputTokens,
    reasoning: config.reasoning,
    timeoutMs: config.timeoutMs,
  };
}

/**
 * The fields the model may return, read defensively.
 *
 * The schema asks for them and the adapter validates against it, and this
 * checks again anyway: `StructuredSuccess.data` is typed `unknown` precisely
 * because a schema is a request rather than a guarantee, and the next thing
 * that happens to this value is that a founder reads it.
 */
function replyFrom(data: unknown): NovaConversationReply | null {
  if (typeof data !== "object" || data === null) return null;

  const shape = data as Record<string, unknown>;
  if (typeof shape.message !== "string") return null;

  const artifact =
    typeof shape.artifact === "object" && shape.artifact !== null
      ? (shape.artifact as { kind?: unknown; ref?: unknown })
      : null;

  /*
   * The two ids are cast and then *checked*, never trusted. `checks.ts` looks
   * each one up in the lists Vibe put in the payload, so a value the enum
   * happened to allow and this project does not have is dropped there rather
   * than being narrowed away here — which is the difference between a type
   * that describes the data and a type that asserts it.
   */
  return {
    message: shape.message,
    artifact:
      artifact === null || typeof artifact.kind !== "string"
        ? null
        : {
            kind: artifact.kind as ArtifactKind,
            ref: typeof artifact.ref === "string" ? artifact.ref : null,
          },
    actionId: typeof shape.actionId === "string" ? (shape.actionId as NovaActionId) : null,
  };
}

export async function answerNovaQuestion(params: {
  provider: AIProvider;
  payload: NovaConversationPayload;
  /** Off by default: a lane that can be switched off is a lane that can be. */
  enabled?: boolean;
}): Promise<ConversationOutcome> {
  const fallback = (
    reason: ConversationFallbackReason,
    extra?: Partial<ConversationOutcome>,
  ): ConversationOutcome => ({
    reply: { message: CONVERSATION_TEMPLATE, artifact: null, actionId: null },
    source: "template",
    fallbackReason: reason,
    providerInvoked: false,
    usage: null,
    providerFailureCode: null,
    latencyMs: null,
    estimatedInputTokens: null,
    check: null,
    ...extra,
  });

  if (params.enabled !== true) return fallback("disabled");
  if (params.payload.question.trim().length > MAX_QUESTION_CHARS) {
    return fallback("question_too_long");
  }

  const request = buildRequest(params.payload);

  /* Count before spending, as every other paid operation does (rule 47). */
  const count = await params.provider.countInputTokens(request);
  if (!count.ok) return fallback("over_input_budget");
  if (count.inputTokens > NOVA_CONVERSATION_CONFIG.maxInputTokens) {
    return fallback("over_input_budget", { estimatedInputTokens: count.inputTokens });
  }

  const estimatedInputTokens = count.inputTokens;
  const result = await params.provider.generateStructured(request);
  const billed = { providerInvoked: true, estimatedInputTokens, latencyMs: result.latencyMs };

  if (!result.ok) {
    /*
     * A failed call may still have been billed, so its usage travels even
     * though its words do not (rule 47). The provider's own error text stays
     * inside the adapter; only the domain code reaches here.
     */
    return fallback("provider_failed", {
      ...billed,
      usage: result.usage ?? null,
      providerFailureCode: result.error,
    });
  }

  const raw = replyFrom(result.data);
  if (raw === null) return fallback("invalid_output", { ...billed, usage: result.usage });

  /*
   * The validator runs on what the model actually wrote. Prompt wording makes a
   * refusal rare; this makes it impossible for a fabricated numeral, a banned
   * claim or a sentence saying Vibe already started something to reach a
   * founder — and drops a pointer that does not resolve rather than failing an
   * otherwise good answer.
   */
  const check = checkConversationReply({ reply: raw, payload: params.payload });

  if (!check.ok || check.reply === null) {
    return fallback("validation_rejected", { ...billed, usage: result.usage, check });
  }

  return {
    reply: check.reply,
    source: "model",
    fallbackReason: null,
    ...billed,
    usage: result.usage,
    providerFailureCode: null,
    check,
  };
}
