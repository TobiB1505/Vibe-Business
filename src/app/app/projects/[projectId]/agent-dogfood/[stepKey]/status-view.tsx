"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/states";
import { Surface } from "@/components/ui/surface";
import { MonoLabel } from "@/components/ui/typography";
import {
  REVIEW_CLASSIFICATION_LABELS,
  REVIEW_CLASSIFICATION_NOTES,
  REVIEW_DOWNGRADE_NOTE,
} from "@/modules/review/classification";
import { OPERATION_FAILURE_MESSAGES } from "@/modules/operations/messages";
import { useOperationPoll } from "@/lib/client/use-operation-poll";
import { operationPollPhase } from "@/modules/operations/view";
import { EXECUTION_INTERRUPT_QUESTIONS } from "@/modules/execution-contract/view";
import { AgentExecutionLiveView } from "@/modules/coding-agent/ui/agent-execution-live-view";
// From `./poll`, not `./live-view`: this is a client component, and
// `live-view.ts` is server-only (Sprint 0053).
import { validationStillSettling } from "@/modules/coding-agent/observability/poll";
import type { ExecutionInterruptAnswer } from "@/modules/execution-contract/schema";
import { answerDogfoodInterruptAction, getDogfoodRunStatusAction, type DogfoodRunStatus } from "./actions";

/** Matches the existing Action Plan panel's own cadence (§16, §20). */
const POLL_INTERVAL_MS = 3_000;

/**
 * Whether this screen still has anything to wait for.
 *
 * Two things happen on this page in sequence, not one: the agent run, and then
 * the validation its success automatically enqueues a few seconds later. Asking
 * only about the agent stopped the poll in the gap between them, which is why a
 * six-minute validation used to render forever as "not started" (Sprint 0053).
 *
 * Both halves are pure functions kept out of this component, so the decision is
 * unit-tested rather than asserted by a screenshot.
 */
function stillWatching(status: DogfoodRunStatus): boolean {
  return (
    operationPollPhase(status.live.operation) === "working" ||
    validationStillSettling(status.live)
  );
}

/**
 * The dogfood surface's host for the reusable live execution view.
 *
 * Everything visual lives in `@/modules/coding-agent/ui` — this file owns the
 * route, the poll and the one thing that genuinely is dogfood-specific, which
 * is the interrupt form. That split is the point: moving this into the real
 * dashboard later is a new host and a data call, not a second implementation.
 *
 * Polling is the refresh mechanism, never the source of truth: the first render
 * comes from the server component that mounted this, a reload re-fetches
 * through the same server action, and losing the poll loses nothing. It stops
 * the moment the operation is terminal — `shouldPoll` is false for every
 * terminal status, so a finished run costs no further requests.
 */
export function StatusView({
  projectId,
  status: initial,
}: {
  projectId: string;
  status: DogfoodRunStatus;
}) {
  const { latest: polled } = useOperationPoll<DogfoodRunStatus>({
    key: initial.live.operation.operationId,
    enabled: stillWatching(initial),
    intervalMs: POLL_INTERVAL_MS,
    poll: async () => {
      const next = await getDogfoodRunStatusAction(projectId, initial.live.operation.operationId);
      return next ? { kind: "value", value: next } : { kind: "unavailable" };
    },
    // Stops on its own answer: the server render cannot know the run ended.
    continueAfter: stillWatching,
  });

  const status = polled ?? initial;
  const { live, openInterrupt } = status;
  const operation = live.operation;

  return (
    <div className="flex flex-col gap-6">
      <AgentExecutionLiveView model={live} />

      {operation.status === "failed" && operation.failureCode && (
        <Notice tone="problem" label="stopped">
          {OPERATION_FAILURE_MESSAGES[operation.failureCode]}
        </Notice>
      )}

      {operation.status === "completed" && operation.resultId && (
        <Notice
          tone="info"
          label="ready for review"
          action={
            <Link
              href={`/app/projects/${projectId}/agent`}
              className="text-mint text-sm font-semibold underline underline-offset-2"
            >
              Review change
            </Link>
          }
        >
          Vibe sent the change for validation. Nothing has been merged or deployed.
        </Notice>
      )}

      {operation.status === "completed" && status.recommendedReview && (
        <RecommendedReview classification={status.recommendedReview} />
      )}

      {openInterrupt && <InterruptPanel projectId={projectId} interrupt={openInterrupt} />}
    </div>
  );
}

