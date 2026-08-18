"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/states";
import { StatusPill } from "@/components/ui/status-pill";
import { MonoLabel } from "@/components/ui/typography";
import { Surface } from "@/components/ui/surface";
import { OPERATION_FAILURE_MESSAGES } from "@/modules/operations/messages";
import { OPERATION_STAGE_LABELS } from "@/modules/operations/view";
import { EXECUTION_ACTIVITY_LABELS, EXECUTION_INTERRUPT_QUESTIONS } from "@/modules/execution-contract/view";
import type { ExecutionInterruptAnswer } from "@/modules/execution-contract/schema";
import { answerDogfoodInterruptAction, getDogfoodRunStatusAction, type DogfoodRunStatus } from "./actions";

/** Matches the existing Action Plan panel's own cadence (§16, §20). */
const POLL_INTERVAL_MS = 3_000;

/**
 * Durable execution status (EXECUTION CORE-4 website gate, §16, §17, §18, §22, §24).
 *
 * Everything rendered here is real: `operation.stage` and `operation.status`
 * are the durable workflow's own state, and every activity line is a tool
 * call Vibe actually brokered — there is no fabricated progress, and no field
 * exists that could carry a model's own narration (§17).
 *
 * Polling is the refresh mechanism, never the source of truth: the initial
 * render comes from the server component that mounted this, a reload
 * re-fetches through the same server action, and losing the poll (a closed
 * tab, a dead connection) loses nothing — the next load reads the same rows.
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

  useEffect(() => {
    if (!status.operation.shouldPoll) return;

    const interval = setInterval(() => {
      startTransition(async () => {
        const next = await getDogfoodRunStatusAction(projectId, status.operation.operationId);
        if (next) setStatus(next);
      });
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [projectId, status.operation.operationId, status.operation.shouldPoll]);

  const { operation, activity, openInterrupt } = status;

  return (
    <div className="flex flex-col gap-6">
      <Surface level="section" padding="md" className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <p className="text-fg text-sm font-semibold">{OPERATION_STAGE_LABELS[operation.stage]}</p>
          <StatusPill tone={statusTone(operation.status)} dot={operation.shouldPoll}>
            {operation.status}
          </StatusPill>
        </div>

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
            Vibe finished. A candidate change exists and is waiting on your own validation and review — nothing
            has been merged or deployed.
          </Notice>
        )}

        {operation.status === "needs_user" && (
          <Notice tone="waiting" label="waiting on you">
            Vibe stopped to ask a question before continuing.
          </Notice>
        )}
      </Surface>

      {openInterrupt && <InterruptPanel projectId={projectId} interrupt={openInterrupt} />}

      {activity.length > 0 && (
        <Surface level="section" padding="md" className="flex flex-col gap-2">
          <MonoLabel>activity</MonoLabel>
          <ol className="flex flex-col gap-1.5">
            {activity.map((entry, index) => (
              <li key={index} className="text-fg-prose flex items-center gap-2 text-sm">
                <span className="bg-mint size-1.5 shrink-0 rounded-full" aria-hidden />
                {EXECUTION_ACTIVITY_LABELS[entry.event]}
                {entry.filesRead !== null && (
                  <span className="text-fg-muted text-xs">({entry.filesRead} files)</span>
                )}
              </li>
            ))}
          </ol>
        </Surface>
      )}
    </div>
  );
}

function statusTone(status: string): "active" | "success" | "waiting" | "problem" | "neutral" {
  if (status === "completed") return "success";
  if (status === "failed" || status === "cancelled") return "problem";
  if (status === "needs_user") return "waiting";
  return "active";
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
