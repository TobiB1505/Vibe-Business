import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { AnthropicProvider, type AnthropicMessagesClient } from "./adapter";
import type { StructuredRequest } from "../provider";

/**
 * Adapter tests (Sprint 4 §35). The messages client is injected, so no
 * test reaches the Anthropic API, needs a key, or costs money.
 */

const request: StructuredRequest = {
  operation: "business_readiness_audit",
  model: "claude-sonnet-5",
  system: "You are an analyst.",
  userContent: "<evidence>x</evidence>",
  outputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
  maxOutputTokens: 16_000,
  reasoning: { mode: "adaptive", effort: "high" },
  timeoutMs: 240_000,
};

function messageWith(overrides: Partial<Anthropic.Message> = {}): Anthropic.Message {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5",
    stop_reason: "end_turn",
    stop_sequence: null,
    content: [{ type: "text", text: '{"ok":true}', citations: null }],
    usage: {
      input_tokens: 2_500,
      output_tokens: 900,
      output_tokens_details: { thinking_tokens: 400 },
    },
    ...overrides,
  } as Anthropic.Message;
}

/**
 * An SDK error shaped the way the SDK shapes one: the typed `error.type`
 * discriminator is passed as its own constructor argument, exactly as
 * `APIError.generate` does when parsing a real response body.
 */
function apiError(status: number, type: Anthropic.ErrorType = "api_error") {
  return new Anthropic.APIError(status, { type: "error", error: { type, message: "m" } }, "m", undefined, type);
}

function clientWith(overrides: Partial<AnthropicMessagesClient>): AnthropicMessagesClient {
  return {
    create: vi.fn(async () => messageWith()),
    countTokens: vi.fn(async () => ({ input_tokens: 2_500 })),
    ...overrides,
  } as unknown as AnthropicMessagesClient;
}

describe("AnthropicProvider — request shape", () => {
  it("sends adaptive thinking, effort and a JSON schema, and no tools", async () => {
    let sent: Record<string, unknown> | undefined;
    const create = vi.fn(async (body: Anthropic.MessageCreateParamsNonStreaming) => {
      sent = body as unknown as Record<string, unknown>;
      return messageWith();
    });
    const provider = new AnthropicProvider(clientWith({ create }));

    await provider.generateStructured(request);

    const params = sent!;
    expect(params.model).toBe("claude-sonnet-5");
    expect(params.max_tokens).toBe(16_000);
    expect(params.thinking).toEqual({ type: "adaptive" });
    expect(params.output_config).toEqual({
      effort: "high",
      format: { type: "json_schema", schema: request.outputSchema },
    });

    // The trust model depends on the model having no ability to act.
    expect(params.tools).toBeUndefined();
    expect(params.tool_choice).toBeUndefined();
    // Sampling parameters are left at their defaults.
    expect(params.temperature).toBeUndefined();
    expect(params.top_p).toBeUndefined();
    expect(params.top_k).toBeUndefined();
  });

  /**
   * The production defect this file now guards.
   *
   * The adapter sent `thinking` and `output_config.effort` on every request,
   * regardless of model. Haiku 4.5 — which Product Understanding runs on —
   * predates both and rejects the payload, so the feature failed on its first
   * call to the API. Because that first call is the *free* token count, the
   * failure surfaced as `token_count_failed`: the code for "we cannot
   * attribute this", which pointed nowhere near the request body.
   *
   * Both call paths are asserted. Counting is the one that broke.
   */
  describe("a model without adaptive reasoning", () => {
    const noReasoning: StructuredRequest = { ...request, reasoning: { mode: "none" } };

    it("omits thinking and effort from the billable call", async () => {
      let sent: Record<string, unknown> | undefined;
      const create = vi.fn(async (body: Anthropic.MessageCreateParamsNonStreaming) => {
        sent = body as unknown as Record<string, unknown>;
        return messageWith();
      });

      await new AnthropicProvider(clientWith({ create })).generateStructured(noReasoning);

      // Absent, not present-and-undefined: the key must not be serialized.
      expect(sent!).not.toHaveProperty("thinking");
      expect(sent!.output_config).toEqual({
        format: { type: "json_schema", schema: request.outputSchema },
      });
    });

    it("omits them from the free token count too", async () => {
      let counted: Record<string, unknown> | undefined;
      const countTokens = vi.fn(async (body: Anthropic.MessageCountTokensParams) => {
        counted = body as unknown as Record<string, unknown>;
        return { input_tokens: 900 };
      });

      const result = await new AnthropicProvider(clientWith({ countTokens })).countInputTokens(
        noReasoning,
      );

      expect(result).toEqual({ ok: true, inputTokens: 900 });
      expect(counted!).not.toHaveProperty("thinking");
      expect(counted!.output_config).toEqual({
        format: { type: "json_schema", schema: request.outputSchema },
      });
    });
  });

  it("counts tokens against the same shape it would send", async () => {
    let counted: Record<string, unknown> | undefined;
    const countTokens = vi.fn(async (body: Anthropic.MessageCountTokensParams) => {
      counted = body as unknown as Record<string, unknown>;
      return { input_tokens: 1_234 };
    });
    const provider = new AnthropicProvider(clientWith({ countTokens }));

    const result = await provider.countInputTokens(request);

    expect(result).toEqual({ ok: true, inputTokens: 1_234 });
    const params = counted!;
    expect(params.system).toBe(request.system);
    expect(params.thinking).toEqual({ type: "adaptive" });
    expect(params.output_config).toBeTruthy();
  });

  it("reports a failed token count as its own typed error", async () => {
    const provider = new AnthropicProvider(
      clientWith({
        countTokens: vi.fn(async () => {
          throw new Error("boom");
        }),
      }),
    );

    expect(await provider.countInputTokens(request)).toEqual({ ok: false, error: "token_count_failed" });
  });
});

