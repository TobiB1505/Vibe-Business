import Anthropic from "@anthropic-ai/sdk";
import type {
  AIFailureCode,
  AIProvider,
  AIToolCallingProvider,
  AIUsage,
  AssistantBlock,
  AgentTurn,
  ProviderErrorDiagnostic,
  StructuredRequest,
  StructuredResult,
  TokenCountResult,
  ToolCall,
  ToolCallingRequest,
  ToolCallingResult,
  ToolCallingUsage,
} from "../provider";
import { logRejectedProviderRequest } from "./provider-error-log";

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
 *  - **No `tools` parameter on structured generation.** The model gets
 *    evidence and cannot act on it. This is what makes prompt injection in a
 *    customer's README or website headline a non-event rather than an
 *    incident. Tool-calling turns exist only through the *separate*
 *    `AIToolCallingProvider` contract (ADR 0109, Proposed): a different
 *    request type, a different parameter builder, and a caller that has to
 *    ask for the capability by name. `buildCountableParams` below still
 *    cannot emit a tool.
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
  create(
    params: Anthropic.MessageCreateParamsNonStreaming,
    /**
     * Per-request options. Only `timeout` is used, and it overrides the
     * client-level default so each operation waits for as long as that
     * operation actually takes (see `StructuredRequest.timeoutMs`).
     */
    options?: { timeout?: number },
  ): Promise<Anthropic.Message>;
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
 * The tool-calling result carries cache tokens too. `null` from the API means
 * "no cache was involved", which is zero tokens, not an unknown quantity.
 */
function toToolCallingUsage(usage: {
  input_tokens: number;
  output_tokens: number;
  output_tokens_details?: { thinking_tokens: number } | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}): ToolCallingUsage {
  return {
    ...toUsage(usage),
    cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
  };
}

/**
 * The provider-neutral transcript, rendered onto the wire.
 *
 * Tool results become a `user` message of `tool_result` blocks, which is the
 * one shape the API accepts for them. Nothing is added to any string: the
 * caller fenced every result before it got here, and the adapter's job is
 * representation, never content.
 */
function toWireMessages(turns: readonly AgentTurn[]): Anthropic.MessageParam[] {
  return turns.map((turn): Anthropic.MessageParam => {
    switch (turn.role) {
      case "user":
        return { role: "user", content: turn.content };
      case "assistant":
        return {
          role: "assistant",
          content: turn.content.map(
            (block): Anthropic.ContentBlockParam =>
              block.type === "text"
                ? { type: "text", text: block.text }
                : { type: "tool_use", id: block.id, name: block.name, input: block.input },
          ),
        };
      case "tool_results":
        return {
          role: "user",
          content: turn.results.map(
            (result): Anthropic.ToolResultBlockParam => ({
              type: "tool_result",
              tool_use_id: result.toolCallId,
              content: result.content,
              is_error: result.isError,
            }),
          ),
        };
    }
  });
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
  | { kind: "request_rejected"; diagnostic: ProviderErrorDiagnostic }
  | { kind: "unclassified" };

/**
 * Allow-lists the two provider-controlled strings the diagnostic carries.
 *
 * `error.type` and `request-id` are documented as low-cardinality
 * identifiers, but they arrive from outside the application, so they are
 * validated rather than trusted: anything that is not a short identifier is
 * dropped entirely. This is what stops a message, a body fragment, or an
 * echoed prompt from reaching a log line through the diagnostic channel
 * (Sprint 4 §27).
 */
function safeIdentifier(value: unknown, pattern: RegExp): string | null {
  return typeof value === "string" && pattern.test(value) ? value : null;
}

function toDiagnostic(error: InstanceType<typeof Anthropic.APIError>): ProviderErrorDiagnostic {
  return {
    httpStatus: typeof error.status === "number" ? error.status : null,
    providerErrorType: safeIdentifier(error.type, /^[a-z][a-z0-9_]{0,63}$/),
    requestId: safeIdentifier(error.requestID, /^[A-Za-z0-9_-]{1,64}$/),
  };
}

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
    // side rather than the provider being down or unpaid. The status and the
    // typed error discriminator are kept so the bug is diagnosable without a
    // second paid call.
    if (typeof status === "number") return { kind: "request_rejected", diagnostic: toDiagnostic(error) };
  }

  return { kind: "unclassified" };
}

export class AnthropicProvider implements AIProvider, AIToolCallingProvider {
  readonly name = "anthropic";

  constructor(private readonly messages: AnthropicMessagesClient) {}

