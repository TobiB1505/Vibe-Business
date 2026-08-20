import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AGENT_GATEWAY_TOKEN_VERSION,
  mintAgentGatewayToken,
  tokenAuthorizesModel,
  verifyAgentGatewayToken,
  type AgentGatewayClaims,
} from "./gateway-token";

/**
 * The token the sandbox holds instead of Vibe's Anthropic key.
 *
 * Every case below is a way the sandbox could try to become something it is
 * not. The sandbox runs a customer's repository under a model that reads that
 * repository's contents, so "the caller is hostile" is not a thought experiment
 * here — it is the design premise.
 */

const SECRET = "test-gateway-secret-not-a-real-one";
const OTHER_SECRET = "a-different-secret";
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

function verify(token: string, options: { route?: string; now?: Date; secret?: string } = {}) {
  return verifyAgentGatewayToken(token, {
    secret: options.secret ?? SECRET,
    route: options.route ?? "/v1/messages",
    now: options.now ?? NOW,
  });
}

describe("a token Vibe issued", () => {
  it("verifies and carries every binding back", () => {
    const verdict = verify(mintAgentGatewayToken(claims(), SECRET));

    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.claims).toEqual(claims());
  });

  it("carries no credential and no secret", () => {
    const token = mintAgentGatewayToken(claims(), SECRET);
    const decoded = Buffer.from(token.split(".")[0], "base64url").toString("utf8");

    expect(decoded).not.toContain(SECRET);
    expect(decoded).not.toMatch(/sk-ant/);
  });
});

describe("a token Vibe did not issue", () => {
  it("is refused when signed with another secret", () => {
    const forged = mintAgentGatewayToken(claims(), OTHER_SECRET);

    expect(verify(forged)).toEqual({ ok: false, rejection: "bad_signature" });
  });

  /**
   * The attack this shape exists to stop: edit the claims, keep the signature.
   * A sandbox that could raise its own ceiling would make the ceiling advisory.
   */
  it("is refused when the claims are edited under a valid signature", () => {
    const token = mintAgentGatewayToken(claims(), SECRET);
    const [, signature] = token.split(".");
    const inflated = Buffer.from(
      JSON.stringify(claims({ maxOutputTokens: 10_000_000, maxRequests: 100_000 })),
      "utf8",
    ).toString("base64url");

    expect(verify(`${inflated}.${signature}`)).toEqual({ ok: false, rejection: "bad_signature" });
  });

  /**
   * `timingSafeEqual` throws on a length mismatch rather than returning false.
   * Without the length guard this would crash the gateway instead of refusing.
   */
  it.each([
    ["", "empty"],
    ["nonsense", "no separator"],
    ["only-one-part.", "empty signature"],
    [".only-a-signature", "empty payload"],
    ["a.b.c", "too many parts"],
    ["not-base64url!!.short", "undecodable payload"],
  ])("refuses %p (%s) without throwing", (token) => {
    expect(() => verify(token)).not.toThrow();
    expect(verify(token).ok).toBe(false);
  });
});

describe("bindings the gateway enforces before the key is injected", () => {
  it("refuses a token past its expiry", () => {
    const token = mintAgentGatewayToken(claims({ expiresAt: NOW.getTime() - 1 }), SECRET);

    expect(verify(token)).toEqual({ ok: false, rejection: "expired" });
  });

  /** Expiry is exclusive: a token that expires exactly now is spent. */
  it("refuses a token expiring at this instant", () => {
    const token = mintAgentGatewayToken(claims({ expiresAt: NOW.getTime() }), SECRET);

    expect(verify(token).ok).toBe(false);
  });

  it("refuses a route the token does not name", () => {
    const token = mintAgentGatewayToken(claims(), SECRET);

    expect(verify(token, { route: "/v1/organizations" })).toEqual({
      ok: false,
      rejection: "route_not_authorized",
    });
  });

  /**
   * Exact match, not a prefix test. A prefix would admit
   * `/v1/messages/../organizations`, and a normalising comparison would be a
   * path parser nobody reviewed sitting in front of a real credential.
   */
  it("refuses a route that merely starts with the authorized one", () => {
    const token = mintAgentGatewayToken(claims(), SECRET);

    expect(verify(token, { route: "/v1/messages/batches" }).ok).toBe(false);
  });

  it("authorizes exactly one model", () => {
    const verdict = verify(mintAgentGatewayToken(claims(), SECRET));
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;

    expect(tokenAuthorizesModel(verdict.claims, "claude-sonnet-5")).toBe(true);
    expect(tokenAuthorizesModel(verdict.claims, "claude-opus-5")).toBe(false);
    // No family prefixes, no wildcards, and no non-strings.
    expect(tokenAuthorizesModel(verdict.claims, "claude-sonnet-5-20260101")).toBe(false);
    expect(tokenAuthorizesModel(verdict.claims, undefined)).toBe(false);
    expect(tokenAuthorizesModel(verdict.claims, { toString: () => "claude-sonnet-5" })).toBe(false);
  });

  it("refuses a token from an older claim set", () => {
    const token = mintAgentGatewayToken(
      { ...claims(), version: "agent-gateway-token-v0" as never },
      SECRET,
    );

    expect(verify(token)).toEqual({ ok: false, rejection: "unknown_version" });
  });
});

/**
 * A claim that is absent is not a claim that is permissive. Each of these is a
 * field the gateway would otherwise read as `undefined` and compare against.
 */
describe("an incomplete claim set is malformed, never permissive", () => {
  it.each([
    "runId",
    "specId",
    "projectId",
    "userId",
    "model",
    "route",
    "maxOutputTokens",
    "maxRequests",
  ] as const)("refuses a token missing %s", (field) => {
    const incomplete = { ...claims() } as Record<string, unknown>;
    delete incomplete[field];
    const payload = Buffer.from(JSON.stringify(incomplete), "utf8").toString("base64url");
    const signature = createHmac("sha256", SECRET).update(payload).digest("base64url");

    expect(verify(`${payload}.${signature}`)).toEqual({ ok: false, rejection: "malformed" });
  });

  it.each([0, -1, 1.5] as const)("refuses a non-positive-integer ceiling (%p)", (value) => {
    const token = mintAgentGatewayToken(claims({ maxOutputTokens: value }), SECRET);

    expect(verify(token)).toEqual({ ok: false, rejection: "malformed" });
  });
});
