import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getLatestCompletedActionPlan } from "../action-plans/store";
import { getAuditCurrency } from "../business-audit/service";
import { getLatestApprovalsForPreparedChanges } from "../approvals/store";
import type { ChangeStage } from "../execution/change-progress";
import { listPreparedChangesForProject } from "../execution/store";
import { getLatestMergesForPreparedChanges } from "../merge/store";
import { getLastFailedOperation } from "../operations/service";
import { findActiveOperation } from "../operations/store";
import type { StoredOperationRun } from "../operations/store";
import type { OperationType } from "../operations/schema";
import { buildOperationView } from "../operations/view";
import type { OperationView } from "../operations/view";
import { getLatestOpportunities } from "../opportunities/service";
import { getLatestVerificationsForPreparedChanges } from "../outcome-verification/store";
import { liveConnections } from "../projects/repository-connection";
import { getLatestSuccessfulSnapshot } from "../repository-intelligence/store";
import { getLatestValidationsForPreparedChanges } from "../validation/store";
import { resolveProjectValidationTarget } from "../validation/workspace-store";
import { deriveNovaFocus } from "./focus";
import type { NovaChangeFact, NovaFocus, NovaFocusFacts, NovaQuestionFact } from "./focus";

/**
 * The I/O half of Nova's focus: gather the facts, then let `focus.ts` rank them.
 *
 * ## What this is allowed to cost
 *
 * A constant number of Supabase queries, **no network call of any kind**, and
 * the anon-key client — never the service role, whose whole purpose is
 * bypassing the ownership rule this read depends on (rule 53). Nothing here
 * touches GitHub, a sandbox provider, a preview, or a model.
 *
 * The property under test is not the absolute query count — a later candidate
 * needing another table would legitimately move it — it is that **eight
 * prepared changes cost what one costs**. That is the same bound
 * `execution/workspace.test.ts` holds its own read model to, and the reason
 * every lifecycle read below is a batched `…ForPreparedChanges`.
 *
 * ## Why it does not call `deriveChangeProgress`
 *
 * `deriveChangeProgress` is the authority on what stage a change is in, and it
 * needs eight inputs. Three of them — the preview card, the review card, the
 * review classification — exist to separate `reviewing` from `review_required`
 * from `review_unavailable` from `awaiting_approval`, and reaching them means
 * GitHub reads, a sandbox provider and signed URLs
 * (`execution/workspace.ts:410-474`). Nova collapses all four of those stages
 * into one candidate, `review_change`, because they are one sentence to a
 * founder: *there is a change here for you to look at*.
 *
 * So calling it would mean paying for network evidence in order to compute a
 * distinction that is discarded on the next line — or passing three stub cards
 * and letting the call site *look* like it used the real derivation when three
 * of its inputs were invented. `stageFromRows` below is the honest third
 * option: the same precedence, over the rows that decide the stages Nova can
 * actually tell apart, and a documented list of the ones it never produces.
 *
 * ## What this still does not read
 *
 * `executableStep` alone, and for the original reason: whether Vibe can build
 * a plan step is `resolvePlanExecutionRoutes`'s answer, and it performs a live
 * website preflight. The offer is computed where that call is already being
 * made, and handed in rather than fetched here.
 *
 * The other two — `repositoryReadOutdated` and `workspaceChoiceRequired` —
 * were fixed false on the same assumption and it turned out to be wrong for
 * them: their resolver is pure over a stored snapshot. They are read below.
 */

/**
 * The operation types whose progress Nova reports.
 *
 * Read individually rather than with one `.in("operation_type", …)` because no
 * such read exists in this codebase and inventing one here would be a second
 * way to query a table eight modules already query one way
 * (`operations/store.ts:122`). Constant either way: the list is fixed.
 */
const WATCHED_OPERATIONS: readonly OperationType[] = [
  "product_scan",
  "business_audit",
  "opportunity_generation",
  "action_planning",
  "agent_execution",
  "change_merge",
];

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

