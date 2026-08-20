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
    .select("id, status, project_id, user_id, execution_spec_id")
    .eq("id", params.runId)
    .maybeSingle();

  if (!run) return null;

  const row = run as {
    status: string;
    project_id: string;
    user_id: string;
    execution_spec_id: string;
  };

  /*
   * Spend, summed from the ledger this run has written so far.
   *
   * Only `succeeded` rows count toward the ceiling: a call that failed before
   * the provider billed anything consumed no budget, and counting it would let
   * a flaky network exhaust a customer's authorization without producing a
   * single token of work.
   */
  const { data: usage } = await supabase
    .from("ai_usage_events")
    .select("output_tokens, status")
    .eq("job_id", params.runId);

  const rows = (usage ?? []) as { output_tokens: number | null; status: string }[];
  const billed = rows.filter((entry) => entry.status === "succeeded");

  return {
    status: row.status,
    projectId: row.project_id,
    userId: row.user_id,
    executionSpecId: row.execution_spec_id,
    spentOutputTokens: billed.reduce((total, entry) => total + (entry.output_tokens ?? 0), 0),
    // Every forwarded request writes a row, succeeded or failed, so the request
    // ceiling counts attempts rather than successes. A loop that fails every
    // call is still a loop, and it still costs latency and provider quota.
    forwardedRequests: rows.length,
  };
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
