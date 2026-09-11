"use client";

import Link from "next/link";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { FounderInputCard } from "@/components/founder-input/founder-input-card";
import { Button } from "@/components/ui/button";
import { SeeMore } from "@/components/ui/see-more";
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
  type OperationView,
} from "@/modules/operations/view";
import { isFounderAttestable } from "@/modules/action-plans/completion";
import type { ActionPlanStep } from "@/modules/action-plans/schema";
import type { ActionPlanReadiness, ActionPlanView } from "@/modules/action-plans/service";
import { agentMoveHref, PLANNED_WORK_ANCHOR } from "@/modules/action-plans/source";
import type { BlockedActionDestinations, OpportunityActionState } from "@/modules/execution/view";
import {
  attestationPrompt,
  PLAN_PROGRESS_LABELS,
  PLAN_STALENESS_LABELS,
  stepResponsibility,
  type StepResponsibility,
  buildActionPlanBlockNotice,
  planEvidenceSummary,
  planExpectedChange,
  planFounderDemands,
  planMetaSummary,
  settledStepOutcomes,
  stepDependencyTitles,
  stepDisplayState,
  stepSequenceStatus,
  type StepDisplayState,
} from "@/modules/action-plans/view";
import { OperationProgress } from "@/components/system/operation-progress";
import { resolveFounderInputAction } from "../founder-input-action";
import { getOperationStatusAction } from "../run-audit-action";
import { startPlanAction, type StartPlanActionState } from "../plan-action";
import { PrepareChangePanel } from "../prepare-change-panel";
import { AttestationForm } from "./attestation-form";
import { HandoffCard } from "./handoff-card";
import { PlanCompleteCard } from "./plan-complete-card";
import type { HandoffPurpose } from "@/modules/handoff/schema";

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
 * This was written here first, and `SeeMore` is its extraction: the clamp, the
 * always-in-the-DOM string and the reasoning about screen readers are the same
 * ones this file worked out. What the shared component adds is the fade that
 * says the sentence continues, and a chevron rather than an underlined word.
 */