/**
 * The stage of one change, from the rows that settle it.
 *
 * The precedence is `deriveChangeProgress`'s own, read from the far end
 * backwards: a merge that landed outranks one in flight, which outranks a
 * refusal, which outranks an approval, which outranks the validation gate.
 * Changing the order here without changing it there would give a founder two
 * different answers about one change on two screens.
 *
 * **Three stages this never produces:** `reviewing`, `review_required` and
 * `review_unavailable`. Deciding between them needs the review evidence this
 * module may not fetch, and Nova maps all three to the same candidate as
 * `awaiting_approval`, which is what it returns in their place. No candidate is
 * lost; only a distinction Nova does not draw.
 *
 * `not_validated` is returned rather than smoothed over, and it matters: it is
 * the one stage that must never read as reviewable, because a change nothing
 * has checked is not a change to look at yet.
 */
export function stageFromRows(input: {
  /** Null before a preparation has written one. Nothing can be approved then. */
  commitSha: string | null;
  validationStatus: "queued" | "running" | "passed" | "failed" | "cancelled" | null;
  approval: { status: "approved" | "revoked" | "invalidated"; preparedCommitSha: string } | null;
  mergeStatus: "preflight" | "merging" | "merged" | "blocked" | "failed" | null;
  outcomeStatus: string | null;
}): ChangeStage {
  if (input.mergeStatus === "merged") {
    const settled =
      input.outcomeStatus === "verified" ||
      input.outcomeStatus === "partial" ||
      input.outcomeStatus === "not_observed" ||
      input.outcomeStatus === "failed";
    return settled ? "observed" : "merged";
  }

  if (input.mergeStatus === "merging" || input.mergeStatus === "preflight") return "merging";
  if (input.mergeStatus === "blocked" || input.mergeStatus === "failed") return "stalled";

  /*
   * An approval is Nova's routing signal, never its permission (rule 55). The
   * comparison is deliberately narrower than `approvals/service.ts`'s identity
   * check, which also binds the validation run, the review artifact and the
   * policy version: this says only that a human said yes to *this commit* and
   * has not withdrawn it. Where the fuller check would refuse, the merge action
   * re-derives it and refuses there — the founder loses a click, never a
   * guarantee, and no write happens on the strength of this line.
   */
  if (
    input.commitSha !== null &&
    input.approval?.status === "approved" &&
    input.approval.preparedCommitSha === input.commitSha
  ) {
    return "ready_to_merge";
  }

  if (input.validationStatus === "failed") return "validation_failed";
  if (input.validationStatus === "queued" || input.validationStatus === "running") {
    return "validating";
  }
  if (input.validationStatus === null || input.validationStatus === "cancelled") {
    return "not_validated";
  }

  return "awaiting_approval";
}

async function readChangeFacts(
  supabase: SupabaseClient,
  projectId: string,
): Promise<NovaChangeFact[]> {
  const prepared = await listPreparedChangesForProject(supabase, projectId);
  /* A project with no prepared changes asks the four lifecycle tables nothing. */
  if (prepared.length === 0) return [];

  const scope = { projectId, preparedChangeIds: prepared.map((change) => change.id) };
  const [validations, approvals, merges, outcomes] = await Promise.all([
    getLatestValidationsForPreparedChanges(supabase, scope),
    getLatestApprovalsForPreparedChanges(supabase, scope),
    getLatestMergesForPreparedChanges(supabase, scope),
    getLatestVerificationsForPreparedChanges(supabase, scope),
  ]);

  return prepared.map((change) => {
    const approval = approvals.get(change.id) ?? null;
    const stage = stageFromRows({
      commitSha: change.commitSha,
      validationStatus: validations.get(change.id)?.status ?? null,
      approval:
        approval === null
          ? null
          : { status: approval.status, preparedCommitSha: approval.preparedCommitSha },
      mergeStatus: merges.get(change.id)?.status ?? null,
      outcomeStatus: outcomes.get(change.id)?.status ?? null,
    });

    return { preparedChangeId: change.id, stage, headline: change.branchName };
  });
}

