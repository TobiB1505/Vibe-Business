"use client";

import Link from "next/link";
import { InfoIcon } from "@/components/ui/dashboard-icons";
import { Notice } from "@/components/ui/states";
import { Surface } from "@/components/ui/surface";
import { MonoLabel } from "@/components/ui/typography";
import { useOperationPoll } from "@/lib/client/use-operation-poll";
import { OPERATION_FAILURE_MESSAGES } from "@/modules/operations/messages";
import { operationPollPhase, type OperationView } from "@/modules/operations/view";
import { buildOpportunityBlockNotice } from "@/modules/opportunities/view";
import { moveSummaryCounts } from "@/modules/opportunities/view";
import type { BusinessOpportunity } from "@/modules/opportunities/schema";
import {
  partitionByContext,
  type MoveLineageMap,
  type MovesContext,
} from "@/modules/opportunities/lineage";
import { founderQuestionCta } from "@/modules/action-plans/view";
import type { ActionPlanReadiness, ActionPlanView } from "@/modules/action-plans/service";
import type {
  BlockedActionDestinations,
  OpportunityActionState,
} from "@/modules/execution/view";
import { getOperationStatusAction } from "../run-audit-action";
import type { ValidationSummary } from "../validation-panel";
import { MoveCard } from "./move-card";
import { MoveList } from "./move-list";
import { PlanDetailPanel, PLANNED_WORK_ANCHOR } from "./plan-detail-panel";
import { PlanGenerating, PlanGeneratingAside } from "./plan-generating";
import { PlanSummary } from "./plan-summary";

/**
 * The Action Plan workspace (ACTION PLAN UI-2).
 *
 * One decision on the left, its explanation on the right. The two used to be
 * stacked — every Move, then one plan underneath — so the relationship between
 * them was expressed only by document order, and a founder had to scroll past
 * the list to find out what Vibe would actually do about the Move at the top of
 * it.
 *
 * Which Move the right side is about is `?plan=<id>` (ADR 0028). Selecting a
 * Move is navigation and nothing more: it never starts a run, because planning
 * is a paid call and a paid call needs a person to press a button that says
 * what it costs (Rule 60).
 *
 * Both operations are polled here rather than in the panels, so the whole
 * screen agrees about what is running.
 */

const POLL_INTERVAL_MS = 3_000;

