"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/states";
import { Surface } from "@/components/ui/surface";
import { MonoLabel } from "@/components/ui/typography";
import { OPERATION_FAILURE_MESSAGES } from "@/modules/operations/messages";
import { EXECUTION_INTERRUPT_QUESTIONS } from "@/modules/execution-contract/view";
import { AgentExecutionLiveView } from "@/modules/coding-agent/ui/agent-execution-live-view";
import type { ExecutionInterruptAnswer } from "@/modules/execution-contract/schema";
import { answerDogfoodInterruptAction, getDogfoodRunStatusAction, type DogfoodRunStatus } from "./actions";

/** Matches the existing Action Plan panel's own cadence (§16, §20). */
const POLL_INTERVAL_MS = 3_000;

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
  const [status, setStatus] = useState(initial);
  const [, startTransition] = useTransition();

  const operation = status.live.operation;

  useEffect(() => {
    if (!operation.shouldPoll) return;

    const interval = setInterval(() => {
      startTransition(async () => {
        const next = await getDogfoodRunStatusAction(projectId, operation.operationId);
        if (next) setStatus(next);
      });
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [projectId, operation.operationId, operation.shouldPoll]);

  const { live, openInterrupt } = status;

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
              href={`/app/projects/${projectId}/prepared`}
              className="text-mint text-sm font-semibold underline underline-offset-2"
            >
              Review change
            </Link>
          }
        >
          Vibe finished. A candidate change exists and is waiting on your own validation and review —
          nothing has been merged or deployed.
        </Notice>
      )}

      {openInterrupt && <InterruptPanel projectId={projectId} interrupt={openInterrupt} />}
    </div>
  );
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