/**
 * Whether Vibe can still reach the repository at all.
 *
 * `liveConnections` filters `detached_at is null`, so an absent row is either
 * a project whose connection was detached or one that never had one. Both
 * mean the same thing for everything downstream — there is nothing to read,
 * nothing to build and nothing to merge into — and the recovery is the same
 * flow, so they are one candidate rather than two.
 *
 * Account-level access revocation (`github_installations.access_revoked_at`)
 * is a second way to lose the same thing, and it is not read here: it needs a
 * user id this function does not take, and adding one would widen a
 * project-scoped read into an account-scoped one for a fact whose recovery is
 * already offered. Named so the gap is deliberate rather than overlooked.
 */
async function readSourceDisconnected(
  supabase: SupabaseClient,
  projectId: string,
): Promise<boolean> {
  const { data, error } = await liveConnections(supabase, "id")
    .eq("project_id", projectId)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data === null;
}

/**
 * The last attempt of each kind, when it failed and nothing succeeded after.
 *
 * `getLastFailedOperation` returns the latest run only if that run failed, so
 * a failure the founder already recovered from reports nothing. Three kinds
 * rather than one flag, because the recovery differs by kind and one of them
 * costs 35 Credits — a single "something failed" would have had to hide that.
 */
async function readFailedOperations(
  supabase: SupabaseClient,
  projectId: string,
): Promise<{ agent: boolean; scan: boolean; audit: boolean }> {
  const [agent, scan, audit] = await Promise.all([
    getLastFailedOperation(supabase, { projectId, operationType: "agent_execution" }),
    getLastFailedOperation(supabase, { projectId, operationType: "product_scan" }),
    getLastFailedOperation(supabase, { projectId, operationType: "business_audit" }),
  ]);

  return { agent: agent !== null, scan: scan !== null, audit: audit !== null };
}

/**
 * The two Stage-4 facts, from the resolver that owns them.
 *
 * Both were fixed at false until Stage 4 merged, on the belief that answering
 * them needed the network. It does not: `resolveValidationProfile` is pure
 * over a stored snapshot, and `resolveProjectValidationTarget` adds one
 * conditional read of the founder's stored answer — and only when the question
 * is choice-shaped, so a single-application project never pays for it. The
 * website preflight that *does* reach the network belongs to
 * `resolvePlanExecutionRoutes`, which is a different question and still not
 * asked here.
 *
 * **No snapshot is not an outdated one.** A project Vibe has never read is not
 * a project whose reading is stale, and telling that founder their code has
 * moved on would be a sentence about a reading that does not exist. Onboarding
 * owns the never-scanned case; this returns both facts false.
 */
async function readValidationTargetFacts(
  supabase: SupabaseClient,
  projectId: string,
): Promise<{ repositoryReadOutdated: boolean; workspaceChoiceRequired: boolean }> {
  const snapshot = await getLatestSuccessfulSnapshot(supabase, projectId);
  if (!snapshot?.result) {
    return { repositoryReadOutdated: false, workspaceChoiceRequired: false };
  }

  const target = await resolveProjectValidationTarget(supabase, {
    projectId,
    snapshot: snapshot.result,
  });
  if (target.supported) {
    return { repositoryReadOutdated: false, workspaceChoiceRequired: false };
  }

  return {
    repositoryReadOutdated: target.reason === "repository_analysis_outdated",
    /*
     * After narrowing. A founder who has already answered is not asked again —
     * `selectValidationTarget` applies their stored choice inside the resolver,
     * and re-deriving the question here would ignore it.
     */
    workspaceChoiceRequired: target.reason === "workspace_choice_required",
  };
}

