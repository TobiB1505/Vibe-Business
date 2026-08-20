import { describe, expect, it } from "vitest";
import {
  createUsageAccumulator,
  hasBilledTokens,
  usageFromJsonBody,
} from "./gateway-usage";

/**
 * Counting what a streamed sampling call cost.
 *
 * The first real agent run recorded `input_tokens: null, output_tokens: null`
 * for calls that had really been billed: the gateway ran `JSON.parse` over a
 * Server-Sent Event stream. Every fixture below is the shape that actually
 * comes back, taken from the installed SDK's event types and the API
 * reference's raw SSE example.
 */

/** One complete stream, in the wire's own shape. */
function successfulStream(
  options: {
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
    cacheRead?: number;
    cacheWrite?: number;
    thinking?: number;
    stop?: boolean;
  } = {},
): string {
  const start = {
    type: "message_start",
    message: {
      id: "msg_01",
      type: "message",
      role: "assistant",
      model: options.model ?? "claude-sonnet-5",
      content: [],
      usage: {
        input_tokens: options.inputTokens ?? 1_200,
        output_tokens: 1,
        cache_read_input_tokens: options.cacheRead ?? 0,
        cache_creation_input_tokens: options.cacheWrite ?? 0,
      },
    },
  };

  const delta = {
    type: "message_delta",
    delta: { stop_reason: "end_turn" },
    // Exactly as the SDK types it: input and cache are `number | null` and null
    // when unchanged; output_tokens is the final cumulative count.
    usage: {
      input_tokens: null,
      cache_read_input_tokens: null,
      cache_creation_input_tokens: null,
      output_tokens: options.outputTokens ?? 340,
      ...(options.thinking === undefined
        ? {}
        : { output_tokens_details: { thinking_tokens: options.thinking } }),
    },
  };

  const lines = [
    `event: message_start\ndata: ${JSON.stringify(start)}\n\n`,
    `event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })}\n\n`,
    `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } })}\n\n`,
    `event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`,
    `event: message_delta\ndata: ${JSON.stringify(delta)}\n\n`,
  ];

  if (options.stop !== false) {
    lines.push(`event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`);
  }

  return lines.join("");
}

function consume(body: string, chunkSize = body.length) {
  const accumulator = createUsageAccumulator();
  for (let at = 0; at < body.length; at += chunkSize) {
    accumulator.push(body.slice(at, at + chunkSize));
  }
  return accumulator.result();
}

describe("a normal successful stream", () => {
  it("reads every count the provider reported", () => {
    expect(
      consume(
        successfulStream({ inputTokens: 1_200, outputTokens: 340, cacheRead: 90, cacheWrite: 12 }),
      ),
    ).toEqual({
      model: "claude-sonnet-5",
      inputTokens: 1_200,
      outputTokens: 340,
      thinkingTokens: 0,
      cacheReadInputTokens: 90,
      cacheCreationInputTokens: 12,
      complete: true,
      streamError: null,
    });
  });

  /**
   * The bug this file exists to prevent recurring. `message_delta` reports
   * unchanged input and cache counts as `null`; reading that as zero would
   * erase the input tokens of every streamed call.
   */
  it("does not let a null in message_delta erase what message_start knew", () => {
    const usage = consume(successfulStream({ inputTokens: 5_000, cacheRead: 300 }));

    expect(usage.inputTokens).toBe(5_000);
    expect(usage.cacheReadInputTokens).toBe(300);
  });

  it("reads reasoning tokens as a count", () => {
    expect(consume(successfulStream({ thinking: 210 })).thinkingTokens).toBe(210);
  });

  /** A stream arrives in arbitrary pieces; events are not aligned to chunks. */
  it.each([1, 7, 64, 500])("reassembles events split across %i-byte chunks", (size) => {
    const usage = consume(successfulStream({ inputTokens: 1_200, outputTokens: 340 }), size);

    expect(usage.inputTokens).toBe(1_200);
    expect(usage.outputTokens).toBe(340);
    expect(usage.complete).toBe(true);
  });
});

describe("a partial stream", () => {
  /**
   * A stream that stopped early still produced what it produced. Reporting
   * zero would understate a bill that really happened (Rule 47).
   */
  it("keeps the tokens counted before it stopped, and says it is incomplete", () => {
    const truncated = successfulStream({ outputTokens: 340, stop: false });
    const usage = consume(truncated);

    expect(usage.outputTokens).toBe(340);
    expect(usage.complete).toBe(false);
  });

  it("keeps the input tokens when the stream dies before any output", () => {
    const body = successfulStream().split("event: content_block_start")[0];
    const usage = consume(body);

    expect(usage.inputTokens).toBe(1_200);
    expect(usage.complete).toBe(false);
  });
});

