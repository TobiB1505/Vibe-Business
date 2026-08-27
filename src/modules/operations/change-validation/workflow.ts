import { createServiceClient } from "@/lib/supabase/service";
import { mintInstallationCloneCredential } from "@/modules/github/installation-token";
import { createGithubRepositoryReader } from "@/modules/github/repository-reader";
import { getProjectWithRepository } from "@/modules/projects/queries";
import { createVercelSandboxProvider } from "@/modules/validation/vercel/provider";
import type { OperationFailureCode } from "../failures";
import type { ProjectOperationRun } from "../store";
import {
  cleanupSandboxStep,
  completeValidationStep,
  failValidationStep,
  finalizeValidationStep,
  prepareValidationStep,
  provisionSandboxStep,
  runPhaseStep,
  verifySourceStep,
  type CleanupRecord,
  type ValidationDeps,
  type ValidationRepositoryTarget,
} from "./execution";

/**
 * The durable change validation (Sprint 10A §20, §8 refactor).
 *
 * ## The step graph
 *
 * ```
 * prepare ─▶ provision ─▶ verify ─▶ install ─▶ typecheck ─▶ test ─▶ build
 *                │           │         │           │          │       │
 *                └───────────┴─────────┴───────────┴──────────┴───────┘
 *                                      ▼
 *                                   cleanup ─▶ finalize ─▶ complete / abort
 * ```
 *
 * Every phase is its own durable step, so every phase gets its own function
 * invocation and its own platform ceiling. That is the whole refactor: the
 * previous design ran the entire pipeline inside one step, and a real run died
 * at the ceiling mid-build with a paid sandbox still alive, because a killed
 * step runs no cleanup.
 *
 * ## Fail-fast, and why the control flow is written this way
 *
 * A failed phase records `failureCode` and skips every remaining phase — there
 * is nothing to learn from building a change whose types do not check, and a
 * sandbox minute spent learning it is a minute billed (§14).
 *
 * The failure is carried in a local rather than by returning early, because
 * **cleanup and finalization must happen on every path**. An early `return`
 * inside the try block is precisely the shape that let the previous design leak
 * a VM, so the flow is: run what can be run, then always clean up, then always
 * record a verdict.
 *
 * ## Retries
 *
 * `maxRetries = 0` on every step that touches the sandbox. A platform retry
 * cannot distinguish "the command never started" from "the command ran and its
 * result was lost", and for repository-controlled commands that ambiguity must
 * resolve to *not running it again* (§10).
 *
 * Recovery does not come from retries; it comes from persisted phase state. A
 * resumed workflow reads what is already recorded and skips it, which is a
 * stronger guarantee than a retry budget because it holds no matter how the
 * previous attempt died.
 *
 * The two exceptions are deliberate. `prepare` is a pure claim guarded by a
 * unique index, and `cleanup` is idempotent by construction — "already stopped"
 * is a success. For cleanup, retrying is the safer error: a duplicate stop
 * request costs nothing, a leaked microVM costs money for as long as it lives.
 */

/**
 * Rebuilds everything the sandbox needs from the operation's own project row.
 *
 * Nothing comes from client input: not the repository, not the installation,
 * not the commit. A step receives an operation id and re-derives the world
 * from server state, which is what makes "the client cannot choose the repo"
 * a structural fact rather than a validation rule (§27).
 */
