import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { AnthropicProvider, type AnthropicMessagesClient } from "./adapter";
import type { ToolCallingRequest } from "../provider";

/**
 * The tool-calling half of the adapter (ADR 0109, Proposed).
 *
 * Same discipline as `adapter.test.ts`: the messages client is injected, so
 * nothing here reaches the API, needs a key, or costs money. What these prove
 * is the seam's contract — one call per invocation, native blocks translated
 * into the neutral shape, usage exact, and the structured path untouched.
 */

const TOOL = {
  name: "get_business_health",
  description: "Read the latest Business Health reading.",
  inputSchema: {
    type: "object",
    properties: { lens: { type: "string" } },
    required: ["lens"],
    additionalProperties: false,
  },
};

const request: ToolCallingRequest = {
  operation: "agent_turn",
  model: "claude-sonnet-5",
  system: "You are Nova.",
  messages: [
    { role: "user", content: "<untrusted>What should I work on next?</untrusted>" },
    {
      role: "assistant",
      content: [{ type: "tool_use", id: "toolu_1", name: "get_project_focus", input: {} }],
    },
    {
      role: "tool_results",
      results: [{ toolCallId: "toolu_1", content: "<untrusted>focus</untrusted>", isError: false }],
    },
  ],
  tools: [TOOL],
  maxOutputTokens: 4_000,
  reasoning: { mode: "adaptive", effort: "high" },
  timeoutMs: 60_000,
};

function messageWith(overrides: Partial<Anthropic.Message> = {}): Anthropic.Message {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5",
    stop_reason: "tool_use",
    stop_sequence: null,
    content: [
      { type: "thinking", thinking: "private", signature: "sig" },
      { type: "text", text: "Let me check.", citations: null },
      {
        type: "tool_use",
        id: "toolu_2",
        name: "get_business_health",
        input: { lens: "conversion" },
      },
    ],
    usage: {
      input_tokens: 3_000,
      output_tokens: 120,
      output_tokens_details: { thinking_tokens: 40 },
      cache_read_input_tokens: 2_400,
      cache_creation_input_tokens: 300,
    },
    ...overrides,
  } as Anthropic.Message;
}

function clientWith(overrides: Partial<AnthropicMessagesClient>): AnthropicMessagesClient {
  return {
    create: vi.fn(async () => messageWith()),
    countTokens: vi.fn(async () => ({ input_tokens: 3_000 })),
    ...overrides,
  } as unknown as AnthropicMessagesClient;
}

function apiError(status: number, type: Anthropic.ErrorType = "api_error") {
  return new Anthropic.APIError(
    status,
    { type: "error", error: { type, message: "m" } },
    "m",
    undefined,
    type,
  );
}

describe("AnthropicProvider.generateWithTools — request shape", () => {
  it("sends the tools strictly, the transcript on the wire, and no forced tool choice", async () => {
    let sent: Record<string, unknown> | undefined;
    const create = vi.fn(async (body: Anthropic.MessageCreateParamsNonStreaming) => {
      sent = body as unknown as Record<string, unknown>;
      return messageWith();
    });

    await new AnthropicProvider(clientWith({ create })).generateWithTools(request);

    const params = sent!;
    expect(params.model).toBe("claude-sonnet-5");
    expect(params.max_tokens).toBe(4_000);
    expect(params.thinking).toEqual({ type: "adaptive" });
    expect(params.output_config).toEqual({ effort: "high" });
    expect(params.tools).toEqual([
      {
        name: "get_business_health",
        description: "Read the latest Business Health reading.",
        input_schema: TOOL.inputSchema,
        strict: true,
      },
    ]);
    expect(params.tool_choice).toBeUndefined();
    // Structured-output formatting belongs to the other path only.
    expect((params.output_config as Record<string, unknown>).format).toBeUndefined();

    expect(params.messages).toEqual([
      { role: "user", content: "<untrusted>What should I work on next?</untrusted>" },
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "toolu_1", name: "get_project_focus", input: {} }],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_1",
            content: "<untrusted>focus</untrusted>",
            is_error: false,
          },
        ],
      },
    ]);
  });

  it("asks for one cache breakpoint on the tool path and none on the structured one", async () => {
    const bodies: Record<string, unknown>[] = [];
    const create = vi.fn(async (body: Anthropic.MessageCreateParamsNonStreaming) => {
      bodies.push(body as unknown as Record<string, unknown>);
      return messageWith({
        stop_reason: "end_turn",
        content: [{ type: "text", text: '{"ok":true}', citations: null }],
      });
    });
    const provider = new AnthropicProvider(clientWith({ create }));

    await provider.generateWithTools(request);
    await provider.generateStructured({
      operation: "business_readiness_audit",
      model: "claude-sonnet-5",
      system: "s",
      userContent: "u",
      outputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
      maxOutputTokens: 100,
      reasoning: { mode: "none" },
      timeoutMs: 1_000,
    });

    // A loop that re-sends a growing transcript reads what the last turn wrote.
    expect(bodies[0].cache_control).toEqual({ type: "ephemeral" });
    // One user string that changes every call has no stable prefix to cache.
    expect(bodies[1].cache_control).toBeUndefined();
  });

  it("omits thinking and effort when the reasoning mode is none", async () => {
    let sent: Record<string, unknown> | undefined;
    const create = vi.fn(async (body: Anthropic.MessageCreateParamsNonStreaming) => {
      sent = body as unknown as Record<string, unknown>;
      return messageWith();
    });

    await new AnthropicProvider(clientWith({ create })).generateWithTools({
      ...request,
      reasoning: { mode: "none" },
    });

    expect(sent!).not.toHaveProperty("thinking");
    expect(sent!).not.toHaveProperty("output_config");
  });

  it("counts the exact request that would be sent, tools included", async () => {
    let counted: Record<string, unknown> | undefined;
    const countTokens = vi.fn(async (body: Anthropic.MessageCountTokensParams) => {
      counted = body as unknown as Record<string, unknown>;
      return { input_tokens: 3_000 };
    });

    const result = await new AnthropicProvider(
      clientWith({ countTokens }),
    ).countToolCallingInputTokens(request);

    expect(result).toEqual({ ok: true, inputTokens: 3_000 });
    expect((counted!.tools as unknown[]).length).toBe(1);
    expect(counted!).not.toHaveProperty("max_tokens");
    expect((counted!.messages as unknown[]).length).toBe(3);
  });
});

