import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAuditEvent } from "@/modules/audit-log/events";
import { getPreparedChange } from "@/modules/execution/store";
import { getLatestSuccessfulSnapshot } from "@/modules/repository-intelligence/store";
import { depthRunsStep } from "@/modules/validation/depth";
import { resolveDepthForPreparedChange } from "@/modules/validation/depth-inputs";
import { computeValidationIdentity } from "@/modules/validation/identity";
import {
  buildSatisfiesProfile,
  provisionSandbox,
  runCheckPhase,
  stopSandbox,
  verifySource,
  type CleanupStatus,
  type SourceManifestPort,
  type ValidationTarget,
} from "@/modules/validation/orchestrator";
import { resolveValidationProfile } from "@/modules/validation/profile";
import type { SandboxProvider, SandboxUsage } from "@/modules/validation/sandbox-port";
import {
  SANDBOX_POLICY_VERSION,
  validationProfileVersionFor,
  type ValidationFailureCode,
  type ValidationStage,
  type ValidationStepName,
} from "@/modules/validation/schema";
import {
  claimValidationRun,
  completeValidationRun,
  findValidationRunByOperation,
  recordSandboxUsage,
  recordSourceIntegrity,
  recordValidationPhase,
  setValidationStage,
  type StoredValidationRun,
} from "@/modules/validation/store";
import type { OperationFailureCode } from "../failures";
import { resolveAgentHold, type AgentHoldOutcome } from "@/modules/coding-agent/hold";
import {
  claimResultForOperation,
  completeOperationRun,
  failOperationRun,
  getProjectOperationRunById,
  setOperationStage,
  type ProjectOperationRun,
} from "../store";

/**
 * Durable steps for isolated change validation (Sprint 10A §20, §8 refactor).
 *
 * ## Why this is a sequence of steps rather than one
 *
 * The first design ran provisioning, verification, install, typecheck, test,
 * build and teardown inside a single durable step. It was defensible — teardown
 * lived in the same `finally` as the work, so no path could leak a paid VM —
 * and a real run proved it wrong in the worst possible way: the step hit the
 * platform's function ceiling mid-build, was killed, and *because it was
 * killed, its cleanup never ran*. The guarantee held only for failures the
 * function survived, which is exactly the wrong set.
 *
 * Splitting the pipeline fixes both halves of that:
 *
 *  - each phase gets its own function invocation and its own ceiling, so a
 *    five-minute pipeline is no longer racing a five-minute limit;
 *  - cleanup is a step of its own, so it runs on the paths that previously ran
 *    nothing — including a phase step the platform killed outright.
 *
 * ## What every step must do, because none of them share memory
 *
 * A step receives an operation id. It re-derives the project, the prepared
 * change, the repository, the profile and the sandbox name from persisted
 * state, and reconnects to the sandbox by a name computed from the validation
 * run id. Nothing about the sandbox is carried in the durable log: no handle,
 * no capability URL, no token (§3, CLAUDE.md rule 52).
 *
 * The GitHub clone credential is minted in exactly one step — the one that
 * clones — rather than for every step that needs a target. A short-lived token
 * that is never requested is a token that cannot leak.
 *
 * Nothing in this file calls a model, and no `ai_usage_events` row is written —
 * none is earned. Sandbox spend goes to its own ledger (§25).
 */

export type ValidationDeps = {
  /** Service-role client: workflow steps have no user session (ADR 0013). */
  supabase: SupabaseClient;
  /**
   * The sandbox provider.
   *
   * Injected so tests can supply a fake that executes nothing. There is no
   * local-execution implementation and there must never be one (§4).
   */
  provider: SandboxProvider;
  /**
   * Rebuilt from the operation's own project — never from client input.
   *
   * `withCloneCredential` is requested only by the provisioning step. Every
   * other phase resolves a target with `cloneCredential: null`, because by then
   * the source is on disk and a credential would be pure additional exposure.
   */
  resolveTarget: (
    operation: ProjectOperationRun,
    options: { withCloneCredential: boolean },
  ) => Promise<ValidationRepositoryTarget | null>;
};

