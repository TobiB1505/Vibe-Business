import { Suspense } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { WorkspaceSection, projectSectionHref } from "@/components/layout/project-shell";
import { SkeletonSection } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/states";
import {
  PLAN_OPPORTUNITY_PARAM,
  sanitizeRequestedOpportunityId,
} from "@/modules/action-plans/source";
import { isDogfoodEligibleProject } from "@/modules/coding-agent/website-preflight";
import {
  getActivePreparationFor,
  getLatestFailedPreparationFor,
  getOpportunityExecutionSummaries,
} from "@/modules/execution/service";
import { countPreparedChangesForProject } from "@/modules/execution/store";
import { buildOpportunityActionState } from "@/modules/execution/view";
import { getPreparedChangeWorkspace } from "@/modules/execution/workspace";
import { getLatestOpportunities } from "@/modules/opportunities/service";
import { buildAgentFocus } from "@/modules/projects/agent-focus";
import { getLatestProfile } from "@/modules/product-understanding/store";
import { buildAgentContext } from "@/modules/projects/command-center";
import { requireProjectAccess } from "@/modules/projects/workspace-context";
import { hasSuccessfulSnapshot } from "@/modules/repository-intelligence/store";
import { AgentPanel } from "../agent-panel";
import { PreparedChangesSection, type PreparedChangeCard } from "../prepared-changes-section";

/**
 * Agent (Sprint UI-2 Part 2 as Prepared; reframed by CORE-5).
 *
 * ## What the page is now about
 *
 * The same lifecycle, told as the work of a team member rather than as a queue
 * of artifacts. `AgentPanel` opens with what Vibe's engineer knows about this
 * business; the prepared changes below it are what it has produced. Nothing
 * about the gates changed.
 *
 * The three extra reads this costs — the product profile, the repository
 * snapshot and the opportunity set — are existence checks, and each is a
 * single row. They are what makes the readiness claim derived rather than
 * asserted.
 *
 * ## The expensive route, and the only one that should be
 *
 * This is where the prepared-change workspace read model is called, and it is
 * the reason UI-2 Part 1 extracted it. It reads the lifecycle tables once for
 * the whole list; for an approved change it additionally spends up to four
 * read-only GitHub calls; for a ready review it signs image URLs; for a running
 * preview it asks the sandbox provider for an origin.
 *
 * That cost is legitimate *here*, because this is the screen that shows all of
 * it. Before the split, every other section paid it too.
 *
 * ## Why the changes stream (VB-023)
 *
 * Because the remaining cost is a *GitHub* cost, and nothing above it depends
 * on GitHub. The panel that says what Vibe's engineer knows about this business
 * is built from three single-row reads; before this, it waited behind a merge
 * preflight that could spend four network round trips per approved change.
 *
 * So the panel renders from the cheap reads and the prepared changes arrive
 * inside a `<Suspense>` boundary. `loading.tsx` still covers the navigation
 * itself; this covers the part of the page that is slow for a reason the rest
 * of the page does not share.
 *
 * The count in the panel above is a `head`-only query — no rows — so the
 * sentence "three changes are below" can be true before the three exist.
 *
 * ## The Move a founder arrived with (UI-S3 §3)
 *
 * `?plan=` names one Move. It is untrusted text: sanitized, then resolved
 * against this project's own set, and a stale or foreign id degrades to the
 * ordinary unfocused page rather than to an error or to rank 1.
 *
 * The reads it costs happen **only when a valid id is present**, and only for
 * that one Move — so the ordinary visit to this already-expensive route costs
 * exactly what it cost before. What the focus produces is a statement and a
 * link back to the Action Plan. It starts nothing: preparing a change is
 * priced and confirmed beside the Move it belongs to (Rule 60).
 *
 * ## Gates
 *
 * The order — validation → preview → review → human approval → safe merge →
 * outcome — is decided by the services behind the read model and rendered by
 * `PreparedChangesSection`. Nothing on this route re-decides it, and no gate
 * can be skipped by arriving at this URL directly: the state comes from
 * persisted rows, not from navigation.
 */