describe("AnthropicProvider.generateWithTools — one turn, translated", () => {
  it("performs exactly one call and never retries", async () => {
    const create = vi.fn(async () => {
      throw apiError(429, "rate_limit_error");
    });
    const provider = new AnthropicProvider(clientWith({ create }));

    const result = await provider.generateWithTools(request);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("provider_rate_limited");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("returns tool calls, text and the blocks in order, and skips thinking", async () => {
    const result = await new AnthropicProvider(clientWith({})).generateWithTools(request);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stopReason).toBe("tool_use");
    expect(result.text).toBe("Let me check.");
    expect(result.toolCalls).toEqual([
      { id: "toolu_2", name: "get_business_health", input: { lens: "conversion" } },
    ]);
    expect(result.content).toEqual([
      { type: "text", text: "Let me check." },
      {
        type: "tool_use",
        id: "toolu_2",
        name: "get_business_health",
        input: { lens: "conversion" },
      },
    ]);
    // No block of any kind carries the thinking text.
    expect(JSON.stringify(result)).not.toContain("private");
  });

  it("reports cache reads and writes beside the ordinary usage, exactly", async () => {
    const result = await new AnthropicProvider(clientWith({})).generateWithTools(request);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.usage).toEqual({
      inputTokens: 3_000,
      outputTokens: 120,
      thinkingTokens: 40,
      cacheReadInputTokens: 2_400,
      cacheCreationInputTokens: 300,
    });
  });

  it("reads a null cache figure as zero, not as unknown", async () => {
    const create = vi.fn(async () =>
      messageWith({
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_read_input_tokens: null,
          cache_creation_input_tokens: null,
        } as Anthropic.Usage,
      }),
    );
    const result = await new AnthropicProvider(clientWith({ create })).generateWithTools(request);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.usage.cacheReadInputTokens).toBe(0);
      expect(result.usage.cacheCreationInputTokens).toBe(0);
    }
  });

  it("maps end_turn and max_tokens to stop reasons, and refusal to a failure", async () => {
    const provider = (stop: Anthropic.StopReason) =>
      new AnthropicProvider(
        clientWith({
          create: vi.fn(async () =>
            messageWith({
              stop_reason: stop,
              content: [{ type: "text", text: "done", citations: null }],
            }),
          ),
        }),
      );

    const ended = await provider("end_turn").generateWithTools(request);
    expect(ended.ok && ended.stopReason).toBe("end_turn");
    expect(ended.ok && ended.toolCalls).toEqual([]);

    const cut = await provider("max_tokens").generateWithTools(request);
    expect(cut.ok && cut.stopReason).toBe("max_tokens");

    const refused = await provider("refusal").generateWithTools(request);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error).toBe("provider_refusal");
      // Billed tokens are still reported on a refusal.
      expect(refused.usage?.outputTokens).toBe(120);
    }
  });

  it("reports a rejected request with its safe diagnostic and nothing else", async () => {
    const create = vi.fn(async () => {
      throw apiError(400, "invalid_request_error");
    });
    const result = await new AnthropicProvider(clientWith({ create })).generateWithTools(request);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("provider_request_rejected");
      expect(result.diagnostic).toEqual({
        httpStatus: 400,
        providerErrorType: "invalid_request_error",
        requestId: null,
      });
    }
  });
});

/**
 * The property the whole design rests on: adding a tool-calling path did not
 * give the structured path a way to emit a tool. `adapter.test.ts` asserts
 * `params.tools` is undefined for a structured request; this asserts the
 * stronger thing — the structured builder has no code that could set it.
 */
describe("the structured path is still structurally tool-free", () => {
  it("sends no tools on a structured request even when the same client handles tool turns", async () => {
    const bodies: Record<string, unknown>[] = [];
    const create = vi.fn(async (body: Anthropic.MessageCreateParamsNonStreaming) => {
      bodies.push(body as unknown as Record<string, unknown>);
      return messageWith({
        stop_reason: "end_turn",
        content: [{ type: "text", text: '{"ok":true}', citations: null }],
      });
    });
    const provider = new AnthropicProvider(clientWith({ create }));

    await provider.generateWithTools(request);
    await provider.generateStructured({
      operation: "business_readiness_audit",
      model: "claude-sonnet-5",
      system: "s",
      userContent: "u",
      outputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
      maxOutputTokens: 100,
      reasoning: { mode: "none" },
      timeoutMs: 1_000,
    });

    expect(bodies[0].tools).toBeDefined();
    expect(bodies[1].tools).toBeUndefined();
    expect(bodies[1].tool_choice).toBeUndefined();
  });
});
