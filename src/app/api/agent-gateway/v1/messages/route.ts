import { NextResponse, type NextRequest } from "next/server";

import {
  authorizeGatewayRequest,
  gatewayRefusalBody,
  type AgentGatewayRefusal,
} from "@/modules/coding-agent/gateway-policy";
import { verifyAgentGatewayToken } from "@/modules/coding-agent/gateway-token";
import {
  readAgentRunGatewayState,
  recordGatewayUsage,
} from "@/modules/operations/agent-execution/gateway-state";

/**
 * The Vibe Agent Gateway (EXECUTION CORE-4 runtime placement).
 *
 * The one place in this product where a request from an untrusted VM becomes a
 * request carrying Vibe's real Anthropic key.
 *
 * ## Why it exists
 *
 * The Claude Agent SDK spawns a ~325 MB native `claude` binary, so it cannot
 * run inside a Vercel function — the first real run failed in 44 ms with zero
 * turns for exactly that reason. The SDK therefore runs in a Vercel Sandbox,
 * and a sandbox that executes a customer's repository is the last place Vibe's
 * Anthropic key may ever be.
 *
 * Anthropic's own guidance names this shape (*Secure deployment* → The proxy
 * pattern, *Hosting the Agent SDK* → Auth and secrets): run a proxy outside the
 * agent's boundary that injects the credential, and point the subprocess at it
 * with `ANTHROPIC_BASE_URL`. The sandbox carries a short-lived, execution-scoped
 * token; the key never leaves this process.
 *
 * ## Authentication is the token, and nothing else
 *
 * There is no session here and there must not be — the caller is a VM, not a
 * browser. So this endpoint is deliberately unauthenticated in the session
 * sense and completely closed in every other: an unsigned, expired, wrong-route,
 * wrong-model, revoked or over-budget request is refused before the key is
 * touched.
 *
 * There is no development bypass and no debug flag that skips verification. A
 * check that configuration can disable is an open proxy in front of a real
 * credential.
 *
 * ## What this file deliberately does not contain
 *
 * The decisions. `gateway-token.ts` verifies the signature and the
 * self-describing claims; `gateway-policy.ts` weighs those against durable
 * state. Both are pure and exhaustively tested, because a refusal that can only
 * be exercised by standing up Next.js, Postgres and a network is a refusal
 * nobody covers. What is left here is I/O.
 */

/** Node, not edge: the service-role client and `node:crypto` both need it. */
export const runtime = "nodejs";

/**
 * Long enough for a real turn.
 *
 * This route is not answering a question of its own — it is holding a
 * connection open while Anthropic composes a coding agent's next turn, which
 * routinely takes 30–90 seconds and can take longer on a large transcript. The
 * platform default is shorter than that on some plans, and a ceiling reached
 * mid-turn returns a 504 the SDK reads as a provider fault: the run dies
 * looking exactly like an outage, which is the failure mode this whole runtime
 * placement exists to stop mistaking for something else.
 *
 * 300s is a deadline, not a budget. What actually bounds a run is the token
 * ceiling and request count on its gateway token, and the sandbox's own
 * 15-minute lifetime.
 */
export const maxDuration = 300;

/** The single upstream this gateway will ever speak to. */
const ANTHROPIC_ORIGIN = "https://api.anthropic.com";
const ROUTE = "/v1/messages";

/** The API version the SDK negotiates. Forwarded verbatim when present. */
const FORWARDED_REQUEST_HEADERS = ["anthropic-version", "anthropic-beta", "content-type"];

function refuse(refusal: AgentGatewayRefusal, status: number, context: Record<string, unknown>) {
  // Server-side, the precise reason. The caller gets none of it: a refusal that
  // named the failing binding would be a probing oracle for a caller that can
  // retry, and this caller is driven by a model reading somebody's repository.
  console.warn("[agent-gateway] refused", { refusal, ...context });
  return NextResponse.json(gatewayRefusalBody(), { status });
}

