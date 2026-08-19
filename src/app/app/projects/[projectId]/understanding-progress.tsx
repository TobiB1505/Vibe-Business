"use client";

import { useActionState } from "react";
import { VibeMark } from "@/components/brand/vibe-mark";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
import { MonoLabel } from "@/components/ui/typography";
import { OPERATION_FAILURE_MESSAGES } from "@/modules/operations/messages";
import type { OperationStage } from "@/modules/operations/schema";
import { useOperationPoll } from "@/lib/client/use-operation-poll";
import {
  freshestOperation,
  operationPollPhase,
  type OperationView,
} from "@/modules/operations/view";
import {
  getUnderstandingStatusAction,
  startUnderstandingAction,
  type StartUnderstandingState,
} from "./understanding-actions";

/**
 * The understanding flow's waiting state (CORE-1 §26–§28, §48).
 *
 * ## What is on screen, and why it is only this
 *
 * Three steps, each corresponding to a real operation stage the server
 * actually reports. Not four, not the six the sprint sketches — a step exists
 * here only if the backend has a state for it, because a step that is always
 * "done" the instant it appears is decoration, and decoration in a progress
 * indicator is a lie about what the system is doing (CORE-1 §27).
 *
 * ## No percentage
 *
 * There is no honest percentage for "reading a repository", so there is no
 * percentage. The bar is a step counter — three segments, filled by the stages
 * that have completed — and while a step is in flight it says so in words
 * (CORE-1 §28). A `role="progressbar"` with real `aria-valuenow`/`max` carries
 * the same information to assistive technology, which a purely visual bar
 * would not.
 *
 * ## Motion
 *
 * Deliberately minimal: opacity and a pulsing dot, both from the existing
 * design system. This flow is named in CORE-1 §47 as a future signature-motion
 * candidate, and the states it would animate — `scan started`, `code
 * understood`, `public product understood`, `profile ready` — are exactly the
 * ones this component already derives. A motion sprint can attach to them
 * without restructuring anything here.
 */

const POLL_INTERVAL_MS = 2_500;

type StepId = "code" | "public" | "understanding";

const STEPS: { id: StepId; label: string; stage: OperationStage }[] = [
  { id: "code", label: "What you built", stage: "reading_code" },
  { id: "public", label: "Your public product", stage: "reading_public_product" },
  { id: "understanding", label: "Putting it together", stage: "understanding_product" },
];

type StepState = "waiting" | "active" | "done";

/**
 * Derives each step from the single stage the server reports.
 *
 * The stage list is ordered, so a stage later than a step's own means that
 * step finished. `preparing` and `counting_tokens` map to the first step
 * rather than to a step of their own — a user does not need to know that token
 * counting exists (CORE-1 §45).
 */
export function stepStates(stage: OperationStage, status: OperationView["status"]): StepState[] {
  if (status === "completed") return STEPS.map(() => "done");

  const index = STEPS.findIndex((step) => step.stage === stage);
  // An unrecognised stage means the operation is somewhere before the first
  // named step — queued, or preparing.
  const current = index === -1 ? 0 : index;

  return STEPS.map((_, position) =>
    position < current ? "done" : position === current ? "active" : "waiting",
  );
}

function StepRow({ label, state }: { label: string; state: StepState }) {
  return (
    <li className="flex items-center justify-between gap-4">
      <span
        className={
          state === "waiting" ? "text-fg-meta text-sm" : "text-fg-body text-sm transition-opacity"
        }
      >
        {label}
      </span>
      {/* The word carries the state, never the colour or the dot alone. */}
      <span
        className={
          state === "done"
            ? "text-mint font-mono text-[0.6875rem]"
            : state === "active"
              ? "text-fg-secondary font-mono text-[0.6875rem]"
              : "text-fg-meta font-mono text-[0.6875rem]"
        }
      >
        {state === "done" ? "done" : state === "active" ? "looking…" : "waiting"}
      </span>
    </li>
  );
}

