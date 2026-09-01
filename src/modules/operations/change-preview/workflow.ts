import { createServiceClient } from "@/lib/supabase/service";
import { mintInstallationCloneCredential } from "@/modules/github/installation-token";
import { getProjectWithRepository } from "@/modules/projects/queries";
import type { ProjectOperationRun } from "../store";
import { createVercelSandboxProvider } from "@/modules/validation/vercel/provider";
import type { PreviewFailureCode } from "@/modules/change-preview/schema";
import type { PreviewTeardown } from "@/modules/change-preview/orchestrator";
import {
  cleanupFailedPreviewStep,
  completePreviewStep,
  failPreviewStep,
  provisionPreviewStep,
  startPreviewStep,
  type PreviewRepositoryTarget,
  type PreviewDeps,
} from "./execution";

/**
 * The durable change preview (Sprint 10B-2 §23).
 *
 * ## The step graph
 *
 * ```
 * provision ─▶ start + health ─▶ complete
 *     │               │
 *     └───────────────┴──▶ cleanup ─▶ fail
 * ```
 *
 * Two steps rather than three, and the split is forced rather than chosen
 * (Sprint 0114). `provision` clones, proves the commit, destroys the credential
 * and installs — up to 240s. `start` runs the dev server and health-checks it —
 * up to 180s, because the first request is what compiles the route. Neither
 * fits with the other under one 300s step deadline, and a detached process
 * handle cannot cross a step boundary, so the server start and its health check
 * have to stay together.
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

/**
 * The repository, resolved from the operation's own project.
 *
 * The same shape validation uses, and deliberately not shared with it: a
 * preview and a validation clone the same repository for different reasons, and
 * a helper both imported would be one place for one of them to quietly acquire
 * the other's needs. What matters is that neither takes any of it from a
 * client (§27).
 */
async function resolveTarget(
  operation: ProjectOperationRun,
  options: { withCloneCredential: boolean },
): Promise<PreviewRepositoryTarget | null> {
  const supabase = createServiceClient();

  const project = await getProjectWithRepository(supabase, operation.projectId);
  if (!project?.repository) return null;

  const { owner, name: repo, installationId } = project.repository;
  if (!owner || !repo) return null;

  // Minted only for the step that clones, at the last possible moment, and
  // never persisted. The server-start step resolves a target without one: the
  // source is on disk by then, so a token would be exposure bought for nothing.
  let cloneCredential: { username: string; password: string } | null = null;
  if (options.withCloneCredential) {
    cloneCredential = await mintInstallationCloneCredential(installationId);
    if (!cloneCredential) return null;
  }

  return {
    repositoryUrl: `https://github.com/${owner}/${repo}.git`,
    // Vercel materializes the clone at `/vercel/sandbox/<repo>/`.
    sourceRoot: repo,
    cloneCredential,
  };
}

function deps(): PreviewDeps {
  return {
    supabase: createServiceClient(),
    // The real provider, only ever constructed here. Tests inject a fake; there
    // is no local-execution implementation to fall back to (ADR 0015 §4).
    provider: createVercelSandboxProvider(),
    resolveTarget,
  };
}

async function provisionPreview(operationId: string) {
  "use step";
  return provisionPreviewStep(deps(), operationId);
}
// Creating a sandbox is billable and its outcome is not knowable from outside.
// A platform retry could buy a second microVM on a second public URL.
provisionPreview.maxRetries = 0;

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
    const provisioned = await provisionPreview(operationId);
    if (!provisioned.ok) failureCode = provisioned.failureCode;

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
