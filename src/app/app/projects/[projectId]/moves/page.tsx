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
    actionPlanReadiness,
    actionPlanView,
    activeActionPlanOperation,
  ] = await Promise.all([
    getLatestOpportunities(supabase, projectId),
    getOpportunityReadiness(supabase, projectId),
    getActiveOpportunityOperation(supabase, projectId),
    getOpportunityExecutionSummaries(supabase, projectId),
    getActionPlanReadiness(supabase, projectId, requestedOpportunityId),
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

  // The single latest completed plan is project-wide, not per-Move
  // (`supersedeOtherPlans` marks every other one superseded regardless of
  // which Move it was for). If it is for a different Move than the one
  // currently selected, showing it here would read as "here is your plan for
  // X" while displaying Y's — so it renders only when it actually answers the
  // current selection; otherwise the CTA below offers to plan this one.
  const resolvedActionPlanView =
    actionPlanView && plannedMove && actionPlanView.plan.opportunityId === plannedMove.id
      ? actionPlanView
      : null;

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
      /*
       * Was: "The order is the engine's, and it is shown as produced." True,
       * and written about the implementation rather than to the founder
       * (UI-S2 §29, §30). What they need to know is that this is a short list
       * in priority order, which is what it now says.
       */
      description="The few things worth doing next, in the order Vibe would do them."
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
        lineage={lineage}
        movesContext={movesContext}
        movesHref={projectSectionHref(project.id, "next-moves")}
        preparedHref={projectSectionHref(project.id, "prepared")}
        // Where a blocked set sends the user. The domain still owns the anchor
        // (`BUSINESS_AUDIT_ANCHOR`); the route it now lives on is a UI fact, so
        // it is supplied here rather than hard-coded in the domain.
        auditHref={projectSectionHref(project.id, "business-audit")}
        // Which Move the section below is currently about, so every other
        // card can offer "Plan this Move" and the selected one does not
        // redundantly link to itself (§83).
        plannedOpportunityId={plannedMove?.id ?? null}
      />

      {/*
       * The Action Plan section, on the same page rather than a section of
       * its own — there is only ever one *current* plan for the project
       * (`supersedeOtherPlans` retires any other completed one regardless of
       * which Move it was for), so a separate nav item would name a place
       * with nothing else to distinguish it.
       *
       * Which Move this is *for* defaults to rank 1 and stays that way for
       * every visit that never carries `?plan=` — a founder's explicit
       * "Plan this Move" link on a card above can point it at a different one
       * instead (§83; PRODUCT.md §6 step 7). Vibe itself never makes that
       * substitution — `readiness.isDefaultMove` tells the panel to disclose
       * it whenever a human did.
       */}
      <div className="border-line-2 flex flex-col gap-5 border-t pt-8" id="plan-this-move">
        <h3 className="text-fg text-title font-bold">Plan this move</h3>
        <ActionPlanPanel
          projectId={project.id}
          opportunityId={plannedMove?.id ?? null}
          moveTitle={plannedMove?.title ?? null}
          defaultMoveTitle={defaultMove?.title ?? null}
          readiness={actionPlanReadiness}
          planView={resolvedActionPlanView}
          // Project-wide, not scoped to `plannedMove` — `action_planning`
          // operations are keyed by input identity (which does include the
          // Move), so two concurrent runs for two different Moves are
          // possible in principle. This read model predates per-Move
          // selection and does not yet disambiguate that case; it would show
          // whichever run it finds even if it is for a different Move than
          // currently selected. Rare enough (two plan clicks on different
          // Moves within the same run) that it is called out here rather than
          // fixed now.
          activeOperation={activeActionPlanOperation}
          auditHref={projectSectionHref(project.id, "business-audit")}
          understandingHref={projectSectionHref(project.id, "understanding")}
        />
      </div>
    </WorkspaceSection>
  );
}
