import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAuditEvent } from "@/modules/audit-log/events";
import { getAuditCurrency } from "@/modules/business-audit/service";
import { getLatestOpportunities } from "@/modules/opportunities/service";
import { getLatestSuccessfulSnapshot } from "@/modules/repository-intelligence/store";
import type { OperationExecutor } from "@/modules/operations/executor";
import type { OperationFailureCode } from "@/modules/operations/failures";
import {
  attachExecutionRun,
  createOperationRun,
  failOperationRun,
  findActiveOperationByIdentity,
  getOperationRun,
  type StoredOperationRun,
} from "@/modules/operations/store";
import { buildOperationView, type OperationView } from "@/modules/operations/view";
import { resolveAppRoot } from "./app-root";
import { resolveExecutionCapability } from "./capabilities";
import { branchNameFor, computeExecutionIdentity } from "./identity";
import { NEXTJS_SEO_FOUNDATIONS_VERSION } from "./schema";
import { findReusablePreparedChange, getPreparedChange, type StoredPreparedChange } from "./store";

/**
 * Starting and observing change preparation (Sprint 9B §8, §9, §19, §20).
 *
 * ## What the caller may decide
 *
 * A project id and an opportunity id. That is the complete list.
 *
 * Everything else — the repository, the installation, the branch, the base
 * commit, the file paths, the capability, the production origin, the generated
 * content — is resolved here from server state. A client that could name its
 * own repository or target path would turn a scoped capability into an
 * arbitrary write primitive, so those are not parameters at all rather than
 * parameters that get validated (§8, §31).
 *
 * ## What this is not
 *
 * The eligibility check here is a courtesy: it avoids queueing a run that will
 * obviously fail. The safety boundary is in the workflow, immediately before
 * the write, because a queued operation can wait while the world changes (§12).
 */

export type StartPreparationOutcome =
  /** An identical change was already prepared; nothing was written again. */
  | { kind: "reused"; preparedChangeId: string; branchName: string; commitSha: string | null }
  /** A matching preparation was already running; the same one is returned. */
  | { kind: "active"; operation: OperationView }
  | { kind: "started"; operation: OperationView }
  | { kind: "failed"; error: OperationFailureCode };

export type StartPreparationParams = {
  projectId: string;
  userId: string;
  /** Must belong to the project's current opportunity set. */
  opportunityId: string;
};

type ResolvedContext = {
  opportunitySetId: string;
  opportunityId: string;
  repositorySnapshotId: string;
  baseSha: string;
  identity: string;
};

/**
 * Resolves the execution context from server state alone, or says why not.
 *
 * The HEAD read is deliberately *not* here: this runs inside an HTTP request,
 * and the base commit is re-read in the workflow anyway. Using the snapshot's
 * analyzed commit keeps the identity stable for a given analyzed state, and
 * the workflow refuses if the live HEAD has moved away from it.
 */
async function resolveContext(
  supabase: SupabaseClient,
  params: StartPreparationParams,
): Promise<{ ok: true; context: ResolvedContext } | { ok: false; error: OperationFailureCode }> {
  const [snapshot, opportunities, currency] = await Promise.all([
    getLatestSuccessfulSnapshot(supabase, params.projectId),
    getLatestOpportunities(supabase, params.projectId),
    getAuditCurrency(supabase, params.projectId),
  ]);

  if (!snapshot?.result) return { ok: false, error: "stale_repository_intelligence" };
  if (!opportunities) return { ok: false, error: "unsupported_opportunity" };
  if (opportunities.stale) return { ok: false, error: "stale_opportunity" };
  if (!currency.upToDate) return { ok: false, error: "stale_audit" };

  // The opportunity must belong to *this* project's current set. A caller
  // naming another project's opportunity finds nothing here.
  const opportunity = opportunities.set.opportunities.find((entry) => entry.id === params.opportunityId);
  if (!opportunity) return { ok: false, error: "stale_opportunity" };

  const { data: project } = await supabase
    .from("projects")
    .select("id, production_url")
    .eq("id", params.projectId)
    .maybeSingle();

  const productionUrl = (project as { production_url: string | null } | null)?.production_url ?? null;

  const capability = resolveExecutionCapability({
    opportunity,
    repository: snapshot.result,
    hasProductionOrigin: productionUrl !== null,
  });
  if (!capability.supported) {
    return {
      ok: false,
      error: capability.reason === "unsupported_framework" ? "unsupported_framework" : "unsupported_opportunity",
    };
  }

  if (resolveAppRoot(snapshot.result) === null) {
    return { ok: false, error: "unsupported_repository_layout" };
  }
  if (productionUrl === null) return { ok: false, error: "missing_required_context" };

  const baseSha = snapshot.result.source.commitSha;

  return {
    ok: true,
    context: {
      opportunitySetId: opportunities.set.id,
      opportunityId: opportunity.id,
      repositorySnapshotId: snapshot.id,
      baseSha,
      identity: computeExecutionIdentity({
        projectId: params.projectId,
        opportunitySetId: opportunities.set.id,
        opportunityId: opportunity.id,
        capability: capability.capability,
        capabilityVersion: NEXTJS_SEO_FOUNDATIONS_VERSION,
        repositorySnapshotId: snapshot.id,
        baseSha,
      }),
    },
  };
}

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