describe("a provider error mid-stream", () => {
  it("records the provider's error type, never its prose", () => {
    const body = `${successfulStream({ stop: false })}event: error\ndata: ${JSON.stringify({
      type: "error",
      error: { type: "overloaded_error", message: "Overloaded: internal detail here" },
    })}\n\n`;

    const usage = consume(body);

    expect(usage.streamError).toBe("overloaded_error");
    expect(JSON.stringify(usage)).not.toContain("internal detail");
    // The tokens produced before the failure are still counted.
    expect(usage.outputTokens).toBe(340);
  });

  it("names an unshaped error rather than dropping it", () => {
    const usage = consume(`event: error\ndata: ${JSON.stringify({ type: "error" })}\n\n`);

    expect(usage.streamError).toBe("stream_error");
  });
});

describe("a malformed stream", () => {
  it.each([
    ["truncated JSON", 'data: {"type":"message_delta","usage":{'],
    ["not JSON at all", "data: <html>gateway timeout</html>"],
    ["a bare array", "data: []"],
    ["an empty data line", "data:"],
    ["a comment", ": keep-alive"],
  ])("steps over %s without throwing", (_why, line) => {
    const body = `${line}\n\n${successfulStream()}`;

    expect(() => consume(body)).not.toThrow();
    // And the good events around it still land.
    expect(consume(body).outputTokens).toBe(340);
  });

  it("survives a body that is not SSE at all", () => {
    const usage = consume("Internal Server Error");

    expect(usage.complete).toBe(false);
    expect(hasBilledTokens(usage)).toBe(false);
  });

  /**
   * A body with no newline must not grow this buffer without bound — this runs
   * in a process that is also holding an API key.
   */
  it("bounds a line that never ends", () => {
    const accumulator = createUsageAccumulator();
    for (let chunk = 0; chunk < 20; chunk += 1) accumulator.push("x".repeat(100_000));

    expect(() => accumulator.result()).not.toThrow();
  });
});

describe("what counts as billed", () => {
  it("reports nothing billed when the provider reported no tokens", () => {
    expect(hasBilledTokens(consume("event: ping\ndata: {}\n\n"))).toBe(false);
  });

  it("reports billed when only cache reads happened", () => {
    const usage = consume(
      `event: message_start\ndata: ${JSON.stringify({
        type: "message_start",
        message: { model: "claude-sonnet-5", usage: { cache_read_input_tokens: 4_000 } },
      })}\n\n`,
    );

    expect(hasBilledTokens(usage)).toBe(true);
  });
});

describe("a response that was not streamed", () => {
  it("is still counted", () => {
    const usage = usageFromJsonBody(
      JSON.stringify({
        model: "claude-sonnet-5",
        usage: {
          input_tokens: 900,
          output_tokens: 210,
          output_tokens_details: { thinking_tokens: 40 },
        },
      }),
    );

    expect(usage).toMatchObject({
      model: "claude-sonnet-5",
      inputTokens: 900,
      outputTokens: 210,
      thinkingTokens: 40,
      complete: true,
    });
  });

  it.each([
    ["an error body", '{"error":{"type":"overloaded_error"}}'],
    ["not JSON", "gateway timeout"],
    ["no usage block", '{"model":"claude-sonnet-5"}'],
  ])("reports nothing for %s", (_why, payload) => {
    expect(usageFromJsonBody(payload)).toBeNull();
  });
});

describe("what never crosses this boundary", () => {
  /**
   * This module sees every token the model produces. Rule 43 stays true because
   * it reads `usage` and `model` and steps over everything else — there is no
   * branch that touches content.
   */
  it("carries no message text, tool input or reasoning", () => {
    const body = `${successfulStream()}event: content_block_delta\ndata: ${JSON.stringify({
      type: "content_block_delta",
      index: 1,
      delta: { type: "thinking_delta", thinking: "SECRET_REASONING_TRACE" },
    })}\n\n`;

    const serialized = JSON.stringify(consume(body));

    expect(serialized).not.toContain("SECRET_REASONING_TRACE");
    expect(serialized).not.toContain("Hello");
  });
});