export type ValidationRepositoryTarget = {
  repositoryUrl: string;
  /** The directory Vercel clones into, i.e. the repository name. */
  sourceRoot: string;
  /**
   * Resolves file bytes from GitHub at an exact commit.
   *
   * Used to verify the build identity against the pinned revision, which is
   * what replaced the `git rev-parse` check the provider cannot support.
   */
  manifest: SourceManifestPort;
  /**
   * A short-lived GitHub installation token, scoped to source acquisition only.
   *
   * Minted immediately before the clone and destroyed inside the sandbox
   * before any repository-controlled command runs. Never persisted, never
   * placed in the sandbox environment (§7).
   */
  cloneCredential: { username: string; password: string } | null;
};

export type StepOutcome<T> = ({ ok: true } & T) | { ok: false; failureCode: OperationFailureCode };

/**
 * A phase step's answer: it worked, or it did not and here is why.
 *
 * Deliberately carries no payload on success. Everything a later phase needs is
 * in the database by the time this returns, and a step that returned its result
 * would tempt the next one into trusting a value from the durable log instead
 * of re-reading the row (§4).
 */
export type PhaseStepOutcome = { ok: true } | { ok: false; failureCode: OperationFailureCode };

/** Metrics a finished sandbox reported. Numbers and enums only — never secrets. */
export type CleanupRecord = {
  cleanup: CleanupStatus;
  runtime: string | null;
  sandboxDurationMs: number | null;
  usage: SandboxUsage | null;
  /**
   * A captured artifact, carried to the step that records the verdict.
   *
   * It cannot be persisted at capture time: the database refuses an artifact on
   * a run that is not yet `passed`, and the verdict is written one step later.
   * Numbers and identifiers only — nothing here is secret, and it is exactly
   * what the terminal write needs to satisfy the constraint in one statement.
   */
  artifact: { snapshotId: string; sizeBytes: number | null; expiresAt: string } | null;
};

async function loadOperation(
  supabase: SupabaseClient,
  operationId: string,
): Promise<StepOutcome<{ operation: ProjectOperationRun }>> {
  const operation = await getProjectOperationRunById(supabase, operationId);
  if (!operation) return { ok: false, failureCode: "operation_not_found" };

  const { data: project } = await supabase
    .from("projects")
    .select("id, user_id")
    .eq("id", operation.projectId)
    .maybeSingle();

  if (!project || (project as { user_id: string }).user_id !== operation.userId) {
    return { ok: false, failureCode: "project_not_found" };
  }

  return { ok: true, operation };
}

/**
 * Everything a sandbox-touching step needs, rebuilt from persisted state.
 *
 * The one place the world is re-derived, so a phase step is a short function
 * about its phase rather than a repetition of this. Ownership is asserted at
 * every hop: the operation's project, the project's owner, and the prepared
 * change scoped to that project (ADR 0013).
 */
async function resolveRunContext(
  deps: ValidationDeps,
  operationId: string,
  options: { withCloneCredential: boolean },
): Promise<
  StepOutcome<{
    operation: ProjectOperationRun;
    run: StoredValidationRun;
    target: ValidationTarget;
    manifest: SourceManifestPort;
  }>
> {
  const loaded = await loadOperation(deps.supabase, operationId);
  if (!loaded.ok) return loaded;
  const { operation } = loaded;

  const run = await findValidationRunByOperation(deps.supabase, operationId);
  if (!run) return { ok: false, failureCode: "validation_run_failed" };

  const prepared = await getPreparedChange(deps.supabase, {
    projectId: operation.projectId,
    preparedChangeId: run.preparedChangeId,
  });
  if (!prepared || prepared.commitSha === null) {
    return { ok: false, failureCode: "prepared_change_not_ready" };
  }

  const repository = await deps.resolveTarget(operation, options);
  if (!repository) return { ok: false, failureCode: "repository_connection_invalid" };

  const snapshot = await getLatestSuccessfulSnapshot(deps.supabase, operation.projectId);
  if (!snapshot?.result) return { ok: false, failureCode: "validation_not_supported" };
  const profile = resolveValidationProfile(snapshot.result);
  if (!profile.supported) return { ok: false, failureCode: profile.reason };

  return {
    ok: true,
    operation,
    run,
    manifest: repository.manifest,
    target: {
      preparedChangeId: prepared.id,
      preparedCommitSha: prepared.commitSha,
      repositoryUrl: repository.repositoryUrl,
      cloneCredential: repository.cloneCredential,
      profile: profile.profile,
      packageManager: profile.packageManager,
      sourceRoot: repository.sourceRoot,
      workspaceRoot: profile.workspaceRoot,
      preparedFiles: prepared.files.map((file) => ({
        path: file.path,
        /* A deletion carries no hash and is checked as absence, not as a
           hash of nothing. Undefined would read as "not measured". */
        contentHash: file.contentHash ?? null,
      })),
      validationRunId: run.id,
    },
  };
}

