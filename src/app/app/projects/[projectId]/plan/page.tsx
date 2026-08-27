import { WorkspaceSection, projectSectionHref } from "@/components/layout/project-shell";
import { buildBranchUrl } from "@/modules/execution/diff";
import {
  getActivePreparationFor,
  getLatestFailedPreparationFor,
  getOpportunityExecutionSummaries,
} from "@/modules/execution/service";
import { buildOpportunityActionState } from "@/modules/execution/view";
import {
  MOVES_CONTEXT_PARAM,
  resolveMovesContext,
} from "@/modules/opportunities/lineage";
import {
  getLatestOpportunities,
  getMoveLineage,
  getOpportunityReadiness,
} from "@/modules/opportunities/service";
import {
  getActiveActionPlanOperation,
  getActiveOpportunityOperation,
} from "@/modules/operations/service";
import { OPERATION_FAILURE_MESSAGES } from "@/modules/operations/messages";
import { requireProjectAccess } from "@/modules/projects/workspace-context";
import { getActionPlanReadiness, getLatestActionPlan } from "@/modules/action-plans/service";
import {
  defaultPlannedOpportunity,
  PLAN_OPPORTUNITY_PARAM,
  resolveRequestedOpportunity,
  sanitizeRequestedOpportunityId,
} from "@/modules/action-plans/source";
import { SANDBOX_POLICY_VERSION } from "@/modules/validation/schema";
import { getLatestValidation } from "@/modules/validation/service";
import { buildValidationSummary } from "@/modules/validation/view";
import type { ValidationSummary } from "../validation-panel";
import { ActionPlanWorkspace } from "./action-plan-workspace";
import { MovesRefreshBar } from "./moves-refresh-bar";

/**
 * The Action Plan (Sprint UI-2 Part 2; rebuilt as a workspace in ACTION PLAN UI-2).
 *
 * ## The execution state this route does need
 *
 * UI-1 flagged that Moves shares execution state with Prepared, and it does:
 * an opportunity's action state is what decides whether Vibe offers to prepare
 * a change for it, and a prepared change already in flight must show as such
 * rather than as an inviting button.
 *
 * So this route loads execution *summaries* and, per opportunity with one, its
 * validation summary. What it does **not** load is the prepared-change
 * workspace — no preview, no review images, no approval, no merge preflight,
 * no outcome, no impact. Those belong to `/agent`, and this route reaching
 * for them is how the coupling would grow back.
 *
 * ## Why selection has readiness for every Move
 *
 * The horizontal stepper changes focus without a route render. The route
 * therefore resolves the existing readiness contract once per persisted Move
 * in parallel; the browser never derives or invents a readiness state. The
 * `?plan=<id>` parameter still restores an explicit choice after refresh.
 */