/**
 * Every open question about this project, whoever is waiting on the answer.
 *
 * Read here rather than through `listFounderInputRequestsForPlan`, which
 * filters on `action_plan_id` — and the RPC that records an agent's own
 * question writes that column null
 * (`20260826090158_fix_runtime_founder_input_rpc_ambiguity.sql:59-70`). Reusing
 * the plan-scoped read would have made `agent_question` structurally
 * unreachable: a candidate that can never be raised, and a founder whose agent
 * is waiting on them with nothing on screen to say so.
 */
async function readQuestionFacts(
  supabase: SupabaseClient,
  projectId: string,
  stepOrderByKey: ReadonlyMap<string, number>,
): Promise<NovaQuestionFact[]> {
  const { data, error } = await supabase
    .from("project_founder_input_requests")
    .select("id, question, origin, action_plan_step_key")
    .eq("project_id", projectId)
    .eq("status", "open")
    .order("created_at", { ascending: true });

  if (error) throw error;

  return (data ?? []).map((row) => {
    const request = row as {
      id: string;
      question: string;
      origin: NovaQuestionFact["origin"];
      action_plan_step_key: string | null;
    };

    return {
      founderInputRequestId: request.id,
      question: request.question,
      origin: request.origin,
      stepOrder:
        request.action_plan_step_key === null
          ? null
          : (stepOrderByKey.get(request.action_plan_step_key) ?? null),
    };
  });
}

export async function readNovaFocusFacts(
  supabase: SupabaseClient,
  projectId: string,
): Promise<NovaFocusFacts> {
  const [
    changes,
    opportunities,
    plan,
    auditCurrency,
    operations,
    validationTarget,
    sourceDisconnected,
    failedOperations,
  ] = await Promise.all([
    readChangeFacts(supabase, projectId),
    getLatestOpportunities(supabase, projectId),
    getLatestCompletedActionPlan(supabase, projectId),
    getAuditCurrency(supabase, projectId),
    Promise.all(
      WATCHED_OPERATIONS.map((operationType) =>
        findActiveOperation(supabase, { projectId, operationType }),
      ),
    ),
    readValidationTargetFacts(supabase, projectId),
    readSourceDisconnected(supabase, projectId),
    readFailedOperations(supabase, projectId),
  ]);

  const stepOrderByKey = new Map((plan?.steps ?? []).map((step) => [step.id, step.order] as const));
  const questions = await readQuestionFacts(supabase, projectId, stepOrderByKey);

  const moves = (opportunities?.set.opportunities ?? []).map((move) => ({
    id: move.id,
    rank: move.rank,
    title: move.title,
  }));

  /*
   * The freshest of whatever is running. A project can have a scan and a merge
   * in flight at once; Nova reports one, and the newest is the one the founder
   * just started.
   */
  const running = operations
    .filter((operation): operation is StoredOperationRun => operation !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return {
    sourceDisconnected,
    failedOperations,
    changes,
    questions,
    moves,
    plannedMoveId: plan?.opportunityId ?? null,
    /* Needs the execution resolver, which reaches the network. §L Slice 6. */
    executableStep: null,
    planOffered: plan === null && moves.length > 0,
    /*
     * `hasAudit` guards the honest reading of `upToDate`: a project with no
     * audit at all is not one whose audit is out of date, and telling a founder
     * to refresh something that was never run is the kind of false statement
     * rule 44 exists to keep out of a missing measurement.
     */
    auditOutdated: auditCurrency.hasAudit && !auditCurrency.upToDate,
    repositoryReadOutdated: validationTarget.repositoryReadOutdated,
    workspaceChoiceRequired: validationTarget.workspaceChoiceRequired,
    working: running.length > 0 ? view(running[0]) : null,
  };
}

export async function readNovaFocus(
  supabase: SupabaseClient,
  projectId: string,
): Promise<NovaFocus> {
  return deriveNovaFocus(await readNovaFocusFacts(supabase, projectId));
}
