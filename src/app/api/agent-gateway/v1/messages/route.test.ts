import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  mintAgentGatewayToken,
  type AgentGatewayClaims,
} from "@/modules/coding-agent/gateway-token";
import { AGENT_GATEWAY_TOKEN_VERSION } from "@/modules/coding-agent/gateway-token";
import type { AgentRunGatewayState } from "@/modules/coding-agent/gateway-policy";

/**
 * The one request in this product that leaves a Vercel function carrying Vibe's
 * real Anthropic key.
 *
 * `gateway-token.ts` and `gateway-policy.ts` already prove *what* is refused.
 * What only this file can prove is that the refusal happens **before** the key
 * is touched — that no path through the handler reaches `fetch` without a
 * verdict, and that nothing the caller sent is forwarded alongside Vibe's
 * credential. That is an I/O property, so it is tested against the real handler
 * with the network faked, not against a pure function.
 */

const SECRET = "test-gateway-secret-not-a-real-one";
const REAL_KEY = "sk-ant-vibe-real-key-do-not-leak";

const readAgentRunGatewayState = vi.fn<() => Promise<AgentRunGatewayState | null>>();
const recordGatewayUsage = vi.fn(async (_params: unknown) => {});
/**
 * The durable claim (VB-016), which the handler makes *before* it injects the
 * key. Counted here, because "how many times was an attempt claimed" is the
 * property the request ceiling now rests on.
 */
const claimGatewayRequest = vi.fn<() => Promise<number | null>>(async () => 1);

vi.mock("@/modules/operations/agent-execution/gateway-state", () => ({
  readAgentRunGatewayState: () => readAgentRunGatewayState(),
  recordGatewayUsage: (params: unknown) => recordGatewayUsage(params),
  claimGatewayRequest: () => claimGatewayRequest(),
}));

/**
 * `after()` runs work that must outlive the response — which is exactly what a
 * test cannot observe by awaiting the handler. Captured here and drained
 * explicitly, so an assertion about usage is an assertion about what the
 * platform would really have run.
 */
const afterTasks: (() => Promise<unknown> | unknown)[] = [];

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (task: () => Promise<unknown> | unknown) => {
    afterTasks.push(task);
  },
}));

async function drainAfter() {
  const tasks = afterTasks.splice(0, afterTasks.length);
  for (const task of tasks) await task();
}

const { POST } = await import("./route");

function claims(overrides: Partial<AgentGatewayClaims> = {}): AgentGatewayClaims {
  return {
    version: AGENT_GATEWAY_TOKEN_VERSION,
    runId: "run-1",
    specId: "spec-1",
    projectId: "project-1",
    userId: "user-1",
    model: "claude-sonnet-5",
    route: "/v1/messages",
    maxOutputTokens: 60_000,
    maxRequests: 40,
    expiresAt: Date.now() + 20 * 60_000,
    ...overrides,
  };
}

function liveRun(overrides: Partial<AgentRunGatewayState> = {}): AgentRunGatewayState {
  return {
    status: "running",
    projectId: "project-1",
    userId: "user-1",
    executionSpecId: "spec-1",
    spentOutputTokens: 0,
    forwardedRequests: 0,
    ...overrides,
  };
}

/** The shape the SDK sends, reduced to what the gateway actually reads. */
function samplingRequest(
  options: { token?: string | null; model?: string; headers?: Record<string, string> } = {},
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "anthropic-version": "2023-06-01",
    ...options.headers,
  };
  if (options.token !== null) {
    headers.authorization = `Bearer ${options.token ?? mintAgentGatewayToken(claims(), SECRET)}`;
  }

  return new NextRequest("https://vibe.test/api/agent-gateway/v1/messages", {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: options.model ?? "claude-sonnet-5",
      max_tokens: 1024,
      messages: [{ role: "user", content: "hello" }],
    }),
  });
}

