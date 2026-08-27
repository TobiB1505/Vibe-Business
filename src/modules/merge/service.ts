import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { findActiveApprovalForCurrentArtifact } from "@/modules/approvals/service";
import { recordAuditEvent } from "@/modules/audit-log/events";
import { getPreparedChange } from "@/modules/execution/store";
import type { OperationExecutor } from "@/modules/operations/executor";
import {
  attachExecutionRun,
  createOperationRun,
  failOperationRun,
  findActiveOperationByIdentity,
  type StoredOperationRun,
} from "@/modules/operations/store";
import { buildOperationView, type OperationView } from "@/modules/operations/view";
import type { MergeApprovedChangePort } from "./git-port";
import { computeMergeIdentity } from "./identity";
import { mergeFailureMessage } from "./messages";
import { runMergePreflight, type MergePreflightResult } from "./preflight";
import {
  FAST_FORWARD_EXACT_COMMIT,
  MERGE_POLICY_VERSION,
  type MergeFailureCode,
} from "./schema";
import {
  UNKNOWN_LAST_REASON,
  createChangeMerge,
  findLastNotEligibleReason,
  getLatestMergeForPreparedChange,
} from "./store";
import { buildMergeCard, type MergeCard } from "./view";

import { liveConnections } from "@/modules/projects/repository-connection";
/**
 * Requesting and observing a merge (Sprint 11C §14, §16, §17, §18).
 *
 * ## What the client is allowed to say
 *
 * Three identifiers and a boolean: which project, which prepared change, which
 * approval, and *yes I confirmed*.
 *
 * It cannot name the default branch, the base SHA, the target SHA, the
 * repository, the owner, the installation, the branch name or the merge
 * strategy. Not because those are validated and rejected — because there is no
 * parameter to put them in (§14). A caller who could name the target SHA could
 * move a default branch to bytes no human ever approved, which is the entire
 * threat model of this sprint in one sentence.
 *
 * The approval id it *does* send is checked against the one the server resolves
 * from artifact identity, so a stale tab cannot authorize a merge with an
 * approval of something else.
 *
 * ## Why this is durable, when approval was not
 *
 * Approval is one database transaction with no external side effect. A merge is
 * a consequential external write, followed by an independent read-back, a
 * database convergence and an audit event — four things that must not depend on
 * the initiating request staying open (ADR 0013, §18). If the browser closes
 * mid-merge, the default branch does not get half-moved and forgotten.
 */

export type MergeTarget = {
  repositoryConnectionId: string;
  installationId: number;
  owner: string;
  repo: string;
};

/**
 * The repository a merge would write to, resolved from the connection row.
 *
 * The connection's stored `default_branch` is deliberately **not** returned:
 * every merge decision uses the branch GitHub reports now, and having a stale
 * name in scope is how it eventually gets used.
 */
export async function resolveMergeTarget(
  supabase: SupabaseClient,
  projectId: string,
): Promise<MergeTarget | null> {
  const { data } = await liveConnections(supabase, "id, owner, name, github_installation_id")
    .eq("project_id", projectId)
    .maybeSingle();

  // The boundary widens the select string, so the row shape is stated here
  // rather than inferred — see `projects/repository-connection.ts`.
  const connection = data as {
    id: string;
    owner: string;
    name: string;
    github_installation_id: string;
  } | null;
  if (!connection) return null;

  const { data: installation } = await supabase
    .from("github_installations")
    .select("installation_id")
    .eq("id", connection.github_installation_id)
    .maybeSingle();

  if (!installation) return null;

  return {
    repositoryConnectionId: connection.id,
    installationId: installation.installation_id,
    owner: connection.owner,
    repo: connection.name,
  };
}

/**
 * Runs the merge preflight against live GitHub state (§9).
 *
 * Shared by the read-only card and by the durable write step, so the two can
 * never drift into checking different things. What differs between them is not
 * the checks — it is *when* they run and what they are allowed to authorize.
 */