function bearerFrom(request: NextRequest): string | null {
  /*
   * Both shapes, because the SDK picks one from the environment it was given.
   *
   * `ANTHROPIC_AUTH_TOKEN` is sent as `Authorization: Bearer`;
   * `ANTHROPIC_API_KEY` is sent as `x-api-key`. The sandbox is configured with
   * the first, and the second is accepted so a future change to that wiring
   * fails visibly at the policy layer rather than silently as "missing token".
   */
  const authorization = request.headers.get("authorization");
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    return authorization.slice("bearer ".length).trim() || null;
  }

  return request.headers.get("x-api-key")?.trim() || null;
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();

  const secret = process.env.VIBE_AGENT_GATEWAY_SECRET;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!secret || !apiKey) {
    // Configuration, not authorization. Loud server-side, opaque to the caller:
    // "the gateway is misconfigured" is not a fact a sandbox needs.
    console.error("[agent-gateway] not configured", {
      hasSecret: Boolean(secret),
      hasApiKey: Boolean(apiKey),
    });
    return NextResponse.json(gatewayRefusalBody(), { status: 503 });
  }

  const token = bearerFrom(request);
  if (!token) return refuse("missing_token", 401, {});

  const verdict = verifyAgentGatewayToken(token, { secret, route: ROUTE });
  if (!verdict.ok) return refuse("token_rejected", 401, { rejection: verdict.rejection });

  const { claims } = verdict;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return refuse("malformed_request", 400, { runId: claims.runId });
  }

  const requestedModel = (body as { model?: unknown } | null)?.model;

  // Both authorities. The signature said Vibe issued this; durable state says
  // whether it is still true (Rule 70's shape, one layer down).
  const run = await readAgentRunGatewayState({ runId: claims.runId });
  const decision = authorizeGatewayRequest({ claims, run, requestedModel });
  if (!decision.ok) {
    return refuse(decision.refusal, decision.status, { runId: claims.runId });
  }

  /*
   * The credential is injected here and nowhere else.
   *
   * A fresh header set is built rather than forwarding the caller's: passing
   * theirs through would carry whatever else the sandbox chose to send —
   * including a second `x-api-key` — into a request Vibe signs with its own
   * key. Only the three headers the API genuinely needs are copied.
   */
  const headers = new Headers({
    "x-api-key": apiKey,
    "content-type": "application/json",
  });
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${ANTHROPIC_ORIGIN}${ROUTE}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch (error) {
    await recordGatewayUsage({
      runId: claims.runId,
      projectId: claims.projectId,
      userId: claims.userId,
      model: claims.model,
      status: "failed",
      latencyMs: Date.now() - startedAt,
      failureCode: "provider_unreachable",
    });
    console.error("[agent-gateway] upstream unreachable", {
      runId: claims.runId,
      detail: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json(gatewayRefusalBody(), { status: 502 });
  }

  const payload = await upstream.text();

  /*
   * Usage is recorded from the provider's own response, for successes and
   * failures alike (Rule 47) — and only when tokens were genuinely billed.
   *
   * This is also what makes the budget ceiling real: the next request reads
   * this row back, so a run cannot outspend its authorization by looping faster
   * than the ledger is written.
   */
  await recordGatewayUsage({
    runId: claims.runId,
    projectId: claims.projectId,
    userId: claims.userId,
    model: claims.model,
    status: upstream.ok ? "succeeded" : "failed",
    latencyMs: Date.now() - startedAt,
    failureCode: upstream.ok ? null : `upstream_${upstream.status}`,
    usage: upstream.ok ? usageFrom(payload) : undefined,
  });

  // The provider's own answer, verbatim. The gateway is a credential boundary,
  // not a translation layer — rewriting a response would make the SDK's error
  // handling depend on our parsing of it.
  return new NextResponse(payload, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
}

/**
 * The token counts the provider reported, or nothing.
 *
 * Returns `undefined` rather than zeros when the shape is unfamiliar: a zero
 * recorded as if it were measured would understate a bill that really happened,
 * and `recordAIUsage` already treats an absent `usage` as "no tokens known".
 */
function usageFrom(payload: string):
  | {
      inputTokens: number;
      outputTokens: number;
      thinkingTokens: number;
      cacheReadInputTokens?: number;
      cacheCreationInputTokens?: number;
    }
  | undefined {
  try {
    const usage = (
      JSON.parse(payload) as {
        usage?: Record<string, unknown> & {
          output_tokens_details?: { thinking_tokens?: unknown } | null;
        };
      }
    ).usage;
    if (!usage) return undefined;

    const input = usage.input_tokens;
    const output = usage.output_tokens;
    if (typeof input !== "number" || typeof output !== "number") return undefined;

    // The same field the Anthropic adapter reads. A count, never the text —
    // reasoning is billed and therefore recorded, and nothing more (Rule 43).
    const thinking = usage.output_tokens_details?.thinking_tokens;

    return {
      inputTokens: input,
      outputTokens: output,
      thinkingTokens: typeof thinking === "number" ? thinking : 0,
      cacheReadInputTokens:
        typeof usage.cache_read_input_tokens === "number" ? usage.cache_read_input_tokens : undefined,
      cacheCreationInputTokens:
        typeof usage.cache_creation_input_tokens === "number"
          ? usage.cache_creation_input_tokens
          : undefined,
    };
  } catch {
    return undefined;
  }
}