export default async function ProjectAgentPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ [PLAN_OPPORTUNITY_PARAM]?: string }>;
}) {
  const { projectId } = await params;
  const { supabase, userId, project } = await requireProjectAccess(projectId);
  const resolvedSearchParams = await searchParams;

  // Untrusted, and never used as a lookup until it has been bounded. It becomes
  // a focus only by matching a Move this project's own set contains.
  const requestedOpportunityId = sanitizeRequestedOpportunityId(
    resolvedSearchParams[PLAN_OPPORTUNITY_PARAM],
  );

  const [preparedCount, profile, repositorySnapshot, opportunities] = await Promise.all([
    countPreparedChangesForProject(supabase, projectId),
    getLatestProfile(supabase, projectId),
    // Existence only — the analyzer document is not rendered here (VB-022).
    hasSuccessfulSnapshot(supabase, projectId),
    getLatestOpportunities(supabase, projectId),
  ]);

  /*
   * What Vibe may do about the Move the founder arrived with.
   *
   * Three reads, all skipped entirely without a valid id, and all scoped to
   * that one Move rather than to the set — this route already reads the most
   * per view of any in the workspace, and a focus must not make an unfocused
   * visit more expensive.
   *
   * The answer comes from `buildOpportunityActionState`, the same function the
   * Action Plan renders, so the two screens cannot disagree about whether Vibe
   * has an executor for this work.
   */
  const focusedMove = requestedOpportunityId
    ? (opportunities?.set.opportunities.find((entry) => entry.id === requestedOpportunityId) ??
      null)
    : null;

  const focusAction = focusedMove
    ? await (async () => {
        const [summaries, activeOperation, failedOperation] = await Promise.all([
          getOpportunityExecutionSummaries(supabase, projectId),
          getActivePreparationFor(supabase, { projectId, opportunityId: focusedMove.id }),
          getLatestFailedPreparationFor(supabase, { projectId, opportunityId: focusedMove.id }),
        ]);

        const summary = summaries.find((entry) => entry.opportunityId === focusedMove.id);
        // No summary at all means no repository snapshot exists yet. That is a
        // missing premise rather than a verdict on the Move, and `buildAgentFocus`
        // says so rather than calling it unautomatable.
        if (!summary) return null;

        return buildOpportunityActionState({
          opportunity: focusedMove,
          capability: summary.capability,
          preparedChangeId: summary.preparedChangeId,
          activeOperation,
          failedOperation,
          blockedReason: null,
        });
      })()
    : null;

  const focus = buildAgentFocus({
    requestedOpportunityId,
    opportunities: opportunities?.set.opportunities ?? [],
    action: focusAction,
  });

  const context = buildAgentContext({
    hasProductUnderstanding: profile !== null,
    // Connected *and* read. A repository Vibe has never analyzed is not code
    // it can work from.
    hasRepositoryUnderstanding: project.repository !== null && repositorySnapshot,
    hasBusinessGoals: (opportunities?.set.opportunities.length ?? 0) > 0,
  });

  /*
   * The internal execution surface, offered only where the allowlist already
   * allows it. Resolved server-side; the link's absence is the same answer the
   * route itself gives (`notFound`), so nothing here reveals that it exists.
   */
  const executionHref = isDogfoodEligibleProject(project.id)
    ? `/app/projects/${project.id}/agent-dogfood`
    : null;

  return (
    <WorkspaceSection
      id="agent"
      title="Agent"
      description="Each change moves through validation, preview, review and your approval before anything can be merged."
    >
      <div className="flex flex-col gap-5">
        <AgentPanel
          context={context}
          focus={focus}
          preparedCount={preparedCount}
          planHref={projectSectionHref(project.id, "action-plan")}
          agentHref={projectSectionHref(project.id, "agent")}
          productHref={projectSectionHref(project.id, "my-product")}
          executionHref={executionHref}
        />

        {preparedCount > 0 ? (
          <Suspense fallback={<SkeletonSection />}>
            <PreparedChanges
              supabase={supabase}
              projectId={project.id}
              userId={userId}
              repositoryFullName={project.repository?.fullName ?? null}
            />
          </Suspense>
        ) : (
          <NothingPrepared />
        )}
      </div>
    </WorkspaceSection>
  );
}

/**
 * The prepared changes, assembled behind the `<Suspense>` boundary above.
 *
 * A separate component only so the boundary has something to suspend on: an
 * `await` in the page body would block the whole page again, however it were
 * written. Nothing here decides anything — the read model does, exactly as it
 * did when the page awaited it directly.
 */
async function PreparedChanges({
  supabase,
  projectId,
  userId,
  repositoryFullName,
}: {
  supabase: SupabaseClient;
  projectId: string;
  userId: string;
  repositoryFullName: string | null;
}) {
  const changes = (await getPreparedChangeWorkspace(supabase, {
    projectId,
    userId,
    repositoryFullName,
  })) as PreparedChangeCard[];

  // The count above and this list are two reads of the same table moments
  // apart, so they can disagree — a change discarded in between. The list is
  // the one that saw the rows, so it decides what is shown.
  if (changes.length === 0) return <NothingPrepared />;

  return (
    <PreparedChangesSection
      projectId={projectId}
      changes={changes}
      planHref={projectSectionHref(projectId, "action-plan")}
    />
  );
}

function NothingPrepared() {
  return (
    <EmptyState
      title="Nothing prepared yet"
      description="When you let Vibe act on one of your next moves, the prepared change appears here with its validation, preview, review and approval state."
    />
  );
}