function anthropicOk(usage?: Record<string, unknown>) {
  return new Response(
    JSON.stringify({
      id: "msg_1",
      content: [{ type: "text", text: "hi" }],
      usage: usage ?? {
        input_tokens: 1_200,
        output_tokens: 340,
        output_tokens_details: { thinking_tokens: 90 },
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubEnv("VIBE_AGENT_GATEWAY_SECRET", SECRET);
  vi.stubEnv("ANTHROPIC_API_KEY", REAL_KEY);
  readAgentRunGatewayState.mockResolvedValue(liveRun());
  recordGatewayUsage.mockClear();
  claimGatewayRequest.mockClear();
  claimGatewayRequest.mockResolvedValue(1);
  // An undrained task from a previous test would otherwise write its usage row
  // into this one's assertions — the same bleed a real deployment cannot have,
  // because each request's `after` belongs to that request.
  afterTasks.length = 0;
  fetchMock = vi.fn(async () => anthropicOk());
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("an authorized sampling call", () => {
  it("reaches Anthropic with Vibe's key, which the caller never held", async () => {
    const response = await POST(samplingRequest());

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(new Headers(init.headers).get("x-api-key")).toBe(REAL_KEY);
  });

  it("returns the provider's own body and status verbatim", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { type: "overloaded_error" } }), {
        status: 529,
        headers: { "content-type": "application/json" },
      }),
    );

    const response = await POST(samplingRequest());

    // The SDK's own retry logic reads this. Rewriting it would make the agent's
    // behaviour depend on our parsing of an error we did not generate.
    expect(response.status).toBe(529);
    expect(await response.json()).toEqual({ error: { type: "overloaded_error" } });
  });

  it("records the tokens the provider reported, reasoning count included", async () => {
    await POST(samplingRequest());

    expect(recordGatewayUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        projectId: "project-1",
        userId: "user-1",
        status: "succeeded",
        usage: expect.objectContaining({
          inputTokens: 1_200,
          outputTokens: 340,
          thinkingTokens: 90,
        }),
      }),
    );
  });

  /**
   * Rule 47: a call that really was billed is recorded even when it failed.
   * Without this a run could spend a customer's authorization through errors
   * and the ceiling would never see it.
   */
  it("records a failed upstream call too", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 500 }));

    await POST(samplingRequest());

    expect(recordGatewayUsage).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", failureCode: "upstream_500" }),
    );
  });

  it("records nothing as billed when the provider reported no usage", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: "msg_1" }), { status: 200 }),
    );

    await POST(samplingRequest());

    expect(recordGatewayUsage).toHaveBeenCalledWith(
      expect.objectContaining({ usage: undefined }),
    );
  });
});

describe("nothing the caller sent travels with Vibe's key", () => {
  /**
   * The sandbox runs a customer's repository under a model that reads it. A
   * header set built by forwarding the caller's would let that VM append
   * anything it liked to a request Vibe signs.
   */
  it("drops a caller-supplied x-api-key rather than forwarding two", async () => {
    await POST(samplingRequest({ headers: { "x-api-key": "sk-ant-attacker-key" } }));

    const headers = new Headers((fetchMock.mock.calls[0] as [string, RequestInit])[1].headers);
    expect(headers.get("x-api-key")).toBe(REAL_KEY);
  });

  it.each(["authorization", "x-vercel-id", "cookie", "x-forwarded-for"])(
    "does not forward %s",
    async (name) => {
      await POST(samplingRequest({ headers: { [name]: "should-not-travel" } }));

      const headers = new Headers((fetchMock.mock.calls[0] as [string, RequestInit])[1].headers);
      expect(headers.get(name)).not.toBe("should-not-travel");
    },
  );

  it("does forward the API version the SDK negotiated", async () => {
    await POST(samplingRequest());

    const headers = new Headers((fetchMock.mock.calls[0] as [string, RequestInit])[1].headers);
    expect(headers.get("anthropic-version")).toBe("2023-06-01");
  });
});