export async function evaluateMergeEligibility(
  supabase: SupabaseClient,
  port: MergeApprovedChangePort,
  params: { projectId: string; preparedChangeId: string },
): Promise<{
  result: MergePreflightResult;
  approvalId: string | null;
  /**
   * What the two sides were, whatever the verdict.
   *
   * Returned alongside the result rather than folded into it: `MergePreflightResult`
   * is shared with the durable write step, where a blocked outcome deliberately
   * carries nothing but a reason. These are for *describing* a refusal, never for
   * acting on one.
   */
  observedDefaultHead: string | null;
  targetSha: string | null;
}> {
  const prepared = await getPreparedChange(supabase, {
    projectId: params.projectId,
    preparedChangeId: params.preparedChangeId,
  });

  const unresolved = { approvalId: null, observedDefaultHead: null, targetSha: null } as const;

  if (!prepared || prepared.status !== "prepared" || !prepared.commitSha) {
    return { ...unresolved, result: { outcome: "blocked", reason: "merge_approval_required" } };
  }

  const approval = await findActiveApprovalForCurrentArtifact(supabase, params);
  if (!approval) {
    // No live GitHub read at all in this branch. Merging is not on the table
    // until a human has decided, so the round trip would be spent learning
    // something nobody can act on.
    return { ...unresolved, result: { outcome: "blocked", reason: "merge_approval_required" } };
  }

  const targetSha = approval.preparedCommitSha;

  // Four reads, issued together. None of them is billed and none of them
  // writes; what they cost is latency and rate-limit budget, which is why they
  // only happen for a change a human has already approved.
  const [defaultBranch, preparedBranchHead, preparedCommitParents, hasContentsWritePermission] =
    await Promise.all([
      port.getDefaultBranch(),
      port.getBranchHead(prepared.branchName),
      port.getCommitParents(targetSha),
      port.hasContentsWritePermission(),
    ]);

  return {
    approvalId: approval.id,
    observedDefaultHead: defaultBranch?.commitSha ?? null,
    targetSha,
    result: runMergePreflight({
      approval: {
        id: approval.id,
        status: approval.status,
        preparedChangeId: approval.preparedChangeId,
        preparedCommitSha: approval.preparedCommitSha,
        preparedBaseSha: approval.preparedBaseSha,
      },
      prepared: {
        id: prepared.id,
        branchName: prepared.branchName,
        commitSha: prepared.commitSha,
        baseSha: prepared.baseSha,
      },
      probe: {
        defaultBranch,
        preparedBranchHead,
        preparedCommitParents,
        hasContentsWritePermission,
      },
    }),
  };
}

export type StartMergeParams = {
  projectId: string;
  userId: string;
  preparedChangeId: string;
  /**
   * The approval the human believes they are acting on.
   *
   * Checked against the server's own resolution, never trusted as authority —
   * the same discipline the approval action applies to its review artifact id.
   */
  changeApprovalId: string;
  /** The explicit merge confirmation. The dialog is not what authorizes this (§16). */
  confirmed: boolean;
};

export type StartMergeOutcome =
  /** Durable merge work is now enqueued. */
  | { kind: "started"; operation: OperationView; changeMergeId: string }
  /** A merge of this exact artifact is already running; the same one is returned. */
  | { kind: "active"; operation: OperationView }
  | { kind: "blocked"; reason: MergeFailureCode };

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

async function ownsProject(
  supabase: SupabaseClient,
  params: { projectId: string; userId: string },
): Promise<boolean> {
  const { data } = await supabase
    .from("projects")
    .select("id")
    .eq("id", params.projectId)
    .eq("user_id", params.userId)
    .maybeSingle();

  return Boolean(data);
}

/**
 * Starts a durable merge (§16, §18, §20).
 *
 * A sequence of refusals before it is a sequence of actions, and the first
 * refusal happens before any state is read at all:
 *
 *   confirmed? → own the project? → repository connected? → approved exactly?
 *   → GitHub still agrees? → identical merge live? → claim → enqueue
 *
 * **Nothing in this function writes to GitHub.** The preflight it runs is
 * read-only and authorizes nothing — the durable step re-runs every critical
 * check immediately before the write, because between this call and that step
 * there is a queue (§17).
 */