export async function startChangePreparation(
  supabase: SupabaseClient,
  executor: OperationExecutor,
  params: StartPreparationParams,
): Promise<StartPreparationOutcome> {
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", params.projectId)
    .eq("user_id", params.userId)
    .maybeSingle();

  if (!project) return { kind: "failed", error: "project_not_found" };

  const resolved = await resolveContext(supabase, params);
  if (!resolved.ok) return { kind: "failed", error: resolved.error };
  const { context } = resolved;

  // Cheapest answer first: this exact change is already prepared, on a branch
  // that still exists. Preparing it again would create a second identical
  // branch for nothing.
  const reusable = await findReusablePreparedChange(supabase, {
    projectId: params.projectId,
    executionIdentity: context.identity,
  });
  if (reusable) {
    return {
      kind: "reused",
      preparedChangeId: reusable.id,
      branchName: reusable.branchName,
      commitSha: reusable.commitSha,
    };
  }

  const alreadyActive = await findActiveOperationByIdentity(supabase, {
    projectId: params.projectId,
    operationType: "change_preparation",
    inputIdentity: context.identity,
  });
  if (alreadyActive) return { kind: "active", operation: view(alreadyActive) };

  const created = await createOperationRun(supabase, {
    projectId: params.projectId,
    userId: params.userId,
    operationType: "change_preparation",
    inputIdentity: context.identity,
    subjectId: context.opportunityId,
  });

  if (!created.ok) {
    if (created.error === "already_active") {
      // Lost the race by milliseconds — the other click's operation is the
      // right answer, not an error (§14).
      const existing = await findActiveOperationByIdentity(supabase, {
        projectId: params.projectId,
        operationType: "change_preparation",
        inputIdentity: context.identity,
      });
      if (existing) return { kind: "active", operation: view(existing) };
    }
    return { kind: "failed", error: "change_preparation_failed" };
  }

  const operation = created.operation;
  const started = await executor.start({
    operationId: operation.id,
    operationType: "change_preparation",
  });

  if (!started.ok) {
    // The row exists but nothing is carrying it. Failing it immediately keeps
    // the identity free so the user can simply try again.
    await failOperationRun(supabase, {
      operationId: operation.id,
      failureCode: "execution_start_failed",
    });
    return { kind: "failed", error: "execution_start_failed" };
  }

  await attachExecutionRun(supabase, {
    operationId: operation.id,
    workflowRunId: started.runId,
    executionProvider: executor.name,
  });

  await recordAuditEvent(supabase, {
    userId: params.userId,
    eventType: "operation.started",
    metadata: {
      projectId: params.projectId,
      operationId: operation.id,
      operationType: "change_preparation",
      opportunityId: context.opportunityId,
      // Recorded so support can find the branch without a GitHub search. It is
      // derived from the identity, never from opportunity text.
      branchName: branchNameFor(context.identity),
    },
  });

  return { kind: "started", operation: view(operation) };
}

/** Status for polling (§19). Ownership is the query. */
export async function getChangePreparationStatus(
  supabase: SupabaseClient,
  params: { projectId: string; operationId: string },
): Promise<(OperationView & { preparedChangeId: string | null }) | null> {
  const operation = await getOperationRun(supabase, params);
  if (!operation) return null;

  return { ...view(operation), preparedChangeId: operation.resultId };
}

/**
 * The bounded prepared-change read (§20).
 *
 * References and file paths only. No diff: fetching repository content for
 * review belongs to Sprint 9C, and returning it here would quietly make
 * Supabase a source-code mirror.
 */
export type PreparedChangeView = {
  id: string;
  status: StoredPreparedChange["status"];
  branchName: string;
  baseBranch: string;
  baseSha: string;
  commitSha: string | null;
  filePaths: string[];
  failureCode: OperationFailureCode | null;
  completedAt: string | null;
};

export async function getPreparedChangeView(
  supabase: SupabaseClient,
  params: { projectId: string; preparedChangeId: string },
): Promise<PreparedChangeView | null> {
  const prepared = await getPreparedChange(supabase, params);
  if (!prepared) return null;

  return {
    id: prepared.id,
    status: prepared.status,
    branchName: prepared.branchName,
    baseBranch: prepared.baseBranch,
    baseSha: prepared.baseSha,
    commitSha: prepared.commitSha,
    filePaths: prepared.files.map((file) => file.path),
    failureCode: prepared.failureCode,
    completedAt: prepared.completedAt,
  };
}
