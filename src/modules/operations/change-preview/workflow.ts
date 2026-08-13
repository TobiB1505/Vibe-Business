import { createServiceClient } from "@/lib/supabase/service";
import { createVercelSandboxProvider } from "@/modules/validation/vercel/provider";
import type { PreviewFailureCode } from "@/modules/change-preview/schema";
import type { PreviewTeardown } from "@/modules/change-preview/orchestrator";
import {
  cleanupFailedPreviewStep,
  completePreviewStep,
  failPreviewStep,
  restoreArtifactStep,
  startPreviewStep,
  verifyArtifactStep,
  type PreviewDeps,
} from "./execution";

/**
 * The durable change preview (Sprint 10B-2 §23).
 *
 * ## The step graph
 *
 * ```
 * restore ─▶ verify ─▶ start + health ─▶ complete
 *    │          │             │
 *    └──────────┴─────────────┴──▶ cleanup ─▶ fail
 * ```
 *
 * ## Fail-safe, and why the control flow is written this way
 *
 * The failure is carried in a local rather than returned early, because
 * **cleanup must happen on every failing path**. An early `return` inside the
 * try block is precisely the shape that leaked a paid VM in Sprint 10A, and a
 * preview leaks worse than a validation does: a leaked preview is a public URL
 * nobody is watching.
 *
 * The success path is the deliberate asymmetry. A preview that started must
 * *not* be cleaned up — the running sandbox is the product — so cleanup is
 * inside the failure branch rather than unconditional. That is the one place
 * this workflow differs in shape from the validation workflow, and it is the
 * whole difference between "run and tear down" and "run and serve".
 *
 * ## Retries
 *
 * `maxRetries = 0` on every step that touches the sandbox. A platform retry
 * cannot distinguish "the sandbox was never created" from "it was created and
 * the result was lost", and for a billable creation that ambiguity must resolve
 * to *not doing it again*.
 *
 * Recovery comes from persisted state, not retries: a resumed workflow adopts
 * the sandbox that already answers to the deterministic name, and skips a
 * server start when the port already answers. That holds no matter how the
 * previous attempt died.
 *
 * `cleanup` is the exception, as it is in validation: it is idempotent by
 * construction, "already gone" is a success on both the sandbox and the
 * snapshot, and the failure mode of retrying is a wasted API call against a
 * failure mode of not retrying that is a public VM nobody stops.
 */

function deps(): PreviewDeps {
  return {
    supabase: createServiceClient(),
    // The real provider, only ever constructed here. Tests inject a fake; there
    // is no local-execution implementation to fall back to (ADR 0015 §4).
    provider: createVercelSandboxProvider(),
  };
}

async function restoreArtifact(operationId: string) {
  "use step";
  return restoreArtifactStep(deps(), operationId);
}
// Creating a sandbox is billable and its outcome is not knowable from outside.
// A platform retry could buy a second microVM on a second public URL.
restoreArtifact.maxRetries = 0;

async function verifyArtifact(operationId: string) {
  "use step";
  return verifyArtifactStep(deps(), operationId);
}
verifyArtifact.maxRetries = 0;

async function startPreview(operationId: string) {
  "use step";
  return startPreviewStep(deps(), operationId);
}
startPreview.maxRetries = 0;

async function cleanupFailedPreview(operationId: string) {
  "use step";
  return cleanupFailedPreviewStep(deps(), operationId);
}

async function failPreview(
  operationId: string,
  failureCode: PreviewFailureCode,
  teardown: PreviewTeardown,
) {
  "use step";
  await failPreviewStep(deps(), operationId, failureCode, teardown);
}

async function finishPreview(operationId: string) {
  "use step";
  await completePreviewStep(deps(), operationId);
}

export async function changePreviewWorkflow(operationId: string) {
  "use workflow";

  let failureCode: PreviewFailureCode | null = null;

  try {
    const restored = await restoreArtifact(operationId);
    if (!restored.ok) failureCode = restored.failureCode;

    if (failureCode === null) {
      const verified = await verifyArtifact(operationId);
      if (!verified.ok) failureCode = verified.failureCode;
    }

    if (failureCode === null) {
      const started = await startPreview(operationId);
      if (!started.ok) failureCode = started.failureCode;
    }
  } catch {
    // A step exhausted its retries or threw outside the returned-failure
    // convention. The error value is untyped and may carry provider prose, so
    // it is deliberately not inspected — but the run still reaches cleanup
    // below, which is the guarantee that matters.
    failureCode = "preview_failed";
  }

  if (failureCode !== null) {
    const teardown = await cleanupFailedPreview(operationId);
    await failPreview(operationId, failureCode, teardown);
    return;
  }

  await finishPreview(operationId);
}
