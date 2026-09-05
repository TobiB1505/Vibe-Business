"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { InfoIcon } from "@/components/ui/dashboard-icons";
import { Notice } from "@/components/ui/states";
import { Surface } from "@/components/ui/surface";
import { MonoLabel } from "@/components/ui/typography";
import { useOperationPoll } from "@/lib/client/use-operation-poll";
import { OPERATION_FAILURE_MESSAGES } from "@/modules/operations/messages";
import {
  operationPollPhase,
  type OperationView,
} from "@/modules/operations/view";
import { buildOpportunityBlockNotice, moveLensLabel } from "@/modules/opportunities/view";
import type { BusinessOpportunity } from "@/modules/opportunities/schema";
import type { MoveLineageMap, MovesContext } from "@/modules/opportunities/lineage";
import { PLAN_OPPORTUNITY_PARAM } from "@/modules/action-plans/source";
import type { StepResponsibility } from "@/modules/action-plans/view";
import type { ActionPlanReadiness, ActionPlanView } from "@/modules/action-plans/service";
import type {
  BlockedActionDestinations,
  OpportunityActionState,
} from "@/modules/execution/view";
import { getOperationStatusAction } from "../run-audit-action";
import { MoveCard } from "./move-card";
import { MoveStepper } from "./move-stepper";
import { PlanDetailPanel } from "./plan-detail-panel";
import { PlanGenerating } from "./plan-generating";
import { OperationProgress } from "@/components/system/operation-progress";

const POLL_INTERVAL_MS = 3_000;
const SWIPE_DISTANCE = 72;
const SWIPE_VELOCITY = 520;

/**
 * One Move at a time: priority, decision, explanation, action.
 *
 * The URL still records the selected Move so a refresh and Back/Forward keep
 * context, but selection uses the native History API and local state. It does
 * not navigate, reload, or start a paid planning run. The server remains the
 * authority for every readiness and execution state rendered after selection.
 */
