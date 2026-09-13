import { getAIToolCallingProvider } from "@/modules/ai/anthropic/client";
import { createServiceClient } from "@/lib/supabase/service";
import type { OperationFailureCode } from "../failures";
import {
  completeTurnOperationStep,
  failTurnOperationStep,
  runTurnStep,
  type AgentTurnDeps,
} from "./execution";

/**
 * The `agent_turn` workflow (ADR 0109).
 *
 * The only file in this family that carries the durable directives, and the
 * only place in production that reaches `generateWithTools` — through the
 * orchestrator loop, which the step calls.
 */

function deps(): AgentTurnDeps {
  return { supabase: createServiceClient(), provider: getAIToolCallingProvider() };
}

async function runTurn(operationId: string) {
  "use step";
  return runTurnStep(deps(), operationId);
}
/*
 * The paid step, and the retry that must never happen.
 *
 * One turn is up to eight billed calls. A platform retry would ask the same
 * question again from the top and bill it again, and the founder would get one
 * answer for two charges — or, worse, two answers. The loop inside never
 * retries either, and the turn's own `inference_started_at` is what makes a
 * replay resolve to a failure rather than to a second attempt (rule 50).
 */
runTurn.maxRetries = 0;

async function finishTurn(operationId: string, turnRunId: string) {
  "use step";
  await completeTurnOperationStep(deps(), operationId, turnRunId);
}

async function abortTurn(operationId: string, failureCode: OperationFailureCode) {
  "use step";
  await failTurnOperationStep(deps(), operationId, failureCode);
}

export async function agentTurnWorkflow(operationId: string) {
  "use workflow";

  try {
    const turn = await runTurn(operationId);
    if (!turn.ok) {
      await abortTurn(operationId, turn.failureCode);
      return;
    }
    await finishTurn(operationId, turn.turnRunId);
  } catch {
    // A step exhausted its retries or failed outside the returned-failure
    // convention. Without this the operation stays `running` forever and the
    // founder's question sits in the thread with nothing under it. The error
    // value is untyped and may carry provider prose, so it is not inspected.
    await abortTurn(operationId, "agent_turn_failed");
  }
}
