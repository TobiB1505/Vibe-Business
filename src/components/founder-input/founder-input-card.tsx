"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { Surface } from "@/components/ui/surface";
import { MonoLabel } from "@/components/ui/typography";
import type { FounderInputRequest } from "@/modules/founder-input/schema";

export type FounderInputFormState = { ok: true } | { ok: false; message: string } | null;

export type FounderInputResolutionAction = (
  projectId: string,
  requestId: string,
  contextHash: string,
  previous: FounderInputFormState,
  formData: FormData,
) => Promise<FounderInputFormState>;

/** Canonical response UI for planner-known and runtime-discovered founder input. */
export function FounderInputCard({
  projectId,
  request,
  context,
  resolveAction,
}: {
  projectId: string;
  request: FounderInputRequest;
  context: "action_plan" | "runtime_execution";
  resolveAction: FounderInputResolutionAction;
}) {
  const [customOpen, setCustomOpen] = useState(
    request.responseType === "text" && request.recommendation === null,
  );
  const action = resolveAction.bind(null, projectId, request.id, request.contextHash);
  const [state, formAction, pending] = useActionState<FounderInputFormState, FormData>(
    action,
    null,
  );
  const customInputId = `founder-input-${request.id}`;
  const customHelpId = `${customInputId}-help`;
  const runtime = context === "runtime_execution";

  return (
    <Surface
      level={runtime ? "section" : "card"}
      padding={runtime ? "md" : "lg"}
      tone={runtime ? "amber" : "mint"}
      className="flex flex-col gap-5"
    >
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={runtime ? "waiting" : "active"} dot>
            {runtime ? "Execution paused" : "Start here"}
          </StatusPill>
          <StatusPill tone="waiting">
            Needs your {request.kind === "decision" ? "decision" : "input"}
          </StatusPill>
        </div>
        <h3 className="text-fg text-xl leading-snug font-semibold">{request.question}</h3>
        <p className="text-fg-prose max-w-2xl text-sm leading-relaxed">{request.whyNeeded}</p>
        {runtime ? (
          <p className="text-fg-muted text-xs leading-relaxed">
            After you answer, Vibe checks the project again and starts a fresh attempt.
          </p>
        ) : null}
      </div>

      <form action={formAction} noValidate aria-busy={pending} className="flex flex-col gap-3">
        {request.recommendation ? (
          <div className="border-mint-line bg-mint-tint/40 flex flex-col gap-3 rounded-xl border p-4">
            <MonoLabel className="tracking-[0.14em]">Vibe recommends</MonoLabel>
            <div className="flex flex-col gap-1">
              <p className="text-fg font-semibold">{request.recommendation.label}</p>
              {request.recommendation.explanation ? (
                <p className="text-fg-secondary text-sm leading-relaxed">
                  {request.recommendation.explanation}
                </p>
              ) : null}
            </div>
            <Button
              type="submit"
              name="choice"
              value="recommendation"
              disabled={pending}
              busy={pending}
              className="self-start"
            >
              Use Vibe&apos;s recommendation
            </Button>
          </div>
        ) : null}

        {request.alternatives.length > 0 ? (
          <div className="flex flex-col gap-2">
            <p className="text-fg-secondary text-sm font-medium">Other options</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {request.alternatives.map((option) => (
                <button
                  key={option.id}
                  type="submit"
                  name="choice"
                  value={`option:${option.id}`}
                  disabled={pending}
                  className="border-line-3 bg-surface-2 hover:border-mint-line focus-visible:ring-mint flex cursor-pointer flex-col gap-1 rounded-xl border p-3 text-left transition-interactive focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="text-fg text-sm font-medium">{option.label}</span>
                  {option.explanation ? (
                    <span className="text-fg-muted text-xs leading-relaxed">
                      {option.explanation}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {request.allowCustom && !customOpen ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() => setCustomOpen(true)}
            className="self-start"
          >
            Something else
          </Button>
        ) : null}

        {customOpen ? (
          <div className="flex flex-col gap-2">
            <label htmlFor={customInputId} className="text-fg-secondary text-sm font-medium">
              Your answer
            </label>
            <textarea
              id={customInputId}
              name="customAnswer"
              maxLength={1200}
              rows={4}
              disabled={pending}
              aria-describedby={customHelpId}
              className="border-line-3 bg-surface-1 text-fg placeholder:text-fg-meta focus:border-mint-line focus:ring-mint min-h-28 resize-none rounded-xl border px-3 py-2 text-sm leading-relaxed outline-none focus:ring-1 disabled:opacity-60"
              placeholder="Write the direction or information Vibe should use."
            />
            <p id={customHelpId} className="text-fg-muted text-xs leading-relaxed">
              Do not include passwords, credentials, API keys, or tokens.
            </p>
            <Button
              type="submit"
              name="choice"
              value="custom"
              disabled={pending}
              busy={pending}
              className="self-start"
            >
              {runtime ? "Save answer and start fresh attempt" : "Use this answer"}
            </Button>
          </div>
        ) : null}

        {state && !state.ok ? (
          <p role="alert" aria-live="polite" className="text-amber text-sm">
            {state.message}
          </p>
        ) : null}
      </form>
    </Surface>
  );
}