/**
 * Regression tests for the production defect where every token-count failure
 * collapsed into `token_count_failed`. An account with no usage credit
 * reported "the audit could not be prepared", hiding an operator-actionable
 * billing problem behind copy that reads as a transient glitch.
 *
 * Token counting is free but shares an account, key and rate limit with the
 * billable call, so it must classify provider states the same way.
 */
describe("AnthropicProvider — token count failure classification", () => {
  const countFailing = (error: unknown) =>
    new AnthropicProvider(
      clientWith({
        countTokens: vi.fn(async () => {
          throw error;
        }),
      }),
    );

  it.each([
    [401, "provider_auth_error"],
    [403, "provider_auth_error"],
    [402, "provider_billing_error"],
    [429, "provider_rate_limited"],
    [408, "provider_timeout"],
    [529, "provider_overloaded"],
    [500, "provider_unavailable"],
    [503, "provider_unavailable"],
  ])("maps a count failure with HTTP %i to %s", async (status, expected) => {
    const result = await countFailing(apiError(status)).countInputTokens(request);
    expect(result).toEqual({ ok: false, error: expected });
  });

  it("maps a connection timeout during counting to a provider timeout", async () => {
    const result = await countFailing(new Anthropic.APIConnectionTimeoutError({})).countInputTokens(request);
    expect(result).toEqual({ ok: false, error: "provider_timeout" });
  });

  it("maps a network failure during counting to the provider being unavailable", async () => {
    const result = await countFailing(new Anthropic.APIConnectionError({ message: "socket hang up" })).countInputTokens(
      request,
    );
    expect(result).toEqual({ ok: false, error: "provider_unavailable" });
  });

  it("recognises a billing error reported under another status via its typed error field", async () => {
    // The credit-balance failure is identified by the API's own typed
    // discriminator, not by matching message prose.
    const result = await countFailing(apiError(400, "billing_error")).countInputTokens(request);
    expect(result).toEqual({ ok: false, error: "provider_billing_error" });
  });

  it("classifies a billing error built the way the SDK builds it", async () => {
    const sdkError = Anthropic.APIError.generate(
      402,
      { type: "error", error: { type: "billing_error", message: "credit balance is too low" } },
      undefined,
      new Headers(),
    );

    const result = await countFailing(sdkError).countInputTokens(request);
    expect(result).toEqual({ ok: false, error: "provider_billing_error" });
  });

  it.each([
    ["a request the API rejected", apiError(400, "invalid_request_error")],
    ["an error with no provider attribution", new Error("boom")],
    ["a thrown non-error value", "just a string"],
  ])("falls back to token_count_failed for %s", async (_label, error) => {
    const result = await countFailing(error).countInputTokens(request);
    expect(result).toEqual({ ok: false, error: "token_count_failed" });
  });

  it("never leaks a raw provider message out of a failed token count", async () => {
    const result = await countFailing(
      new Anthropic.APIError(
        402,
        { type: "error", error: { type: "billing_error", message: "ORG_ID_9f3a credit balance too low" } },
        "ORG_ID_9f3a credit balance too low",
        undefined,
        "billing_error",
      ),
    ).countInputTokens(request);

    expect(result).toEqual({ ok: false, error: "provider_billing_error" });
    expect(JSON.stringify(result)).not.toContain("ORG_ID_9f3a");
  });
});

