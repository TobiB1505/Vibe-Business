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
  effort: "high",
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
  const apiError = (status: number) =>
    new Anthropic.APIError(status, { type: "error", error: { type: "x", message: "m" } }, "m", undefined);

  it.each([
    [401, "provider_auth_error"],
    [403, "provider_auth_error"],
    [429, "provider_rate_limited"],
    [408, "provider_timeout"],
    [500, "provider_unavailable"],
    [503, "provider_unavailable"],
    [529, "provider_overloaded"],
    [400, "structured_output_invalid"],
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

  it("reports unparseable output as invalid", async () => {
    const provider = new AnthropicProvider(
      clientWith({
        create: vi.fn(async () =>
          messageWith({ content: [{ type: "text", text: "Sorry, here is some prose.", citations: null }] }),
        ),
      }),
    );

    const result = await provider.generateStructured(request);
    expect(result.ok === false && result.error).toBe("structured_output_invalid");
  });

  it("reports an empty response as invalid", async () => {
    const provider = new AnthropicProvider(
      clientWith({ create: vi.fn(async () => messageWith({ content: [] })) }),
    );
    const result = await provider.generateStructured(request);
    expect(result.ok === false && result.error).toBe("structured_output_invalid");
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
