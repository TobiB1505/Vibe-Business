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
 * Provider states that mean "the provider could not serve this request",
 * independent of which endpoint was called. Token counting and generation
 * share them because they share an account, a key, and a rate limit.
 */
type ProviderStateFailure = Extract<
  AIFailureCode,
  | "provider_auth_error"
  | "provider_billing_error"
  | "provider_rate_limited"
  | "provider_timeout"
  | "provider_unavailable"
  | "provider_overloaded"
>;

/**
 * What an SDK error tells us, before deciding how to describe it.
 *
 * `request_rejected` and `unclassified` are kept apart from each other
 * because the two call sites answer them differently: a rejected request is
 * a bug in the payload we built, while an unclassified error is simply
 * something we cannot attribute.
 */
type ClassifiedError =
  | { kind: "provider_state"; code: ProviderStateFailure }
  | { kind: "request_rejected" }
  | { kind: "unclassified" };

/**
 * Maps an SDK error onto domain vocabulary.
 *
 * Classification uses the HTTP status and the API's own typed `error.type`
 * discriminator — never message text. Messages are not a stable contract,
 * and matching on them would silently reclassify failures the day the
 * provider rewords something.
 *
 * Connection errors are tested before the general `APIError` branch on
 * purpose: `APIConnectionError` extends `APIError` with an undefined status,
 * so checking the base class first would swallow every timeout and network
 * failure into the statusless fallback.
 */
function classifyError(error: unknown): ClassifiedError {
  const state = (code: ProviderStateFailure): ClassifiedError => ({ kind: "provider_state", code });

  if (error instanceof Anthropic.APIConnectionTimeoutError) return state("provider_timeout");
  if (error instanceof Anthropic.APIConnectionError) return state("provider_unavailable");

  if (error instanceof Anthropic.APIError) {
    const status = error.status;
    if (status === 401 || status === 403) return state("provider_auth_error");
    // 402 is the documented billing status, and `billing_error` is a typed
    // member of the SDK's `ErrorType` union — the provider may report a
    // credit problem under another status, so the typed field is honoured
    // too. Both are structured fields, not prose.
    if (status === 402 || error.type === "billing_error") return state("provider_billing_error");
    if (status === 429) return state("provider_rate_limited");
    if (status === 408) return state("provider_timeout");
    if (status === 529) return state("provider_overloaded");
    if (typeof status === "number" && status >= 500) return state("provider_unavailable");
    // Any other 4xx means we built a request the API rejected — a bug on our
    // side rather than the provider being down or unpaid.
    if (typeof status === "number") return { kind: "request_rejected" };
  }

  return { kind: "unclassified" };
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
    } catch (error) {
      // The count is free, but it reaches the same account and key as the
      // billable call, so it surfaces the same provider states. Preserving
      // them is what tells an operator "the account has no credit" instead
      // of "try again in a moment" (Sprint 4 §27).
      const classified = classifyError(error);
      if (classified.kind === "provider_state") {
        return { ok: false, error: classified.code };
      }
      // A rejected payload or an error we cannot attribute: all that is
      // honestly known is that counting failed.
      return { ok: false, error: "token_count_failed" };
    }
  }

  async generateStructured(request: StructuredRequest): Promise<StructuredResult> {
    const startedAt = Date.now();

    let response: Anthropic.Message;
    try {
      response = await this.messages.create(this.buildParams(request));
    } catch (error) {
      const classified = classifyError(error);
      return {
        ok: false,
        // A rejected request means the payload we built was invalid, which
        // is reported as an unusable output. An unattributable error is
        // treated as the provider being unreachable, because that is the
        // only thing the failure of a single non-streaming call can imply.
        error:
          classified.kind === "provider_state"
            ? classified.code
            : classified.kind === "request_rejected"
              ? "structured_output_invalid"
              : "provider_unavailable",
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
