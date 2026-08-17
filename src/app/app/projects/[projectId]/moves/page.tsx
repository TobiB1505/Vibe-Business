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
import { getActiveOpportunityOperation } from "@/modules/operations/service";
import { OPERATION_FAILURE_MESSAGES } from "@/modules/operations/messages";
import { requireProjectAccess } from "@/modules/projects/workspace-context";
import { SANDBOX_POLICY_VERSION } from "@/modules/validation/schema";
import { getLatestValidation } from "@/modules/validation/service";
import { buildValidationSummary } from "@/modules/validation/view";
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
  searchParams: Promise<{ [MOVES_CONTEXT_PARAM]?: string }>;
}) {
  const { projectId } = await params;
  const { supabase, project } = await requireProjectAccess(projectId);

  const [opportunities, opportunityReadiness, activeOpportunityOperation, executionSummaries] =
    await Promise.all([
      getLatestOpportunities(supabase, projectId),
      getOpportunityReadiness(supabase, projectId),
      getActiveOpportunityOperation(supabase, projectId),
      getOpportunityExecutionSummaries(supabase, projectId),
    ]);

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
    requested: (await searchParams)[MOVES_CONTEXT_PARAM],
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
      />
    </WorkspaceSection>
  );
}
