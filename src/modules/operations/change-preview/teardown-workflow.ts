import { createServiceClient } from "@/lib/supabase/service";
import { createVercelSandboxProvider } from "@/modules/validation/vercel/provider";
import type { PreviewDeps } from "./execution";
import {
  convergePreviewStep,
  recordPreviewUsageStep,
  terminatePreviewStep,
  type TeardownRecord,
} from "./teardown-execution";

/**
 * The durable preview teardown (Sprint 10B-3, ADR 0016 §14).
 *
 * ```
 * terminate ─▶ record usage ─▶ converge
 *  destructive   retryable      retryable
 * ```
 *
 * Manual stop and expiry both enter here. They differ only in the reason the
 * initiator persisted on the session, because everything else about ending a
 * preview is the same work, and two implementations of it would drift on
 * exactly the parts that cost money.
 *
 * ## Retries
 *
 * `terminate` is `maxRetries = 0`. It is idempotent in principle — stopping a
 * stopped sandbox and deleting a deleted snapshot are its intended outcomes —
 * but a platform retry of a provider call is ambiguity bought for nothing, and
 * re-entry recovers better: the step re-reads the session and finds the work
 * already done.
 *
 * `record usage` and `converge` may retry, and both are idempotent where it
 * counts. The ledger has a unique index on the preview session, so a second
 * insert loses at the database rather than double-counting a sandbox that ran
 * once. Convergence is scoped to rows that are not yet terminal.
 *
 * ## The ordering is a priority, not a preference
 *
 * Cleanup outranks accounting. If the ledger step fails after the sandbox is
 * already stopped, the sandbox stays stopped and the ledger step retries alone.
 * Nothing resurrects or retains a VM to make the books balance.
 */

function deps(): PreviewDeps {
  return {
    supabase: createServiceClient(),
    provider: createVercelSandboxProvider(),
    /*
     * Teardown acquires no source, so it never needs a repository or a
     * credential. Present because `PreviewDeps` is one shape, and refusing
     * rather than returning null would make "cleanup cannot run" depend on a
     * repository lookup — cleanup must work when nothing else does.
     */
    resolveTarget: async () => null,
  };
}

async function terminatePreview(operationId: string) {
  "use step";
  return terminatePreviewStep(deps(), operationId);
}
// A platform retry cannot tell "the sandbox was never stopped" from "it was
// stopped and the result was lost". Re-entry is the recovery path.
terminatePreview.maxRetries = 0;

async function recordUsage(operationId: string, teardown: TeardownRecord) {
  "use step";
  await recordPreviewUsageStep(deps(), operationId, teardown);
}

async function converge(operationId: string, teardown: TeardownRecord) {
  "use step";
  await convergePreviewStep(deps(), operationId, teardown);
}

export async function previewTeardownWorkflow(operationId: string) {
  "use workflow";

  const teardown = await terminatePreview(operationId);

  // Deliberately not wrapped in a try. If recording the spend throws after the
  // sandbox is already stopped, the workflow fails and this step retries —
  // which is the intended behaviour. Swallowing it here would turn a missing
  // ledger row into a silent one, which is the exact defect that moved teardown
  // into durable execution in the first place.
  await recordUsage(operationId, teardown);

  await converge(operationId, teardown);
}
