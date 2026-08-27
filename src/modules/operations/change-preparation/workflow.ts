import { createServiceClient } from "@/lib/supabase/service";
import { createExecutionProbe, createGithubGitWritePort } from "@/modules/execution/github/adapter";
import { resolveAppRoot } from "@/modules/execution/app-root";
import { getLatestSuccessfulSnapshot } from "@/modules/repository-intelligence/store";
import { getProjectWithRepository } from "@/modules/projects/queries";
import type { OperationFailureCode } from "../failures";
import type { ProjectOperationRun } from "../store";
import {
  completePreparationStep,
  failPreparationStep,
  preflightStep,
  writeChangeStep,
  type PreparationDeps,
  type PreparationTarget,
} from "./execution";

/**
 * The durable change preparation (Sprint 9B §11).
 *
 * The third operation type on the Sprint 7 foundation, and the first that
 * writes to something outside Vibe. Same shape as the other two: thin `"use
 * step"` shims over plain functions, an operation id as the only thing that
 * crosses the durable boundary, and a terminal handler so an operation always
 * reaches a state the UI can explain.
 *
 * Nothing here calls a model. No usage event is written, because none is
 * earned (§18).
 */

/**
 * Resolves everything the steps need from the operation's own project row.
 *
 * Nothing is taken from client input — not the repository, not the
 * installation, not the origin. A step is handed an operation id and rebuilds
 * the world from server state (§8).
 */
async function resolveTarget(operation: ProjectOperationRun): Promise<PreparationTarget | null> {
  const supabase = createServiceClient();

  // The same query the project page uses. Hand-rolling a second one is how
  // this step spent three production runs failing on a table name that never
  // existed — reuse the resolved shape rather than re-deriving it.
  const project = await getProjectWithRepository(supabase, operation.projectId);
  if (!project?.repository) return null;

  const { owner, name: repo, fullName, installationId } = project.repository;
  if (!owner || !repo || !fullName) return null;

  const productionOrigin = project.productionUrl === null ? null : safeOrigin(project.productionUrl);

  const snapshot = await getLatestSuccessfulSnapshot(supabase, operation.projectId);
  const appRoot = snapshot?.result ? resolveAppRoot(snapshot.result) : null;

  const target = { installationId, owner, repo };

  return {
    owner,
    repo,
    productionOrigin,
    appRoot,
    git: createGithubGitWritePort(target),
    probe: createExecutionProbe(target, productionOrigin),
  };
}

/** Only a validated https origin is ever written into generated source (§12). */
function safeOrigin(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

function deps(): PreparationDeps {
  return { supabase: createServiceClient(), resolveTarget };
}

async function runPreflight(operationId: string) {
  "use step";
  return preflightStep(deps(), operationId);
}

async function writeChange(operationId: string) {
  "use step";
  return writeChangeStep(deps(), operationId);
}
// The consequential external write. A retry could create a second branch, and
// the recovery path — not the platform — is what makes re-entry safe.
writeChange.maxRetries = 0;

async function finishPreparation(operationId: string, preparedChangeId: string) {
  "use step";
  await completePreparationStep(deps(), operationId, preparedChangeId);
}

async function abortPreparation(operationId: string, failureCode: OperationFailureCode) {
  "use step";
  await failPreparationStep(deps(), operationId, failureCode);
}

export async function changePreparationWorkflow(operationId: string) {
  "use workflow";

  try {
    const preflight = await runPreflight(operationId);
    if (!preflight.ok) {
      await abortPreparation(operationId, preflight.failureCode);
      return;
    }

    const written = await writeChange(operationId);
    if (!written.ok) {
      await abortPreparation(operationId, written.failureCode);
      return;
    }

    await finishPreparation(operationId, written.preparedChangeId);
  } catch {
    // A step exhausted its retries or failed outside the returned-failure
    // convention. Without this the operation stays `running` with nothing
    // carrying it. The error value is untyped and may carry provider prose,
    // so it is deliberately not inspected.
    await abortPreparation(operationId, "change_preparation_failed");
  }
}