describe("a refused call never reaches the provider", () => {
  it("refuses a request with no token at all", async () => {
    const response = await POST(samplingRequest({ token: null }));

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a forged token", async () => {
    const response = await POST(
      samplingRequest({ token: mintAgentGatewayToken(claims(), "a-different-secret") }),
    );

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses an expired token", async () => {
    const response = await POST(
      samplingRequest({ token: mintAgentGatewayToken(claims({ expiresAt: 1 }), SECRET) }),
    );

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a model the token does not name", async () => {
    const response = await POST(samplingRequest({ model: "claude-opus-5" }));

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses when the run has been cancelled", async () => {
    readAgentRunGatewayState.mockResolvedValue(liveRun({ status: "cancelled" }));

    const response = await POST(samplingRequest());

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses when the run has spent its authorized budget", async () => {
    readAgentRunGatewayState.mockResolvedValue(liveRun({ spentOutputTokens: 60_000 }));

    const response = await POST(samplingRequest());

    expect(response.status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a body that is not JSON", async () => {
    const request = new NextRequest("https://vibe.test/api/agent-gateway/v1/messages", {
      method: "POST",
      headers: {
        authorization: `Bearer ${mintAgentGatewayToken(claims(), SECRET)}`,
        "content-type": "application/json",
      },
      body: "not json",
    });

    expect((await POST(request)).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /** Every refusal above, in one assertion: no verdict, no credential. */
  it("tells a refused caller nothing about why", async () => {
    const response = await POST(samplingRequest({ model: "claude-opus-5" }));
    const body = JSON.stringify(await response.json());

    for (const leak of [REAL_KEY, "run-1", "project-1", "user-1", "budget", "model"]) {
      expect(body.toLowerCase(), leak).not.toContain(leak.toLowerCase());
    }
  });
});

describe("a misconfigured gateway", () => {
  /**
   * There is no development bypass here, deliberately. A verification step that
   * configuration can switch off is an open proxy in front of a real credential.
   */
  it("refuses everything when the signing secret is absent", async () => {
    vi.stubEnv("VIBE_AGENT_GATEWAY_SECRET", "");

    expect((await POST(samplingRequest())).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses everything when no Anthropic key is configured", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");

    expect((await POST(samplingRequest())).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("an unreachable provider", () => {
  it("is a failed usage event and a 502, not a retry", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNRESET"));

    const response = await POST(samplingRequest());

    expect(response.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(recordGatewayUsage).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", failureCode: "provider_unreachable" }),
    );
  });
});

/* ---------------------------------------------------------------------------
 * Streaming — the shape the Claude CLI actually asks for
 * ------------------------------------------------------------------------ */

/**
 * The defect the first real run exposed: the gateway buffered the body and ran
 * `JSON.parse` over Server-Sent Events, so every billed call recorded null
 * tokens — and the ceilings measured against those tokens could never bind.
 */
describe("a streamed response", () => {
  function sseBody(options: { outputTokens?: number; stop?: boolean } = {}) {
    const start = {
      type: "message_start",
      message: {
        id: "msg_01",
        model: "claude-sonnet-5",
        usage: { input_tokens: 1_200, output_tokens: 1, cache_read_input_tokens: 90 },
      },
    };
    const delta = {
      type: "message_delta",
      delta: { stop_reason: "end_turn" },
      usage: { input_tokens: null, output_tokens: options.outputTokens ?? 340 },
    };

    const parts = [
      `event: message_start\ndata: ${JSON.stringify(start)}\n\n`,
      `event: message_delta\ndata: ${JSON.stringify(delta)}\n\n`,
    ];
    if (options.stop !== false) parts.push(`event: message_stop\ndata: {"type":"message_stop"}\n\n`);
    return parts.join("");
  }

  /** A real SSE response: a body that arrives in pieces, not a string. */
  function anthropicStream(body: string, options: { status?: number; chunk?: number } = {}) {
    const encoder = new TextEncoder();
    const size = options.chunk ?? 16;

    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (let at = 0; at < body.length; at += size) {
            controller.enqueue(encoder.encode(body.slice(at, at + size)));
          }
          controller.close();
        },
      }),
      { status: options.status ?? 200, headers: { "content-type": "text/event-stream" } },
    );
  }

  it("forwards the stream to the caller rather than buffering it", async () => {
    const body = sseBody();
    fetchMock.mockResolvedValue(anthropicStream(body));

    const response = await POST(samplingRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    // Byte-identical: the gateway is a credential boundary, not a translator.
    expect(await response.text()).toBe(body);
  });

  /**
   * The response must be answerable without waiting for the accounting. If the
   * usage write had to finish first, every turn would pay for it.
   */
  it("answers before the usage is written", async () => {
    fetchMock.mockResolvedValue(anthropicStream(sseBody()));

    await POST(samplingRequest());

    expect(recordGatewayUsage).not.toHaveBeenCalled();
    await drainAfter();
    expect(recordGatewayUsage).toHaveBeenCalledOnce();
  });

  it("records the tokens the stream reported", async () => {
    fetchMock.mockResolvedValue(anthropicStream(sseBody({ outputTokens: 340 })));

    const response = await POST(samplingRequest());
    await response.text();
    await drainAfter();

    expect(recordGatewayUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "succeeded",
        model: "claude-sonnet-5",
        failureCode: null,
        usage: expect.objectContaining({
          inputTokens: 1_200,
          outputTokens: 340,
          cacheReadInputTokens: 90,
        }),
      }),
    );
  });

  /** A stream that stopped early still produced what it produced (Rule 47). */
  it("records a partial stream as failed while keeping its tokens", async () => {
    fetchMock.mockResolvedValue(anthropicStream(sseBody({ stop: false })));

    const response = await POST(samplingRequest());
    await response.text();
    await drainAfter();

    expect(recordGatewayUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        failureCode: "stream_incomplete",
        usage: expect.objectContaining({ outputTokens: 340 }),
      }),
    );
  });

  it("survives a malformed stream without failing the turn", async () => {
    fetchMock.mockResolvedValue(anthropicStream('data: {"type":"message_del\n\nnot sse at all\n'));

    const response = await POST(samplingRequest());

    expect(response.status).toBe(200);
    await response.text();
    await expect(drainAfter()).resolves.not.toThrow();
  });

  /**
   * Many calls, one run — the cardinality the migration exists for. Each
   * forwarded request writes its own row, and the ceiling reads their sum.
   */
  it("writes one usage row per forwarded request", async () => {
    fetchMock.mockImplementation(async () => anthropicStream(sseBody({ outputTokens: 100 })));

    for (let call = 0; call < 3; call += 1) {
      const response = await POST(samplingRequest());
      await response.text();
    }
    await drainAfter();

    expect(recordGatewayUsage).toHaveBeenCalledTimes(3);
    for (const [params] of recordGatewayUsage.mock.calls) {
      expect(params).toMatchObject({ runId: "run-1", usage: { outputTokens: 100 } });
    }
  });

  /**
   * The point of recording cumulative usage: the next request reads it back.
   * A run cannot outspend its authorization by looping faster than the ledger.
   */
  it("is refused once the accumulated spend reaches the ceiling", async () => {
    fetchMock.mockImplementation(async () => anthropicStream(sseBody()));

    // Under the ceiling: forwarded.
    readAgentRunGatewayState.mockResolvedValue(
      liveRun({ spentOutputTokens: 59_900, forwardedRequests: 12 }),
    );
    expect((await POST(samplingRequest())).status).toBe(200);

    // The ledger now says the ceiling is reached; the next call never leaves.
    readAgentRunGatewayState.mockResolvedValue(
      liveRun({ spentOutputTokens: 60_000, forwardedRequests: 13 }),
    );
    fetchMock.mockClear();

    expect((await POST(samplingRequest())).status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /** A refused request was never forwarded, so it must never be counted. */
  it("records nothing for a request it refused", async () => {
    readAgentRunGatewayState.mockResolvedValue(liveRun({ status: "cancelled" }));

    await POST(samplingRequest());
    await drainAfter();

    expect(recordGatewayUsage).not.toHaveBeenCalled();
  });
});

describe("the request ceiling holds under concurrency (VB-016)", () => {
  /**
   * The gap this closes.
   *
   * `readAgentRunGatewayState` counts usage rows, and those are written in
   * `after()` — after the response. So requests arriving together all read the
   * same total and all pass a check that looks correct in isolation. The
   * durable claim is incremented before the key is injected, in one statement
   * Postgres serializes, and what it *returns* is what decides.
   */
  it("refuses the request whose claim lands past the ceiling", async () => {
    // The stale read still says there is room; the claim says otherwise.
    readAgentRunGatewayState.mockResolvedValue(liveRun({ forwardedRequests: 0 }));
    claimGatewayRequest.mockResolvedValue(41);

    const response = await POST(samplingRequest());

    expect(response.status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("claims before the key is injected, never after", async () => {
    const order: string[] = [];
    claimGatewayRequest.mockImplementation(async () => {
      order.push("claim");
      return 1;
    });
    fetchMock.mockImplementation(async () => {
      order.push("fetch");
      return anthropicOk();
    });

    await POST(samplingRequest());

    expect(order).toEqual(["claim", "fetch"]);
  });

  it("forwards nothing when the run vanished between the read and the claim", async () => {
    claimGatewayRequest.mockResolvedValue(null);

    const response = await POST(samplingRequest());

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still forwards the request that lands exactly on the ceiling", async () => {
    claimGatewayRequest.mockResolvedValue(40);

    const response = await POST(samplingRequest());

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe("max_tokens is lowered to the remaining budget (VB-016)", () => {
  function forwardedBody(): Record<string, unknown> {
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    return JSON.parse(String(init.body)) as Record<string, unknown>;
  }

  it("lowers a call that would exceed what the run may still spend", async () => {
    // 60_000 authorized, 59_800 already billed: 200 left, and the SDK asked
    // for 1024.
    readAgentRunGatewayState.mockResolvedValue(liveRun({ spentOutputTokens: 59_800 }));

    await POST(samplingRequest());

    expect(forwardedBody().max_tokens).toBe(200);
  });

  it("leaves a call well inside the budget alone", async () => {
    await POST(samplingRequest());

    expect(forwardedBody().max_tokens).toBe(1024);
  });

  it("keeps the rest of the request the sandbox sent", async () => {
    readAgentRunGatewayState.mockResolvedValue(liveRun({ spentOutputTokens: 59_800 }));

    await POST(samplingRequest());

    const body = forwardedBody();
    expect(body.model).toBe("claude-sonnet-5");
    expect(body.messages).toEqual([{ role: "user", content: "hello" }]);
  });
});

/* ---------------------------------------------------------------------------
 * The deadline on the upstream call (PERF-009)
 * ------------------------------------------------------------------------ */

/**
 * `fetch` has no default timeout, so a socket that was accepted and then went
 * quiet used to be held until the platform killed the function at
 * `maxDuration` — and a killed function writes no usage row, which is the one
 * outcome this route is built to prevent. The deadline bounds the *answer*;
 * the stream that follows it must stay unbounded.
 */
describe("a provider that accepts the connection and never answers", () => {
  /** Mirrors `UPSTREAM_HEADERS_TIMEOUT_MS` in the route. */
  const HEADERS_DEADLINE_MS = 240_000;

  it("ends the attempt itself, records the failure and answers 502", async () => {
    vi.useFakeTimers();
    try {
      let seen: AbortSignal | undefined;
      fetchMock.mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            seen = init.signal ?? undefined;
            seen?.addEventListener("abort", () =>
              reject(new DOMException("The operation was aborted.", "AbortError")),
            );
          }),
      );

      const pending = POST(samplingRequest());
      await vi.advanceTimersByTimeAsync(HEADERS_DEADLINE_MS);
      const response = await pending;

      expect(seen?.aborted, "the route aborted rather than waiting to be killed").toBe(true);
      expect(response.status).toBe(502);
      expect(recordGatewayUsage).toHaveBeenCalledWith(
        expect.objectContaining({ status: "failed", failureCode: "provider_unreachable" }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("disarms the deadline once the answer arrives, so a long turn is never severed", async () => {
    vi.useFakeTimers();
    try {
      let seen: AbortSignal | undefined;
      fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
        seen = init.signal ?? undefined;
        return anthropicOk();
      });

      const response = await POST(samplingRequest());
      expect(response.status).toBe(200);

      // Far past the deadline: a timer left armed would abort here, and on a
      // streamed turn that is a healthy generation cut off mid-sentence.
      await vi.advanceTimersByTimeAsync(HEADERS_DEADLINE_MS * 3);

      expect(seen?.aborted, "the timer must not outlive the attempt it bounded").toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
