import { getAIProvider } from "@/modules/ai/anthropic/client";
import { createServiceClient } from "@/lib/supabase/service";
import type { OperationFailureCode } from "../failures";
import {
  completeOperationStep,
  failOperationStep,
  readCodeStep,
  readPublicProductStep,
  understandProductStep,
  type ExecutionDeps,
} from "./execution";

/**
 * The durable Product Understanding run (CORE-1 §22).
 *
 * The thinnest layer in the sprint, by the same convention the Business Audit
 * established: every step is a shim that builds dependencies, calls a plain
 * function from `execution.ts`, and returns a small serializable value.
 *
 * ## What crosses the durable boundary
 *
 * An operation id, a token count, a profile id, and a failure code. That is the
 * complete list. Vercel Workflows records every step input and output in its
 * event log, so evidence, prompts, model output and credentials never appear
 * as step arguments or return values (CLAUDE.md rule 52).
 *
 * ## Retry policy
 *
 * Expected failures are returned rather than thrown, so they are never
 * retried by construction. `understandProduct` additionally sets
 * `maxRetries = 0`, so even an unexpected exception cannot cause a second
 * billable call (CLAUDE.md rule 50).
 */

function deps(): ExecutionDeps {
  // Built inside each step, never passed between them: both clients hold
  // credentials, and credentials must not be serialized into durable state.
  return { supabase: createServiceClient(), provider: getAIProvider() };
}

async function readCode(operationId: string) {
  "use step";
  return readCodeStep(deps(), operationId);
}

async function readPublicProduct(operationId: string) {
  "use step";
  return readPublicProductStep(deps(), operationId);
}

async function understandProduct(operationId: string, estimatedInputTokens: number) {
  "use step";
  return understandProductStep(deps(), operationId, estimatedInputTokens);
}
// One paid call, never two. See the retry note above.
understandProduct.maxRetries = 0;

async function finishOperation(operationId: string, profileId: string) {
  "use step";
  await completeOperationStep(deps(), operationId, profileId);
}

async function abortOperation(operationId: string, failureCode: OperationFailureCode) {
  "use step";
  await failOperationStep(deps(), operationId, failureCode);
}

export async function productUnderstandingWorkflow(operationId: string) {
  "use workflow";

  try {
    const prepared = await readCode(operationId);
    if (!prepared.ok) {
      await abortOperation(operationId, prepared.failureCode);
      return;
    }

    const counted = await readPublicProduct(operationId);
    if (!counted.ok) {
      await abortOperation(operationId, counted.failureCode);
      return;
    }

    // Note what is *not* here: a check for "did synthesis succeed?". It cannot
    // fail this operation. The step persists a deterministic profile when the
    // model call fails, and only a failure to produce any profile at all
    // reaches the branch below (CORE-1 §43).
    const understood = await understandProduct(operationId, counted.estimatedInputTokens);
    if (!understood.ok) {
      await abortOperation(operationId, understood.failureCode);
      return;
    }

    await finishOperation(operationId, understood.profileId);
  } catch {
    // A step exhausted its retries, or something outside the returned-failure
    // convention went wrong. Without this the operation would stay `running`
    // forever with nothing carrying it.
    //
    // Deliberately swallows the error rather than inspecting it: the value is
    // untyped and may carry provider prose, and nothing here may put that in
    // front of a user.
    await abortOperation(operationId, "understanding_failed");
  }
}
