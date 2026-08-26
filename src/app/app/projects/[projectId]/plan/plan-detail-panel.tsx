"use client";

import { useActionState, useState } from "react";
import { FounderInputCard } from "@/components/founder-input/founder-input-card";
import { Button, TextAction } from "@/components/ui/button";
import { CloseIcon, DocumentIcon, CheckIcon } from "@/components/ui/dashboard-icons";
import { CreditPrice } from "@/components/ui/credit-price";
import { Disclosure } from "@/components/ui/disclosure";
import { Notice } from "@/components/ui/states";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
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
import type { ActionPlanStep, ExecutionSupport } from "@/modules/action-plans/schema";
import type { ActionPlanReadiness, ActionPlanView } from "@/modules/action-plans/service";
import {
  PLAN_PROGRESS_LABELS,
  PLAN_STALENESS_LABELS,
  RESPONSIBILITY_HEADLINES,
  RESPONSIBILITY_SUBLABELS,
  buildActionPlanBlockNotice,
  planDependencyTitles,
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

/**
 * Planned work: what Vibe would do about the selected Move (ACTION PLAN UI-2).
 *
 * This is the Action Plan panel, moved beside the list it belongs to rather
 * than stacked under it. Everything it must never do is unchanged from the
 * panel it replaces:
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


const RESPONSIBILITY_TONE: Record<ExecutionSupport, StatusTone> = {
  vibe_executes_now: "success",
  // Deliberately not mint: mint is Vibe's action colour, and this value must
  // never read as an offer to act.
  vibe_prepares: "neutral",
  founder_decides: "waiting",
  founder_provides_input: "waiting",
  founder_acts: "waiting",
  external_dependency: "waiting",
  not_yet_supported: "neutral",
};

/** The panel's own anchor, so a card's question CTA can point into it. */
export const PLANNED_WORK_ANCHOR = "planned-work";

const POLL_INTERVAL_MS = 3_000;

function PanelFrame({
  state,
  children,
  onClose,
  collapsed,
  onOpen,
}: {
  state: { label: string; tone: StatusTone } | null;
  children: React.ReactNode;
  onClose: () => void;
  collapsed: boolean;
  onOpen: () => void;
}) {
  if (collapsed) {
    return (
      <Surface level="panel" padding="md" id={PLANNED_WORK_ANCHOR}>
        <button
          type="button"
          onClick={onOpen}
          className="text-fg-body hover:text-fg flex w-full items-center gap-2 text-sm transition-interactive"
        >
          <DocumentIcon size={16} className="text-fg-meta shrink-0" />
          Show planned work
        </button>
      </Surface>
    );
  }

  return (
    <Surface
      level="panel"
      padding="lg"
      id={PLANNED_WORK_ANCHOR}
      className="flex flex-col gap-5"
      data-testid="planned-work"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          <h2 className="text-fg text-title font-bold">Planned work</h2>
          {state && <StatusPill tone={state.tone}>{state.label}</StatusPill>}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Hide planned work"
          className="text-fg-meta hover:text-fg-body hover:bg-surface-hover rounded-nav flex size-8 shrink-0 items-center justify-center transition-interactive"
        >
          <CloseIcon size={16} />
        </button>
      </div>
      {children}
    </Surface>
  );
}

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

/** The step Vibe would start with — whatever `firstActionableStep` computed. */
function StartHere({ step }: { step: ActionPlanStep }) {
  return (
    <Surface level="card" padding="md" tone="mint" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StatusPill tone="active" dot>
          Start here
        </StatusPill>
        <StatusPill tone={RESPONSIBILITY_TONE[step.executionSupport]}>
          {RESPONSIBILITY_HEADLINES[step.executionSupport]}
        </StatusPill>
      </div>
      <h4 className="text-fg text-base leading-snug font-semibold">{step.title}</h4>
      <p className="text-fg-prose text-sm leading-relaxed">{step.description}</p>
    </Surface>
  );
}

/**
 * One numbered step of the plan.
 *
 * Scan first, expand second: the title, the one-sentence description and whose
 * work it is are visible without asking; the purpose, the completion criterion
 * and the prerequisites are one click away and never truncated. The sequence
 * label is text as well as colour — "Waiting for step 4: …", never a tinted dot.
 */
function PlanStepRow({
  step,
  allSteps,
  display,
  index,
  done,
}: {
  step: ActionPlanStep;
  allSteps: ActionPlanStep[];
  display: StepDisplayState;
  index: number;
  done: boolean;
}) {
  const sequence = stepSequenceStatus(step, allSteps, display);
  const dependencyTitles = stepDependencyTitles(step, allSteps);
  const isCurrent = display === "start_here";
  const sublabel = RESPONSIBILITY_SUBLABELS[step.executionSupport];

  return (
    <li className="flex items-start gap-3">
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border font-mono text-meta tabular-nums",
          isCurrent
            ? "border-mint-line bg-mint-tint text-mint"
            : done
              ? "border-mint-line text-mint"
              : "border-line-3 bg-surface-2 text-fg-meta",
        )}
      >
        {done ? <CheckIcon size={12} /> : String(index + 1).padStart(2, "0")}
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-fg-secondary text-meta font-medium">
            {RESPONSIBILITY_HEADLINES[step.executionSupport]}
          </span>
          <span
            className={cn(
              "font-mono text-meta tracking-[0.1em] uppercase",
              sequence.state === "waiting" ? "text-amber" : "text-fg-meta",
            )}
          >
            {sequence.label}
          </span>
        </div>

        {sublabel && <p className="text-fg-muted text-xs">{sublabel}</p>}

        <h4 className="text-fg text-sm leading-snug font-semibold">{step.title}</h4>
        <p className="text-fg-muted text-xs leading-relaxed">{step.description}</p>

        <Disclosure label="Details" className="pt-0.5">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <MonoLabel className="tracking-[0.14em]">Why this step exists</MonoLabel>
              <p className="text-fg-secondary text-sm leading-relaxed">{step.purpose}</p>
            </div>
            <div className="flex flex-col gap-1">
              <MonoLabel className="tracking-[0.14em]">Done when</MonoLabel>
              <p className="text-fg-secondary text-sm leading-relaxed">{step.completionCriteria}</p>
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
        </Disclosure>
      </div>
    </li>
  );
}