export function ActionPlanWorkspace({
  projectId,
  opportunities,
  executionStates,
  branchUrls,
  stale,
  movesOperation,
  movesBlockedReason,
  lineage,
  movesContext,
  movesHref,
  preparedHref,
  blockedDestinations,
  selectedOpportunityId,
  defaultMoveTitle,
  planReadinessByOpportunity,
  responsibilityByStepKey,
  planView,
  planOperation,
  planOperationOpportunityId,
  auditHref,
  understandingHref,
}: {
  projectId: string;
  opportunities: BusinessOpportunity[];
  executionStates: Record<string, OpportunityActionState>;
  branchUrls: Record<string, string>;
  stale: boolean;
  movesOperation: OperationView | null;
  movesBlockedReason: "audit_missing" | "audit_stale" | null;
  lineage: MoveLineageMap;
  movesContext: MovesContext | null;
  movesHref: string;
  preparedHref: string;
  blockedDestinations: BlockedActionDestinations;
  selectedOpportunityId: string | null;
  defaultMoveTitle: string | null;
  /** Existing readiness semantics, resolved once per persisted Move. */
  planReadinessByOpportunity: Record<string, ActionPlanReadiness>;
  /**
   * What each step's responsibility line says, resolved by the route.
   *
   * Two plain strings per step rather than the resolution itself: an
   * `ExecutionResolution` carries capability ids and version strings, and §5 of
   * the execution contract keeps those out of a component.
   */
  responsibilityByStepKey: Record<string, StepResponsibility>;
  /** The project-wide latest plan. It is shown only for its own Move. */
  planView: ActionPlanView | null;
  planOperation: OperationView | null;
  /** Conservative association for the operation loaded with this render. */
  planOperationOpportunityId: string | null;
  auditHref: string;
  understandingHref: string;
}) {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const initialId =
    opportunities.find((opportunity) => opportunity.id === selectedOpportunityId)?.id ??
    opportunities[0]?.id ??
    null;
  const [activeOpportunityId, setActiveOpportunityId] = useState<string | null>(initialId);
  const [direction, setDirection] = useState(1);

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
    /*
     * The half this poller was missing (UI-4 §5).
     *
     * Everything a finished generation produces is rendered by the *server*:
     * the new Moves, their readiness, the set's own date in the refresh bar.
     * Watching the run end and telling nobody left the founder looking at the
     * previous plan — or, from empty, at "No moves yet" seconds after a run
     * that had just succeeded — until they reloaded by hand.
     *
     * On the transition, never on the tick: a refresh per reading is the
     * defect `use-operation-poll` was extracted to remove.
     */
    onReading: (next) => {
      if (operationPollPhase(next) !== "working") router.refresh();
    },
  });

  const movesOperationView = polledMoves ?? movesOperation;
  const movesRunning =
    movesOperationView !== null &&
    (movesOperationView.status === "queued" || movesOperationView.status === "running");
  const hasOpportunities = opportunities.length > 0;
  const resolvedIndex = opportunities.findIndex(
    (opportunity) => opportunity.id === activeOpportunityId,
  );
  const activeIndex = resolvedIndex >= 0 ? resolvedIndex : 0;
  const activeOpportunity = opportunities[activeIndex] ?? null;
  const movesBlockNotice = buildOpportunityBlockNotice(movesBlockedReason);

  function selectMove(index: number, history: "push" | "none" = "push") {
    const next = opportunities[index];
    if (!next || next.id === activeOpportunity?.id) return;

    setDirection(index > activeIndex ? 1 : -1);
    setActiveOpportunityId(next.id);

    if (history === "push") {
      const url = new URL(window.location.href);
      url.searchParams.set(PLAN_OPPORTUNITY_PARAM, next.id);
      window.history.pushState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }

  useEffect(() => {
    const restoreSelection = () => {
      const requested = new URL(window.location.href).searchParams.get(PLAN_OPPORTUNITY_PARAM);
      const index = opportunities.findIndex((opportunity) => opportunity.id === requested);
      const next = opportunities[index];
      if (!next || next.id === activeOpportunityId) return;
      setDirection(index > activeIndex ? 1 : -1);
      setActiveOpportunityId(next.id);
    };

    window.addEventListener("popstate", restoreSelection);
    return () => window.removeEventListener("popstate", restoreSelection);
  }, [activeIndex, activeOpportunityId, opportunities]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      {movesContext ? (
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
                ? "1 move addresses this"
                : `${movesContext.moveIds.length} moves address this`}
            </p>
            <Link
              href={movesHref}
              className="text-fg-muted hover:text-fg-body rounded-sm text-xs underline underline-offset-4"
            >
              See the full priority order
            </Link>
          </div>
        </Surface>
      ) : null}

      {hasOpportunities && activeOpportunity ? (
        <>
          {/*
            A re-scan, while the previous plan is still on screen.
            `PlanGenerating` answers the empty case only, so a founder who
            already had Moves pressed "Re-scan business" and watched nothing
            happen for over a minute: the button returned to rest, the old plan
            stayed, and the run was invisible. The previous plan deliberately
            stays readable underneath — it is still the current answer until
            the new one lands — so this says which one they are reading.
          */}
          {movesRunning && movesOperationView ? (
            <Surface
              level="section"
              padding="md"
              className="border-mint-line flex flex-col gap-4"
              role="status"
              data-testid="moves-rescanning"
            >
              <MonoLabel className="text-mint">Re-scanning your business</MonoLabel>
              <OperationProgress
                sequence="opportunity_generation"
                operation={movesOperationView}
                runningNote="The plan below is your previous one until this finishes. You can leave this page. Vibe will continue."
              />
            </Surface>
          ) : null}

          <div className="border-line-2 bg-surface-1 rounded-panel flex items-center gap-3 border px-4 py-3">
            <InfoIcon size={15} className="text-fg-meta shrink-0" />
            <p className="text-fg-muted text-xs leading-relaxed">
              Moves are ordered by impact and by what has to happen first. Choose a step or swipe
              the active Move to explore the plan.
            </p>
          </div>

          <MoveStepper
            opportunities={opportunities}
            activeIndex={activeIndex}
            onSelect={selectMove}
          />

          <motion.div layout={!reduceMotion} className="min-w-0">
            <AnimatePresence mode="wait" initial={false} custom={direction}>
              <motion.div
                key={activeOpportunity.id}
                id="active-move-panel"
                role="tabpanel"
                aria-labelledby={`move-step-${activeIndex}`}
                custom={direction}
                initial={reduceMotion ? false : { opacity: 0, x: direction * 48 }}
                animate={{ opacity: 1, x: 0 }}
                exit={reduceMotion ? undefined : { opacity: 0, x: direction * -40 }}
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : { duration: 0.4, ease: [0.22, 0.72, 0.18, 1] }
                }
                drag={!reduceMotion && opportunities.length > 1 ? "x" : false}
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={0.14}
                dragDirectionLock
                onDragEnd={(_, info) => {
                  if (
                    (info.offset.x <= -SWIPE_DISTANCE || info.velocity.x <= -SWIPE_VELOCITY) &&
                    activeIndex < opportunities.length - 1
                  ) {
                    selectMove(activeIndex + 1);
                  } else if (
                    (info.offset.x >= SWIPE_DISTANCE || info.velocity.x >= SWIPE_VELOCITY) &&
                    activeIndex > 0
                  ) {
                    selectMove(activeIndex - 1);
                  }
                }}
                className="touch-pan-y"
                data-testid="active-move"
              >
                <MoveCard
                  opportunity={activeOpportunity}
                  execution={executionStates[activeOpportunity.id] ?? null}
                  // Exactly the condition the detail panel below renders the
                  // question under: this Move's own plan, carrying an open
                  // request. Anything looser would let the card promise a
                  // question that is not there (UX audit F-3).
                  questionIsBelow={
                    planView?.plan.opportunityId === activeOpportunity.id &&
                    planView.founderInputRequest !== null
                  }
                />
              </motion.div>
            </AnimatePresence>
          </motion.div>

          <motion.div layout={!reduceMotion}>
            <AnimatePresence mode="wait" initial={false} custom={direction}>
              <motion.div
                key={`detail-${activeOpportunity.id}`}
                initial={reduceMotion ? false : { opacity: 0, y: 12, x: direction * 12 }}
                animate={{ opacity: 1, y: 0, x: 0 }}
                exit={reduceMotion ? undefined : { opacity: 0, y: -6, x: direction * -8 }}
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : { duration: 0.36, ease: [0.22, 0.72, 0.18, 1] }
                }
              >
                {planReadinessByOpportunity[activeOpportunity.id] ? (
                  <PlanDetailPanel
                    projectId={projectId}
                    opportunityId={activeOpportunity.id}
                    moveTitle={activeOpportunity.title}
                    moveRank={activeOpportunity.rank}
                    moveLens={moveLensLabel(activeOpportunity)}
                    moveProblem={activeOpportunity.problem}
                    moveWhyNow={activeOpportunity.whyNow}
                    lineageHeadline={lineage[activeOpportunity.id]?.headline ?? null}
                    defaultMoveTitle={defaultMoveTitle}
                    readiness={planReadinessByOpportunity[activeOpportunity.id]}
                    responsibilityByStepKey={responsibilityByStepKey}
                    planView={
                      planView?.plan.opportunityId === activeOpportunity.id ? planView : null
                    }
                    activeOperation={
                      planOperationOpportunityId === activeOpportunity.id ? planOperation : null
                    }
                    execution={executionStates[activeOpportunity.id] ?? null}
                    branchUrl={branchUrls[activeOpportunity.id] ?? null}
                    preparedHref={preparedHref}
                    blockedDestinations={blockedDestinations}
                    auditHref={auditHref}
                    understandingHref={understandingHref}
                  />
                ) : (
                  <Notice tone="waiting" label="Move details unavailable">
                    Refresh the Action Plan before acting on this Move.
                  </Notice>
                )}
              </motion.div>
            </AnimatePresence>
          </motion.div>

          {stale ? (
            <Notice tone="waiting" label="New business evidence is available">
              These Moves were prioritized from an earlier audit. Re-scanning may change their
              order and spends another AI call.
            </Notice>
          ) : null}

          {movesBlockNotice !== null && !movesRunning ? (
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
          ) : null}

          <div className="border-line-2 bg-surface-1 rounded-panel flex items-center gap-3 border px-4 py-3">
            <InfoIcon size={15} className="text-fg-meta shrink-0" />
            <p className="text-fg-muted text-xs leading-relaxed">
              Priorities can change as your business evolves. Re-scanning re-orders this plan
              against current evidence.
            </p>
          </div>
        </>
      ) : (
        <PlanGenerating running={movesRunning}>
          {!movesRunning && movesBlockNotice !== null ? (
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
          ) : null}
        </PlanGenerating>
      )}

      {movesOperationView?.status === "failed" && movesOperationView.failureCode ? (
        <p className="text-amber text-sm">
          Vibe couldn&apos;t work out your next Moves.{" "}
          {OPERATION_FAILURE_MESSAGES[movesOperationView.failureCode]}
        </p>
      ) : null}
    </div>
  );
}
