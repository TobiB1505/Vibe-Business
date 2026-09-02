import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { recordAIUsage } from "@/modules/ai/usage";
import type { AgentRunGatewayState } from "@/modules/coding-agent/gateway-policy";

/**
 * The durable half of the Agent Gateway's decision (EXECUTION CORE-4 runtime
 * placement, Rule 53).
 *
 * ## Why it lives in `operations/` rather than beside the route
 *
 * Because the caller has no session at all. The Agent Gateway is reached by a
 * sandbox holding a scoped token, not by a browser holding a cookie, so there
 * is no RLS-scoped client to read with — exactly the situation the Stripe
 * webhook is in. The service-role client is the only option, and Rule 53
 * confines it to this directory.
 *
 * That constraint is doing real work here. Every function below takes the run
 * id **from a verified token** and filters on it; nothing takes a project or a
 * user from the caller. A service-role client that trusted a caller-supplied
 * project id would let one sandbox read another project's spend.
 *
 * ## Why spend is read from the usage ledger
 *
 * Because that is where it already is. `ai_usage_events` records every billed
 * call in the product, the agent path included, and inventing a second counter
 * on the run row would create two numbers that can disagree about what a
 * customer was charged. The ledger is the one that settles Credits, so it is
 * the one the ceiling is measured against.
 */

export type GatewayRunLookup = { runId: string };

/**
 * Reads everything `authorizeGatewayRequest` needs, fresh.
 *
 * No caching, deliberately. The whole point of consulting durable state on
 * every request is that cancellation and spend change *during* a run — a cached
 * answer would make revocation take effect somewhere between "immediately" and
 * "never", which is not a security property anyone can reason about.
 */
export async function readAgentRunGatewayState(
  params: GatewayRunLookup,
): Promise<AgentRunGatewayState | null> {
  const supabase = createServiceClient();

  const { data: run } = await supabase
    .from("agent_execution_runs")
    .select("id, status, project_id, user_id, execution_spec_id, gateway_requests_started")
    .eq("id", params.runId)
    .maybeSingle();

  if (!run) return null;

  const row = run as {
    status: string;
    project_id: string;
    user_id: string;
    execution_spec_id: string;
    gateway_requests_started: number | null;
  };

  /*
   * Spend, summed from the ledger this run has written so far.
   *
   * Counted from the tokens, not from the status (VB-016). This filtered on
   * `status === 'succeeded'`, and the reasoning was half right: a call that
   * failed before the provider billed anything really did consume no budget,
   * and counting it would let a flaky network exhaust a customer's
   * authorization without producing a single token of work.
   *
   * What it missed is the stream that fails *after* the provider has billed.
   * Anthropic charges for what it emitted, so that row is `failed` and carries
   * real `output_tokens` — and those tokens were excluded from the ceiling
   * entirely. A loop whose calls all die late therefore spent real money
   * against a budget that never noticed.
   *
   * Summing the tokens gets both cases right without needing to know which
   * happened: a failure that billed nothing contributes zero on its own.
   */
  /*
   * Two aggregates, one round trip, no rows (PERF-002).
   *
   * This used to select every usage row the run had written and reduce them
   * here. That is quadratic across a run — request *n* carried *n-1* rows, and
   * a large run is allowed 260 requests — and it sat behind
   * `max_rows = 1000`, past which PostgREST would have truncated the read
   * silently and under-reported spend against the ceiling it feeds.
   *
   * The error is thrown rather than absorbed, unlike the run read above whose
   * absence is a real answer ("no such run"). A failed aggregate has no
   * truthful default: zero would hand the run its whole budget back, which is
   * exactly what a missing function would have done quietly if this deployed
   * ahead of its migration.
   */
  const { data: usage, error: usageError } = await supabase.rpc("sum_agent_run_usage", {
    p_run_id: params.runId,
  });

  if (usageError) throw usageError;

  // `returns table(...)` reaches PostgREST as an array of one row, and a
  // `bigint` comes back as a string once it is large enough.
  const totals = (Array.isArray(usage) ? usage[0] : usage) as
    | { spent_output_tokens: number | string | null; forwarded_requests: number | string | null }
    | undefined;

  const spentOutputTokens = Number(totals?.spent_output_tokens ?? 0);
  const forwardedFromLedger = Number(totals?.forwarded_requests ?? 0);

  return {
    status: row.status,
    projectId: row.project_id,
    userId: row.user_id,
    executionSpecId: row.execution_spec_id,
    spentOutputTokens,
    /*
     * Every forwarded request writes a row, succeeded or failed, so the request
     * ceiling counts attempts rather than successes. A loop that fails every
     * call is still a loop, and it still costs latency and provider quota.
     *
     * The larger of two counts (VB-016). The ledger rows land in `after()`, so
     * under concurrency they lag; the claim counter is incremented before the
     * credential is injected and does not. Taking the maximum means the counter
     * can only tighten the ceiling, and a run that started before the column
     * existed — its counter still zero — is still bounded by its ledger.
     */
    forwardedRequests: Math.max(forwardedFromLedger, row.gateway_requests_started ?? 0),
  };
}

/**
 * Claims one request against the run, before Vibe's key is injected (VB-016).
 *
 * Returns the count *after* this claim, or `null` when no run matched. The
 * caller compares that number against the authorized maximum rather than
 * trusting the read that preceded it: a check-then-act on state that lands
 * after the response is not a ceiling under concurrency, it is a delay.
 *
 * Never released. An attempt that failed still happened, and a counter an
 * unreliable network could reset would be worth less than no counter at all,
 * because it would look like one.
 */
export async function claimGatewayRequest(params: GatewayRunLookup): Promise<number | null> {
  const { data, error } = await createServiceClient().rpc("claim_gateway_request", {
    p_run_id: params.runId,
  });

  if (error) throw error;
  return data === null || data === undefined ? null : Number(data);
}

/**
 * Records one forwarded sampling call against the run.
 *
 * Written after the provider answers, for successes and failures alike (Rule
 * 47) — but only with the tokens the provider actually reported. An estimate
 * recorded as if it were actual corrupts the number the ceiling is measured
 * against, and the ceiling is the customer's authorization.
 */
export async function recordGatewayUsage(params: {
  runId: string;
  projectId: string;
  userId: string;
  model: string;
  status: "succeeded" | "failed";
  latencyMs: number;
  failureCode: string | null;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    /**
     * Reasoning tokens, billed inside `outputTokens` and reported separately for
     * cost transparency (Rule 43). The reasoning *text* never reaches this
     * process: the gateway reads a count off the provider's usage block and
     * forwards the body to the sandbox without parsing its content.
     */
    thinkingTokens: number;
    cacheReadInputTokens?: number;
    cacheCreationInputTokens?: number;
  };
}): Promise<void> {
  await recordAIUsage(createServiceClient(), {
    userId: params.userId,
    projectId: params.projectId,
    operation: "agentic_execution",
    provider: "anthropic",
    model: params.model,
    jobId: params.runId,
    status: params.status,
    usage: params.usage
      ? {
          inputTokens: params.usage.inputTokens,
          outputTokens: params.usage.outputTokens,
          thinkingTokens: params.usage.thinkingTokens,
        }
      : undefined,
    cacheReadInputTokens: params.usage?.cacheReadInputTokens,
    cacheCreationInputTokens: params.usage?.cacheCreationInputTokens,
    // The gateway does not count tokens before forwarding: the body it is
    // proxying was composed by the SDK, and re-tokenising it to produce an
    // estimate would be inventing a number nobody uses.
    estimatedInputTokens: null,
    latencyMs: params.latencyMs,
    failureCode: params.failureCode,
  });
}