/**
 * Progress reporting, on both rows that describe the same run.
 *
 * Best-effort by design: this is a page the user may have left, and a failed
 * status write must never abort a sandbox that is working correctly.
 */
async function announceStage(
  deps: ValidationDeps,
  params: { operationId: string; projectId: string; validationRunId: string; stage: ValidationStage },
): Promise<void> {
  try {
    await setValidationStage(deps.supabase, {
      validationRunId: params.validationRunId,
      projectId: params.projectId,
      stage: params.stage,
    });
    await setOperationStage(deps.supabase, { operationId: params.operationId, stage: params.stage });
  } catch {
    return;
  }
}

/**
 * Step 1 — establish eligibility and claim the run. No sandbox yet.
 *
 * Everything that can refuse without spending money refuses here (§34).
 */
export async function prepareValidationStep(
  deps: ValidationDeps,
  operationId: string,
): Promise<StepOutcome<{ validationRunId: string }>> {
  const loaded = await loadOperation(deps.supabase, operationId);
  if (!loaded.ok) return loaded;
  const { operation } = loaded;

  // A replay after the claim: reuse rather than claiming twice.
  const existing = await findValidationRunByOperation(deps.supabase, operationId);
  if (existing) return { ok: true, validationRunId: existing.id };

  await setOperationStage(deps.supabase, { operationId, stage: "preparing", markRunning: true });

  if (!operation.subjectId) return { ok: false, failureCode: "missing_required_context" };

  const prepared = await getPreparedChange(deps.supabase, {
    projectId: operation.projectId,
    preparedChangeId: operation.subjectId,
  });
  if (!prepared) return { ok: false, failureCode: "prepared_change_not_ready" };

  // Only a completed preparation has a commit to validate.
  if (prepared.status !== "prepared" || prepared.commitSha === null) {
    return { ok: false, failureCode: "prepared_change_not_ready" };
  }

  // Validation is artifact-centric (§28): the snapshot is consulted for the
  // repository's *shape* — framework, package manager, workspace layout —
  // never to decide whether the artifact is still current. A prepared commit
  // stays validatable after newer intelligence arrives.
  const snapshot = await getLatestSuccessfulSnapshot(deps.supabase, operation.projectId);
  if (!snapshot?.result) return { ok: false, failureCode: "validation_not_supported" };

  const profile = resolveValidationProfile(snapshot.result);
  if (!profile.supported) return { ok: false, failureCode: profile.reason };

  /*
   * How much of the profile this change deserves (Sprint 0047).
   *
   * Server-derived from the spec's risk class, the trusted Action Step's
   * change kind and evidence ids, and the paths Vibe itself verified as
   * changed — never from a commit message, and never from anything the agent
   * said about its own work. The same shared resolver `startChangeValidation`
   * uses for its reuse check, so both compute the same identity.
   */
  const depth = await resolveDepthForPreparedChange({
    supabase: deps.supabase,
    projectId: operation.projectId,
    prepared,
  });

  const identity = computeValidationIdentity({
    preparedChangeId: prepared.id,
    preparedCommitSha: prepared.commitSha,
    validationProfile: profile.profile,
    validationProfileVersion: validationProfileVersionFor(profile.profile),
    sandboxPolicyVersion: SANDBOX_POLICY_VERSION,
    validationDepth: depth.depth,
    validationDepthPolicyVersion: depth.policyVersion,
  });

  const claim = await claimValidationRun(deps.supabase, {
    projectId: operation.projectId,
    userId: operation.userId,
    preparedChangeId: prepared.id,
    operationRunId: operationId,
    validationProfile: profile.profile,
    validationProfileVersion: validationProfileVersionFor(profile.profile),
    validationDepth: depth.depth,
    validationDepthPolicyVersion: depth.policyVersion,
    validationDepthReason: depth.reason,
    sandboxPolicyVersion: SANDBOX_POLICY_VERSION,
    sandboxProvider: deps.provider.id,
    packageManager: profile.packageManager,
    preparedCommitSha: prepared.commitSha,
    validationIdentity: identity,
  });

  if (!claim.ok) {
    return {
      ok: false,
      failureCode: claim.error === "already_active" ? "already_running" : "validation_run_failed",
    };
  }

  await claimResultForOperation(deps.supabase, { operationId, resultId: claim.validationRun.id });

  await recordAuditEvent(deps.supabase, {
    userId: operation.userId,
    eventType: "change_validation.started",
    metadata: {
      projectId: operation.projectId,
      operationId,
      validationRunId: claim.validationRun.id,
      preparedChangeId: prepared.id,
      profile: profile.profile,
      validationDepth: depth.depth,
      validationDepthReason: depth.reason,
      validationDepthEscalatedBy: depth.escalatedBy.join(", ") || null,
      sandboxPolicyVersion: SANDBOX_POLICY_VERSION,
    },
  });

  return { ok: true, validationRunId: claim.validationRun.id };
}

