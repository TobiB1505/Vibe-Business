import { getAIProvider } from "@/modules/ai/anthropic/client";
import { createServiceClient } from "@/lib/supabase/service";
import type { OperationFailureCode } from "../failures";
import {
  readCodeStep,
  readPublicProductStep,
  understandProductStep,
  type ExecutionDeps,
} from "../product-understanding/execution";
import {
  completeProductScanStep,
  failProductScanStep,
  recordProfileReadyStep,
  scanLiveProductStep,
  scanRepositoryStep,
} from "./execution";

function deps(): ExecutionDeps {
  return { supabase: createServiceClient(), provider: getAIProvider() };
}

async function scanRepository(operationId: string) {
  "use step";
  return scanRepositoryStep(deps(), operationId);
}

async function scanLiveProduct(operationId: string) {
  "use step";
  return scanLiveProductStep(deps(), operationId);
}

async function prepareUnderstanding(operationId: string) {
  "use step";
  return readCodeStep(deps(), operationId, { setStage: false });
}

async function countUnderstanding(operationId: string) {
  "use step";
  return readPublicProductStep(deps(), operationId);
}

async function understand(operationId: string, estimatedInputTokens: number) {
  "use step";
  return understandProductStep(deps(), operationId, estimatedInputTokens);
}
understand.maxRetries = 0;

async function recordProfile(operationId: string, profileId: string) {
  "use step";
  return recordProfileReadyStep(deps(), operationId, profileId);
}

async function finish(operationId: string, profileId: string) {
  "use step";
  await completeProductScanStep(deps(), operationId, profileId);
}

async function abort(operationId: string, failureCode: OperationFailureCode) {
  "use step";
  await failProductScanStep(deps(), operationId, failureCode);
}

export async function productScanWorkflow(operationId: string) {
  "use workflow";

  try {
    const repository = await scanRepository(operationId);
    if (!repository.ok) return abort(operationId, repository.failureCode);

    const live = await scanLiveProduct(operationId);
    if (!live.ok) return abort(operationId, live.failureCode);

    const prepared = await prepareUnderstanding(operationId);
    if (!prepared.ok) return abort(operationId, prepared.failureCode);

    const counted = await countUnderstanding(operationId);
    if (!counted.ok) return abort(operationId, counted.failureCode);

    const understood = await understand(operationId, counted.estimatedInputTokens);
    if (!understood.ok) return abort(operationId, understood.failureCode);

    const recorded = await recordProfile(operationId, understood.profileId);
    if (!recorded.ok) return abort(operationId, recorded.failureCode);

    await finish(operationId, understood.profileId);
  } catch {
    await abort(operationId, "understanding_failed");
  }
}
