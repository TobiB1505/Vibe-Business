import Anthropic from "@anthropic-ai/sdk";
import type {
  AIFailureCode,
  AIProvider,
  AIUsage,
  StructuredRequest,
  StructuredResult,
  TokenCountResult,
} from "../provider";

/**
 * Anthropic adapter — the only file in the application allowed to import
 * the Anthropic SDK (ADR 0005, ADR 0011).
 *
 * Everything provider-specific stops here: SDK types, model parameter
 * shapes, and error taxonomies are translated into the domain vocabulary in
 * `../provider.ts` before anything else sees them. Callers switch on
 * `AIFailureCode`; a raw Anthropic error never escapes this module and
 * therefore never reaches a log line or a browser (Sprint 4 §27, §38).
 *
 * Three deliberate omissions, each a security property rather than a
 * simplification:
 *
 *  - **No `tools` parameter.** The model gets evidence and cannot act on
 *    it. This is what makes prompt injection in a customer's README or
 *    website headline a non-event rather than an incident.
 *  - **No streaming.** A single request/response keeps usage accounting and
 *    refusal handling exact.
 *  - **Thinking blocks are never read.** Only `text` blocks are extracted,
 *    so hidden reasoning cannot be persisted or displayed (Sprint 4 §21).
 *    Reasoning *token counts* are still read, because they are billed.
 */

/**
 * The slice of the SDK this adapter actually uses, declared structurally
 * rather than as `Pick<Anthropic["messages"], …>`.
 *
 * The SDK's methods return `APIPromise`, an internal subclass carrying
 * private fields. Depending on it would force every test double to
 * reproduce SDK internals; a plain `Promise` return type is satisfied by
 * the real client (`APIPromise` extends `Promise`) and by a one-line fake.
 */
export type AnthropicMessagesClient = {
  create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
  countTokens(params: Anthropic.MessageCountTokensParams): Promise<Anthropic.MessageTokensCount>;
};

function toUsage(usage: {
  input_tokens: number;
  output_tokens: number;
  output_tokens_details?: { thinking_tokens: number } | null;
}): AIUsage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    thinkingTokens: usage.output_tokens_details?.thinking_tokens ?? 0,
  };
}

/**
 * Maps an SDK error onto domain vocabulary.
 *
 * Status codes are used rather than message text: messages are not a stable
 * contract, and matching on them would silently reclassify failures when
 * the provider rewords something.
 */
function classifyError(error: unknown): AIFailureCode {
  if (error instanceof Anthropic.APIError) {
    const status = error.status;
    if (status === 401 || status === 403) return "provider_auth_error";
    if (status === 429) return "provider_rate_limited";
    if (status === 408) return "provider_timeout";
    if (status === 529) return "provider_overloaded";
    if (typeof status === "number" && status >= 500) return "provider_unavailable";
    // A 4xx that is not auth or rate limiting means we built a request the
    // API rejected — a bug on our side, surfaced as an invalid output
    // rather than blamed on the provider being down.
    return "structured_output_invalid";
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) return "provider_timeout";
  if (error instanceof Anthropic.APIConnectionError) return "provider_unavailable";
  return "provider_unavailable";
}

export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic";

  constructor(private readonly messages: AnthropicMessagesClient) {}

  /**
   * Builds the request body once, so the token count is measured against
   * the exact shape that will be billed. Counting a different payload than
   * the one sent would make the budget gate meaningless.
   */
  private buildParams(request: StructuredRequest) {
    return {
      model: request.model,
      max_tokens: request.maxOutputTokens,
      system: request.system,
      messages: [{ role: "user" as const, content: request.userContent }],
      // Adaptive thinking is the only supported mode on Sonnet 5; manual
      // `budget_tokens` is rejected with a 400 on this model generation.
      // Depth is steered by `effort` instead.
      thinking: { type: "adaptive" as const },
      output_config: {
        effort: request.effort,
        format: {
          type: "json_schema" as const,
          schema: request.outputSchema,
        },
      },
      // Temperature, top_p and top_k are deliberately left at their
      // defaults: non-default sampling values are unsupported alongside
      // thinking on this model generation.
    };
  }

  async countInputTokens(request: StructuredRequest): Promise<TokenCountResult> {
    try {
      const params = this.buildParams(request);
      const result = await this.messages.countTokens({
        model: params.model,
        system: params.system,
        messages: params.messages,
        thinking: params.thinking,
        output_config: params.output_config,
      });
      return { ok: true, inputTokens: result.input_tokens };
    } catch {
      // The count is a cost guard, not the product. Its failure is reported
      // as its own code so the caller can decide, rather than being
      // conflated with a failed audit.
      return { ok: false, error: "token_count_failed" };
    }
  }

  async generateStructured(request: StructuredRequest): Promise<StructuredResult> {
    const startedAt = Date.now();

    let response: Anthropic.Message;
    try {
      response = await this.messages.create(this.buildParams(request));
    } catch (error) {
      return {
        ok: false,
        error: classifyError(error),
        model: request.model,
        latencyMs: Date.now() - startedAt,
      };
    }

    const latencyMs = Date.now() - startedAt;
    const usage = toUsage(response.usage);

    // A refusal is a valid API response carrying real billed tokens — it is
    // simply not an audit. Persisting it as one would fabricate a result
    // (Sprint 4 §28).
    if (response.stop_reason === "refusal") {
      return { ok: false, error: "provider_refusal", usage, model: response.model, latencyMs };
    }

    // Truncation means the JSON is incomplete. Separated from a schema
    // violation because the fix differs: raise the output budget rather
    // than change the schema.
    if (response.stop_reason === "max_tokens") {
      return { ok: false, error: "output_truncated", usage, model: response.model, latencyMs };
    }

    // Only text blocks are read. Any thinking block present is skipped and
    // never leaves this function.
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    if (text.trim() === "") {
      return { ok: false, error: "structured_output_invalid", usage, model: response.model, latencyMs };
    }

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, error: "structured_output_invalid", usage, model: response.model, latencyMs };
    }

    return { ok: true, data, usage, model: response.model, latencyMs };
  }
}