/**
 * Step 2 — provision the sandbox, and nothing else.
 *
 * The only billable-and-ambiguous operation in the run, alone in its own step
 * so that step can refuse retries without that refusal spreading to work which
 * is safe to repeat. A platform retry here could buy a second microVM for a
 * question the first one may already have answered (§10).
 *
 * Re-entry is still safe: a replay finds the sandbox already exists and the
 * cheapest correct thing to do is nothing, because the name is deterministic
 * and the provider refuses a duplicate.
 */
export async function provisionSandboxStep(
  deps: ValidationDeps,
  operationId: string,
): Promise<PhaseStepOutcome> {
  const resolved = await resolveRunContext(deps, operationId, { withCloneCredential: true });
  if (!resolved.ok) return resolved;
  const { operation, run, target } = resolved;

  // Already past provisioning on a previous attempt: the sandbox exists and
  // later phases will reconnect to it. Provisioning again would be a second VM.
  if (run.sourceIntegrity !== null || Object.keys(run.steps).length > 0) {
    return { ok: true };
  }

  await announceStage(deps, {
    operationId,
    projectId: operation.projectId,
    validationRunId: run.id,
    stage: "provisioning",
  });

  const outcome = await provisionSandbox(deps.provider, target);
  if (!outcome.ok) {
    await recordFailureDetail(deps, run, outcome.failureDetail);
    return { ok: false, failureCode: outcome.failureCode };
  }

  return { ok: true };
}

/**
 * Step 3 — verify the source, then destroy the clone credential.
 *
 * Idempotent: a run whose `source_integrity` is already recorded has already
 * proved what this step proves, so a replay reuses it rather than re-reading
 * every build-identity file (§11).
 */
export async function verifySourceStep(
  deps: ValidationDeps,
  operationId: string,
): Promise<PhaseStepOutcome> {
  const resolved = await resolveRunContext(deps, operationId, { withCloneCredential: false });
  if (!resolved.ok) return resolved;
  const { operation, run, target, manifest } = resolved;

  if (run.sourceIntegrity !== null) return { ok: true };

  await announceStage(deps, {
    operationId,
    projectId: operation.projectId,
    validationRunId: run.id,
    stage: "verifying_source",
  });

  const outcome = await verifySource(deps.provider, manifest, target);

  if (!outcome.ok) {
    if (outcome.sourceIntegrity) {
      await recordSourceIntegrity(deps.supabase, {
        validationRunId: run.id,
        projectId: operation.projectId,
        sourceIntegrity: outcome.sourceIntegrity,
        sandboxRuntime: run.sandboxRuntime,
        stage: "verifying_source",
      });
    }
    await recordFailureDetail(deps, run, outcome.failureDetail);
    return { ok: false, failureCode: outcome.failureCode };
  }

  await recordSourceIntegrity(deps.supabase, {
    validationRunId: run.id,
    projectId: operation.projectId,
    sourceIntegrity: outcome.sourceIntegrity,
    sandboxRuntime: outcome.runtime,
    stage: "securing_sandbox",
  });

  return { ok: true };
}

