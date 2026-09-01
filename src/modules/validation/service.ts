import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getPreparedChange } from "@/modules/execution/store";
import type { OperationExecutor } from "@/modules/operations/executor";
import {
  createOperationRun,
  findActiveOperationByIdentity,
  getProjectOperationRunById,
  type StoredOperationRun,
} from "@/modules/operations/store";
import { buildOperationView, type OperationView } from "@/modules/operations/view";
import { getLatestSuccessfulSnapshot } from "@/modules/repository-intelligence/store";
import { resolveDepthForPreparedChange } from "./depth-inputs";
import { computeValidationIdentity } from "./identity";
import { resolveValidationProfile } from "./profile";
import {
  SANDBOX_POLICY_VERSION,
  validationProfileVersionFor,
  type ValidationFailureCode,
} from "./schema";
import {
  findReusableValidationRun,
  getLatestValidationForPreparedChange,
  type StoredValidationRun,
} from "./store";

/**
 * Starting a validation (Sprint 10A §27, §28).
 *
 * ## What the client is allowed to say
 *
 * Two identifiers: which project, which prepared change. That is the entire
 * input surface.
 *
 * The client cannot choose the repository, the commit, the sandbox provider,
 * the runtime, the commands, the network policy, the package manager or the
 * working directory. Not because those are validated and rejected — because
 * they are never accepted in the first place. Every one is re-derived from
 * server state inside the durable step, from an operation id. A parameter that
 * does not exist cannot be tampered with.
 *
 * ## Artifact-centric, deliberately
 *
 * Change *preparation* refuses on stale evidence, because writing code from a
 * stale premise produces a wrong commit (Sprint 9, ADR 0014). Validation does
 * the opposite and it is not an inconsistency:
 *
 * > Preparation asks "should this change exist?" — a question about now.
 * > Validation asks "does this commit build?" — a question about an artifact.
 *
 * A commit's build result does not expire because newer repository
 * intelligence arrived. Blocking validation on staleness would mean an
 * untouched prepared change silently becomes unvalidatable while sitting
 * still. Staleness matters again at merge, which does not exist yet.
 */

export type StartValidationParams = {
  projectId: string;
  userId: string;
  preparedChangeId: string;
  /**
   * Normal gate reads reuse an exact current pass. An explicit founder retry
   * sets this false so the requested new observation actually runs, while the
   * active-operation identity still blocks duplicate work.
   */
  reusePassed?: boolean;
};

export type StartValidationOutcome =
  | { kind: "started"; operation: OperationView }
  | { kind: "running"; operation: OperationView }
  | { kind: "reused"; validationRunId: string; status: "passed" }
  | { kind: "failed"; error: ValidationFailureCode | "project_not_found" | "execution_start_failed" };

function view(operation: StoredOperationRun): OperationView {
  return buildOperationView({
    operationId: operation.id,
    status: operation.status,
    stage: operation.stage,
    failureCode: operation.failureCode,
    resultId: operation.resultId,
    startedAt: operation.startedAt,
    completedAt: operation.completedAt,
    createdAt: operation.createdAt,
  });
}

type ResolvedContext =
  | { ok: true; identity: string; preparedCommitSha: string }
  | { ok: false; error: ValidationFailureCode };

/**
 * Everything checkable before a single cent of infrastructure is spent (§28).
 *
 * Ordered cheapest-first, and every branch returns without provisioning.
 */