export function ActionPlanWorkspace({
  projectId,
  opportunities,
  executionStates,
  branchUrls,
  validationSummaries,
  stale,
  movesOperation,
  movesBlockedReason,
  lineage,
  movesContext,
  movesHref,
  preparedHref,
  blockedDestinations,
  selectedOpportunityId,
  moveTitle,
  defaultMoveTitle,
  planReadiness,
  planView,
  planOperation,
  auditHref,
  understandingHref,
  productHref,
  experimentsHref,
}: {
  projectId: string;
  opportunities: BusinessOpportunity[];
  executionStates: Record<string, OpportunityActionState>;
  branchUrls: Record<string, string>;
  validationSummaries: Record<string, ValidationSummary>;
  /** A newer audit exists than the one these were prioritized from. */
  stale: boolean;
  movesOperation: OperationView | null;
  movesBlockedReason: "audit_missing" | "audit_stale" | null;
  lineage: MoveLineageMap;
  movesContext: MovesContext | null;
  movesHref: string;
  preparedHref: string;
  blockedDestinations: BlockedActionDestinations;
  /** Which Move the panel is about — rank 1 by default, or a founder's choice. */
  selectedOpportunityId: string | null;
  moveTitle: string | null;
  defaultMoveTitle: string | null;
  planReadiness: ActionPlanReadiness;
  planView: ActionPlanView | null;
  planOperation: OperationView | null;
  auditHref: string;
  understandingHref: string;
  productHref: string;
  experimentsHref: string;
}) {
  const { latest: polledMoves } = useOperationPoll<OperationView>({
    key: movesOperation?.operationId ?? null,
    enabled: operationPollPhase(movesOperation) === "working",
    intervalMs: POLL_INTERVAL_MS,
    poll: async () => {
      const operationId = movesOperation?.operationId;
      if (!operationId) return { kind: "unavailable" };

      const result = await getOperationStatusAction(projectId, operationId);
      return result.ok ? { kind: "value", value: result.operation } : { kind: "unavailable" };
    },
    continueAfter: (next) => operationPollPhase(next) === "working",
  });

  const movesOperationView = polledMoves ?? movesOperation;
  const movesRunning =
    movesOperationView !== null &&
    (movesOperationView.status === "queued" || movesOperationView.status === "running");

  const hasOpportunities = opportunities.length > 0;
  const movesBlockNotice = buildOpportunityBlockNotice(movesBlockedReason);

  // Elevation, never reranking. Both groups keep the engine's order and every
  // card keeps its persisted number.
  const { addressing, others } = partitionByContext(opportunities, movesContext);

  /*
   * The founder-question CTA belongs to exactly one card: the Move the current
   * plan is for. There is only ever one current plan project-wide, so a card
   * for any other Move has no open questions to offer — and offering to answer
   * questions that do not exist is the kind of dead affordance this workspace
   * exists to remove.
   */
  const questionCta =
    planView && planView.plan.opportunityId
      ? founderQuestionCta(planView.openFounderInputCount)
      : null;
  const questionMoveId = planView?.plan.opportunityId ?? null;

  const renderCard = (opportunity: BusinessOpportunity, inContext: boolean) => (
    <MoveCard
      projectId={projectId}
      opportunity={opportunity}
      execution={executionStates[opportunity.id] ?? null}
      branchUrl={branchUrls[opportunity.id] ?? null}
      validationSummary={validationSummaries[opportunity.id] ?? null}
      lineageHeadline={inContext ? null : (lineage[opportunity.id]?.headline ?? null)}
      preparedHref={preparedHref}
      blockedDestinations={blockedDestinations}
      movesHref={movesHref}
      selected={opportunity.id === selectedOpportunityId}
      questionCta={opportunity.id === questionMoveId ? questionCta : null}
      planPanelHref={`#${PLANNED_WORK_ANCHOR}`}
    />
  );

  const waitLinks = [
    {
      href: auditHref,
      title: "Keep your Business Health up to date",
      detail: "Fresher evidence leads to better moves.",
    },
    {
      href: productHref,
      title: "Add context if something is missing",
      detail: "Help Vibe understand what your product is for.",
    },
    {
      href: experimentsHref,
      title: "Review what changed before",
      detail: "See what a merged change made measurable.",
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Arrived from one audit finding. Orientation, not a second audit
          surface: the finding in the audit's own words, how many Moves answer
          it, and a way back to the whole list. */}
      {movesContext && (
        <Surface
          level="section"
          padding="md"
          className="border-mint-line flex flex-col gap-2"
          data-testid="moves-context"
        >
          <MonoLabel className="text-mint">From your audit</MonoLabel>
          <p className="text-fg-body text-sm leading-relaxed">{movesContext.headline}</p>
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <p className="text-fg-muted text-xs">
              {movesContext.moveIds.length === 1
                ? "1 way Vibe can help"
                : `${movesContext.moveIds.length} ways Vibe can help`}
            </p>
            <Link
              href={movesHref}
              className="text-fg-muted hover:text-fg-body rounded-sm text-xs underline underline-offset-4"
            >
              See all next moves
            </Link>
          </div>
        </Surface>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(23rem,0.75fr)] xl:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="border-line-2 bg-surface-1 rounded-panel flex flex-wrap items-center gap-3 border px-4 py-3">
            <InfoIcon size={15} className="text-fg-meta shrink-0" />
            <p className="text-fg-muted text-xs leading-relaxed">
              {hasOpportunities
                ? "These moves are ordered by impact and by what has to happen first."
                : "Vibe orders your moves by impact and by what has to happen first."}
            </p>
          </div>

          {hasOpportunities ? (
            movesContext ? (
              <>
                <MoveList opportunities={addressing}>
                  {(opportunity) => renderCard(opportunity, true)}
                </MoveList>
                {/* The rest of the ranked list stays reachable when the page
                    was entered from a finding — filtered away would be a
                    smaller product, not a clearer one. */}
                {others.length > 0 && (
                  <div className="flex flex-col gap-3 pt-2">
                    <MonoLabel as="h3" className="text-fg-secondary">
                      Your other moves
                    </MonoLabel>
                    <MoveList opportunities={others}>
                      {(opportunity) => renderCard(opportunity, false)}
                    </MoveList>
                  </div>
                )}
              </>
            ) : (
              <MoveList opportunities={others}>
                {(opportunity) => renderCard(opportunity, false)}
              </MoveList>
            )
          ) : (
            <PlanGenerating running={movesRunning}>
              {!movesRunning && movesBlockNotice !== null && (
                <Notice
                  tone="waiting"
                  label="Why this is blocked"
                  className="text-left"
                  action={
                    <a
                      href={auditHref}
                      className="text-fg-prose hover:text-fg rounded-sm text-sm underline underline-offset-4 transition-interactive"
                    >
                      {movesBlockNotice.actionLabel}
                    </a>
                  }
                >
                  {OPERATION_FAILURE_MESSAGES[movesBlockNotice.reason]}
                </Notice>
              )}
            </PlanGenerating>
          )}

          {stale && hasOpportunities && (
            <Notice tone="waiting" label="New business evidence is available">
              These were prioritized from an earlier audit, and still say what they addressed then.
              Refreshing spends another AI call and may change the order.
            </Notice>
          )}

          {hasOpportunities && movesBlockNotice !== null && !movesRunning && (
            <Notice
              tone="waiting"
              label="Why a refresh is blocked"
              action={
                <a
                  href={auditHref}
                  className="text-fg-prose hover:text-fg rounded-sm text-sm underline underline-offset-4 transition-interactive"
                >
                  {movesBlockNotice.actionLabel}
                </a>
              }
            >
              {OPERATION_FAILURE_MESSAGES[movesBlockNotice.reason]}
            </Notice>
          )}

          {movesOperationView?.status === "failed" && movesOperationView.failureCode && (
            <p className="text-amber text-sm">
              Vibe couldn&apos;t work out your next moves.{" "}
              {OPERATION_FAILURE_MESSAGES[movesOperationView.failureCode]}
            </p>
          )}

          {hasOpportunities && (
            <div className="border-line-2 bg-surface-1 rounded-panel flex flex-wrap items-center gap-3 border px-4 py-3">
              <InfoIcon size={15} className="text-fg-meta shrink-0" />
              <p className="text-fg-muted text-xs leading-relaxed">
                Priorities change as your business does. Re-scanning re-orders this plan against
                your current evidence.
              </p>
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-4 xl:sticky xl:top-6">
          <PlanSummary counts={hasOpportunities ? moveSummaryCounts(opportunities) : null} />

          {hasOpportunities ? (
            <PlanDetailPanel
              projectId={projectId}
              opportunityId={selectedOpportunityId}
              moveTitle={moveTitle}
              defaultMoveTitle={defaultMoveTitle}
              readiness={planReadiness}
              planView={planView}
              activeOperation={planOperation}
              auditHref={auditHref}
              understandingHref={understandingHref}
            />
          ) : movesBlockNotice !== null && !movesRunning ? (
            /* A blocked plan offers exactly one way forward. A column of
               alternatives beside it would compete with the single thing that
               unblocks the page. */
            null
          ) : (
            <PlanGeneratingAside
              running={movesRunning}
              operation={movesOperationView}
              waitLinks={waitLinks}
              healthHref={auditHref}
            />
          )}
        </div>
      </div>
    </div>
  );
}