const PHASE_STAGES: Record<ValidationStepName, ValidationStage> = {
  install: "installing",
  typecheck: "typechecking",
  test: "testing",
  build: "building",
};

/**
 * Steps 4–7 — one validation phase each.
 *
 * ## The re-entry rule, which is the reason this function exists
 *
 * A durable workflow can resume for reasons that have nothing to do with the
 * work: a persistence error, a provider hiccup, a redeploy. If resuming meant
 * re-running, a validation that had already spent 84 seconds running the
 * customer's test suite would spend them again — and worse, could report a
 * *different* verdict for the same artifact on the same filesystem.
 *
 * So the first thing a phase does is read what is already recorded. A phase
 * with a persisted result is finished, and its stored result is the answer
 * (§11, §20). This is checked against the database rather than against anything
 * in memory, because memory is exactly what a resumed step does not have.
 */
export async function runPhaseStep(
  deps: ValidationDeps,
  operationId: string,
  phase: ValidationStepName,
): Promise<PhaseStepOutcome> {
  const resolved = await resolveRunContext(deps, operationId, { withCloneCredential: false });
  if (!resolved.ok) return resolved;
  const { operation, run, target } = resolved;

  const recorded = run.steps[phase];
  if (recorded) {
    // Already done, on a previous attempt. Reuse the persisted verdict — never
    // re-run a repository-controlled command to re-answer a settled question.
    if (recorded.status === "passed" || recorded.status === "skipped") return { ok: true };
    // A recorded failure is equally final. Re-running to see whether the tests
    // fail differently this time is how a flaky suite becomes a coin toss.
    return {
      ok: false,
      failureCode: recorded.status === "timed_out" ? "sandbox_timeout" : "validation_checks_failed",
    };
  }

  /*
   * Outside this run's depth (Sprint 0047).
   *
   * Recorded as an explicit skip with a reason, never silently omitted: a phase
   * with no row at all is indistinguishable from a phase whose result was lost,
   * and the whole point of a depth is that a reader can see which questions were
   * asked.
   *
   * `outside_depth`, not `not_in_profile`. The first dogfood reused the latter
   * and the panel rendered the skipped step as "no script for this in the
   * project" — a statement about the customer's repository that was simply
   * untrue. "The profile has no such step" and "this change did not need it"
   * are different sentences and now have different reasons.
   *
   * A run claimed before depth existed has `validationDepth: null` and runs
   * everything, which is precisely what those runs did.
   */
  if (run.validationDepth !== null && !depthRunsStep(run.validationDepth, phase)) {
    await recordValidationPhase(deps.supabase, {
      validationRunId: run.id,
      projectId: operation.projectId,
      step: phase,
      result: {
        command: "",
        status: "skipped",
        exitCode: null,
        durationMs: 0,
        outputTail: "",
        outputTruncated: false,
        skipReason: "outside_depth",
      },
      stage: PHASE_STAGES[phase],
    });
    return { ok: true };
  }

  await announceStage(deps, {
    operationId,
    projectId: operation.projectId,
    validationRunId: run.id,
    stage: PHASE_STAGES[phase],
  });

  const outcome = await runCheckPhase(deps.provider, target, phase);

  if (outcome.step) {
    await recordValidationPhase(deps.supabase, {
      validationRunId: run.id,
      projectId: operation.projectId,
      step: phase,
      result: outcome.step,
      stage: PHASE_STAGES[phase],
    });
  }

  if (!outcome.ok) {
    await recordFailureDetail(deps, run, outcome.failureDetail);
    return { ok: false, failureCode: outcome.failureCode };
  }

  return { ok: true };
}

