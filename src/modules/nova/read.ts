import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getLatestCompletedActionPlan } from "../action-plans/store";
import { getAuditCurrency } from "../business-audit/service";
import { getLatestApprovalsForPreparedChanges } from "../approvals/store";
import type { ChangeStage } from "../execution/change-progress";
import { listPreparedChangesForProject } from "../execution/store";
import { getLatestMergesForPreparedChanges } from "../merge/store";
import { findActiveOperation } from "../operations/store";
import type { StoredOperationRun } from "../operations/store";
import type { OperationType } from "../operations/schema";
import { buildOperationView } from "../operations/view";
import type { OperationView } from "../operations/view";
import { getLatestOpportunities } from "../opportunities/service";
import { getLatestVerificationsForPreparedChanges } from "../outcome-verification/store";
import { getLatestValidationsForPreparedChanges } from "../validation/store";
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
 * ## What this slice does not yet read
 *
 * `executableStep`, `repositoryReadOutdated` and `workspaceChoiceRequired` are
 * fixed at their empty values here, and the three candidates that depend on
 * them cannot be raised yet. All three are answers only `resolvePlanExecutionRoutes`
 * can give, and it performs a live website preflight — a network call, which is
 * exactly what this module may not make. They arrive with the slices that
 * render them (§L 5–6), where the offer is being computed anyway.
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
  const [changes, opportunities, plan, auditCurrency, operations] = await Promise.all([
    readChangeFacts(supabase, projectId),
    getLatestOpportunities(supabase, projectId),
    getLatestCompletedActionPlan(supabase, projectId),
    getAuditCurrency(supabase, projectId),
    Promise.all(
      WATCHED_OPERATIONS.map((operationType) =>
        findActiveOperation(supabase, { projectId, operationType }),
      ),
    ),
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
    /* Both are Stage-4 resolver answers, and the resolver reaches the network. */
    repositoryReadOutdated: false,
    workspaceChoiceRequired: false,
    working: running.length > 0 ? view(running[0]) : null,
  };
}

export async function readNovaFocus(
  supabase: SupabaseClient,
  projectId: string,
): Promise<NovaFocus> {
  return deriveNovaFocus(await readNovaFocusFacts(supabase, projectId));
}
