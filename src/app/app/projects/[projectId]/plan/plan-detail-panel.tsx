"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { FounderInputCard } from "@/components/founder-input/founder-input-card";
import { Button, TextAction } from "@/components/ui/button";
import { ChevronDownIcon, DocumentIcon, CheckIcon } from "@/components/ui/dashboard-icons";
import { CreditPrice } from "@/components/ui/credit-price";
import { Disclosure } from "@/components/ui/disclosure";
import { Notice } from "@/components/ui/states";
import { StatusPill } from "@/components/ui/status-pill";
import { Surface } from "@/components/ui/surface";
import { MonoLabel } from "@/components/ui/typography";
import { cn } from "@/lib/utils/cn";
import { describeEvidenceId } from "@/modules/business-audit/evidence-labels";
import { OPERATION_FAILURE_MESSAGES } from "@/modules/operations/messages";
import { useOperationPoll } from "@/lib/client/use-operation-poll";
import {
  freshestOperation,
  operationPollPhase,
  operationProgressSteps,
  OPERATION_STAGE_LABELS,
  type OperationView,
} from "@/modules/operations/view";
import type { ActionPlanStep } from "@/modules/action-plans/schema";
import type { ActionPlanReadiness, ActionPlanView } from "@/modules/action-plans/service";
import { agentMoveHref, PLANNED_WORK_ANCHOR } from "@/modules/action-plans/source";
import type {
  BlockedActionDestinations,
  OpportunityActionState,
} from "@/modules/execution/view";
import {
  PLAN_PROGRESS_LABELS,
  PLAN_STALENESS_LABELS,
  stepResponsibility,
  type StepResponsibility,
  buildActionPlanBlockNotice,
  planEvidenceSummary,
  planExpectedChange,
  planFounderDemands,
  planMetaSummary,
  stepDependencyTitles,
  stepDisplayState,
  stepSequenceStatus,
  type StepDisplayState,
} from "@/modules/action-plans/view";
import { PlanProgressSteps } from "./plan-progress-steps";
import { resolveFounderInputAction } from "../founder-input-action";
import {
  attestFounderActionStepAction,
  type FounderActionAttestationState,
} from "../founder-action-attestation";
import { getOperationStatusAction } from "../run-audit-action";
import { startPlanAction, type StartPlanActionState } from "../plan-action";
import { PrepareChangePanel } from "../prepare-change-panel";

/**
 * Planned work: what Vibe would do about the selected Move (ACTION PLAN UI-2).
 *
 * This is the Action Plan detail directly below the one active Move. Everything
 * it must never do is unchanged from the panel it replaces:
 *
 *  - **Promise execution.** No "Apply", "Execute" or "Prepare" control exists
 *    here. `vibe_prepares` means the work is Vibe's responsibility, not that a
 *    button exists — and the one primary control this panel does render is the
 *    Move's own executor, supplied by the card's `PrepareChangePanel`, never
 *    manufactured from a plan step.
 *  - **Show internals.** Every enum, id and version reaches this file through
 *    `action-plans/view.ts` or a schema label map. No conclusion key,
 *    capability id, contract or planner version, provider or model.
 *  - **Assume the first step is first.** "Start here" renders whatever
 *    `firstActionableStep` computed server-side, never `steps[0]`.
 *  - **Start spending on its own.** Planning is a paid call, so it happens
 *    only when a founder presses a button that says what it costs (Rule 60).
 *    Selecting a Move never starts one.
 */

/**
 * Stable anchor for deep links into the Move detail.
 *
 * Re-exported rather than declared: `action-plans/source.ts` owns it, because
 * that is where `planMoveHref` builds the URL that ends in it.
 */
export { PLANNED_WORK_ANCHOR };

const POLL_INTERVAL_MS = 3_000;

/**
 * A "read more" toggle over text that is never mutated or sliced.
 *
 * The full string is always in the DOM — CSS `line-clamp` hides overflow
 * visually without removing it, so a screen reader already gets the whole
 * thing regardless of the toggle's state.
 */
function ExpandableText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="flex flex-col gap-1.5">
      <p className={cn("text-fg-prose text-sm leading-relaxed", !expanded && "line-clamp-2")}>
        {text}
      </p>
      <TextAction
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="self-start text-xs"
      >
        {expanded ? "Show less" : "More context"}
      </TextAction>
    </div>
  );
}