export function UnderstandingProgress({
  projectId,
  hasProfile,
  activeOperation,
  canStart,
  blockedReason,
}: {
  projectId: string;
  hasProfile: boolean;
  /**
   * Discovered on the server at page load, so a reload or a return to the tab
   * shows the run in progress rather than an inviting button.
   */
  activeOperation: OperationView | null;
  canStart: boolean;
  /** Why starting is unavailable. Shown instead of the button. */
  blockedReason: string | null;
}) {
  const action = startUnderstandingAction.bind(null, projectId);
  const [state, formAction, pending] = useActionState<StartUnderstandingState, FormData>(
    action,
    null,
  );

  const startedOperation = state?.ok && state.kind === "running" ? state.operation : null;

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

      const result = await getUnderstandingStatusAction(projectId, operationId);
      return result.ok ? { kind: "value", value: result.operation } : { kind: "unavailable" };
    },
    // Stops on its own answer: the server render cannot know the run ended.
    continueAfter: (next) => operationPollPhase(next) === "working",
  });

  const operation = freshestOperation(polled ?? activeOperation, startedOperation);

  const running =
    operation !== null && (operation.status === "queued" || operation.status === "running");
  const failed = operation?.status === "failed";

  if (running) {
    const states = stepStates(operation.stage, operation.status);
    const completed = states.filter((step) => step === "done").length;

    return (
      <Surface level="card" padding="lg" className="flex flex-col items-center gap-6 text-center">
        <VibeMark size={40} />

        <div className="flex flex-col gap-2">
          <h2 className="text-fg text-title font-bold">
            {operation.stalled
              ? "Still getting to know your product."
              : "Vibe is getting to know your product."}
          </h2>
          <p className="text-fg-muted max-w-[50ch] text-sm">
            {operation.stalled
              ? "This is taking much longer than expected. You can start again if it never finishes."
              : "You can leave this page. Vibe will keep going."}
          </p>
        </div>

        <div className="flex w-full max-w-sm flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <MonoLabel>Step {Math.min(completed + 1, STEPS.length)} of {STEPS.length}</MonoLabel>
          </div>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={STEPS.length}
            aria-valuenow={completed}
            aria-label="Understanding your product"
            className="flex gap-1.5"
          >
            {states.map((step, index) => (
              <span
                key={STEPS[index].id}
                className={[
                  "h-1 flex-1 rounded-full transition-colors duration-300 ease-vibe",
                  step === "done"
                    ? "bg-mint"
                    : step === "active"
                      ? "bg-mint-dim animate-pulse"
                      : "bg-line-track",
                ].join(" ")}
              />
            ))}
          </div>

          <ul className="flex flex-col gap-2 pt-2 text-left">
            {STEPS.map((step, index) => (
              <StepRow key={step.id} label={step.label} state={states[index]} />
            ))}
          </ul>
        </div>

        {operation.stalled && (
          <form action={formAction}>
            <input type="hidden" name="force" value="true" />
            <Button type="submit" disabled={pending}>
              Start again
            </Button>
          </form>
        )}
      </Surface>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {blockedReason ? (
        <p className="text-fg-muted text-sm">{blockedReason}</p>
      ) : (
        <form action={formAction} className="flex items-center gap-3">
          <input type="hidden" name="force" value={hasProfile ? "true" : "false"} />
          <Button type="submit" disabled={pending || !canStart}>
            {pending
              ? "Starting…"
              : hasProfile
                ? "Check my product again"
                : "Get to know my product"}
          </Button>
        </form>
      )}

      {failed && operation?.failureCode && (
        <div className="flex flex-col gap-2">
          <p className="text-amber text-sm">
            Vibe couldn&apos;t finish. {OPERATION_FAILURE_MESSAGES[operation.failureCode]}
          </p>
          {/* Only offered where starting again is honest — never after an
              interrupted paid call, where we cannot say whether it was
              billed. */}
          {operation.retryAllowed && (
            <form action={formAction}>
              <input type="hidden" name="force" value="true" />
              <Button type="submit" variant="secondary" disabled={pending}>
                Try again
              </Button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