async function resolveTarget(
  operation: ProjectOperationRun,
  options: { withCloneCredential: boolean },
): Promise<ValidationRepositoryTarget | null> {
  const supabase = createServiceClient();

  const project = await getProjectWithRepository(supabase, operation.projectId);
  if (!project?.repository) return null;

  const { owner, name: repo, installationId } = project.repository;
  if (!owner || !repo) return null;

  // Minted only for the step that clones, at the last possible moment, and
  // never persisted. Every later phase resolves a target without one: the
  // source is already on disk by then, so a token would be exposure bought for
  // nothing. See `github/installation-token.ts` for why this is the one place a
  // raw token leaves the Octokit boundary.
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
    // The same bounded reader the analyzer uses. Verifying build identity
    // against the pinned commit is an ordinary read, not a new capability.
    manifest: createGithubRepositoryReader(installationId, owner, repo),
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

async function provisionSandbox(operationId: string) {
  "use step";
  return provisionSandboxStep(deps(), operationId);
}
// Provisioning is billable and its outcome is not knowable from outside. A
// platform-level retry could buy a second sandbox for the same question.
provisionSandbox.maxRetries = 0;

async function verifySource(operationId: string) {
  "use step";
  return verifySourceStep(deps(), operationId);
}
// Verification is read-only and idempotent, but a retry would run inside a
// sandbox whose liveness the retry cannot assume. Recovery is re-entry against
// persisted state, not repetition.
verifySource.maxRetries = 0;

async function installDependencies(operationId: string) {
  "use step";
  return runPhaseStep(deps(), operationId, "install");
}
installDependencies.maxRetries = 0;

async function typecheckChange(operationId: string) {
  "use step";
  return runPhaseStep(deps(), operationId, "typecheck");
}
typecheckChange.maxRetries = 0;

async function testChange(operationId: string) {
  "use step";
  return runPhaseStep(deps(), operationId, "test");
}
testChange.maxRetries = 0;

async function buildChange(operationId: string) {
  "use step";
  return runPhaseStep(deps(), operationId, "build");
}
buildChange.maxRetries = 0;

async function cleanupSandbox(operationId: string) {
  "use step";
  return cleanupSandboxStep(deps(), operationId);
}
// The one sandbox-touching step that *should* retry. Stopping is idempotent and
// "already gone" is a success, so the failure mode of retrying is a wasted API
// call — against a failure mode of not retrying that is a paid VM nobody stops.

async function finalizeValidation(
  operationId: string,
  failureCode: OperationFailureCode | null,
  cleanup: CleanupRecord,
) {
  "use step";
  return finalizeValidationStep(deps(), operationId, failureCode, cleanup);
}

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

  const prepared = await prepareValidation(operationId);
  if (!prepared.ok) {
    // Nothing was provisioned: this step refuses before any sandbox exists, so
    // there is nothing to clean up and no verdict to record.
    await abortValidation(operationId, prepared.failureCode);
    return;
  }

  let failureCode: OperationFailureCode | null = null;

  try {
    const provisioned = await provisionSandbox(operationId);
    if (!provisioned.ok) failureCode = provisioned.failureCode;

    if (failureCode === null) {
      const verified = await verifySource(operationId);
      if (!verified.ok) failureCode = verified.failureCode;
    }

    // Fail-fast, phase by phase. Written out rather than looped so each phase is
    // a distinct step identity in the durable log and in the observability UI —
    // "which phase is this run in" should be answerable without decoding an
    // index.
    if (failureCode === null) {
      const installed = await installDependencies(operationId);
      if (!installed.ok) failureCode = installed.failureCode;
    }

    if (failureCode === null) {
      const typechecked = await typecheckChange(operationId);
      if (!typechecked.ok) failureCode = typechecked.failureCode;
    }

    if (failureCode === null) {
      const tested = await testChange(operationId);
      if (!tested.ok) failureCode = tested.failureCode;
    }

    if (failureCode === null) {
      const built = await buildChange(operationId);
      if (!built.ok) failureCode = built.failureCode;
    }
  } catch {
    // A step exhausted its retries or threw outside the returned-failure
    // convention. The error value is untyped and may carry provider prose, so
    // it is deliberately not inspected — but the run still reaches cleanup
    // below, which is the guarantee the previous design could not make.
    failureCode = "validation_run_failed";
  }

  // Unconditional, including after the catch. The sandbox has no remaining
  // purpose once the phases are done, and nothing about deciding a verdict
  // should be able to keep a paid VM alive (§13).
  const cleanup = await cleanupSandbox(operationId);

  const finalized = await finalizeValidation(operationId, failureCode, cleanup);
  if (!finalized.ok) {
    // A failed build is a *successful* validation of a broken change, but the
    // operation still ends as failed: the user asked "does this validate?" and
    // the answer is no. The distinction lives in the ValidationRun row, which
    // carries the per-phase detail.
    await abortValidation(operationId, finalized.failureCode);
    return;
  }

  await finishValidation(operationId, finalized.validationRunId);
}