export async function startMerge(
  supabase: SupabaseClient,
  executor: OperationExecutor,
  port: MergeApprovedChangePort,
  params: StartMergeParams,
): Promise<StartMergeOutcome> {
  // First, and before any read that could be mistaken for progress. An
  // unconfirmed call must leave nothing behind: no row, no operation, no audit
  // event, no GitHub request (§16).
  if (!params.confirmed) return { kind: "blocked", reason: "merge_confirmation_required" };

  if (!(await ownsProject(supabase, params))) {
    // The same answer for "no such project" and "not yours".
    return { kind: "blocked", reason: "merge_not_authorized" };
  }

  const target = await resolveMergeTarget(supabase, params.projectId);
  if (!target) return { kind: "blocked", reason: "merge_repository_unavailable" };

  const { result, approvalId } = await evaluateMergeEligibility(supabase, port, params);

  if (approvalId === null) return { kind: "blocked", reason: "merge_approval_required" };

  // The client's idea of what authorized this must match the server's. A stale
  // tab holding a revoked approval's id is exactly the "merged on the strength
  // of the wrong decision" failure this sprint exists to prevent.
  if (params.changeApprovalId !== approvalId) {
    return { kind: "blocked", reason: "merge_approval_invalid" };
  }

  if (result.outcome !== "eligible") {
    const reason: MergeFailureCode =
      result.outcome === "already_applied" ? "merge_repository_changed" : result.reason;

    // Recorded as an event rather than a row: a request refused at the door
    // never touched GitHub and never became an attempt, so inventing a
    // ChangeMerge for it would put junk in the table that documents writes.
    await recordAuditEvent(supabase, {
      userId: params.userId,
      eventType: "change_merge.blocked",
      metadata: {
        project_id: params.projectId,
        prepared_change_id: params.preparedChangeId,
        change_approval_id: approvalId,
        failure_code: reason,
        merge_policy_version: MERGE_POLICY_VERSION,
      },
    });

    return { kind: "blocked", reason };
  }

  const mergeIdentity = computeMergeIdentity({
    projectId: params.projectId,
    preparedChangeId: params.preparedChangeId,
    changeApprovalId: approvalId,
    preparedCommitSha: result.targetSha,
    preparedBaseSha: result.observedDefaultHead,
    mergePolicyVersion: MERGE_POLICY_VERSION,
  });

  // Already happening. Returning the live operation is the honest answer to a
  // double click, not an error (§20).
  const alreadyActive = await findActiveOperationByIdentity(supabase, {
    projectId: params.projectId,
    operationType: "change_merge",
    inputIdentity: mergeIdentity,
  });
  if (alreadyActive) return { kind: "active", operation: view(alreadyActive) };

  const created = await createOperationRun(supabase, {
    projectId: params.projectId,
    userId: params.userId,
    operationType: "change_merge",
    inputIdentity: mergeIdentity,
    initiatedBy: "customer",
  });

  if (!created.ok) {
    if (created.error === "already_active") {
      const existing = await findActiveOperationByIdentity(supabase, {
        projectId: params.projectId,
        operationType: "change_merge",
        inputIdentity: mergeIdentity,
      });
      if (existing) return { kind: "active", operation: view(existing) };
    }
    return { kind: "blocked", reason: "merge_failed" };
  }

  const operation = created.operation;

  const merge = await createChangeMerge(supabase, {
    projectId: params.projectId,
    userId: params.userId,
    preparedChangeId: params.preparedChangeId,
    changeApprovalId: approvalId,
    repositoryConnectionId: target.repositoryConnectionId,
    preparedCommitSha: result.targetSha,
    preparedBaseSha: result.observedDefaultHead,
    defaultBranch: result.defaultBranch,
    mergePolicyVersion: MERGE_POLICY_VERSION,
    mergeStrategy: FAST_FORWARD_EXACT_COMMIT,
    mergeIdentity,
    operationRunId: operation.id,
  });

  if (!merge.ok) {
    // Either the row already exists as writing/written, or RLS refused the
    // linkage. Either way nothing should be carrying this operation, and
    // failing it now releases the identity so a later attempt is possible.
    await failOperationRun(supabase, {
      operationId: operation.id,
      failureCode: merge.error === "already_written" ? "merge_failed" : "merge_failed",
    });
    return { kind: "blocked", reason: "merge_failed" };
  }

  const started = await executor.start({ operationId: operation.id, operationType: "change_merge" });

  if (!started.ok) {
    await failOperationRun(supabase, {
      operationId: operation.id,
      failureCode: "execution_start_failed",
    });
    return { kind: "blocked", reason: "merge_provider_unavailable" };
  }

  await attachExecutionRun(supabase, {
    operationId: operation.id,
    workflowRunId: started.runId,
    executionProvider: executor.name,
  });

  await recordAuditEvent(supabase, {
    userId: params.userId,
    eventType: "change_merge.requested",
    metadata: {
      project_id: params.projectId,
      prepared_change_id: params.preparedChangeId,
      change_approval_id: approvalId,
      change_merge_id: merge.merge.id,
      operation_id: operation.id,
      default_branch: result.defaultBranch,
      // Both SHAs, because "what would move from where to where" is the whole
      // content of a default-branch write. Public content identifiers, never
      // credentials.
      base_sha: result.observedDefaultHead,
      target_sha: result.targetSha,
      merge_strategy: FAST_FORWARD_EXACT_COMMIT,
      merge_policy_version: MERGE_POLICY_VERSION,
    },
  });

  return {
    kind: "started",
    operation: view(operation),
    changeMergeId: merge.merge.id,
  };
}

