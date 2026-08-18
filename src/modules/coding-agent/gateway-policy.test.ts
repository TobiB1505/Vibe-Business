import { describe, expect, it } from "vitest";
import {
  authorizeGatewayRequest,
  gatewayRefusalBody,
  type AgentRunGatewayState,
} from "./gateway-policy";
import { AGENT_GATEWAY_TOKEN_VERSION, type AgentGatewayClaims } from "./gateway-token";

/**
 * The decision that stands between a customer's sandbox and Vibe's Anthropic
 * key.
 *
 * The caller here is a VM running a customer's repository, driven by a model
 * that reads that repository's contents. Treating it as hostile is not
 * pessimism — Rule 25 already says repository content is data and never
 * instructions, and this is the layer where that stops being a prompt rule and
 * becomes a refusal.
 */

const NOW = new Date("2026-08-18T22:00:00.000Z");

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
    expiresAt: NOW.getTime() + 20 * 60_000,
    ...overrides,
  };
}

function run(overrides: Partial<AgentRunGatewayState> = {}): AgentRunGatewayState {
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

function authorize(overrides: {
  claims?: AgentGatewayClaims;
  run?: AgentRunGatewayState | null;
  requestedModel?: unknown;
} = {}) {
  return authorizeGatewayRequest({
    claims: overrides.claims ?? claims(),
    run: overrides.run === undefined ? run() : overrides.run,
    requestedModel: overrides.requestedModel ?? "claude-sonnet-5",
  });
}

describe("a live run inside its ceilings", () => {
  it("is forwarded", () => {
    expect(authorize()).toEqual({ ok: true });
  });

  it("is still forwarded one request below each ceiling", () => {
    expect(
      authorize({ run: run({ forwardedRequests: 39, spentOutputTokens: 59_999 }) }),
    ).toEqual({ ok: true });
  });
});

describe("model binding", () => {
  it("refuses a model the token does not name", () => {
    expect(authorize({ requestedModel: "claude-opus-5" })).toEqual({
      ok: false,
      refusal: "model_not_authorized",
      status: 403,
    });
  });

  /**
   * Checked before the run is even looked up. A stranger's token must not be
   * able to learn whether a run exists, let alone what it has spent.
   */
  it("refuses on the model before consulting durable state", () => {
    expect(authorize({ requestedModel: "claude-opus-5", run: null }).ok).toBe(false);
    expect(authorize({ requestedModel: "claude-opus-5", run: null })).toEqual({
      ok: false,
      refusal: "model_not_authorized",
      status: 403,
    });
  });
});

describe("identity bindings, re-checked against the stored row", () => {
  it("refuses when no run exists for the token", () => {
    expect(authorize({ run: null })).toEqual({
      ok: false,
      refusal: "run_not_found",
      status: 403,
    });
  });

  it.each([
    ["projectId", { projectId: "project-2" }],
    ["userId", { userId: "user-2" }],
    ["executionSpecId", { executionSpecId: "spec-2" }],
  ] as const)("refuses when the run's %s disagrees with the token", (_field, drift) => {
    expect(authorize({ run: run(drift) })).toEqual({
      ok: false,
      refusal: "run_binding_mismatch",
      status: 403,
    });
  });

  /**
   * The signature proves Vibe issued the claims. It proves nothing about the
   * world the token now finds itself in — so a re-created or re-owned run is
   * not the run this token was minted for.
   */
  it("refuses a mismatch even though the signature is valid", () => {
    // Same token, drifted row. Nothing about the token changed.
    expect(authorize({ run: run({ userId: "someone-else" }) }).ok).toBe(false);
  });
});

describe("revocation is a status change", () => {
  it.each(["queued", "paused", "succeeded", "failed", "cancelled", "aborted"])(
    "refuses a run in %s",
    (status) => {
      expect(authorize({ run: run({ status }) })).toEqual({
        ok: false,
        refusal: "run_not_live",
        status: 403,
      });
    },
  );

  /** Only one status forwards, so a new state is refused until somebody says otherwise. */
  it("refuses an unrecognised status rather than assuming it is live", () => {
    expect(authorize({ run: run({ status: "some_future_state" }) }).ok).toBe(false);
  });
});

describe("ceilings are hard", () => {
  it("refuses once the request count is reached", () => {
    expect(authorize({ run: run({ forwardedRequests: 40 }) })).toEqual({
      ok: false,
      refusal: "request_limit_reached",
      status: 429,
    });
  });

  it("refuses once the output-token budget is reached", () => {
    expect(authorize({ run: run({ spentOutputTokens: 60_000 }) })).toEqual({
      ok: false,
      refusal: "budget_exhausted",
      status: 429,
    });
  });

  /**
   * `>=`, not `>`. Reading it the other way would permit exactly one call past
   * every ceiling the customer approved.
   */
  it("does not allow one extra call at the ceiling", () => {
    expect(authorize({ run: run({ forwardedRequests: 41 }) }).ok).toBe(false);
    expect(authorize({ run: run({ spentOutputTokens: 999_999 }) }).ok).toBe(false);
  });

  /** A cancelled run is refused before its budget is consulted. */
  it("prefers the liveness refusal over the budget one", () => {
    expect(
      authorize({ run: run({ status: "cancelled", spentOutputTokens: 999_999 }) }),
    ).toEqual({ ok: false, refusal: "run_not_live", status: 403 });
  });
});

describe("what a refused caller is told", () => {
  /**
   * Nothing. A refusal that named the failing binding would be a probing
   * oracle for a caller that can retry — and this caller is driven by a model
   * reading a repository somebody else wrote.
   */
  it("names no binding, no identifier and no ceiling", () => {
    const body = JSON.stringify(gatewayRefusalBody());

    for (const leak of [
      "run-1",
      "spec-1",
      "project-1",
      "user-1",
      "claude-sonnet-5",
      "budget",
      "token",
      "expired",
      "60000",
      "40",
    ]) {
      expect(body.toLowerCase(), leak).not.toContain(leak.toLowerCase());
    }
  });

  it("is shaped like an API error the SDK can read", () => {
    expect(gatewayRefusalBody().error.type).toBe("authentication_error");
  });
});
