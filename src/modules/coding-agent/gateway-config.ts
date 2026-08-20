import "server-only";

import {
  AGENT_GATEWAY_ROUTES,
  mintAgentGatewayToken,
  type AgentGatewayClaims,
} from "./gateway-token";

/**
 * Where the Agent Gateway lives, and the authority to mint tokens for it
 * (EXECUTION CORE-4 runtime placement).
 *
 * ## Why the origin is configured rather than derived
 *
 * Because the sandbox has to reach it from outside, and a guessed origin is a
 * guessed trust boundary. Deriving one from `VERCEL_URL` would point a
 * production execution at whatever deployment happened to be running the
 * workflow — a preview, a branch, a rollback — and the sandbox's egress
 * allowlist is built from the same value, so a wrong guess is both a wrong
 * destination and a hole in the network policy.
 *
 * So it is explicit, and its absence is a configuration failure rather than a
 * fallback. An agent runtime that cannot reach a gateway does not run.
 */

export type AgentGatewayConfig = {
  /** e.g. `https://app.vibe.business`. No trailing slash, https only. */
  origin: string;
  /** The host alone, for the sandbox's egress allowlist. */
  host: string;
  /** What `ANTHROPIC_BASE_URL` is set to inside the sandbox. */
  baseUrl: string;
  secret: string;
};

/** The path prefix the gateway is mounted at. The SDK appends `/v1/messages`. */
const GATEWAY_PATH = "/api/agent-gateway";

/**
 * Reads the gateway's configuration, or reports that it is absent.
 *
 * `null` rather than a throw: the caller turns it into a typed run failure, and
 * a missing configuration is an operational fact rather than an exception.
 */
export function readAgentGatewayConfig(
  env: Record<string, string | undefined> = process.env,
): AgentGatewayConfig | null {
  const origin = env.VIBE_AGENT_GATEWAY_ORIGIN?.trim();
  const secret = env.VIBE_AGENT_GATEWAY_SECRET?.trim();
  if (!origin || !secret) return null;

  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }

  // https only. The token is a bearer credential and the sandbox is the one
  // party that must not be able to widen its own reach; a plaintext hop would
  // hand it to anything on the path.
  if (url.protocol !== "https:") return null;

  const normalized = `${url.protocol}//${url.host}`;

  return {
    origin: normalized,
    host: url.hostname,
    baseUrl: `${normalized}${GATEWAY_PATH}`,
    secret,
  };
}

/**
 * How long a run's gateway token stays valid.
 *
 * Sized to the run's own wall clock rather than to a round number, so a token
 * that outlives its execution is a bug rather than a policy. It is the weakest
 * of the bindings — the run's status and spend are re-read on every request —
 * but it is the one that keeps working after the database has forgotten why.
 */
export function agentTokenExpiryFor(wallClockMs: number, now: number): number {
  // One minute of slack for provisioning and the final turn's round trip.
  return now + wallClockMs + 60_000;
}

export type MintRunTokenParams = {
  runId: string;
  specId: string;
  projectId: string;
  userId: string;
  model: string;
  maxOutputTokens: number;
  maxRequests: number;
  expiresAt: number;
};

/**
 * Mints the one credential the sandbox is given.
 *
 * Not the Anthropic key, and not a Vibe session: a signed statement of exactly
 * which execution this is, which model it may ask for, how much it may spend
 * and until when. Everything it authorizes is re-checked against durable state
 * at the gateway, so this is the *upper* bound on a run's reach rather than a
 * grant of it.
 */
export function mintRunGatewayToken(params: MintRunTokenParams, secret: string): string {
  const claims: AgentGatewayClaims = {
    version: "agent-gateway-token-v1",
    runId: params.runId,
    specId: params.specId,
    projectId: params.projectId,
    userId: params.userId,
    model: params.model,
    // One route, named explicitly. The token cannot address the rest of the
    // Anthropic API even though the gateway process holds a key that could.
    route: AGENT_GATEWAY_ROUTES[0],
    maxOutputTokens: params.maxOutputTokens,
    maxRequests: params.maxRequests,
    expiresAt: params.expiresAt,
  };

  return mintAgentGatewayToken(claims, secret);
}
