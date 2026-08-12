import { getAIProvider } from "@/modules/ai/anthropic/client";
import { createServiceClient } from "@/lib/supabase/service";
import type { OperationFailureCode } from "../failures";
import {
  completeOperationStep,
  countTokensStep,
  failOperationStep,
  prepareEvidenceStep,
  runInferenceStep,
  type ExecutionDeps,
} from "./execution";

/**
 * The durable Business Audit (Sprint 7 §3, §10).
 *
 * This file is intentionally the thinnest layer in the sprint. Every step is a
 * shim: build dependencies, call a plain function from `execution.ts`, return a
 * small serializable value. All the logic — and all the tests — live there,
 * which is what keeps the audit domain runnable without a workflow platform
 * (§32) and keeps the platform's vocabulary from spreading.
 *
 * ## What crosses the durable boundary
 *
 * An operation id, a token count, an audit id, and a failure code. That is the
 * complete list (§14). Vercel Workflows records every step input and output in
 * its event log, so anything passed here is persisted outside Supabase —
 * evidence, prompts, model output and provider credentials therefore never
 * appear as step arguments or return values. Steps rebuild what they need from
 * the database on each entry.
 *
 * ## Retry policy
 *
 * Steps retry up to 3 times by default on a thrown error. That is right for a
 * transient database blip and catastrophic for a paid provider call, so:
 *
 *  - expected failures are **returned**, not thrown, and are therefore never
 *    retried by construction;
 *  - `runInference` sets `maxRetries = 0`, so even an unexpected exception
 *    cannot cause a second billable call (§11).
 *
 * The workflow then routes any failure to a single terminal step, so an
 * operation always reaches a state the UI can explain.
 */

function deps(): ExecutionDeps {
  // Built inside each step, never passed between them: a database client and a
  // provider client both hold credentials, and credentials must not be
  // serialized into durable state (§14, §31).
  return { supabase: createServiceClient(), provider: getAIProvider() };
}

async function prepareEvidence(operationId: string) {
  "use step";
  return prepareEvidenceStep(deps(), operationId);
}

async function countTokens(operationId: string) {
  "use step";
  return countTokensStep(deps(), operationId);
}

async function runInference(operationId: string, estimatedInputTokens: number) {
  "use step";
  return runInferenceStep(deps(), operationId, estimatedInputTokens);
}
// The single most important line in this sprint. See the retry note above.
runInference.maxRetries = 0;

async function finishOperation(operationId: string, auditId: string) {
  "use step";
  await completeOperationStep(deps(), operationId, auditId);
}

async function abortOperation(operationId: string, failureCode: OperationFailureCode) {
  "use step";
  await failOperationStep(deps(), operationId, failureCode);
}

export async function businessAuditWorkflow(operationId: string) {
  "use workflow";

  try {
    const prepared = await prepareEvidence(operationId);
    if (!prepared.ok) {
      await abortOperation(operationId, prepared.failureCode);
      return;
    }

    const counted = await countTokens(operationId);
    if (!counted.ok) {
      await abortOperation(operationId, counted.failureCode);
      return;
    }

    const inferred = await runInference(operationId, counted.estimatedInputTokens);
    if (!inferred.ok) {
      await abortOperation(operationId, inferred.failureCode);
      return;
    }

    await finishOperation(operationId, inferred.auditId);
  } catch {
    // A step exhausted its retries, or something outside the returned-failure
    // convention went wrong. Without this the operation would stay `running`
    // forever with nothing carrying it, and the user would watch a spinner
    // that can never finish.
    //
    // Deliberately swallows the error rather than inspecting it: the value is
    // untyped and may carry provider prose, and nothing here may put that in
    // front of a user. The specifics are in the platform's own run trace.
    //
    // If this itself fails — the database being unreachable is exactly the
    // kind of thing that lands here — the operation stays live and the UI's
    // stall threshold is the last line of defence.
    await abortOperation(operationId, "audit_failed");
  }
}