/**
 * One numbered step of the plan.
 *
 * The plan reads like a to-do list before it reads like a specification. A
 * closed row exposes the task and its short state; opening that row reveals the
 * description, ownership, exact dependency, completion criterion and approval.
 *
 * The completion mark is intentionally not a checkbox. Completion is projected
 * from durable plan state, and founder-owned work keeps its explicit attestation
 * action below rather than pretending a local toggle can complete it.
 */
function PlanStepRow({
  step,
  allSteps,
  display,
  index,
  done,
  responsibility,
}: {
  step: ActionPlanStep;
  allSteps: ActionPlanStep[];
  display: StepDisplayState;
  index: number;
  done: boolean;
  responsibility: StepResponsibility;
}) {
  const sequence = stepSequenceStatus(step, allSteps, display);
  const dependencyTitles = stepDependencyTitles(step, allSteps);
  const isCurrent = display === "start_here";
  const compactState = isCurrent
    ? "Start here"
    : sequence.state === "waiting"
      ? "Waiting"
      : sequence.label;

  return (
    <li
      data-testid="plan-step"
      className={cn(
        "border-b last:border-b-0",
        isCurrent ? "border-mint-line" : "border-line-2",
      )}
    >
      <details className="group/step">
        <summary
          className={cn(
            "flex min-h-14 cursor-pointer list-none items-center gap-3 rounded-nav px-2 py-2.5",
            "transition-interactive hover:bg-surface-2 [&::-webkit-details-marker]:hidden",
            isCurrent && "bg-mint-tint-soft hover:bg-mint-tint",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-full border font-mono text-meta tabular-nums",
              isCurrent
                ? "border-mint-line bg-mint-tint text-mint"
                : done
                  ? "border-mint-line bg-mint-tint-soft text-mint"
                  : "border-line-3 bg-surface-2 text-fg-meta",
            )}
          >
            {done ? <CheckIcon size={12} /> : String(index + 1).padStart(2, "0")}
          </span>

          <span className="text-fg min-w-0 flex-1 text-sm leading-snug font-medium">
            {step.title}
          </span>

          <span
            className={cn(
              "shrink-0 text-right text-xs",
              isCurrent
                ? "text-mint"
                : sequence.state === "waiting"
                  ? "text-amber"
                  : sequence.state === "done"
                    ? "text-mint"
                    : "text-fg-meta",
            )}
          >
            {compactState}
          </span>

          <ChevronDownIcon
            aria-hidden
            size={15}
            className="text-fg-meta shrink-0 transition-transform duration-200 group-open/step:rotate-180"
          />
        </summary>

        <div className="flex flex-col gap-4 px-2 pt-1 pb-5 pl-12">
          <p className="text-fg-muted text-sm leading-relaxed">{step.description}</p>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-fg-secondary text-xs font-medium">
              {responsibility.headline}
            </span>
            {responsibility.sublabel && (
              <span className="text-fg-muted text-xs">{responsibility.sublabel}</span>
            )}
          </div>

          <span
            className={cn(
              "text-xs",
              sequence.state === "waiting" ? "text-amber" : "text-fg-meta",
            )}
          >
            {sequence.label}
          </span>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <MonoLabel className="tracking-[0.14em]">Why this step exists</MonoLabel>
              <p className="text-fg-secondary text-sm leading-relaxed">{step.purpose}</p>
            </div>
            <div className="flex flex-col gap-1">
              <MonoLabel className="tracking-[0.14em]">Done when</MonoLabel>
              <p className="text-fg-secondary text-sm leading-relaxed">{step.completionCriteria}</p>
            </div>
          </div>

          {dependencyTitles.length > 0 && (
            <div className="flex flex-col gap-1">
              <MonoLabel className="tracking-[0.14em]">Depends on</MonoLabel>
              <p className="text-fg-secondary text-sm leading-relaxed">
                {dependencyTitles.join(", ")}
              </p>
            </div>
          )}

          {step.requiresApproval && (
            <p className="text-fg-muted text-xs">Approval required before Vibe acts on this.</p>
          )}
        </div>
      </details>
    </li>
  );
}

