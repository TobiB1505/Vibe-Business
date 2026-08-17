"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { Surface } from "@/components/ui/surface";
import { Disclosure } from "@/components/ui/disclosure";
import { MonoLabel, SectionHeader } from "@/components/ui/typography";
import { Notice } from "@/components/ui/states";
import { cn } from "@/lib/utils/cn";
import { describeEvidenceId } from "@/modules/business-audit/evidence-labels";
import { BUSINESS_AUDIT_ANCHOR } from "@/modules/opportunities/view";
import { OPERATION_FAILURE_MESSAGES } from "@/modules/operations/messages";
import { OPERATION_STAGE_LABELS, type OperationView } from "@/modules/operations/view";
import type { ActionPlanStep, ExecutionSupport, PlanProgress } from "@/modules/action-plans/schema";
import type { ActionPlanReadiness, ActionPlanView } from "@/modules/action-plans/service";
import {
  PLAN_PROGRESS_LABELS,
  PLAN_STALENESS_LABELS,
  RESPONSIBILITY_HEADLINES,
  RESPONSIBILITY_SUBLABELS,
  buildActionPlanBlockNotice,
  planMetaSummary,
  stepDependencyTitles,
  stepDisplayState,
  stepSequenceStatus,
  type StepDisplayState,
} from "@/modules/action-plans/view";
import { getOperationStatusAction } from "./run-audit-action";
import { startPlanAction, type StartPlanActionState } from "./plan-action";

/**
 * The Action Plan section (ACTION PLANNER UI-1, density pass UI-1.1).
 *
 * Three things it must never do, same as the Opportunities panel above it on
 * this page, plus one more that is this feature's whole reason for existing:
 *
 *  - **Promise execution.** No "Let Vibe prepare this", "Apply" or "Execute"
 *    button anywhere in this file. `vibe_prepares` means the work is Vibe's
 *    responsibility, not that a button exists — CORE-2b built that
 *    distinction specifically so it could be told to a founder honestly, and
 *    this screen is where it gets told.
 *  - **Show internals.** Every enum, id and version on `ActionPlan` /
 *    `ActionPlanStep` reaches this file only through `./view.ts` or the
 *    schema's own label maps. No conclusion key, capability id, contract or
 *    planner version, provider or model ever reaches JSX.
 *  - **Assume the first step is first.** "Start Here" renders whatever
 *    `firstActionableStep` computed server-side — never `steps[0]`.
 *
 * UI-1.1 changes presentation only: scan first, expand second. The plan's own
 * content — descriptions, purpose, completion criteria, dependencies,
 * evidence — is unchanged and un-truncated; only how much of it is visible
 * without asking moved. See `docs/sprints/0036-action-planner-ui11.md`.
 */

const POLL_INTERVAL_MS = 3_000;

const RESPONSIBILITY_TONE: Record<ExecutionSupport, StatusTone> = {
  // A real registry match — informational only, since no button is attached
  // to it in this phase either.
  vibe_executes_now: "success",
  // Deliberately not mint: mint is Vibe's action colour, and this value must
  // never read as an offer to act.
  vibe_prepares: "neutral",
  founder_decides: "waiting",
  founder_acts: "waiting",
  external_dependency: "waiting",
  not_yet_supported: "neutral",
};

/**
 * A "read more" toggle over text that is never mutated or sliced (§7).
 *
 * The full string is always in the DOM — CSS `line-clamp` hides overflow
 * visually without removing it, so a screen reader already gets the whole
 * thing regardless of the toggle's state. What the toggle changes is only
 * whether a sighted reader sees it without asking.
 */
function ExpandableText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="flex flex-col gap-1.5">
      <p className={cn("text-fg-prose text-sm leading-relaxed", !expanded && "line-clamp-2")}>
        {text}
      </p>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="text-fg-muted hover:text-fg-body self-start text-xs underline underline-offset-4 transition-colors"
      >
        {expanded ? "Show less" : "More context"}
      </button>
    </div>
  );
}

function PlanHero({
  goal,
  whyNow,
  steps,
}: {
  goal: string | null;
  whyNow: string | null;
  steps: ActionPlanStep[];
}) {
  return (
    <div className="flex flex-col gap-3">
      <MonoLabel className="tracking-[0.16em]">Action plan</MonoLabel>
      {goal && (
        <h4 className="text-fg text-xl leading-snug font-semibold tracking-[-0.01em] sm:text-2xl">
          {goal}
        </h4>
      )}
      {whyNow && (
        <div className="flex flex-col gap-1">
          <MonoLabel className="tracking-[0.14em]">Why now</MonoLabel>
          <ExpandableText text={whyNow} />
        </div>
      )}
      <p className="text-fg-meta font-mono text-xs">{planMetaSummary(steps)}</p>
    </div>
  );
}

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
      <h5 className="text-fg text-lg leading-snug font-semibold">{step.title}</h5>
      <p className="text-fg-prose text-sm leading-relaxed">{step.description}</p>
    </Surface>
  );
}