async function resolveContext(
  supabase: SupabaseClient,
  params: StartValidationParams,
): Promise<ResolvedContext> {
  const prepared = await getPreparedChange(supabase, {
    projectId: params.projectId,
    preparedChangeId: params.preparedChangeId,
  });

  // Scoped to the project, and the project was already scoped to the user, so
  // another tenant's prepared change is invisible rather than forbidden.
  if (!prepared) return { ok: false, error: "prepared_change_not_ready" };
  if (prepared.status !== "prepared" || prepared.commitSha === null) {
    return { ok: false, error: "prepared_change_not_ready" };
  }

  const snapshot = await getLatestSuccessfulSnapshot(supabase, params.projectId);
  if (!snapshot?.result) return { ok: false, error: "validation_not_supported" };

  const profile = resolveValidationProfile(snapshot.result);
  if (!profile.supported) return { ok: false, error: profile.reason };

  /*
   * The depth is an identity input, so the reuse check has to know it.
   *
   * Resolved through the same shared function the claim uses — if these two
   * disagreed even once, this lookup would search for a hash the claim never
   * wrote and every validation would provision a fresh sandbox for a question
   * already answered (Sprint 0047).
   */
  const depth = await resolveDepthForPreparedChange({
    supabase,
    projectId: params.projectId,
    prepared,
  });

  return {
    ok: true,
    preparedCommitSha: prepared.commitSha,
    identity: computeValidationIdentity({
      preparedChangeId: prepared.id,
      preparedCommitSha: prepared.commitSha,
      validationProfile: profile.profile,
      validationProfileVersion: validationProfileVersionFor(profile.profile),
      sandboxPolicyVersion: SANDBOX_POLICY_VERSION,
      validationDepth: depth.depth,
      validationDepthPolicyVersion: depth.policyVersion,
    }),
  };
}

export async function startChangeValidation(
  supabase: SupabaseClient,
  executor: OperationExecutor,
  params: StartValidationParams,
): Promise<StartValidationOutcome> {
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", params.projectId)
    .eq("user_id", params.userId)
    .maybeSingle();

  if (!project) return { kind: "failed", error: "project_not_found" };

  const resolved = await resolveContext(supabase, params);
  if (!resolved.ok) return { kind: "failed", error: resolved.error };

  // Cheapest answer first: this exact artifact already passed under this exact
  // policy *and its captured filesystem is still usable*, so there is nothing
  // to learn from a second microVM (§21). A pass whose capture failed, expired
  // or was deleted must be allowed to run again; otherwise Preview's explicit
  // "Validate again" action can never recover the missing artifact.
  const reusable =
    params.reusePassed === false
      ? null
      : await findReusableValidationRun(supabase, {
          projectId: params.projectId,
          validationIdentity: resolved.identity,
        });
  if (reusable) return { kind: "reused", validationRunId: reusable.id, status: "passed" };

  // Second cheapest: it is already running. Return the live operation rather
  // than queueing a duplicate.
  const active = await findActiveOperationByIdentity(supabase, {
    projectId: params.projectId,
    operationType: "change_validation",
    inputIdentity: resolved.identity,
  });
  if (active) return { kind: "running", operation: view(active) };

  const created = await createOperationRun(supabase, {
    projectId: params.projectId,
    userId: params.userId,
    operationType: "change_validation",
    inputIdentity: resolved.identity,
    subjectId: params.preparedChangeId,
    initiatedBy: "customer",
  });

  if (!created.ok) {
    // Lost the race against a concurrent click — the unique index caught the
    // second insert. Show the winner's operation rather than a failure: the
    // work the user asked for is happening.
    if (created.error === "already_active") {
      const winner = await findActiveOperationByIdentity(supabase, {
        projectId: params.projectId,
        operationType: "change_validation",
        inputIdentity: resolved.identity,
      });
      if (winner) return { kind: "running", operation: view(winner) };
    }
    return { kind: "failed", error: "validation_run_failed" };
  }

  const started = await executor.start({
    operationId: created.operation.id,
    operationType: "change_validation",
  });

  if (!started.ok) {
    return { kind: "failed", error: "execution_start_failed" };
  }

  const refreshed = await getProjectOperationRunById(supabase, created.operation.id);
  return { kind: "started", operation: view(refreshed ?? created.operation) };
}

/** Live status for a page that may have been left and returned to. */
export async function getValidationStatus(
  supabase: SupabaseClient,
  params: { projectId: string; userId: string; operationId: string },
): Promise<OperationView | null> {
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", params.projectId)
    .eq("user_id", params.userId)
    .maybeSingle();

  if (!project) return null;

  const operation = await getProjectOperationRunById(supabase, params.operationId);
  if (!operation || operation.projectId !== params.projectId) return null;

  return view(operation);
}

export async function getLatestValidation(
  supabase: SupabaseClient,
  params: { projectId: string; preparedChangeId: string },
): Promise<StoredValidationRun | null> {
  return getLatestValidationForPreparedChange(supabase, params);
}