/**
 * A failure explanation that would otherwise be lost.
 *
 * Written onto the run while it is still `running`, so the terminal write does
 * not have to carry an explanation through a step boundary. Best-effort: an
 * unexplained failure is bad, but a failure to explain must not become a second
 * failure.
 */
async function recordFailureDetail(
  deps: ValidationDeps,
  run: StoredValidationRun,
  failureDetail: string | null,
): Promise<void> {
  if (!failureDetail) return;
  try {
    await deps.supabase
      .from("validation_runs")
      .update({ failure_detail: failureDetail })
      .eq("id", run.id)
      .eq("project_id", run.projectId)
      .eq("status", "running");
  } catch {
    return;
  }
}

/**
 * Step 8 — stop the sandbox. Runs on every path (§13).
 *
 * Deliberately ordered **before** result collection rather than after it, which
 * is a small departure from the phase list and a deliberate one: once the last
 * phase has returned, the sandbox has no remaining purpose, and nothing about
 * deciding a verdict should be able to keep a paid VM alive. Cleanup that
 * depends on the correctness of result-collection logic is cleanup with a
 * condition attached.
 *
 * Safe to retry, and one of the few steps that should be: stopping is
 * idempotent, "already gone" is a success, and a leaked microVM is worse than a
 * duplicate stop request.
 */
export async function cleanupSandboxStep(
  deps: ValidationDeps,
  operationId: string,
): Promise<CleanupRecord> {
  const resolved = await resolveRunContext(deps, operationId, { withCloneCredential: false });
  if (!resolved.ok) {
    return { cleanup: "not_provisioned", runtime: null, sandboxDurationMs: null, usage: null, artifact: null };
  }
  const { operation, run, target } = resolved;

  await announceStage(deps, {
    operationId,
    projectId: operation.projectId,
    validationRunId: run.id,
    stage: "cleaning_up",
  });

  /*
   * Every run is torn down, including a passing one (Sprint 0114).
   *
   * A pass used to be *snapshotted* instead of stopped, so a preview could boot
   * from the exact validated bytes. Nothing boots from a snapshot any more — a
   * preview clones the prepared commit and runs a development server, which is
   * what let it stop waiting for this run to finish at all (ADR 0064).
   *
   * What that removes is more than a branch: the capture, the restore, the
   * integrity re-verification of a restored filesystem, the deletion, and a
   * customer's built filesystem sitting in a third party's storage for 24 hours
   * because Vercel refuses a shorter expiry. Keeping any of it would mean
   * paying a provider to retain customer data for a purpose that no longer
   * exists.
   *
   * `artifact: null` on every path below is the whole of what finalize now
   * writes, and the CHECK that refuses an artifact on a non-passing row is left
   * in place: it costs nothing and it is the guard that would catch this being
   * reintroduced carelessly.
   */
  const outcome = await stopSandbox(deps.provider, target);

  // Wall time from the claim, which is the closest honest bound on how long the
  // sandbox could have existed. The provider's own Active CPU figure is the
  // billing-relevant number and is recorded separately.
  const startedAt = run.startedAt ? Date.parse(run.startedAt) : null;
  const sandboxDurationMs =
    startedAt !== null && Number.isFinite(startedAt) ? Date.now() - startedAt : null;

  return {
    cleanup: outcome.cleanup,
    runtime: outcome.runtime ?? run.sandboxRuntime,
    sandboxDurationMs,
    usage: outcome.usage,
    artifact: null,
  };
}

/**
 * Step 9 — decide and record the verdict.
 *
 * Reads the phases from the database rather than receiving them through the
 * durable log: they were written as they happened, and re-reading them is what
 * makes this step's answer independent of how many times the workflow was
 * resumed on the way here.
 */