function PlanStatusNotice({ progress }: { progress: PlanProgress }) {
  if (progress !== "finished" && progress !== "blocked") return null;
  return (
    <Notice tone={progress === "finished" ? "info" : "waiting"} label="Where this plan stands">
      {PLAN_PROGRESS_LABELS[progress]}
    </Notice>
  );
}

function TimelineStep({
  step,
  allSteps,
  display,
  isLast,
}: {
  step: ActionPlanStep;
  allSteps: ActionPlanStep[];
  display: StepDisplayState;
  isLast: boolean;
}) {
  const sequence = stepSequenceStatus(step, allSteps, display);
  const dependencyTitles = stepDependencyTitles(step, allSteps);
  const isCurrent = display === "start_here";
  const sublabel = RESPONSIBILITY_SUBLABELS[step.executionSupport];

  return (
    <li className="relative flex gap-4">
      {/* The connecting line — presentation only. The list stays a real
          `<ol>`; nothing about sequence is expressed through this line. */}
      {!isLast && <span aria-hidden className="bg-line-3 absolute top-8 bottom-0 left-[13px] w-px" />}
      <span
        aria-hidden
        className={cn(
          "relative z-10 mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border font-mono text-[0.6875rem]",
          isCurrent
            ? "bg-mint-tint border-mint-line text-mint"
            : "bg-surface-3 border-line-3 text-fg-meta",
        )}
      >
        {step.order}
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5 pb-7">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <StatusPill tone={RESPONSIBILITY_TONE[step.executionSupport]}>
            {RESPONSIBILITY_HEADLINES[step.executionSupport]}
          </StatusPill>
          {/* Text-first, never colour-only: waiting reads amber *and* says
              "Waiting for step N" — never just a tinted dot. */}
          <span
            className={cn(
              "font-mono text-[0.65625rem] tracking-[0.1em] uppercase",
              sequence.state === "waiting" ? "text-amber" : "text-fg-meta",
            )}
          >
            {sequence.label}
          </span>
        </div>

        {sublabel && <p className="text-fg-muted text-xs">{sublabel}</p>}

        <h5 className="text-fg text-base leading-snug font-semibold">{step.title}</h5>
        <p className="text-fg-prose text-sm leading-relaxed">{step.description}</p>

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

function ReadyPlan({ planView }: { planView: ActionPlanView }) {
  const { plan, staleness, firstActionableStep, progress } = planView;
  const orderedSteps = [...plan.steps].sort((a, b) => a.order - b.order);
  const firstActionableOrder = firstActionableStep?.order ?? null;

  const evidenceIds = [...new Set(orderedSteps.flatMap((step) => step.evidenceIds))];

  return (
    <div className="flex flex-col gap-4">
      {staleness.length > 0 && (
        <Notice tone="waiting" label="This plan may be out of date">
          {staleness.map((reason) => PLAN_STALENESS_LABELS[reason]).join(" ")}
        </Notice>
      )}

      <Surface level="section" padding="lg" className="flex flex-col gap-7">
        <PlanHero goal={plan.goal} whyNow={plan.whyNow} steps={orderedSteps} />

        {firstActionableStep ? (
          <StartHere step={firstActionableStep} />
        ) : (
          <PlanStatusNotice progress={progress} />
        )}

        <ol className="flex flex-col">
          {orderedSteps.map((step, index) => (
            <TimelineStep
              key={step.id}
              step={step}
              allSteps={orderedSteps}
              display={stepDisplayState(step, firstActionableOrder)}
              isLast={index === orderedSteps.length - 1}
            />
          ))}
        </ol>

        {plan.expectedOutcome && (
          <div className="border-line-2 flex flex-col gap-2 border-t pt-6">
            <MonoLabel className="tracking-[0.14em]">If this plan works</MonoLabel>
            <p className="text-fg-body text-base leading-relaxed">{plan.expectedOutcome}</p>
          </div>
        )}

        <Disclosure label="Why Vibe planned this">
          <div className="flex flex-col gap-4">
            {plan.addressesRootProblem && (
              <div className="flex flex-col gap-1.5">
                <MonoLabel className="tracking-[0.14em]">The problem this addresses</MonoLabel>
                <p className="text-fg-secondary text-sm leading-relaxed">{plan.addressesRootProblem}</p>
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
      </Surface>
    </div>
  );
}

const initialState: StartPlanActionState = null;

export function ActionPlanPanel({
  projectId,
  moveTitle,
  readiness,
  planView,
  activeOperation,
  auditHref,
  understandingHref,
}: {
  projectId: string;
  /** The current rank-1 Move's title, when there is one — for the CTA's copy only. */
  moveTitle: string | null;
  readiness: ActionPlanReadiness;
  planView: ActionPlanView | null;
  activeOperation: OperationView | null;
  auditHref: string;
  understandingHref: string;
}) {
  const action = startPlanAction.bind(null, projectId);
  const [state, formAction, pending] = useActionState(action, initialState);
  const [polled, setPolled] = useState<OperationView | null>(activeOperation);

  const startedOperation = state?.ok && state.kind === "running" ? state.operation : null;
  const operation =
    startedOperation && polled?.operationId !== startedOperation.operationId
      ? startedOperation
      : polled;

  const operationId = operation?.operationId ?? null;
  const shouldPoll = operation?.shouldPoll ?? false;

  useEffect(() => {
    if (!operationId || !shouldPoll) return;

    let cancelled = false;
    const timer = setInterval(async () => {
      const result = await getOperationStatusAction(projectId, operationId);
      if (cancelled) return;
      if (result.ok) setPolled(result.operation);
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [projectId, operationId, shouldPoll]);

  const running = operation !== null && (operation.status === "queued" || operation.status === "running");
  const blockNotice = buildActionPlanBlockNotice(readiness.blockedReason);

  const blockHref =
    blockNotice?.target === "business_audit"
      ? `${auditHref}${BUSINESS_AUDIT_ANCHOR}`
      : blockNotice?.target === "product_understanding"
        ? understandingHref
        : null; // "next_moves" lives on this same page — no navigation needed.

  return (
    <div className="flex flex-col gap-4">
      {/* Kept visible during a replan rather than hidden behind the loading
          notice below it — the same choice `OpportunitiesPanel` makes, so a
          founder never sees a blank panel while Vibe re-plans. */}
      {planView && (
        <>
          <ReadyPlan planView={planView} />
          <form action={formAction} className="flex items-center gap-3">
            <input type="hidden" name="force" value="true" />
            <Button type="submit" variant="secondary" size="sm" disabled={pending || running}>
              {pending ? "Starting…" : "Replan this move"}
            </Button>
          </form>
        </>
      )}

      {running && operation && (
        <Surface level="section" padding="md" role="status" className="flex flex-col gap-1">
          <p className="text-fg-body text-sm">
            {operation.stalled ? "Still working…" : `${OPERATION_STAGE_LABELS[operation.stage]}…`}
          </p>
          <p className="text-fg-muted text-sm">
            {operation.stalled
              ? "This is taking much longer than expected. You can start again if it never finishes."
              : "You can leave this page. Vibe will continue."}
          </p>
        </Surface>
      )}

      {!running && !planView && (
        <>
          {blockNotice !== null ? (
            <Notice
              tone="waiting"
              label="Why this is blocked"
              action={
                blockHref ? (
                  <a
                    href={blockHref}
                    className="text-fg-prose hover:text-fg rounded-sm text-sm underline underline-offset-4 transition-colors"
                  >
                    {blockNotice.actionLabel}
                  </a>
                ) : (
                  <a
                    href="#next-moves"
                    className="text-fg-prose hover:text-fg rounded-sm text-sm underline underline-offset-4 transition-colors"
                  >
                    {blockNotice.actionLabel}
                  </a>
                )
              }
            >
              {OPERATION_FAILURE_MESSAGES[blockNotice.reason]}
            </Notice>
          ) : (
            <Surface level="section" padding="lg" className="flex flex-col gap-4">
              <SectionHeader
                level={3}
                title="Vibe can work out exactly how to do this."
                description={
                  moveTitle
                    ? `A step-by-step plan for "${moveTitle}" — what changes, who does each part, and where to start.`
                    : "A step-by-step plan for your top next move — what changes, who does each part, and where to start."
                }
              />
              <form action={formAction} className="flex items-center gap-3">
                <input type="hidden" name="force" value="false" />
                <Button type="submit" disabled={pending}>
                  {pending ? "Starting…" : "Plan this move"}
                </Button>
              </form>
            </Surface>
          )}
        </>
      )}

      {operation?.status === "failed" && operation.failureCode && (
        <p className="text-amber text-sm">
          Vibe couldn&apos;t work out a plan for this move. {OPERATION_FAILURE_MESSAGES[operation.failureCode]}
        </p>
      )}

      {state && !state.ok && (
        <p className="text-amber text-sm">{OPERATION_FAILURE_MESSAGES[state.error]}</p>
      )}

      {state?.ok && state.kind === "reused" && (
        <p className="text-fg-muted text-sm">
          Nothing has changed since the last plan, so the existing one is shown.
        </p>
      )}
    </div>
  );
}