function PlanBody({
  projectId,
  planView,
}: {
  projectId: string;
  planView: ActionPlanView;
}) {
  const { plan, firstActionableStep, completedStepOrders, founderInputRequest, progress } = planView;
  const steps = [...plan.steps].sort((a, b) => a.order - b.order);
  const completed = new Set(completedStepOrders);
  const surfaces = planExpectedChange(steps);
  const dependencies = planDependencyTitles(steps);
  const demands = planFounderDemands(steps, completedStepOrders);
  const evidence = planEvidenceSummary(steps);
  const evidenceIds = [...new Set(steps.flatMap((step) => step.evidenceIds))];

  return (
    <>
      <div className="flex flex-col gap-2">
        <p className="text-fg-muted text-ui">What Vibe plans to do</p>
        {plan.goal && (
          <h3 className="text-fg text-base leading-snug font-semibold">{plan.goal}</h3>
        )}
        {plan.whyNow && (
          <div className="flex flex-col gap-1">
            <MonoLabel className="tracking-[0.14em]">Why now</MonoLabel>
            <ExpandableText text={plan.whyNow} />
          </div>
        )}
        <p className="text-fg-meta font-mono text-meta">{planMetaSummary(steps)}</p>
      </div>

      {/* The founder's own step comes before the list of everything else: it is
          the only part of the plan that is waiting on a person right now. */}
      {founderInputRequest ? (
        <FounderInputCard
          projectId={projectId}
          request={founderInputRequest}
          context="action_plan"
          resolveAction={resolveFounderInputAction}
        />
      ) : firstActionableStep?.actor === "founder_action" &&
        firstActionableStep.executionSupport === "founder_acts" ? (
        <FounderActionCard projectId={projectId} actionPlanId={plan.id} step={firstActionableStep} />
      ) : firstActionableStep ? (
        <StartHere step={firstActionableStep} />
      ) : (
        <Notice tone={progress === "finished" ? "info" : "waiting"} label="Where this plan stands">
          {PLAN_PROGRESS_LABELS[progress]}
        </Notice>
      )}

      <ol className="flex flex-col gap-5" data-testid="planned-steps">
        {steps.map((step, index) => (
          <PlanStepRow
            key={step.id}
            step={step}
            allSteps={steps}
            index={index}
            display={stepDisplayState(step, firstActionableStep?.order ?? null, completed)}
            done={completed.has(step.order)}
          />
        ))}
      </ol>

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

      {dependencies.length > 0 && (
        <div className="flex flex-col gap-2">
          <MonoLabel className="tracking-[0.14em]">Depends on</MonoLabel>
          <ul className="flex flex-col gap-1.5">
            {dependencies.map((title) => (
              <li key={title} className="text-fg-secondary flex items-start gap-2 text-ui">
                <CheckIcon size={14} className="text-mint mt-0.5 shrink-0" />
                {title}
              </li>
            ))}
          </ul>
        </div>
      )}

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
        label={`Why Vibe planned this · ${evidence.signals} ${
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
  defaultMoveTitle,
  readiness,
  planView,
  activeOperation,
  auditHref,
  understandingHref,
}: {
  projectId: string;
  /** The Move this panel is about — rank 1 by default, or a founder's choice. */
  opportunityId: string | null;
  /** That Move's title, for the offer's copy only. */
  moveTitle: string | null;
  /** The engine's own rank-1 title, for the priority-deviation disclosure. */
  defaultMoveTitle: string | null;
  readiness: ActionPlanReadiness;
  planView: ActionPlanView | null;
  activeOperation: OperationView | null;
  auditHref: string;
  understandingHref: string;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const action = startPlanAction.bind(null, projectId, opportunityId);
  const [actionState, formAction, pending] = useActionState<StartPlanActionState, FormData>(
    action,
    null,
  );

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

  // ADR 0028's honesty requirement: Vibe never plans a Move other than rank 1
  // on its own, so whenever the resolved Move is not rank 1 a founder chose it,
  // and that choice is disclosed rather than left implicit in a title.
  const showsPriorityDeviation = readiness.opportunityId !== null && !readiness.isDefaultMove;

  const state: { label: string; tone: StatusTone } | null = running
    ? { label: "Generating", tone: "active" }
    : planView
      ? planView.founderInputRequest
        ? { label: "Needs your input", tone: "waiting" }
        : { label: "Ready for Vibe", tone: "success" }
      : null;

  return (
    <PanelFrame
      state={state}
      collapsed={collapsed}
      onClose={() => setCollapsed(true)}
      onOpen={() => setCollapsed(false)}
    >
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

      {/* Kept visible during a replan rather than hidden behind the progress
          rows below it, so a founder never sees an empty panel while Vibe
          re-plans. */}
      {planView && <PlanBody projectId={projectId} planView={planView} />}

      {running && operation && (
        <div className="flex flex-col gap-3" role="status">
          <p className="text-fg-body text-sm">
            {operation.stalled ? "Still working…" : `${OPERATION_STAGE_LABELS[operation.stage]}…`}
          </p>
          <PlanProgressSteps steps={operationProgressSteps("action_planning", operation)} />
          <p className="text-fg-muted text-xs leading-relaxed">
            {operation.stalled
              ? "This is taking much longer than expected. You can start again if it never finishes."
              : "You can leave this page. Vibe will continue."}
          </p>
        </div>
      )}

      {!running && !planView && blockNotice !== null && (
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
      )}

      {!running && !planView && blockNotice === null && (
        <div className="flex flex-col gap-4">
          <p className="text-fg-prose text-sm leading-relaxed">
            {moveTitle
              ? `Vibe can work out exactly how to do "${moveTitle}" — what changes, who does each part, and where to start.`
              : "Vibe can work out exactly how to do your top next move — what changes, who does each part, and where to start."}
          </p>
          <form action={formAction} className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="force" value="false" />
            <Button type="submit" disabled={pending} busy={pending}>
              {pending ? "Starting…" : "Plan this move"}
            </Button>
            {/* The cost, before the click. Reading a finished plan is free. */}
            <CreditPrice operation="action_plan" />
          </form>
        </div>
      )}

      {planView && !running && (
        <form action={formAction} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="force" value="true" />
          <Button type="submit" variant="secondary" size="sm" disabled={pending} busy={pending}>
            {pending ? "Starting…" : "Replan this move"}
          </Button>
          <CreditPrice operation="action_plan" />
        </form>
      )}

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
    </PanelFrame>
  );
}