  /**
   * Everything both endpoints take, built once so the token count is measured
   * against the exact shape that will be billed. Counting a different payload
   * than the one sent would make the budget gate meaningless.
   *
   * `max_tokens` is the only field they differ on — the count endpoint does
   * not accept an output budget — so it is added by `buildParams` rather than
   * stripped here. Building up is safer than tearing down: a field added to
   * the billable call cannot silently escape the count.
   */
  private buildCountableParams(request: StructuredRequest) {
    /**
     * `thinking` and `output_config.effort` are sent **only** when the caller
     * asked for adaptive reasoning, because they are not universal parameters.
     * They arrived with one model generation, and an older model — Haiku 4.5,
     * which Product Understanding runs on — rejects the request outright when
     * either is present.
     *
     * This used to be unconditional, on the assumption that every model Vibe
     * calls is Sonnet-5-shaped. Spreading empty objects rather than sending
     * explicit `undefined` keeps the key absent from the serialized body,
     * which is what the API distinguishes.
     */
    const thinking =
      request.reasoning.mode === "adaptive"
        ? // Adaptive is the only supported mode on this generation; manual
          // `budget_tokens` is rejected with a 400. Depth is steered by
          // `effort` instead.
          { thinking: { type: "adaptive" as const } }
        : {};

    const effort =
      request.reasoning.mode === "adaptive" ? { effort: request.reasoning.effort } : {};

    return {
      model: request.model,
      system: request.system,
      messages: [{ role: "user" as const, content: request.userContent }],
      ...thinking,
      output_config: {
        ...effort,
        // Structured output is required on every model, whatever its
        // reasoning support — it is what makes a prose answer a typed
        // failure rather than something to parse hopefully.
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

  /** The countable body plus the one field only the billable call takes. */
  private buildParams(request: StructuredRequest) {
    return {
      ...this.buildCountableParams(request),
      max_tokens: request.maxOutputTokens,
    };
  }

  async countInputTokens(request: StructuredRequest): Promise<TokenCountResult> {
    try {
      const result = await this.messages.countTokens(this.buildCountableParams(request));
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
      response = await this.messages.create(this.buildParams(request), {
        timeout: request.timeoutMs,
      });
    } catch (error) {
      const classified = classifyError(error);
      const latencyMs = Date.now() - startedAt;

      // A rejected request is reported as exactly that, with the safe
      // signals needed to fix it. It used to be reported as invalid
      // structured output, which was actively misleading: nothing was
      // generated, so the output was never the problem.
      if (classified.kind === "request_rejected") {
        // The status and typed error type identify the *class* of bug; only
        // the provider's message names the rejected field. It is written to
        // the process log, never persisted or returned — see
        // ./provider-error-log.ts. The returned value below is unchanged.
        logRejectedProviderRequest(error, classified.diagnostic);
        return {
          ok: false,
          error: "provider_request_rejected",
          diagnostic: classified.diagnostic,
          model: request.model,
          latencyMs,
        };
      }

      return {
        ok: false,
        // An unattributable error is treated as the provider being
        // unreachable, because that is the only thing the failure of a
        // single non-streaming call can imply.
        error: classified.kind === "provider_state" ? classified.code : "provider_unavailable",
        model: request.model,
        latencyMs,
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

    // A 200 with no text block at all. Separated from a parse failure
    // because the causes differ: nothing was returned to parse, which points
    // at the request shape or a response consumed entirely by reasoning —
    // not at malformed JSON. Usage is reported either way: the call was paid
    // for.
    if (text.trim() === "") {
      return { ok: false, error: "structured_output_empty", usage, model: response.model, latencyMs };
    }

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      // Text was returned but is not JSON — with structured outputs active
      // this should be unreachable, which is precisely why it is worth
      // being able to tell apart from an empty response.
      return { ok: false, error: "structured_output_json_invalid", usage, model: response.model, latencyMs };
    }

    return { ok: true, data, usage, model: response.model, latencyMs };
  }

  /* -------------------------------------------------------------------------
   * Tool-calling turns (AIToolCallingProvider)
   *
   * A second parameter builder rather than a flag on the first: the
   * structured path must stay incapable of emitting a `tools` key, and the
   * only way to make that structural is to never give it the code.
   * ---------------------------------------------------------------------- */

  private buildCountableToolParams(request: ToolCallingRequest) {
    const thinking =
      request.reasoning.mode === "adaptive" ? { thinking: { type: "adaptive" as const } } : {};
    const effort =
      request.reasoning.mode === "adaptive"
        ? { output_config: { effort: request.reasoning.effort } }
        : {};

    return {
      model: request.model,
      system: request.system,
      messages: toWireMessages(request.messages),
      // `strict: true` makes the API guarantee that `tool_use.input` validates
      // against the schema exactly, so a malformed argument is a provider-side
      // impossibility rather than a runtime-side surprise. The runtime still
      // validates on receipt (rule 45's discipline): the guarantee is about the
      // wire, and the check is about what Vibe is willing to act on.
      tools: request.tools.map(
        (tool): Anthropic.Tool => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
          strict: true,
        }),
      ),
      // `tool_choice` is deliberately left at its default (`auto`). Forcing a
      // tool is rejected outright by the newest model generation, and a loop
      // that needs to force one is a loop that should have asked in prose.
      //
      // One cache breakpoint, at the end of what has been sent so far. A
      // tool-calling loop re-sends a transcript that only grows, so each turn
      // reads what the previous turn wrote and pays the full rate for its own
      // tail alone. Structured generation has no equivalent and is left
      // untouched: one user string that changes every call has no stable
      // prefix to cache, which is a property of that shape rather than an
      // omission here.
      cache_control: { type: "ephemeral" as const },
      ...thinking,
      ...effort,
    };
  }

  private buildToolParams(request: ToolCallingRequest) {
    return {
      ...this.buildCountableToolParams(request),
      max_tokens: request.maxOutputTokens,
    };
  }

  async countToolCallingInputTokens(request: ToolCallingRequest): Promise<TokenCountResult> {
    try {
      const result = await this.messages.countTokens(this.buildCountableToolParams(request));
      return { ok: true, inputTokens: result.input_tokens };
    } catch (error) {
      const classified = classifyError(error);
      if (classified.kind === "provider_state") {
        return { ok: false, error: classified.code };
      }
      return { ok: false, error: "token_count_failed" };
    }
  }

  /**
   * Exactly one turn. The response is translated block by block into the
   * neutral shape; thinking blocks are skipped here exactly as they are in
   * `generateStructured`, so no reasoning leaves this file on either path.
   */
  async generateWithTools(request: ToolCallingRequest): Promise<ToolCallingResult> {
    const startedAt = Date.now();

    let response: Anthropic.Message;
    try {
      response = await this.messages.create(this.buildToolParams(request), {
        timeout: request.timeoutMs,
      });
    } catch (error) {
      const classified = classifyError(error);
      const latencyMs = Date.now() - startedAt;

      if (classified.kind === "request_rejected") {
        logRejectedProviderRequest(error, classified.diagnostic);
        return {
          ok: false,
          error: "provider_request_rejected",
          diagnostic: classified.diagnostic,
          model: request.model,
          latencyMs,
        };
      }

      return {
        ok: false,
        error: classified.kind === "provider_state" ? classified.code : "provider_unavailable",
        model: request.model,
        latencyMs,
      };
    }

    const latencyMs = Date.now() - startedAt;
    const usage = toToolCallingUsage(response.usage);

    if (response.stop_reason === "refusal") {
      return { ok: false, error: "provider_refusal", usage, model: response.model, latencyMs };
    }

    // The context window is a ceiling the caller's own budget should have
    // stopped short of; reaching it is the same class of defect as a
    // truncated structured answer, and gets the same code.
    if (response.stop_reason === "model_context_window_exceeded") {
      return { ok: false, error: "output_truncated", usage, model: response.model, latencyMs };
    }

    const content: AssistantBlock[] = [];
    const toolCalls: ToolCall[] = [];
    for (const block of response.content) {
      if (block.type === "text") {
        content.push({ type: "text", text: block.text });
      } else if (block.type === "tool_use") {
        const call: ToolCall = { id: block.id, name: block.name, input: block.input };
        content.push({ type: "tool_use", ...call });
        toolCalls.push(call);
      }
      // Thinking, redacted thinking and server-tool blocks are skipped: the
      // first two by rule 43, the last because no server tool is ever sent.
    }

    const text = content
      .filter((block): block is Extract<AssistantBlock, { type: "text" }> => block.type === "text")
      .map((block) => block.text)
      .join("");

    const stopReason =
      response.stop_reason === "tool_use"
        ? "tool_use"
        : response.stop_reason === "max_tokens"
          ? "max_tokens"
          : "end_turn";

    return {
      ok: true,
      stopReason,
      content,
      text,
      toolCalls,
      usage,
      model: response.model,
      latencyMs,
    };
  }
}