export default async function ProjectMovesPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ [MOVES_CONTEXT_PARAM]?: string; [PLAN_OPPORTUNITY_PARAM]?: string }>;
}) {
  const { projectId } = await params;
  const { supabase, project } = await requireProjectAccess(projectId);
  const resolvedSearchParams = await searchParams;

  // A founder's explicit choice of which Move to plan (§83). Absent, this is
  // still unconditionally rank 1 — nothing here changes for the vast majority
  // of visits, which never carry this parameter.
  const requestedOpportunityId = sanitizeRequestedOpportunityId(
    resolvedSearchParams[PLAN_OPPORTUNITY_PARAM],
  );

  const [
    opportunities,
    opportunityReadiness,
    activeOpportunityOperation,
    executionSummaries,
    actionPlanView,
    activeActionPlanOperation,
  ] = await Promise.all([
    getLatestOpportunities(supabase, projectId),
    getOpportunityReadiness(supabase, projectId),
    getActiveOpportunityOperation(supabase, projectId),
    getOpportunityExecutionSummaries(supabase, projectId),
    getLatestActionPlan(supabase, projectId),
    getActiveActionPlanOperation(supabase, projectId),
  ]);

  /*
   * Which Move the Action Plan section is about (§6, §83).
   *
   * Rank 1 by default; a founder's explicit "Plan this Move" link can name a
   * different one, re-resolved against the current set exactly as readiness
   * does — a stale or foreign id degrades to null rather than silently
   * substituting rank 1, so the CTA copy below can never claim to be about a
   * Move it is not.
   */
  const plannedMove = opportunities
    ? resolveRequestedOpportunity(opportunities.set.opportunities, requestedOpportunityId)
    : null;
  const defaultMove = opportunities
    ? defaultPlannedOpportunity(opportunities.set.opportunities)
    : null;

  /*
   * The stepper switches Moves without a route render, so each persisted Move
   * receives the same existing readiness answer up front. These calls run in
   * parallel and do not change readiness semantics; they only prevent the
   * browser from guessing when the founder moves from step 1 to step 2.
   */
  const planReadinessByOpportunity = Object.fromEntries(
    opportunities
      ? await Promise.all(
          opportunities.set.opportunities.map(async (opportunity) => [
            opportunity.id,
            await getActionPlanReadiness(supabase, projectId, opportunity.id),
          ] as const),
        )
      : [],
  );

  /*
   * Which audit finding each Move answers, and which one the founder arrived
   * for (UI-S2 §6, §9, §31).
   *
   * One query for the whole list — the set names its own audit and every
   * conclusion lives inside that one document, so this does not scale with the
   * number of Moves.
   *
   * The requested key is untrusted text and is never used as a lookup. It
   * becomes a context only by matching a key that this project's own Moves
   * cite, so a malformed value, a stale key, or a key belonging to another
   * project all degrade to the ordinary ranked page rather than to an error.
   */
  const lineage = opportunities
    ? await getMoveLineage(supabase, { projectId, set: opportunities.set })
    : {};
  const movesContext = resolveMovesContext({
    requested: resolvedSearchParams[MOVES_CONTEXT_PARAM],
    lineage,
    opportunities: opportunities?.set.opportunities ?? [],
  });

  // Execution state per opportunity, resolved here so the browser renders an
  // answer rather than deciding whether Vibe has an executor (Sprint 9C §2).
  const executionStates: Record<string, ReturnType<typeof buildOpportunityActionState>> = {};
  const branchUrls: Record<string, string> = {};
  // Isolated validation state per prepared change (Sprint 10A §44), resolved
  // server-side for the same reason execution state is: the browser renders an
  // answer, it does not decide what Vibe is willing to run.
  const validationSummaries: Record<string, ValidationSummary> = {};

  /*
   * Three reads per Move, none of which depends on another Move's answer, so
   * the whole grid goes at once rather than in a queue (UI-4 §4). A project
   * with five Moves was paying fifteen sequential round trips for a page that
   * had already resolved its own reads in parallel one block above.
   *
   * The keyed records are filled after the reads land, so an absent Move and
   * an absent validation stay absent — an empty entry and a missing entry are
   * different answers to `OpportunitiesPanel`.
   */
  const resolvedSummaries = await Promise.all(
    executionSummaries.map(async (summary) => {
      const opportunity = opportunities?.set.opportunities.find(
        (entry) => entry.id === summary.opportunityId,
      );
      if (!opportunity) return null;

      const [activeOperation, failedOperation, validation] = await Promise.all([
        getActivePreparationFor(supabase, { projectId, opportunityId: summary.opportunityId }),
        // Without this a failed preparation silently re-offers the start button
        // instead of saying what went wrong.
        getLatestFailedPreparationFor(supabase, {
          projectId,
          opportunityId: summary.opportunityId,
        }),
        summary.preparedChangeId
          ? getLatestValidation(supabase, {
              projectId,
              preparedChangeId: summary.preparedChangeId,
            })
          : null,
      ]);

      return { summary, opportunity, activeOperation, failedOperation, validation };
    }),
  );

  for (const resolved of resolvedSummaries) {
    if (!resolved) continue;
    const { summary, opportunity, activeOperation, failedOperation, validation } = resolved;

    executionStates[summary.opportunityId] = buildOpportunityActionState({
      opportunity,
      capability: summary.capability,
      preparedChangeId: summary.preparedChangeId,
      activeOperation,
      failedOperation,
      blockedReason: null,
    });

    if (summary.branchName && project.repository) {
      branchUrls[summary.opportunityId] = buildBranchUrl(
        project.repository.fullName,
        summary.branchName,
      );
    }

    if (validation) {
      validationSummaries[summary.opportunityId] = buildValidationSummary(validation, {
        currentPolicyVersion: SANDBOX_POLICY_VERSION,
        failureMessage: validation.failureCode
          ? (OPERATION_FAILURE_MESSAGES[validation.failureCode] ?? null)
          : null,
      });
    }
  }

  return (
    <WorkspaceSection
      id="action-plan"
      title="Action Plan"
      description="Your prioritized plan to strengthen your business."
      actions={
        <MovesRefreshBar
          projectId={project.id}
          /* When this set finished, not when the row was created: a queued
             set that has not produced anything must not date the plan. */
          generatedAt={opportunities?.set.completedAt ?? null}
          hasOpportunities={(opportunities?.set.opportunities.length ?? 0) > 0}
          blocked={opportunityReadiness.blockedReason !== null}
        />
      }
    >
      <ActionPlanWorkspace
        projectId={project.id}
        opportunities={opportunities?.set.opportunities ?? []}
        executionStates={executionStates}
        branchUrls={branchUrls}
        validationSummaries={validationSummaries}
        stale={opportunities?.stale ?? false}
        movesOperation={activeOpportunityOperation}
        movesBlockedReason={opportunityReadiness.blockedReason}
        lineage={lineage}
        movesContext={movesContext}
        movesHref={projectSectionHref(project.id, "action-plan")}
        preparedHref={projectSectionHref(project.id, "agent")}
        // Where each blocked state's one way forward leads. Built by the route
        // from `projectSectionHref`, never hard-coded in a panel — the panel
        // does not know what the workspace's segments are called.
        blockedDestinations={{
          product: projectSectionHref(project.id, "my-product"),
          audit: projectSectionHref(project.id, "business-audit"),
          moves: projectSectionHref(project.id, "action-plan"),
          repository: projectSectionHref(project.id, "settings"),
        }}
        selectedOpportunityId={plannedMove?.id ?? null}
        defaultMoveTitle={defaultMove?.title ?? null}
        planReadinessByOpportunity={planReadinessByOpportunity}
        planView={actionPlanView}
        // Project-wide, not scoped to `plannedMove` — `action_planning`
        // operations are keyed by input identity (which does include the
        // Move), so two concurrent runs for two different Moves are possible
        // in principle. This read model predates per-Move selection and does
        // not yet disambiguate that case; it would show whichever run it finds
        // even if it is for a different Move than currently selected. Rare
        // enough (two plan clicks on different Moves within the same run) that
        // it is called out here rather than fixed now.
        planOperation={activeActionPlanOperation}
        planOperationOpportunityId={plannedMove?.id ?? null}
        auditHref={projectSectionHref(project.id, "business-audit")}
        understandingHref={projectSectionHref(project.id, "my-product")}
      />
    </WorkspaceSection>
  );
}
