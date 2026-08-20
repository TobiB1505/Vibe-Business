import { describe, expect, it } from "vitest";
import {
  agentTokenExpiryFor,
  mintRunGatewayToken,
  readAgentGatewayConfig,
} from "./gateway-config";
import { verifyAgentGatewayToken } from "./gateway-token";

/**
 * Where the sandbox is told to send its sampling requests, and what it is given
 * to send them with.
 *
 * Both halves are security-relevant in the same way: the origin becomes the
 * sandbox's entire egress allowlist, so a wrong one is both a wrong destination
 * and a hole in the network policy.
 */

const SECRET = "test-gateway-secret-not-a-real-one";

function env(overrides: Record<string, string | undefined> = {}) {
  return {
    VIBE_AGENT_GATEWAY_ORIGIN: "https://app.vibe.test",
    VIBE_AGENT_GATEWAY_SECRET: SECRET,
    ...overrides,
  };
}

describe("a configured gateway", () => {
  it("yields the base URL the SDK appends /v1/messages to", () => {
    expect(readAgentGatewayConfig(env())).toEqual({
      origin: "https://app.vibe.test",
      host: "app.vibe.test",
      baseUrl: "https://app.vibe.test/api/agent-gateway",
      secret: SECRET,
    });
  });

  it("normalises away a path and a trailing slash", () => {
    expect(readAgentGatewayConfig(env({ VIBE_AGENT_GATEWAY_ORIGIN: "https://app.vibe.test/x/" }))
      ?.baseUrl).toBe("https://app.vibe.test/api/agent-gateway");
  });
});

describe("a gateway that is not configured", () => {
  it.each([
    ["no origin", { VIBE_AGENT_GATEWAY_ORIGIN: undefined }],
    ["no secret", { VIBE_AGENT_GATEWAY_SECRET: undefined }],
    ["an empty origin", { VIBE_AGENT_GATEWAY_ORIGIN: "   " }],
    ["an unparseable origin", { VIBE_AGENT_GATEWAY_ORIGIN: "app.vibe.test" }],
  ])("is absent rather than guessed: %s", (_why, overrides) => {
    expect(readAgentGatewayConfig(env(overrides))).toBeNull();
  });

  /**
   * The token is a bearer credential and the sandbox is the one party that must
   * not be able to widen its own reach. A plaintext hop would hand it to
   * anything on the path.
   */
  it("refuses a plaintext origin", () => {
    expect(readAgentGatewayConfig(env({ VIBE_AGENT_GATEWAY_ORIGIN: "http://app.vibe.test" })))
      .toBeNull();
  });
});

describe("the token a run is given", () => {
  const params = {
    runId: "run-1",
    specId: "spec-1",
    projectId: "project-1",
    userId: "user-1",
    model: "claude-sonnet-5",
    maxOutputTokens: 60_000,
    maxRequests: 40,
    expiresAt: Date.now() + 600_000,
  };

  it("verifies for the one route it names", () => {
    const verdict = verifyAgentGatewayToken(mintRunGatewayToken(params, SECRET), {
      secret: SECRET,
      route: "/v1/messages",
    });

    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.claims).toMatchObject({ runId: "run-1", model: "claude-sonnet-5" });
  });

  /** The gateway process holds a key that could address the rest of the API. */
  it("does not verify for any other route", () => {
    expect(
      verifyAgentGatewayToken(mintRunGatewayToken(params, SECRET), {
        secret: SECRET,
        route: "/v1/organizations",
      }).ok,
    ).toBe(false);
  });
});

/**
 * Production Domain & Environment Migration v1, PART F — the gateway origin
 * must stay independent of `lib/env/app-url.ts`'s general deployment-URL
 * resolution, on purpose. `getAppUrl()` would happily resolve `VERCEL_URL`
 * or `NEXT_PUBLIC_APP_URL` into an origin, but this file already documents
 * why doing that here would be wrong: the value becomes the sandbox's whole
 * egress allowlist, so an automatic guess is both a wrong destination and a
 * hole in the network policy. These pin that the two never merge.
 */
describe("independence from the general app-URL resolution (PART F)", () => {
  it("ignores NEXT_PUBLIC_APP_URL entirely — still refuses without its own origin", () => {
    expect(
      readAgentGatewayConfig({
        VIBE_AGENT_GATEWAY_SECRET: SECRET,
        NEXT_PUBLIC_APP_URL: "https://vibe.business",
      }),
    ).toBeNull();
  });

  it("ignores VERCEL_URL entirely — still refuses without its own origin", () => {
    expect(
      readAgentGatewayConfig({
        VIBE_AGENT_GATEWAY_SECRET: SECRET,
        VERCEL_URL: "some-deploy.vercel.app",
      }),
    ).toBeNull();
  });

  it("VIBE_AGENT_GATEWAY_ORIGIN may legitimately differ from NEXT_PUBLIC_APP_URL — both are read independently", () => {
    // A real, deliberate operational shape: production traffic serves from
    // the custom domain while agent dogfooding still points at a pinned
    // preview deployment. Neither variable talks the other one down.
    expect(
      readAgentGatewayConfig(
        env({ VIBE_AGENT_GATEWAY_ORIGIN: "https://dogfood-preview.vercel.app" }),
      )?.origin,
    ).toBe("https://dogfood-preview.vercel.app");
  });
});

describe("expiry", () => {
  /**
   * Sized to the run's own wall clock rather than a round number, so a token
   * that outlives its execution is a bug rather than a policy.
   */
  it("tracks the run's wall clock with one minute of slack", () => {
    expect(agentTokenExpiryFor(600_000, 1_000)).toBe(1_000 + 600_000 + 60_000);
  });
});