export async function finalizeValidationStep(
  deps: ValidationDeps,
  operationId: string,
  failureCode: OperationFailureCode | null,
  cleanup: CleanupRecord,
): Promise<StepOutcome<{ validationRunId: string; status: "passed" | "failed" }>> {
  const loaded = await loadOperation(deps.supabase, operationId);
  if (!loaded.ok) return loaded;
  const { operation } = loaded;

  const run = await findValidationRunByOperation(deps.supabase, operationId);
  if (!run) return { ok: false, failureCode: "validation_run_failed" };

  // A replay of a step that already finished.
  if (run.status === "passed" || run.status === "failed") {
    return run.status === "passed"
      ? { ok: true, validationRunId: run.id, status: "passed" }
      : { ok: false, failureCode: run.failureCode ?? "validation_run_failed" };
  }

  // The build is mandatory. A pipeline that ran to the end without a passing
  // build has not established the claim this sprint makes, and must not be
  // recorded as though it had (§6).
  const resolvedFailure: ValidationFailureCode | null =
    failureCode !== null
      ? (failureCode as ValidationFailureCode)
      : buildSatisfiesProfile(run.steps)
        ? null
        : "validation_not_supported";

  const status = resolvedFailure === null ? "passed" : "failed";

  const persisted = await completeValidationRun(deps.supabase, {
    validationRunId: run.id,
    projectId: operation.projectId,
    status,
    stage: status === "passed" ? "completed" : run.stage,
    steps: run.steps,
    failureCode: resolvedFailure,
    failureDetail: run.failureDetail,
    sandboxRuntime: cleanup.runtime ?? run.sandboxRuntime,
    sandboxDurationMs: cleanup.sandboxDurationMs ?? run.sandboxDurationMs,
    cleanupStatus: cleanup.cleanup,
    sourceIntegrity: run.sourceIntegrity,
    // Written in the same statement as the verdict, which is the only order the
    // constraint permits. A captured artifact only ever accompanies a pass.
    artifact: status === "passed" ? cleanup.artifact : null,
  });

  // A snapshot Vibe cannot point at is a snapshot nobody will ever delete: a
  // gigabyte of a customer's filesystem in provider storage, invisible to the
  // application that created it. If the terminal write did not apply — a replay,
  // an already-terminal row — the artifact captured in *this* invocation has no
  // owner, so it goes rather than leaking silently.
  if (!persisted && cleanup.artifact) {
    try {
      await deps.provider.deleteArtifact(cleanup.artifact.snapshotId);
    } catch {
      // Recorded by absence rather than by failing a finished validation. The
      // artifact's own TTL remains the backstop.
    }
  }

  if (persisted) {
    // Exactly one usage record per validation run, tied to the terminal write
    // so a retried finalize cannot produce a second one (§18).
    await recordSandboxUsage(deps.supabase, {
      projectId: operation.projectId,
      userId: operation.userId,
      validationRunId: run.id,
      provider: deps.provider.id,
      runtime: cleanup.runtime ?? run.sandboxRuntime,
      status,
      sandboxDurationMs: cleanup.sandboxDurationMs,
      usage: cleanup.usage,
      cleanupStatus: cleanup.cleanup,
      failureCode: resolvedFailure,
      failureDetail: run.failureDetail,
    });

    await recordAuditEvent(deps.supabase, {
      userId: operation.userId,
      eventType: status === "passed" ? "change_validation.passed" : "change_validation.failed",
      metadata: {
        projectId: operation.projectId,
        operationId,
        validationRunId: run.id,
        preparedChangeId: run.preparedChangeId,
        failureCode: resolvedFailure,
        cleanup: cleanup.cleanup,
        failureDetail: run.failureDetail,
        sandboxDurationMs: cleanup.sandboxDurationMs,
      },
    });
  }

  if (status === "failed") {
    return { ok: false, failureCode: resolvedFailure ?? "validation_run_failed" };
  }

  return { ok: true, validationRunId: run.id, status: "passed" };
}

/**
 * Step 10 — finish, idempotently, and charge for what was sold (ADR 0073).
 *
 * This is where a customer's Credits are actually taken. Not because validation
 * is priced — it carries no price of its own, and `credits/retail.ts` explains
 * why — but because *"a customer bought a validated improvement, not a
 * pipeline"*, and this is the line at which one exists.
 *
 * The settlement is gated on winning the status swap, for the reason the agent
 * run's own finalization gives: whoever wins owns billing finalization, so a
 * sweep racing this workflow cannot release a hold this process is about to
 * charge.
 *
 * A validation started by hand for a change whose agent hold was already
 * settled or released resolves to `already_closed` and charges nothing. That is
 * the ordinary shape of "Validate again", not an error.
 */