function PlanBody({
  projectId,
  planView,
  moveTitle,
  moveRank,
  moveLens,
  responsibilityByStepKey,
  onFounderResolved,
}: {
  projectId: string;
  planView: ActionPlanView;
  moveTitle: string | null;
  moveRank: number | null;
  moveLens: string | null;
  responsibilityByStepKey: Record<string, StepResponsibility>;
  onFounderResolved: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const { plan, firstActionableStep, completedStepOrders, founderInputRequest, progress } = planView;
  const steps = [...plan.steps].sort((a, b) => a.order - b.order);
  const completed = new Set(completedStepOrders);
  const surfaces = planExpectedChange(steps);
  const demands = planFounderDemands(steps, completedStepOrders);
  const evidence = planEvidenceSummary(steps);
  const evidenceIds = [...new Set(steps.flatMap((step) => step.evidenceIds))];
  const moveEyebrow = [
    moveRank === null ? null : `Move ${String(moveRank).padStart(2, "0")}`,
    moveLens,
  ]
    .filter(Boolean)
    .join(" · ");
  const plannedSteps = (
    <ol
      className="border-line-2 bg-well flex flex-col rounded-well border px-2"
      data-testid="planned-steps"
      aria-label="Planned work checklist"
    >
      {steps.map((step, index) => (
        <PlanStepRow
          key={step.id}
          step={step}
          allSteps={steps}
          index={index}
          display={stepDisplayState(step, firstActionableStep?.order ?? null, completed)}
          done={completed.has(step.order)}
          /* Resolved by the route. Falling back to the stored answer keeps a
             step the route did not resolve reading exactly as it did before,
             rather than blank. */
          responsibility={responsibilityByStepKey[step.id] ?? stepResponsibility(step, null)}
        />
      ))}
    </ol>
  );

  return (
    <>
      {founderInputRequest ? (
        <>
          <div className="flex flex-col gap-2">
            {moveEyebrow && (
              <MonoLabel className="text-amber tracking-[0.14em]">{moveEyebrow}</MonoLabel>
            )}
            <h3 className="text-fg text-xl leading-tight font-semibold">Vibe needs your input</h3>
            <p className="text-fg-muted text-sm leading-relaxed">
              Answer the current question so Vibe can finish planning{" "}
              {moveTitle ? `“${moveTitle}”` : "this move"}.
            </p>
          </div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={founderInputRequest.id}
              initial={reduceMotion ? false : { opacity: 0, x: 14 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, x: -10 }}
              transition={
                reduceMotion
                  ? { duration: 0 }
                  : { duration: 0.36, ease: [0.22, 0.72, 0.18, 1] }
              }
            >
              <FounderInputCard
                projectId={projectId}
                request={founderInputRequest}
                context="action_plan"
                presentation="workspace"
                openRequestCount={planView.openFounderInputCount}
                resolveAction={resolveFounderInputAction}
                onResolved={onFounderResolved}
              />
            </motion.div>
          </AnimatePresence>
          <Disclosure label={`See the full planned work · ${planMetaSummary(steps)}`}>
            <div className="flex flex-col gap-4">
              {plan.goal && (
                <h4 className="text-fg text-sm leading-snug font-semibold">{plan.goal}</h4>
              )}
              {plan.whyNow && <ExpandableText text={plan.whyNow} />}
              {plannedSteps}
            </div>
          </Disclosure>
        </>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <p className="text-fg-muted text-ui">What Vibe plans to do</p>
            {plan.goal && (
              <h3 className="text-fg text-base leading-snug font-semibold">{plan.goal}</h3>
            )}
            <p className="text-fg-meta font-mono text-meta">{planMetaSummary(steps)}</p>
          </div>

          {firstActionableStep?.actor === "founder_action" &&
          firstActionableStep.executionSupport === "founder_acts" ? (
            <FounderActionCard
              projectId={projectId}
              actionPlanId={plan.id}
              step={firstActionableStep}
            />
          ) : firstActionableStep === null ? (
            <Notice
              tone={progress === "finished" ? "info" : "waiting"}
              label="Where this plan stands"
            >
              {PLAN_PROGRESS_LABELS[progress]}
            </Notice>
          ) : null}

          {plannedSteps}
        </>
      )}

      {/* Which parts of the product this lands on, derived from the steps'
          evidence ids and nothing a model wrote (rule 57). A plan of decisions
          and measurements names no surface, and this section is then absent
          rather than guessed. There is deliberately no file count: how many
          files a change touches is knowable only after the change exists. */}
      {surfaces.length > 0 && (
        <div className="flex flex-col gap-2">
          <MonoLabel className="tracking-[0.14em]">Expected change</MonoLabel>
          <ul className="flex flex-wrap gap-2">
            {surfaces.map((surface) => (
              <li
                key={surface.id}
                className="border-line-3 bg-surface-2 rounded-nav text-fg-body flex items-center gap-2 border px-3 py-2 text-ui"
              >
                <DocumentIcon size={15} className="text-fg-meta shrink-0" />
                {surface.label}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/*
        No plan-level "Depends on".

        Every prerequisite a plan has is another of its own steps, and each step
        disclosure states its own — "Waiting for step 4: Submit the sitemap".
        Listing them again under the checklist restates the checklist. The
        reference design's version of this section named an external dependency
        ("Existing Stripe integration"), which is a fact the domain does not
        model; inventing one to fill the slot is exactly what the rest of this
        screen refuses to do.
      */}

      <div className="flex flex-col gap-2">
        <MonoLabel className="tracking-[0.14em]">Needs from you</MonoLabel>
        {demands.length === 0 ? (
          <p className="text-fg-secondary flex items-start gap-2 text-ui">
            <CheckIcon size={14} className="text-mint mt-0.5 shrink-0" />
            Nothing right now
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {demands.map((title) => (
              <li key={title} className="text-fg-secondary text-ui">
                {title}
              </li>
            ))}
          </ul>
        )}
      </div>

      {plan.expectedOutcome && (
        <div className="border-line-2 flex flex-col gap-2 border-t pt-4">
          <MonoLabel className="tracking-[0.14em]">If this plan works</MonoLabel>
          <p className="text-fg-body text-sm leading-relaxed">{plan.expectedOutcome}</p>
        </div>
      )}

      {/* The counts are the plan's own cited evidence, not the size of a pack
          Vibe happened to build. The label keeps the words the browser suite
          pins, because what it protects is that reasoning is disclosed rather
          than pushed at the founder. */}
      <Disclosure
        label={`Evidence & details · ${evidence.signals} ${
          evidence.signals === 1 ? "signal" : "signals"
        } · ${evidence.sources} ${evidence.sources === 1 ? "source" : "sources"}`}
      >
        <div className="flex flex-col gap-4">
          {plan.addressesRootProblem && (
            <div className="flex flex-col gap-1.5">
              <MonoLabel className="tracking-[0.14em]">The problem this addresses</MonoLabel>
              <p className="text-fg-secondary text-sm leading-relaxed">
                {plan.addressesRootProblem}
              </p>
            </div>
          )}

          {plan.assumptions.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <MonoLabel className="tracking-[0.14em]">What this plan assumes</MonoLabel>
              <ul className="flex flex-col gap-1">
                {plan.assumptions.map((assumption) => (
                  <li key={assumption} className="text-fg-secondary text-xs leading-relaxed">
                    {assumption}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {evidenceIds.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <MonoLabel className="tracking-[0.14em]">Why Vibe thinks this</MonoLabel>
              <ul className="flex flex-col gap-1">
                {evidenceIds.map((id) => {
                  const { source, detail } = describeEvidenceId(id);
                  return (
                    <li key={id} className="text-fg-muted text-xs leading-relaxed" title={id}>
                      <span className="text-fg-secondary font-mono">{source}:</span> {detail}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {plan.validationNotes.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <MonoLabel className="tracking-[0.14em]">Notes</MonoLabel>
              <ul className="flex flex-col gap-1">
                {plan.validationNotes.map((note) => (
                  <li key={note} className="text-fg-muted text-xs leading-relaxed">
                    {note}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Disclosure>
    </>
  );
}

function FounderActionCard({
  projectId,
  actionPlanId,
  step,
}: {
  projectId: string;
  actionPlanId: string;
  step: ActionPlanStep;
}) {
  const action = attestFounderActionStepAction.bind(null, projectId, actionPlanId, step.id);
  const [state, formAction, pending] = useActionState<FounderActionAttestationState, FormData>(
    action,
    null,
  );

  return (
    <Surface level="card" padding="md" tone="amber" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StatusPill tone="waiting" dot>
          Your action
        </StatusPill>
        <span className="text-fg-muted text-xs">Step {step.order}</span>
      </div>

      <div className="flex flex-col gap-1.5">
        <h3 className="text-fg text-base leading-snug font-semibold">{step.title}</h3>
        <p className="text-fg-prose text-sm leading-relaxed">{step.description}</p>
      </div>

      <div className="border-amber-line bg-amber-tint/35 rounded-well border px-4 py-3">
        <MonoLabel className="text-amber tracking-[0.12em]">Confirm when true</MonoLabel>
        <p className="text-fg-body mt-1.5 text-sm leading-relaxed">{step.completionCriteria}</p>
      </div>

      <form action={formAction} noValidate className="flex flex-col items-start gap-2.5">
        <Button type="submit" disabled={pending || state?.ok === true} busy={pending}>
          {pending
            ? "Saving confirmation…"
            : state?.ok
              ? "Completion confirmed"
              : "Confirm this is complete"}
        </Button>
        <p className="text-fg-muted text-xs">
          This records your confirmation against this exact plan step.
        </p>
      </form>

      {state && !state.ok && (
        <p role="alert" className="text-coral text-sm">
          {state.message}
        </p>
      )}
    </Surface>
  );
}

export function PlanDetailPanel({
  projectId,
  opportunityId,
  moveTitle,
  moveRank,
  moveLens,
  moveProblem = null,
  moveWhyNow = null,
  lineageHeadline = null,
  defaultMoveTitle,
  readiness,
  responsibilityByStepKey,
  planView,
  activeOperation,
  execution = null,
  branchUrl = null,
  preparedHref = "/app",
  blockedDestinations = {
    product: "/app",
    audit: "/app",
    moves: "/app",
    repository: "/app",
  },
  auditHref,
  understandingHref,
}: {
  projectId: string;
  opportunityId: string | null;
  moveTitle: string | null;
  moveRank: number | null;
  moveLens: string | null;
  moveProblem?: string | null;
  moveWhyNow?: string | null;
  lineageHeadline?: string | null;
  defaultMoveTitle: string | null;
  readiness: ActionPlanReadiness;
  /** What each step's responsibility line says, resolved by the route. */
  responsibilityByStepKey: Record<string, StepResponsibility>;
  planView: ActionPlanView | null;
  activeOperation: OperationView | null;
  execution?: OpportunityActionState | null;
  branchUrl?: string | null;
  preparedHref?: string;
  blockedDestinations?: BlockedActionDestinations;
  auditHref: string;
  understandingHref: string;
}) {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const action = startPlanAction.bind(null, projectId, opportunityId);
  const [actionState, formAction, pending] = useActionState<StartPlanActionState, FormData>(
    action,
    null,
  );

  useEffect(() => {
    if (actionState?.ok && actionState.kind === "reused") router.refresh();
  }, [actionState, router]);

  const startedOperation =
    actionState?.ok && actionState.kind === "running" ? actionState.operation : null;

  /*
   * What to watch, before the first reading lands: whichever of the server
   * render and the start action's answer is newer.
   */
  const watching = freshestOperation(activeOperation, startedOperation);

  const { latest: polled } = useOperationPoll<OperationView>({
    key: watching?.operationId ?? null,
    enabled: operationPollPhase(watching) === "working",
    intervalMs: POLL_INTERVAL_MS,
    poll: async () => {
      const operationId = watching?.operationId;
      if (!operationId) return { kind: "unavailable" };

      const result = await getOperationStatusAction(projectId, operationId);
      return result.ok ? { kind: "value", value: result.operation } : { kind: "unavailable" };
    },
    // Stops on its own answer: the server render cannot know the run ended.
    continueAfter: (next) => operationPollPhase(next) === "working",
    onReading: (next) => {
      if (operationPollPhase(next) !== "working") router.refresh();
    },
  });

  const operation = freshestOperation(polled ?? activeOperation, startedOperation);

  const running = operation !== null && (operation.status === "queued" || operation.status === "running");
  const blockNotice = buildActionPlanBlockNotice(readiness.blockedReason);
  const blockHref =
    blockNotice?.target === "business_audit"
      ? auditHref
      : blockNotice?.target === "product_understanding"
        ? understandingHref
        : // "next_moves" is the list beside this panel — an anchor on this very
          // page, not a navigation away from it.
          "#action-plan";

  const showsPriorityDeviation = readiness.opportunityId !== null && !readiness.isDefaultMove;
  /**
   * Staleness does not decide *whether* replanning is offered — a plan that
   * exists can always be replanned — only whether the offer is folded away.
   */
  const planIsStale = (planView?.staleness.length ?? 0) > 0;
  const detailState = running
    ? "planning"
    : planView?.founderInputRequest
      ? "question"
      : planView
        ? "planned"
        : blockNotice
          ? "blocked"
          : "offer";
  const whyThisMove = planView?.plan.whyNow ?? moveWhyNow ?? moveProblem;
  const executionOwnsPrimary =
    execution !== null &&
    execution.kind !== "needs_user_input" &&
    execution.kind !== "not_automated";
  const executionOpportunityId = opportunityId ?? planView?.plan.opportunityId ?? null;
  const status =
    detailState === "planning"
      ? { label: "Planning", tone: "active" as const }
      : detailState === "question"
        ? { label: "Needs your input", tone: "waiting" as const }
        : detailState === "planned"
          ? { label: "Plan ready", tone: "success" as const }
          : null;

  return (
    <Surface
      level="panel"
      padding="lg"
      id={PLANNED_WORK_ANCHOR}
      className="action-plan-detail-panel flex flex-col gap-6 overflow-hidden sm:p-7"
      data-testid="planned-work"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <MonoLabel className="text-fg-secondary tracking-[0.14em]">Move details</MonoLabel>
          {status ? <StatusPill tone={status.tone}>{status.label}</StatusPill> : null}
        </div>
      </div>

      {showsPriorityDeviation && (
        <Notice tone="waiting" label="Planned out of priority order">
          {defaultMoveTitle
            ? `You chose this Move yourself — Vibe's own top priority is currently "${defaultMoveTitle}".`
            : "You chose this Move yourself, rather than the Move Vibe ranked first."}
        </Notice>
      )}

      {planView && planView.staleness.length > 0 && (
        <Notice tone="waiting" label="This plan may be out of date">
          {planView.staleness.map((reason) => PLAN_STALENESS_LABELS[reason]).join(" ")}
        </Notice>
      )}

      {whyThisMove ? (
        <section className="border-line-2 flex flex-col gap-2 border-b pb-6" aria-labelledby="why-this-move">
          <h3 id="why-this-move" className="text-fg text-base font-semibold">Why this move</h3>
          <ExpandableText text={whyThisMove} />
          {lineageHeadline ? (
            <p className="text-fg-muted text-xs leading-relaxed" data-testid="move-lineage">
              <span className="text-fg-meta">From your audit: </span>{lineageHeadline}
            </p>
          ) : null}
        </section>
      ) : null}

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={detailState}
          initial={reduceMotion ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? undefined : { opacity: 0, y: -8 }}
          transition={
            reduceMotion ? { duration: 0 } : { duration: 0.38, ease: [0.22, 0.72, 0.18, 1] }
          }
          className="flex flex-col gap-5"
        >
          {running && operation ? (
            <div className="flex flex-col gap-4" role="status">
              <div className="flex flex-col gap-1.5">
                <h3 className="text-fg text-xl font-semibold">Generating planned work</h3>
                <p className="text-fg-prose text-sm leading-relaxed">
                  {operation.stalled
                    ? "This is taking much longer than expected."
                    : `${OPERATION_STAGE_LABELS[operation.stage]}…`}
                </p>
              </div>
              <PlanProgressSteps steps={operationProgressSteps("action_planning", operation)} />
              <p className="text-fg-muted text-xs leading-relaxed">
                {operation.stalled
                  ? "You can start again if this attempt never finishes."
                  : "You can leave this page. Vibe will continue."}
              </p>
            </div>
          ) : planView ? (
            <PlanBody
              projectId={projectId}
              planView={planView}
              moveTitle={moveTitle}
              moveRank={moveRank}
              moveLens={moveLens}
              responsibilityByStepKey={responsibilityByStepKey}
              onFounderResolved={() => router.refresh()}
            />
          ) : blockNotice !== null ? (
            <Notice
              tone="waiting"
              label="Why this is blocked"
              action={
                <a
                  href={blockHref}
                  className="text-fg-prose hover:text-fg rounded-sm text-sm underline underline-offset-4 transition-interactive"
                >
                  {blockNotice.actionLabel}
                </a>
              }
            >
              {OPERATION_FAILURE_MESSAGES[blockNotice.reason]}
            </Notice>
          ) : executionOwnsPrimary ? (
            <div className="flex flex-col gap-1.5">
              <h3 className="text-fg text-xl font-semibold">Ready for the next step</h3>
              <p className="text-fg-prose text-sm leading-relaxed">
                Vibe has enough grounded context to act on this Move. Review the action below
                before anything is prepared.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <h3 className="text-fg text-xl font-semibold">Plan the work</h3>
                <p className="text-fg-prose text-sm leading-relaxed">
                  {moveTitle
                    ? `Vibe can work out how to do “${moveTitle}” — what changes, who owns each part, and where to start.`
                    : "Vibe can work out what changes, who owns each part, and where to start."}
                </p>
              </div>
              <form action={formAction} className="flex flex-wrap items-center gap-3">
                <input type="hidden" name="force" value="false" />
                <Button type="submit" disabled={pending} busy={pending}>
                  {pending ? "Starting…" : "Plan this move"}
                </Button>
                <CreditPrice operation="action_plan" />
              </form>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {!running && !planView?.founderInputRequest && executionOwnsPrimary && execution && executionOpportunityId ? (
        <div className="border-line-2 flex flex-col gap-3 border-t pt-5">
          <MonoLabel className="tracking-[0.14em]">Start</MonoLabel>
          <PrepareChangePanel
            projectId={projectId}
            opportunityId={executionOpportunityId}
            actionState={execution}
            branchUrl={branchUrl}
            preparedHref={preparedHref}
            blockedDestinations={blockedDestinations}
          />
        </div>
      ) : null}

      {/*
        Every planned Move keeps its identity when it enters the Agent. The
        Agent may still refuse to start it — policy, risk and the allowlist stay
        server-owned — but the workspace should never lose the task merely
        because this Move uses the agentic route instead of a deterministic
        capability.
      */}
      {!running && !planView?.founderInputRequest && executionOpportunityId ? (
        <Link
          href={agentMoveHref(preparedHref, executionOpportunityId)}
          className="text-fg-muted hover:text-fg-body w-fit rounded-sm text-sm underline underline-offset-4 transition-interactive"
        >
          Open this move in Agent
        </Link>
      ) : null}

      {planView && !running ? (
        // Deliberately not gated on an open founder question. Replanning is how
        // a founder leaves a plan whose question they cannot or will not
        // answer, so the moment a question is open is the moment the way out
        // matters most — and the panel rewrite withheld it exactly there.
        //
        // Open by default when the plan is stale: folded away, the escape is
        // present in the DOM and absent from the screen, which is the failure
        // the staleness notice above is supposed to prevent.
        <Disclosure label="Plan options" defaultOpen={planIsStale}>
          <form action={formAction} className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="force" value="true" />
            <Button type="submit" variant="secondary" size="sm" disabled={pending} busy={pending}>
              {pending ? "Starting…" : "Replan this move"}
            </Button>
            <CreditPrice operation="action_plan" />
          </form>
        </Disclosure>
      ) : null}

      {operation?.status === "failed" && operation.failureCode && (
        <p className="text-amber text-sm">
          Vibe couldn&apos;t work out a plan for this move.{" "}
          {OPERATION_FAILURE_MESSAGES[operation.failureCode]}
        </p>
      )}

      {actionState && !actionState.ok && (
        <p className="text-amber text-sm">{OPERATION_FAILURE_MESSAGES[actionState.error]}</p>
      )}

      {actionState?.ok && actionState.kind === "reused" && (
        <p className="text-fg-muted text-sm">
          Nothing has changed since the last plan, so the existing one is shown.
        </p>
      )}
    </Surface>
  );
}
