import { getAIProvider } from "@/modules/ai/anthropic/client";
import { createServiceClient } from "@/lib/supabase/service";
import type { ExecutionDeps } from "../business-audit/execution";
import type { OperationFailureCode } from "../failures";
import {
  completeActionPlanOperationStep,
  countActionPlanTokensStep,
  failActionPlanOperationStep,
  prepareActionPlanStep,
  runPlanningStep,
} from "./execution";

/**
 * The durable Action Planner (CORE-2b §51, §55).
 *
 * A fourth workflow rather than a branch inside an existing one: the operations
 * load different things, persist to different tables and fail in different
 * ways, and a shared workflow with a type switch would put every operation's
 * failure modes on every code path.
 *
 * What *is* shared is everything that matters — the operation model, the store,
 * the executor boundary, the retry convention. See `../business-audit/workflow.ts`
 * for the reasoning behind each.
 *
 * Crossing the durable boundary: an operation id, a token count, a plan id, a
 * typed failure code. Nothing else (Rule 52).
 */

function deps(): ExecutionDeps {
  return { supabase: createServiceClient(), provider: getAIProvider() };
}

async function prepareActionPlan(operationId: string) {
  "use step";
  return prepareActionPlanStep(deps(), operationId);
}

async function countActionPlanTokens(operationId: string) {
  "use step";
  return countActionPlanTokensStep(deps(), operationId);
}

async function runPlanning(operationId: string, estimatedInputTokens: number) {
  "use step";
  return runPlanningStep(deps(), operationId, estimatedInputTokens);
}
// The paid step. A retry here would buy a second plan.
runPlanning.maxRetries = 0;

async function finishActionPlan(operationId: string, planId: string) {
  "use step";
  await completeActionPlanOperationStep(deps(), operationId, planId);
}

async function abortActionPlan(operationId: string, failureCode: OperationFailureCode) {
  "use step";
  await failActionPlanOperationStep(deps(), operationId, failureCode);
}

export async function actionPlanningWorkflow(operationId: string) {
  "use workflow";

  try {
    const prepared = await prepareActionPlan(operationId);
    if (!prepared.ok) {
      await abortActionPlan(operationId, prepared.failureCode);
      return;
    }

    const counted = await countActionPlanTokens(operationId);
    if (!counted.ok) {
      await abortActionPlan(operationId, counted.failureCode);
      return;
    }

    const planned = await runPlanning(operationId, counted.estimatedInputTokens);
    if (!planned.ok) {
      await abortActionPlan(operationId, planned.failureCode);
      return;
    }

    await finishActionPlan(operationId, planned.planId);
  } catch {
    // A step exhausted its retries or failed outside the returned-failure
    // convention. Without this the operation stays `running` forever with
    // nothing carrying it. The error value is untyped and may carry provider
    // prose, so it is deliberately not inspected.
    await abortActionPlan(operationId, "action_planning_failed");
  }
}
