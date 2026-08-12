import { createServiceClient } from "@/lib/supabase/service";
import { mintInstallationCloneCredential } from "@/modules/github/installation-token";
import { getProjectWithRepository } from "@/modules/projects/queries";
import { createVercelSandboxProvider } from "@/modules/validation/vercel/provider";
import type { OperationFailureCode } from "../failures";
import type { StoredOperationRun } from "../store";
import {
  completeValidationStep,
  executeValidationStep,
  failValidationStep,
  prepareValidationStep,
  type ValidationDeps,
  type ValidationRepositoryTarget,
} from "./execution";

/**
 * The durable change validation (Sprint 10A §20).
 *
 * Same shape as the other three operation types: thin `"use step"` shims over
 * plain functions, an operation id as the only thing crossing the durable
 * boundary, and a terminal handler so an operation always reaches a state the
 * UI can explain.
 *
 * The one deliberate difference is `maxRetries = 0` on the execute step. A
 * retry would provision a second microVM for a question the first one may have
 * already answered, and the platform cannot know whether the first sandbox
 * charged us. Ambiguity resolves to a failed operation, never to a second
 * charge — the same rule the paid AI steps follow (ADR 0013).
 */

/**
 * Rebuilds everything the sandbox needs from the operation's own project row.
 *
 * Nothing comes from client input: not the repository, not the installation,
 * not the commit. A step receives an operation id and re-derives the world
 * from server state, which is what makes "the client cannot choose the repo"
 * a structural fact rather than a validation rule (§27).
 */
async function resolveTarget(operation: StoredOperationRun): Promise<ValidationRepositoryTarget | null> {
  const supabase = createServiceClient();

  const project = await getProjectWithRepository(supabase, operation.projectId);
  if (!project?.repository) return null;

  const { owner, name: repo, installationId } = project.repository;
  if (!owner || !repo) return null;

  // Minted here, at the last possible moment, and never persisted. See
  // `github/installation-token.ts` for why this is the one place a raw token
  // leaves the Octokit boundary.
  const cloneCredential = await mintInstallationCloneCredential(installationId);
  if (!cloneCredential) return null;

  return {
    repositoryUrl: `https://github.com/${owner}/${repo}.git`,
    cloneCredential,
  };
}

function deps(): ValidationDeps {
  return {
    supabase: createServiceClient(),
    // The real provider, only ever constructed here. Tests inject a fake; there
    // is no local-execution implementation to fall back to (§4, §39).
    provider: createVercelSandboxProvider(),
    resolveTarget,
  };
}

async function prepareValidation(operationId: string) {
  "use step";
  return prepareValidationStep(deps(), operationId);
}

async function executeValidation(operationId: string) {
  "use step";
  return executeValidationStep(deps(), operationId);
}
// Provisioning is billable and its outcome is not knowable from outside. A
// platform-level retry could buy a second sandbox for the same question.
executeValidation.maxRetries = 0;

async function finishValidation(operationId: string, validationRunId: string) {
  "use step";
  await completeValidationStep(deps(), operationId, validationRunId);
}

async function abortValidation(operationId: string, failureCode: OperationFailureCode) {
  "use step";
  await failValidationStep(deps(), operationId, failureCode);
}

export async function changeValidationWorkflow(operationId: string) {
  "use workflow";

  try {
    const prepared = await prepareValidation(operationId);
    if (!prepared.ok) {
      await abortValidation(operationId, prepared.failureCode);
      return;
    }

    const executed = await executeValidation(operationId);
    if (!executed.ok) {
      // A failed build is a *successful* validation of a broken change, but the
      // operation still ends as failed: the user asked "does this validate?"
      // and the answer is no. The distinction lives in the ValidationRun row,
      // which carries the per-step detail.
      await abortValidation(operationId, executed.failureCode);
      return;
    }

    await finishValidation(operationId, executed.validationRunId);
  } catch {
    // A step exhausted its retries or threw outside the returned-failure
    // convention. Without this the operation stays `running` with nothing
    // carrying it. The error value is untyped and may carry provider prose, so
    // it is deliberately not inspected.
    await abortValidation(operationId, "validation_run_failed");
  }
}