describe("AnthropicProvider — successful response", () => {
  it("parses structured output and extracts usage", async () => {
    const provider = new AnthropicProvider(clientWith({}));
    const result = await provider.generateStructured(request);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({ ok: true });
    expect(result.usage).toEqual({ inputTokens: 2_500, outputTokens: 900, thinkingTokens: 400 });
    expect(result.model).toBe("claude-sonnet-5");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("never returns model reasoning, only the text output", async () => {
    const provider = new AnthropicProvider(
      clientWith({
        create: vi.fn(async () =>
          messageWith({
            content: [
              { type: "thinking", thinking: "SECRET_REASONING_TRACE", signature: "sig" },
              { type: "text", text: '{"value":1}', citations: null },
            ] as Anthropic.ContentBlock[],
          }),
        ),
      }),
    );

    const result = await provider.generateStructured(request);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.stringify(result)).not.toContain("SECRET_REASONING_TRACE");
    expect(result.data).toEqual({ value: 1 });
  });

  it("reports thinking tokens for cost accounting even though the text is discarded", async () => {
    const provider = new AnthropicProvider(clientWith({}));
    const result = await provider.generateStructured(request);
    expect(result.ok && result.usage.thinkingTokens).toBe(400);
  });
});

describe("AnthropicProvider — failure mapping", () => {
  it.each([
    [401, "provider_auth_error"],
    [403, "provider_auth_error"],
    // A billing problem is not malformed structured output.
    [402, "provider_billing_error"],
    [429, "provider_rate_limited"],
    [408, "provider_timeout"],
    [500, "provider_unavailable"],
    [503, "provider_unavailable"],
    [529, "provider_overloaded"],
    // A rejected request, not malformed output — nothing was generated.
    [400, "provider_request_rejected"],
    [404, "provider_request_rejected"],
    [413, "provider_request_rejected"],
    [422, "provider_request_rejected"],
  ])("maps HTTP %i to %s", async (status, expected) => {
    const provider = new AnthropicProvider(
      clientWith({
        create: vi.fn(async () => {
          throw apiError(status);
        }),
      }),
    );

    const result = await provider.generateStructured(request);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toBe(expected);
  });

  it("treats a refusal as a typed failure rather than an audit", async () => {
    const provider = new AnthropicProvider(
      clientWith({ create: vi.fn(async () => messageWith({ stop_reason: "refusal", content: [] })) }),
    );

    const result = await provider.generateStructured(request);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("provider_refusal");
    // A refusal still burns tokens, and the ledger must know.
    expect(result.usage?.inputTokens).toBe(2_500);
  });

  it("reports truncation separately from a schema violation", async () => {
    const provider = new AnthropicProvider(
      clientWith({
        create: vi.fn(async () =>
          messageWith({ stop_reason: "max_tokens", content: [{ type: "text", text: '{"partial":', citations: null }] }),
        ),
      }),
    );

    const result = await provider.generateStructured(request);
    expect(result.ok === false && result.error).toBe("output_truncated");
  });

  it("reports unparseable output as a JSON failure, not an empty one", async () => {
    const provider = new AnthropicProvider(
      clientWith({
        create: vi.fn(async () =>
          messageWith({ content: [{ type: "text", text: "Sorry, here is some prose.", citations: null }] }),
        ),
      }),
    );

    const result = await provider.generateStructured(request);
    expect(result.ok === false && result.error).toBe("structured_output_json_invalid");
    // The generation happened and was billed, whatever its content.
    expect(result.ok === false && result.usage?.inputTokens).toBe(2_500);
  });

  it("reports a response with no text block as empty, not unparseable", async () => {
    const provider = new AnthropicProvider(
      clientWith({ create: vi.fn(async () => messageWith({ content: [] })) }),
    );
    const result = await provider.generateStructured(request);
    expect(result.ok === false && result.error).toBe("structured_output_empty");
    expect(result.ok === false && result.usage?.inputTokens).toBe(2_500);
  });

  it("reports a response of only thinking blocks as empty", async () => {
    const provider = new AnthropicProvider(
      clientWith({
        create: vi.fn(async () =>
          messageWith({
            content: [{ type: "thinking", thinking: "SECRET_REASONING_TRACE", signature: "sig" }] as Anthropic.ContentBlock[],
          }),
        ),
      }),
    );

    const result = await provider.generateStructured(request);
    expect(result.ok === false && result.error).toBe("structured_output_empty");
    // Reasoning is never surfaced, not even on the failure path.
    expect(JSON.stringify(result)).not.toContain("SECRET_REASONING_TRACE");
  });

  it("keeps only safe signals when the API rejects the request", async () => {
    const headers = new Headers({ "request-id": "req_011CSHoEeqs5C35K2UUqR7Fy" });
    const provider = new AnthropicProvider(
      clientWith({
        create: vi.fn(async () => {
          throw Anthropic.APIError.generate(
            400,
            {
              type: "error",
              error: {
                type: "invalid_request_error",
                // A real 400 body echoes part of what we sent. None of it
                // may survive into the diagnostic.
                message: "output_config.format.schema: Unsupported keyword at PROMPT_FRAGMENT_MARKER",
              },
            },
            undefined,
            headers,
          );
        }),
      }),
    );

    const result = await provider.generateStructured(request);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("provider_request_rejected");
    expect(result.diagnostic).toEqual({
      httpStatus: 400,
      providerErrorType: "invalid_request_error",
      requestId: "req_011CSHoEeqs5C35K2UUqR7Fy",
    });
    // The diagnostic has no field a message could occupy, and nothing
    // stringifies into one.
    expect(JSON.stringify(result)).not.toContain("PROMPT_FRAGMENT_MARKER");
    expect(JSON.stringify(result)).not.toContain("Unsupported keyword");
    // No usage: the request never reached inference, so nothing was billed.
    expect(result.usage).toBeUndefined();
  });

  it("drops provider-supplied identifiers that are not short identifiers", async () => {
    const provider = new AnthropicProvider(
      clientWith({
        create: vi.fn(async () => {
          // A provider (or a proxy) returning prose where an error type
          // belongs must not turn the diagnostic into a message channel.
          throw new Anthropic.APIError(
            400,
            { type: "error", error: { type: "x", message: "m" } },
            "m",
            new Headers({ "request-id": "not an id: contains PROSE and spaces" }),
            "Request failed: the model returned SENSITIVE_TEXT" as never,
          );
        }),
      }),
    );

    const result = await provider.generateStructured(request);

    expect(result.ok === false && result.diagnostic).toEqual({
      httpStatus: 400,
      providerErrorType: null,
      requestId: null,
    });
    expect(JSON.stringify(result)).not.toContain("SENSITIVE_TEXT");
    expect(JSON.stringify(result)).not.toContain("PROSE");
  });

  it("carries no diagnostic for failures the code already explains", async () => {
    const provider = new AnthropicProvider(
      clientWith({
        create: vi.fn(async () => {
          throw apiError(500);
        }),
      }),
    );

    const result = await provider.generateStructured(request);
    expect(result.ok === false && result.error).toBe("provider_unavailable");
    expect(result.ok === false && result.diagnostic).toBeUndefined();
  });

  it("never leaks a raw provider message into the domain result", async () => {
    const provider = new AnthropicProvider(
      clientWith({
        create: vi.fn(async () => {
          throw new Anthropic.APIError(
            500,
            { type: "error", error: { type: "internal", message: "INTERNAL_HOST_DETAIL" } },
            "INTERNAL_HOST_DETAIL",
            undefined,
          );
        }),
      }),
    );

    const result = await provider.generateStructured(request);
    expect(JSON.stringify(result)).not.toContain("INTERNAL_HOST_DETAIL");
  });
});
