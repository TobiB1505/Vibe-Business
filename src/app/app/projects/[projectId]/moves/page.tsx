import { WorkspaceSection, projectSectionHref } from "@/components/layout/project-shell";
import { buildBranchUrl } from "@/modules/execution/diff";
import {
  getActivePreparationFor,
  getLatestFailedPreparationFor,
  getOpportunityExecutionSummaries,
} from "@/modules/execution/service";
import { buildOpportunityActionState } from "@/modules/execution/view";
import { getLatestOpportunities, getOpportunityReadiness } from "@/modules/opportunities/service";
import {
  getActiveActionPlanOperation,
  getActiveOpportunityOperation,
} from "@/modules/operations/service";
import { OPERATION_FAILURE_MESSAGES } from "@/modules/operations/messages";
import { requireProjectAccess } from "@/modules/projects/workspace-context";
import { getActionPlanReadiness, getLatestActionPlan } from "@/modules/action-plans/service";
import { defaultPlannedOpportunity } from "@/modules/action-plans/source";
import { SANDBOX_POLICY_VERSION } from "@/modules/validation/schema";
import { getLatestValidation } from "@/modules/validation/service";
import { buildValidationSummary } from "@/modules/validation/view";
import { ActionPlanPanel } from "../action-plan-panel";
import { OpportunitiesPanel } from "../opportunities-panel";
import type { ValidationSummary } from "../validation-panel";

/**
 * Next moves (Sprint UI-2 Part 2).
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
 * no outcome, no impact. Those belong to `/prepared`, and this route reaching
 * for them is how the coupling would grow back.
 */
export default async function ProjectMovesPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { supabase, project } = await requireProjectAccess(projectId);

  const [
    opportunities,
    opportunityReadiness,
    activeOpportunityOperation,
    executionSummaries,
    actionPlanReadiness,
    actionPlanView,
    activeActionPlanOperation,
  ] = await Promise.all([
    getLatestOpportunities(supabase, projectId),
    getOpportunityReadiness(supabase, projectId),
    getActiveOpportunityOperation(supabase, projectId),
    getOpportunityExecutionSummaries(supabase, projectId),
    getActionPlanReadiness(supabase, projectId),
    getLatestActionPlan(supabase, projectId),
    getActiveActionPlanOperation(supabase, projectId),
  ]);

  // The Action Plan can only ever be for the current #1 Move — the planner
  // has no concept of planning any other one (§83). This is why plan detail
  // lives on this same page rather than at a `/moves/[opportunityId]` route:
  // that route would imply a selection the backend cannot actually serve.
  const plannedMove = opportunities
    ? defaultPlannedOpportunity(opportunities.set.opportunities)
    : null;

  // Execution state per opportunity, resolved here so the browser renders an
  // answer rather than deciding whether Vibe has an executor (Sprint 9C §2).
  const executionStates: Record<string, ReturnType<typeof buildOpportunityActionState>> = {};
  const branchUrls: Record<string, string> = {};
  // Isolated validation state per prepared change (Sprint 10A §44), resolved
  // server-side for the same reason execution state is: the browser renders an
  // answer, it does not decide what Vibe is willing to run.
  const validationSummaries: Record<string, ValidationSummary> = {};

  for (const summary of executionSummaries) {
    const opportunity = opportunities?.set.opportunities.find(
      (entry) => entry.id === summary.opportunityId,
    );
    if (!opportunity) continue;

    executionStates[summary.opportunityId] = buildOpportunityActionState({
      opportunity,
      capability: summary.capability,
      preparedChangeId: summary.preparedChangeId,
      activeOperation: await getActivePreparationFor(supabase, {
        projectId,
        opportunityId: summary.opportunityId,
      }),
      // Without this a failed preparation silently re-offers the start button
      // instead of saying what went wrong.
      failedOperation: await getLatestFailedPreparationFor(supabase, {
        projectId,
        opportunityId: summary.opportunityId,
      }),
      blockedReason: null,
    });

    if (summary.branchName && project.repository) {
      branchUrls[summary.opportunityId] = buildBranchUrl(
        project.repository.fullName,
        summary.branchName,
      );
    }

    if (summary.preparedChangeId) {
      const validation = await getLatestValidation(supabase, {
        projectId,
        preparedChangeId: summary.preparedChangeId,
      });

      if (validation) {
        validationSummaries[summary.opportunityId] = buildValidationSummary(validation, {
          currentPolicyVersion: SANDBOX_POLICY_VERSION,
          failureMessage: validation.failureCode
            ? (OPERATION_FAILURE_MESSAGES[validation.failureCode] ?? null)
            : null,
        });
      }
    }
  }

  const opportunityCount = opportunities?.set.opportunities.length ?? null;

  return (
    <WorkspaceSection
      id="next-moves"
      title={opportunityCount ? "Next moves" : "Opportunities"}
      description="A short, ranked list — not a report. The order is the engine's, and it is shown as produced."
    >
      <OpportunitiesPanel
        projectId={project.id}
        opportunities={opportunities?.set.opportunities ?? []}
        executionStates={executionStates}
        branchUrls={branchUrls}
        validationSummaries={validationSummaries}
        stale={opportunities?.stale ?? false}
        activeOperation={activeOpportunityOperation}
        blockedReason={opportunityReadiness.blockedReason}
        // Where a blocked set sends the user. The domain still owns the anchor
        // (`BUSINESS_AUDIT_ANCHOR`); the route it now lives on is a UI fact, so
        // it is supplied here rather than hard-coded in the domain.
        auditHref={projectSectionHref(project.id, "business-audit")}
      />

      {/*
       * The Action Plan for the current #1 Move, on the same section rather
       * than a section of its own — there is only ever one Move being
       * planned, and it is this list's own rank-1 entry, so a separate nav
       * item would name a place with nothing else to distinguish it.
       */}
      <div className="border-line-2 flex flex-col gap-5 border-t pt-8">
        <h3 className="text-fg text-title font-bold">Plan this move</h3>
        <ActionPlanPanel
          projectId={project.id}
          moveTitle={plannedMove?.title ?? null}
          readiness={actionPlanReadiness}
          planView={actionPlanView}
          activeOperation={activeActionPlanOperation}
          auditHref={projectSectionHref(project.id, "business-audit")}
          understandingHref={projectSectionHref(project.id, "understanding")}
        />
      </div>
    </WorkspaceSection>
  );
}
