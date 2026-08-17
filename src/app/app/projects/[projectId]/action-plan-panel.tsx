"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { CategoryChip, StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { Surface } from "@/components/ui/surface";
import { Disclosure } from "@/components/ui/disclosure";
import { MonoLabel, SectionHeader } from "@/components/ui/typography";
import { Notice } from "@/components/ui/states";
import { describeEvidenceId } from "@/modules/business-audit/evidence-labels";
import { BUSINESS_AUDIT_ANCHOR } from "@/modules/opportunities/view";
import { OPERATION_FAILURE_MESSAGES } from "@/modules/operations/messages";
import { OPERATION_STAGE_LABELS, type OperationView } from "@/modules/operations/view";
import {
  ACTOR_LABELS,
  EXECUTION_SUPPORT_LABELS,
  type ActionPlanStep,
  type ExecutionSupport,
} from "@/modules/action-plans/schema";
import type { ActionPlanReadiness, ActionPlanView } from "@/modules/action-plans/service";
import {
  PLAN_PROGRESS_LABELS,
  PLAN_STALENESS_LABELS,
  buildActionPlanBlockNotice,
  stepDependencyTitles,
  stepDisplayState,
} from "@/modules/action-plans/view";
import { getOperationStatusAction } from "./run-audit-action";
import { startPlanAction, type StartPlanActionState } from "./plan-action";

/**
 * The Action Plan section (ACTION PLANNER UI-1).
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
 */

const POLL_INTERVAL_MS = 3_000;

const EXECUTION_SUPPORT_TONE: Record<ExecutionSupport, StatusTone> = {
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

function StepCard({
  step,
  allSteps,
  firstActionableOrder,
}: {
  step: ActionPlanStep;
  allSteps: ActionPlanStep[];
  firstActionableOrder: number | null;
}) {
  const display = stepDisplayState(step, firstActionableOrder);
  const dependencies = stepDependencyTitles(step, allSteps);

  return (
    <Surface
      as="li"
      level="panel"
      padding="lg"
      tone={display === "start_here" ? "mint" : "neutral"}
      className="flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="text-fg-meta font-mono text-sm">#{step.order}</span>
        <h4 className="text-fg text-base font-semibold tracking-[-0.01em]">{step.title}</h4>
        {display === "start_here" && (
          <StatusPill tone="active" dot>
            Start here
          </StatusPill>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <CategoryChip>{ACTOR_LABELS[step.actor]}</CategoryChip>
        <StatusPill tone={EXECUTION_SUPPORT_TONE[step.executionSupport]}>
          {EXECUTION_SUPPORT_LABELS[step.executionSupport]}
        </StatusPill>
        {step.requiresApproval && <StatusPill tone="waiting">Needs your sign-off</StatusPill>}
      </div>

      <p className="text-fg-prose text-sm leading-relaxed">{step.description}</p>
      <p className="text-fg-muted text-sm leading-relaxed">{step.purpose}</p>

      <div className="border-line-2 flex flex-col gap-1.5 border-t pt-3">
        <MonoLabel className="tracking-[0.14em]">Done when</MonoLabel>
        <p className="text-fg-secondary text-sm leading-relaxed">{step.completionCriteria}</p>
      </div>

      {display === "waiting_on_steps" && dependencies.length > 0 && (
        <p className="text-fg-muted text-xs leading-relaxed">
          Waiting on: {dependencies.join(", ")}
        </p>
      )}
    </Surface>
  );
}

function StartHereCard({ step }: { step: ActionPlanStep }) {
  return (
    <Surface level="card" padding="lg" tone="mint" className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <StatusPill tone="active" dot>
          Start here
        </StatusPill>
      </div>
      <h3 className="text-fg text-xl font-semibold">{step.title}</h3>
      <p className="text-fg-prose leading-relaxed">{step.description}</p>
      <div className="flex flex-wrap gap-2">
        <CategoryChip>{ACTOR_LABELS[step.actor]}</CategoryChip>
        <StatusPill tone={EXECUTION_SUPPORT_TONE[step.executionSupport]}>
          {EXECUTION_SUPPORT_LABELS[step.executionSupport]}
        </StatusPill>
      </div>
    </Surface>
  );
}

function ReadyPlan({ planView }: { planView: ActionPlanView }) {
  const { plan, staleness, firstActionableStep, progress } = planView;
  const orderedSteps = [...plan.steps].sort((a, b) => a.order - b.order);

  const evidenceIds = [...new Set(orderedSteps.flatMap((step) => step.evidenceIds))];

  return (
    <div className="flex flex-col gap-6">
      {staleness.length > 0 && (
        <Notice tone="waiting" label="This plan may be out of date">
          {staleness.map((reason) => PLAN_STALENESS_LABELS[reason]).join(" ")}
        </Notice>
      )}

      <div className="flex flex-col gap-3">
        <StatusPill
          tone={
            progress === "finished" ? "success" : progress === "blocked" ? "waiting" : "active"
          }
        >
          {PLAN_PROGRESS_LABELS[progress]}
        </StatusPill>
        {plan.goal && <h3 className="text-fg text-2xl font-semibold tracking-[-0.01em]">{plan.goal}</h3>}
      </div>

      {plan.whyNow && (
        <div className="flex flex-col gap-1.5">
          <MonoLabel className="tracking-[0.14em]">Why now</MonoLabel>
          <p className="text-fg-prose leading-relaxed">{plan.whyNow}</p>
        </div>
      )}

      {firstActionableStep ? (
        <StartHereCard step={firstActionableStep} />
      ) : (
        <Notice tone="info" label="Nothing can start yet">
          Every remaining step is waiting on another one that has not happened.
        </Notice>
      )}

      <div className="flex flex-col gap-4">
        {/* A caption, not a heading: each step below carries its own `<h4>`,
            and a heading here would sit at the same depth as its own list
            items rather than above them. */}
        <MonoLabel className="tracking-[0.14em]">The full plan</MonoLabel>
        <ol className="flex flex-col gap-4">
          {orderedSteps.map((step) => (
            <StepCard
              key={step.id}
              step={step}
              allSteps={orderedSteps}
              firstActionableOrder={firstActionableStep?.order ?? null}
            />
          ))}
        </ol>
      </div>

      {plan.expectedOutcome && (
        <Surface level="section" padding="md" className="flex flex-col gap-1.5">
          <MonoLabel className="tracking-[0.14em]">If every step succeeds</MonoLabel>
          <p className="text-fg-prose text-sm leading-relaxed">{plan.expectedOutcome}</p>
        </Surface>
      )}

      <Disclosure label="How Vibe reasoned about this">
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
