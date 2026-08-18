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

vi.mock("@/modules/operations/agent-execution/gateway-state", () => ({
  readAgentRunGatewayState: () => readAgentRunGatewayState(),
  recordGatewayUsage: (params: unknown) => recordGatewayUsage(params),
}));

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