/**
 * The merge state for one prepared change (§17).
 *
 * ## What this costs
 *
 * Nothing billed, ever: no sandbox, no browser, no model. For an **approved**
 * change it additionally spends four read-only GitHub calls so the section can
 * say whether the branch is where the approval expects it — which is the whole
 * point of the section, and useless if answered from a stored snapshot. For
 * anything not approved it spends none, because there is nothing a live read
 * could tell a user they could act on.
 *
 * ## What it authorizes
 *
 * Nothing. Even when this returns `ready`, the durable workflow re-runs every
 * critical check immediately before the write. The UI preflight exists so a
 * user is not offered a button that cannot work — never as permission (§17).
 */
export async function getMergeCard(
  supabase: SupabaseClient,
  port: MergeApprovedChangePort,
  params: { projectId: string; userId: string; preparedChangeId: string },
): Promise<MergeCard> {
  const [latestMerge, evaluated] = await Promise.all([
    getLatestMergeForPreparedChange(supabase, params),
    evaluateMergeEligibility(supabase, port, params),
  ]);

  const card = buildMergeCard({
    latestMerge,
    eligibility: evaluated.result,
    changeApprovalId: evaluated.approvalId,
    resolveFailureMessage: mergeFailureMessage,
  });

  await recordNotEligibleObservation(supabase, {
    projectId: params.projectId,
    userId: params.userId,
    preparedChangeId: params.preparedChangeId,
    changeApprovalId: evaluated.approvalId,
    observedDefaultHead: evaluated.observedDefaultHead,
    targetSha: evaluated.targetSha,
    card,
  });

  return card;
}

/**
 * Records, at most once per reason, that an approved change cannot be merged.
 *
 * ## The gap this closes
 *
 * `startMerge` records `change_merge.blocked` on every refusal it reaches — but
 * the UI withholds the button when the render-time preflight already says no,
 * so that path is never reached and a drift-refused merge left **no trace at
 * all**. The first real merge dogfood ended exactly there: `main` had moved, the
 * product correctly declined, and nothing anywhere recorded that it had.
 *
 * ## Why the condition is this narrow
 *
 * `not_eligible` is the ordinary resting state of every change nobody has
 * approved yet, so recording it unconditionally would mostly log the absence of
 * a decision. The state worth remembering is the *specific* one:
 *
 * > a human approved these exact bytes, and Vibe currently cannot merge them.
 *
 * That is a fact about a commitment already made, and the only version of this
 * a user would ever go looking for.
 *
 * ## Why it deduplicates
 *
 * Because it runs on a **read**. The project page recomputes this preflight on
 * every render, and an event per render would turn the audit log into a
 * page-view log. Comparing against the last recorded reason yields one event per
 * transition: the first time the change becomes unmergeable, and again only if
 * the reason changes — `merge_repository_changed` becoming
 * `merge_permission_missing` is a different fact and gets its own entry.
 *
 * Two concurrent renders can both observe "nothing recorded" and both write. The
 * result is a duplicate line in an append-only log, which is untidy rather than
 * wrong — and worth strictly less than the write barrier that would prevent it.
 *
 * ## What it never does
 *
 * Change what the user sees. The card is built before this runs and returned
 * unchanged after it; a failed audit write must not turn a correct screen into a
 * broken one (ADR 0007).
 */
async function recordNotEligibleObservation(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    userId: string;
    preparedChangeId: string;
    changeApprovalId: string | null;
    observedDefaultHead: string | null;
    targetSha: string | null;
    card: MergeCard;
  },
): Promise<void> {
  const { card } = params;

  // Not blocked, not approved, or blocked for no stated reason — nothing here
  // is a fact about a commitment.
  if (card.state !== "not_eligible") return;
  if (!params.changeApprovalId) return;
  if (!card.failureCode) return;

  const lastReason = await findLastNotEligibleReason(supabase, {
    projectId: params.projectId,
    preparedChangeId: params.preparedChangeId,
  });

  // Already recorded, or the read failed and silence is the safe answer.
  if (lastReason === card.failureCode || lastReason === UNKNOWN_LAST_REASON) return;

  await recordAuditEvent(supabase, {
    userId: params.userId,
    // Stated explicitly rather than inferred from the payload, because the
    // deduplicating read now filters on the column (ADR 0056 §8).
    projectId: params.projectId,
    eventType: "change_merge.not_eligible",
    metadata: {
      project_id: params.projectId,
      prepared_change_id: params.preparedChangeId,
      change_approval_id: params.changeApprovalId,
      failure_code: card.failureCode,
      merge_policy_version: MERGE_POLICY_VERSION,
      // What the branch was doing when Vibe declined. Both are public content
      // identifiers, and without them the entry cannot say what "changed".
      observed_default_head_sha: params.observedDefaultHead,
      approved_commit_sha: params.targetSha,
    },
  });
}

export type { MergeCard };
