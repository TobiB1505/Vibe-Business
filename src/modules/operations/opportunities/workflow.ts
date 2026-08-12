import { getAIProvider } from "@/modules/ai/anthropic/client";
import { createServiceClient } from "@/lib/supabase/service";
import type { ExecutionDeps } from "../business-audit/execution";
import type { OperationFailureCode } from "../failures";
import {
  completeOpportunityOperationStep,
  countOpportunityTokensStep,
  failOpportunityOperationStep,
  prepareOpportunitiesStep,
  runPrioritizationStep,
} from "./execution";

/**
 * The durable Opportunity Engine (Sprint 8 §24).
 *
 * A second workflow rather than a branch inside the first: the two operations
 * load different things, persist to different tables and fail in different
 * ways, and a shared workflow with a type switch would put both sets of
 * failure modes on every code path.
 *
 * What is shared is everything that matters — the operation model, the store,
 * the executor boundary, the retry convention. See
 * `../business-audit/workflow.ts` for the reasoning behind each of them.
 *
 * Crossing the durable boundary: an operation id, a token count, a set id, a
 * typed failure code. Nothing else (Sprint 7 §14).
 */

function deps(): ExecutionDeps {
  return { supabase: createServiceClient(), provider: getAIProvider() };
}

async function prepareOpportunities(operationId: string) {
  "use step";
  return prepareOpportunitiesStep(deps(), operationId);
}

async function countOpportunityTokens(operationId: string) {
  "use step";
  return countOpportunityTokensStep(deps(), operationId);
}

async function runPrioritization(operationId: string, estimatedInputTokens: number) {
  "use step";
  return runPrioritizationStep(deps(), operationId, estimatedInputTokens);
}
// The paid step. A retry here would buy a second prioritization.
runPrioritization.maxRetries = 0;

async function finishOpportunities(operationId: string, setId: string) {
  "use step";
  await completeOpportunityOperationStep(deps(), operationId, setId);
}

async function abortOpportunities(operationId: string, failureCode: OperationFailureCode) {
  "use step";
  await failOpportunityOperationStep(deps(), operationId, failureCode);
}

export async function opportunityGenerationWorkflow(operationId: string) {
  "use workflow";

  try {
    const prepared = await prepareOpportunities(operationId);
    if (!prepared.ok) {
      await abortOpportunities(operationId, prepared.failureCode);
      return;
    }

    const counted = await countOpportunityTokens(operationId);
    if (!counted.ok) {
      await abortOpportunities(operationId, counted.failureCode);
      return;
    }

    const prioritized = await runPrioritization(operationId, counted.estimatedInputTokens);
    if (!prioritized.ok) {
      await abortOpportunities(operationId, prioritized.failureCode);
      return;
    }

    await finishOpportunities(operationId, prioritized.setId);
  } catch {
    // A step exhausted its retries or failed outside the returned-failure
    // convention. Without this the operation stays `running` forever with
    // nothing carrying it. The error value is untyped and may carry provider
    // prose, so it is deliberately not inspected.
    await abortOpportunities(operationId, "opportunity_generation_failed");
  }
}
