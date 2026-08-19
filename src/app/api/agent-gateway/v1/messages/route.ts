import { after, NextResponse, type NextRequest } from "next/server";

import {
  authorizeGatewayRequest,
  gatewayRefusalBody,
  type AgentGatewayRefusal,
} from "@/modules/coding-agent/gateway-policy";
import { verifyAgentGatewayToken } from "@/modules/coding-agent/gateway-token";
import {
  createUsageAccumulator,
  hasBilledTokens,
  usageFromJsonBody,
  type GatewayStreamUsage,
} from "@/modules/coding-agent/gateway-usage";
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

  /*
   * A streamed response is forwarded as a stream, and counted beside it.
   *
   * The obvious shape — buffer the body, parse it, then answer — is what the
   * first version did, and it was wrong twice over. It turned a streaming proxy
   * into a blocking one, adding the whole generation time to the SDK's
   * time-to-first-byte; and it then called `JSON.parse` on Server-Sent Events,
   * which threw, which is why that run recorded null tokens for calls that were
   * really billed.
   *
   * `tee()` splits the body into two independent readers. One becomes the
   * response the moment upstream sends its first byte. The other is consumed
   * here, after the answer is already on its way to the sandbox, so accounting
   * cannot delay or fail a turn.
   */
  const contentType = upstream.headers.get("content-type") ?? "application/json";
  const forwardedHeaders = new Headers({ "content-type": contentType });
  const cacheHeader = upstream.headers.get("cache-control");
  if (cacheHeader) forwardedHeaders.set("cache-control", cacheHeader);

  const streamed = contentType.includes("text/event-stream") && upstream.body !== null;

  if (!streamed) {
    // Not a stream: an error body, or a caller that asked for a whole message.
    // Still a billed call, so it is still counted.
    const payload = await upstream.text();

    await recordGatewayUsage({
      runId: claims.runId,
      projectId: claims.projectId,
      userId: claims.userId,
      model: claims.model,
      status: upstream.ok ? "succeeded" : "failed",
      latencyMs: Date.now() - startedAt,
      failureCode: upstream.ok ? null : `upstream_${upstream.status}`,
      usage: upstream.ok ? toRecordedUsage(usageFromJsonBody(payload)) : undefined,
    });

    return new NextResponse(payload, { status: upstream.status, headers: forwardedHeaders });
  }

  const [toCaller, toLedger] = upstream.body!.tee();

  /*
   * `after()` rather than a floating promise.
   *
   * The platform may freeze a function the moment its response is done, and a
   * detached promise would be cut off mid-stream — the exact failure that would
   * make usage look complete and be short. `after` is Next's contract for work
   * that must outlive the response.
   */
  after(async () => {
    const accumulator = createUsageAccumulator();
    const decoder = new TextDecoder();
    const reader = toLedger.getReader();
    let interrupted: string | null = null;

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulator.push(decoder.decode(value, { stream: true }));
      }
      accumulator.push(decoder.decode());
    } catch (error) {
      // The connection died part-way. What was counted so far is still true.
      interrupted = error instanceof Error ? error.name : "stream_read_failed";
    } finally {
      reader.releaseLock();
    }

    const usage = accumulator.result();
    const failure = interrupted ?? usage.streamError ?? (usage.complete ? null : "stream_incomplete");

    await recordGatewayUsage({
      runId: claims.runId,
      projectId: claims.projectId,
      userId: claims.userId,
      // What the provider says it served, never what the caller asked for —
      // the token already bound the model, and this is the billing record.
      model: usage.model ?? claims.model,
      // A stream that broke still produced the tokens it produced. Recording it
      // as `failed` while keeping the counts is the honest pair (Rule 47).
      status: failure === null ? "succeeded" : "failed",
      latencyMs: Date.now() - startedAt,
      failureCode: failure,
      usage: toRecordedUsage(usage),
    });
  });

  return new NextResponse(toCaller, { status: upstream.status, headers: forwardedHeaders });
}

/**
 * The ledger's shape, or nothing when the provider reported no tokens.
 *
 * `undefined` rather than zeros when nothing was billed: `recordAIUsage` treats
 * an absent `usage` as "no tokens known", and a zero recorded as if it were
 * measured would understate a bill that really happened.
 */
function toRecordedUsage(usage: GatewayStreamUsage | null) {
  if (!usage || !hasBilledTokens(usage)) return undefined;

  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    thinkingTokens: usage.thinkingTokens,
    cacheReadInputTokens: usage.cacheReadInputTokens || undefined,
    cacheCreationInputTokens: usage.cacheCreationInputTokens || undefined,
  };
}