function ExpandableText({ text }: { text: string }) {
  return (
    <SeeMore lines={2} textClassName="text-fg-prose text-body leading-relaxed">
      {text}
    </SeeMore>
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
  coveredBy,
  responsibility,
}: {
  step: ActionPlanStep;
  allSteps: ActionPlanStep[];
  display: StepDisplayState;
  index: number;
  done: boolean;
  /** The step whose run covered this one, when it was covered rather than done. */
  coveredBy: number | null;
  responsibility: StepResponsibility;
}) {
  const sequence = stepSequenceStatus(step, allSteps, display, coveredBy);
  const dependencyTitles = stepDependencyTitles(step, allSteps);
  const isCurrent = display === "start_here";
  const compactState = isCurrent
    ? "Start here"
    : sequence.state === "waiting"
      ? "Waiting"
      : sequence.label;
  /* A covered row is finished for the plan but was never carried out, so it
     gets the muted mark rather than the tick a completion earns (ADR 0091). */
  const covered = display === "covered";

  return (
    <li
      data-testid="plan-step"
      className={cn("border-b last:border-b-0", isCurrent ? "border-mint-line" : "border-line-2")}
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
            {done && !covered ? <CheckIcon size={12} /> : String(index + 1).padStart(2, "0")}
          </span>

          <span className="text-fg min-w-0 flex-1 text-body leading-snug font-medium">
            {step.title}
          </span>

          <span
            className={cn(
              "shrink-0 text-right text-caption",
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

        {/*
          The hanging indent is `pl-12` so an opened step's body lines up under
          its title rather than under its number. That is right where there is
          room for it, and on a phone it is a third of the line: measured at
          390, this text ran 202px — twenty-nine characters — inside a well
          that already starts 57px in.

          `max-sm:pl-4` keeps enough indent to say the body belongs to the step
          above it and gives the sentence back its measure. Alignment is worth
          less than being able to read the thing that is aligned.
        */}
        <div className="flex flex-col gap-4 px-2 pt-1 pb-5 pl-12 max-sm:pl-4">
          <p className="text-fg-muted text-body leading-relaxed">{step.description}</p>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-fg-secondary text-caption font-medium">
              {responsibility.headline}
            </span>
            {responsibility.sublabel && (
              <span className="text-fg-muted text-caption">{responsibility.sublabel}</span>
            )}
          </div>

          <span
            className={cn(
              "text-caption",
              sequence.state === "waiting" ? "text-amber" : "text-fg-meta",
            )}
          >
            {sequence.label}
          </span>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <MonoLabel className="tracking-[0.14em]">Why this step exists</MonoLabel>
              <p className="text-fg-secondary text-body leading-relaxed">{step.purpose}</p>
            </div>
            <div className="flex flex-col gap-1">
              <MonoLabel className="tracking-[0.14em]">Done when</MonoLabel>
              <p className="text-fg-secondary text-body leading-relaxed">
                {step.completionCriteria}
              </p>
            </div>
          </div>

          {dependencyTitles.length > 0 && (
            <div className="flex flex-col gap-1">
              <MonoLabel className="tracking-[0.14em]">Depends on</MonoLabel>
              <p className="text-fg-secondary text-body leading-relaxed">
                {dependencyTitles.join(", ")}
              </p>
            </div>
          )}

          {step.requiresApproval && (
            <p className="text-fg-muted text-caption">
              Approval required before Vibe acts on this.
            </p>
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
  handoffStepKey,
  repositoryFullName,
  nextMove,
  onFounderResolved,
}: {
  projectId: string;
  planView: ActionPlanView;
  moveTitle: string | null;
  moveRank: number | null;
  moveLens: string | null;
  responsibilityByStepKey: Record<string, StepResponsibility>;
  /**
   * The actionable step, when Vibe refuses it permanently (ADR 0099).
   *
   * Resolved by the route, never here: it is the *shape* of a live refusal, and
   * a panel deriving it from labels would be reading Vibe's prose back as a
   * machine answer. Null whenever the step has any other outcome.
   */
  handoffStepKey: string | null;
  /** `owner/name`, or null when Vibe holds no repository for this project. */
  repositoryFullName: string | null;
  /** The Move to hand over to once this plan is finished. */
  nextMove: { title: string; href: string } | null;
  onFounderResolved: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const { plan, firstActionableStep, completedStepOrders, founderInputRequest, progress } =
    planView;
  const steps = [...plan.steps].sort((a, b) => a.order - b.order);
  const completed = new Set(completedStepOrders);
  /* Serialized as an object across the server boundary; a Map here because the
     display functions ask it questions rather than iterate it. */
  /*
   * Whether this step comes with a prompt for the founder's own tool, and why.
   *
   * Two different questions, deliberately not merged. `handoffStepKey` is
   * resolved by the route from a *live* refusal — Vibe declined to build this,
   * and only the server may say so. A verification is the step's own immutable
   * shape: `founder_action` + `measurement` is work that was never Vibe's, and
   * whose check its sandbox structurally cannot run, having no network and no
   * credential.
   *
   * Build wins where both could somehow match, because a refusal is the one
   * that grants something and must never be shadowed by the one that does not.
   */
  const handoffPurpose: HandoffPurpose | null =
    firstActionableStep === null
      ? null
      : handoffStepKey === firstActionableStep.id
        ? "build"
        : firstActionableStep.actor === "founder_action" &&
            firstActionableStep.changeKind === "measurement"
          ? "verify"
          : null;

  const absorbedBy = new Map(
    Object.entries(planView.absorbedByStepOrder).map(([order, by]) => [Number(order), by]),
  );
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
          display={stepDisplayState(
            step,
            firstActionableStep?.order ?? null,
            completed,
            absorbedBy,
          )}
          done={completed.has(step.order)}
          coveredBy={absorbedBy.get(step.order) ?? null}
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
            <h3 className="text-fg text-moment leading-tight font-semibold">
              Vibe needs your input
            </h3>
            <p className="text-fg-muted text-body leading-relaxed">
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
                reduceMotion ? { duration: 0 } : { duration: 0.36, ease: [0.22, 0.72, 0.18, 1] }
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
                <h4 className="text-fg text-body leading-snug font-semibold">{plan.goal}</h4>
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
              <h3 className="text-fg text-title leading-snug font-semibold">{plan.goal}</h3>
            )}
            <p className="text-fg-meta font-mono text-meta">{planMetaSummary(steps)}</p>
          </div>

          {/*
            Three outcomes for the step that could happen next, in the order
            that keeps each one honest.

            A step with a prompt is *also* attestable — that is the whole point
            of the handoff — so it has to be recognised first, or it would
            render as a bare confirmation with no prompt and nothing explaining
            why (ADR 0099).
          */}
          {firstActionableStep !== null && handoffPurpose !== null ? (
            <HandoffCard
              projectId={projectId}
              actionPlanId={plan.id}
              step={firstActionableStep}
              repository={repositoryFullName}
              purpose={handoffPurpose}
              tool={
                (handoffPurpose === "verify"
                  ? planView.verifyHandoffByStepKey[firstActionableStep.id]
                  : planView.handoffByStepKey[firstActionableStep.id]) ?? null
              }
              /* What the plan already settled, in plan order and without the
                 step being handed over — a note that answers this step is the
                 step, not context for it (ADR 0099). Findings and decisions
                 both count: the prompt used to say "the confirmed plan
                 structure" while carrying neither. */
              settled={settledStepOutcomes(
                steps,
                planView.completedStepOrders,
                planView.findingByStepKey,
                planView.decisionByStepKey,
              ).filter((entry) => entry.stepKey !== firstActionableStep.id)}
              /* Everything after this step, so the receiving tool is told where
                 this task stops rather than left to guess an edge. */
              later={steps
                .filter((entry) => entry.order > firstActionableStep.order)
                .map((entry) => ({ order: entry.order, title: entry.title }))}
              confirmation={
                <AttestationForm
                  projectId={projectId}
                  actionPlanId={plan.id}
                  step={firstActionableStep}
                  handoff={handoffPurpose}
                />
              }
            />
          ) : firstActionableStep !== null &&
            isFounderAttestable(
              firstActionableStep,
              new Set(Object.keys(planView.handoffByStepKey)),
            ) ? (
            <FounderActionCard
              projectId={projectId}
              actionPlanId={plan.id}
              step={firstActionableStep}
            />
          ) : firstActionableStep === null && progress === "finished" ? (
            /* The end of the plan, which used to be one sentence and no way
               onward. What the steps established is shown back to the founder
               who wrote it, and the next Move is named — never started here. */
            <PlanCompleteCard
              outcomes={settledStepOutcomes(
                steps,
                planView.completedStepOrders,
                planView.findingByStepKey,
                planView.decisionByStepKey,
              ).filter((entry) => entry.outcome !== null)}
              nextMove={nextMove}
            />
          ) : firstActionableStep === null ? (
            <Notice tone="waiting" label="Where this plan stands">
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
          <p className="text-fg-body text-body leading-relaxed">{plan.expectedOutcome}</p>
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
              <p className="text-fg-secondary text-body leading-relaxed">
                {plan.addressesRootProblem}
              </p>
            </div>
          )}

          {plan.assumptions.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <MonoLabel className="tracking-[0.14em]">What this plan assumes</MonoLabel>
              <ul className="flex flex-col gap-1">
                {plan.assumptions.map((assumption) => (
                  <li key={assumption} className="text-fg-secondary text-caption leading-relaxed">
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
                    <li key={id} className="text-fg-muted text-caption leading-relaxed" title={id}>
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
                  <li key={note} className="text-fg-muted text-caption leading-relaxed">
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
  const prompt = attestationPrompt(step);

  return (
    <Surface level="card" padding="md" tone="amber" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StatusPill tone="waiting" dot>
          {prompt.pill}
        </StatusPill>
        <span className="text-fg-muted text-caption">Step {step.order}</span>
      </div>

      <div className="flex flex-col gap-1.5">
        <h3 className="text-fg text-title leading-snug font-semibold">{step.title}</h3>
        <p className="text-fg-prose text-body leading-relaxed">{step.description}</p>
        {prompt.lead && <p className="text-fg-muted text-body leading-relaxed">{prompt.lead}</p>}
      </div>

      {/* The question and the answer, owned by one component so the handoff
          card can compose it without drawing a second card (ADR 0099). */}
      <AttestationForm projectId={projectId} actionPlanId={actionPlanId} step={step} />
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
  handoffStepKey,
  repositoryFullName,
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
  nextMove,
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
  /**
   * The actionable step, when Vibe refuses it permanently (ADR 0099).
   *
   * Resolved by the route, never here: it is the *shape* of a live refusal, and
   * a panel deriving it from labels would be reading Vibe's prose back as a
   * machine answer. Null whenever the step has any other outcome.
   */
  handoffStepKey: string | null;
  /** `owner/name`, or null when Vibe holds no repository for this project. */
  repositoryFullName: string | null;
  planView: ActionPlanView | null;
  activeOperation: OperationView | null;
  execution?: OpportunityActionState | null;
  branchUrl?: string | null;
  preparedHref?: string;
  blockedDestinations?: BlockedActionDestinations;
  auditHref: string;
  understandingHref: string;
  /**
   * The Move after this one, for the finished-plan card to hand over to.
   *
   * A link, not a start: planning is paid and already has a disclosed offer on
   * the Move it belongs to. Null when this is the last Move Vibe ranked, or
   * when the surface rendering this panel has no list to take a next one from.
   */
  nextMove?: { title: string; href: string } | null;
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

  const running =
    operation !== null && (operation.status === "queued" || operation.status === "running");
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
        <section
          className="border-line-2 flex flex-col gap-2 border-b pb-6"
          aria-labelledby="why-this-move"
        >
          <h3 id="why-this-move" className="text-fg text-title font-semibold">
            Why this move
          </h3>
          <ExpandableText text={whyThisMove} />
          {lineageHeadline ? (
            <p className="text-fg-muted text-caption leading-relaxed" data-testid="move-lineage">
              <span className="text-fg-meta">From your audit: </span>
              {lineageHeadline}
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
              <h3 className="text-fg text-moment font-semibold">Generating planned work</h3>
              <OperationProgress sequence="action_planning" operation={operation} />
            </div>
          ) : planView ? (
            <PlanBody
              projectId={projectId}
              planView={planView}
              moveTitle={moveTitle}
              moveRank={moveRank}
              moveLens={moveLens}
              responsibilityByStepKey={responsibilityByStepKey}
              handoffStepKey={handoffStepKey}
              repositoryFullName={repositoryFullName}
              nextMove={nextMove ?? null}
              onFounderResolved={() => router.refresh()}
            />
          ) : blockNotice !== null ? (
            <Notice
              tone="waiting"
              label="Why this is blocked"
              action={
                <a
                  href={blockHref}
                  className="text-fg-prose hover:text-fg rounded-inline text-body underline underline-offset-4 transition-interactive"
                >
                  {blockNotice.actionLabel}
                </a>
              }
            >
              {OPERATION_FAILURE_MESSAGES[blockNotice.reason]}
            </Notice>
          ) : executionOwnsPrimary ? (
            <div className="flex flex-col gap-1.5">
              <h3 className="text-fg text-moment font-semibold">Ready for the next step</h3>
              <p className="text-fg-prose text-body leading-relaxed">
                Vibe has enough grounded context to act on this Move. Review the action below before
                anything is prepared.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <h3 className="text-fg text-moment font-semibold">Plan the work</h3>
                <p className="text-fg-prose text-body leading-relaxed">
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

      {!running &&
      !planView?.founderInputRequest &&
      executionOwnsPrimary &&
      execution &&
      executionOpportunityId ? (
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
          className="text-fg-muted hover:text-fg-body w-fit rounded-inline text-body underline underline-offset-4 transition-interactive"
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
            <Button type="submit" variant="secondary" disabled={pending} busy={pending}>
              {pending ? "Starting…" : "Replan this move"}
            </Button>
            <CreditPrice operation="action_plan" />
          </form>
        </Disclosure>
      ) : null}

      {operation?.status === "failed" && operation.failureCode && (
        <p className="text-amber text-body">
          Vibe couldn&apos;t work out a plan for this move.{" "}
          {OPERATION_FAILURE_MESSAGES[operation.failureCode]}
        </p>
      )}

      {actionState && !actionState.ok && (
        <p className="text-amber text-body">{OPERATION_FAILURE_MESSAGES[actionState.error]}</p>
      )}

      {actionState?.ok && actionState.kind === "reused" && (
        <p className="text-fg-muted text-body">
          Nothing has changed since the last plan, so the existing one is shown.
        </p>
      )}
    </Surface>
  );
}