export async function completeValidationStep(
  deps: ValidationDeps,
  operationId: string,
  validationRunId: string,
): Promise<void> {
  const transitioned = await completeOperationRun(deps.supabase, {
    operationId,
    resultId: validationRunId,
  });
  if (!transitioned) return;

  const operation = await getProjectOperationRunById(deps.supabase, operationId);
  if (!operation) return;

  await settleAgentHold(deps, operation, "validated");

  await recordAuditEvent(deps.supabase, {
    userId: operation.userId,
    eventType: "operation.completed",
    metadata: { projectId: operation.projectId, operationId, operationType: operation.operationType },
  });
}

export async function failValidationStep(
  deps: ValidationDeps,
  operationId: string,
  failureCode: OperationFailureCode,
): Promise<void> {
  // A run claimed but never completed — a step died outside the returned-failure
  // convention. Close the row so the UI is not left waiting.
  const run = await findValidationRunByOperation(deps.supabase, operationId);
  if (run && (run.status === "running" || run.status === "queued")) {
    const operation = await getProjectOperationRunById(deps.supabase, operationId);
    if (operation) {
      await completeValidationRun(deps.supabase, {
        validationRunId: run.id,
        projectId: operation.projectId,
        status: "failed",
        stage: run.stage,
        steps: run.steps,
        failureCode: (failureCode as ValidationFailureCode) ?? "validation_run_failed",
        failureDetail: run.failureDetail ?? "the validation step ended without recording a result",
        sourceIntegrity: run.sourceIntegrity,
        sandboxRuntime: run.sandboxRuntime,
        sandboxDurationMs: run.sandboxDurationMs,
        cleanupStatus: run.cleanupStatus ?? "not_provisioned",
      });
    }
  }

  const transitioned = await failOperationRun(deps.supabase, { operationId, failureCode });
  if (!transitioned) return;

  const operation = await getProjectOperationRunById(deps.supabase, operationId);
  if (!operation) return;

  // The improvement did not pass. Vibe paid the provider for the run that
  // produced it and the customer pays nothing — CREDIT_ECONOMICS.md's approved
  // failure policy, reached through the same door the pass uses (ADR 0073).
  await settleAgentHold(deps, operation, "unvalidated");

  await recordAuditEvent(deps.supabase, {
    userId: operation.userId,
    eventType: "operation.failed",
    metadata: { projectId: operation.projectId, operationId, failureCode },
  });
}

/**
 * Resolves the agent hold behind the change this validation judged.
 *
 * The prepared change is read from the validation run rather than from the
 * operation, because that is the link the database actually records — and it is
 * what makes "which hold does this verdict answer for" a lookup rather than an
 * inference.
 *
 * Never throws into the workflow. A verdict that has been written must not be
 * undone by a billing fault; an unresolved hold is recoverable and a lost
 * verdict is not. What it must not do is fail silently, so both the outcome and
 * the failure are recorded.
 */
async function settleAgentHold(
  deps: ValidationDeps,
  operation: { id: string; projectId: string; userId: string },
  outcome: AgentHoldOutcome,
): Promise<void> {
  const run = await findValidationRunByOperation(deps.supabase, operation.id);
  if (!run) return;

  let resolution: string;
  try {
    const resolved = await resolveAgentHold(deps.supabase, {
      projectId: operation.projectId,
      preparedChangeId: run.preparedChangeId,
      outcome,
    });
    resolution = resolved.kind;
  } catch {
    resolution = "error";
  }

  await recordAuditEvent(deps.supabase, {
    userId: operation.userId,
    projectId: operation.projectId,
    eventType: "agent_execution.hold_resolved",
    metadata: {
      projectId: operation.projectId,
      operationId: operation.id,
      preparedChangeId: run.preparedChangeId,
      validationRunId: run.id,
      outcome,
      resolution,
      decidedBy: "validation_verdict",
    },
  });
}