/**
 * Which review this change deserves (Sprint 0048).
 *
 * A line in the existing panel, not a new surface. It recommends and nothing
 * else: no review is started here, and the visual-review domain's rule that
 * nothing is automatic is untouched — a browser session still costs money by
 * the second and still waits for a click.
 */
function RecommendedReview({
  classification,
}: {
  classification: NonNullable<DogfoodRunStatus["recommendedReview"]>;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-line-2 p-4">
      <p className="text-xs uppercase tracking-wide text-fg-muted">Recommended review</p>
      <p className="text-sm font-semibold text-fg-prose">
        {REVIEW_CLASSIFICATION_LABELS[classification.classification]}
      </p>
      <p className="text-xs text-fg-secondary">
        {REVIEW_CLASSIFICATION_NOTES[classification.classification]}
      </p>
      {classification.routes.length > 0 && (
        <p className="text-xs text-fg-muted">
          Pages affected: {classification.routes.join(", ")}
        </p>
      )}
      {/* Why a page file did not earn a screenshot. Without this the reader
          has to guess whether the classifier missed it. */}
      {classification.downgradedPaths.length > 0 && (
        <p className="text-xs text-fg-muted">{REVIEW_DOWNGRADE_NOTE}</p>
      )}
      <p className="text-xs text-fg-muted">
        {classification.visualPaths.length} rendered {fileWord(classification.visualPaths.length)},{" "}
        {classification.codePaths.length} other {fileWord(classification.codePaths.length)}.
      </p>
    </div>
  );
}

function fileWord(count: number): string {
  return count === 1 ? "file" : "files";
}

function InterruptPanel({
  projectId,
  interrupt,
}: {
  projectId: string;
  interrupt: NonNullable<DogfoodRunStatus["openInterrupt"]>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(answer: ExecutionInterruptAnswer) {
    setPending(true);
    setError(null);
    const result = await answerDogfoodInterruptAction(projectId, interrupt.id, answer);
    setPending(false);
    if (!result?.ok) setError("That answer couldn't be recorded — try again.");
  }

  return (
    <Surface level="section" tone="amber" padding="md" className="flex flex-col gap-3">
      <MonoLabel>vibe needs one decision</MonoLabel>
      <p className="text-fg-prose text-sm">{EXECUTION_INTERRUPT_QUESTIONS[interrupt.type]}</p>
      <p className="text-fg text-sm font-semibold">{interrupt.question}</p>

      {interrupt.responseSchema.kind === "single_choice" && (
        <div className="flex flex-wrap gap-2">
          {interrupt.responseSchema.options.map((option) => (
            <Button
              key={option.id}
              type="button"
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={() => submit({ kind: "single_choice", optionId: option.id })}
            >
              {option.label}
            </Button>
          ))}
        </div>
      )}

      {interrupt.responseSchema.kind === "confirmation" && (
        <div className="flex gap-2">
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={pending}
            onClick={() => submit({ kind: "confirmation", confirmed: true })}
          >
            Yes
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() => submit({ kind: "confirmation", confirmed: false })}
          >
            No
          </Button>
        </div>
      )}

      {interrupt.responseSchema.kind === "text" && (
        <TextAnswerForm pending={pending} maxLength={interrupt.responseSchema.maxLength} onSubmit={submit} />
      )}

      {error && (
        <Notice tone="problem" label="couldn't save">
          {error}
        </Notice>
      )}
    </Surface>
  );
}

function TextAnswerForm({
  pending,
  maxLength,
  onSubmit,
}: {
  pending: boolean;
  maxLength: number;
  onSubmit: (answer: ExecutionInterruptAnswer) => void;
}) {
  const [value, setValue] = useState("");

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim().length === 0) return;
        onSubmit({ kind: "text", value });
      }}
    >
      <textarea
        value={value}
        onChange={(event) => setValue(event.target.value.slice(0, maxLength))}
        maxLength={maxLength}
        rows={3}
        className="bg-surface-2 border-line-3 text-fg-body rounded-panel border p-3 text-sm"
      />
      <div>
        <Button type="submit" variant="primary" size="sm" disabled={pending || value.trim().length === 0}>
          Answer
        </Button>
      </div>
    </form>
  );
}
