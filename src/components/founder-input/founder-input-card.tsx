"use client";

import { useActionState, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Button } from "@/components/ui/button";
import { CheckIcon } from "@/components/ui/dashboard-icons";
import { ChoiceCard } from "@/components/ui/choice-card";
import { Disclosure } from "@/components/ui/disclosure";
import { Textarea } from "@/components/ui/field";
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
  presentation = "card",
  openRequestCount = 1,
  onResolved,
}: {
  projectId: string;
  request: FounderInputRequest;
  context: "action_plan" | "runtime_execution";
  resolveAction: FounderInputResolutionAction;
  presentation?: "card" | "workspace";
  /** Real open requests on this plan. Used only to orient the current question. */
  openRequestCount?: number;
  /** Refreshes or advances the owning workspace after a confirmed answer. */
  onResolved?: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const initialChoice = request.recommendation
    ? "recommendation"
    : request.responseType === "text"
      ? "custom"
      : request.alternatives[0]
        ? `option:${request.alternatives[0].id}`
        : null;
  const [selectedChoice, setSelectedChoice] = useState<string | null>(initialChoice);
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

  if (presentation === "workspace" && !runtime) {
    const options = [
      ...(request.recommendation
        ? [
            {
              value: "recommendation",
              label: request.recommendation.label,
              explanation: request.recommendation.explanation,
              recommended: true,
            },
          ]
        : []),
      ...request.alternatives.map((option) => ({
        value: `option:${option.id}`,
        label: option.label,
        explanation: option.explanation,
        recommended: false,
      })),
    ];
    const resolvedAnswer =
      selectedChoice === "recommendation"
        ? request.recommendation?.label ?? "Vibe's recommendation"
        : selectedChoice === "custom"
          ? "Your own answer"
          : options.find((option) => option.value === selectedChoice)?.label ?? "Your answer";

    if (state?.ok) {
      return (
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={
            reduceMotion ? { duration: 0 } : { duration: 0.38, ease: [0.22, 0.72, 0.18, 1] }
          }
          className="border-mint-line bg-mint-tint-soft flex flex-col gap-5 rounded-panel border p-5"
          role="status"
        >
          <div className="flex items-start gap-3">
            <span className="border-mint-line bg-mint-tint text-mint flex size-9 shrink-0 items-center justify-center rounded-full border">
              <CheckIcon size={16} />
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <h3 className="text-fg text-title font-semibold">Got it</h3>
              <p className="text-fg-body text-body">{resolvedAnswer}</p>
              <p className="text-fg-muted text-caption leading-relaxed">
                {openRequestCount > 1
                  ? "Your answer is saved. Vibe has another question for this Move."
                  : "Your answer is saved. Vibe can continue planning this Move."}
              </p>
            </div>
          </div>
          {onResolved ? (
            <Button type="button" onClick={onResolved} className="self-start">
              {openRequestCount > 1 ? "Next question" : "Continue planning"}
            </Button>
          ) : null}
        </motion.div>
      );
    }

    return (
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-4">
            <p className="text-fg-secondary text-caption font-medium">
              {openRequestCount === 1 ? "1 open question" : `${openRequestCount} open questions`}
            </p>
            <span className="text-fg-meta text-meta">Your answer becomes project context</span>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-fg text-moment font-semibold">{request.question}</h3>
          <p className="text-fg-prose text-body leading-relaxed">
            Choose the direction that fits your business right now.
          </p>
        </div>

        <form action={formAction} noValidate aria-busy={pending} className="flex flex-col gap-3">
          {selectedChoice === "custom" && !request.allowCustom && (
            <input type="hidden" name="choice" value="custom" />
          )}
          {options.map((option) => {
            const selected = selectedChoice === option.value;
            return (
              <ChoiceCard
                key={option.value}
                name="choice"
                value={option.value}
                checked={selected}
                onChange={() => {
                  setSelectedChoice(option.value);
                  setCustomOpen(false);
                }}
                disabled={pending}
                label={
                  <>
                    {option.label}
                    {option.recommended && (
                      <span className="bg-mint-tint text-mint rounded-full px-2 py-0.5 text-meta font-medium">
                        Suggested by Vibe
                      </span>
                    )}
                  </>
                }
                detail={option.explanation}
              />
            );
          })}

          {request.allowCustom && (
            <ChoiceCard
              name="choice"
              value="custom"
              checked={selectedChoice === "custom"}
              onChange={() => {
                setSelectedChoice("custom");
                setCustomOpen(true);
              }}
              disabled={pending}
              label="Something else"
              detail="Give Vibe a different answer"
            />
          )}

          {customOpen && selectedChoice === "custom" && (
            <div className="flex flex-col gap-2 pt-1">
              <label htmlFor={customInputId} className="text-fg-secondary text-body font-medium">
                Your answer
              </label>
              <Textarea
                id={customInputId}
                name="customAnswer"
                maxLength={1200}
                rows={4}
                disabled={pending}
                aria-describedby={customHelpId}
                placeholder="Write the direction or information Vibe should use."
              />
              <p id={customHelpId} className="text-fg-muted text-caption leading-relaxed">
                Do not include passwords, credentials, API keys, or tokens.
              </p>
            </div>
          )}

          {request.recommendation && (
            <Button
              variant="ghost"
              onClick={() => {
                setSelectedChoice("recommendation");
                setCustomOpen(false);
              }}
              className="mt-1 self-start"
            >
              I&apos;m not sure — use Vibe&apos;s recommendation
            </Button>
          )}

          <div className="border-line-2 mt-2 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <Disclosure label="Why is Vibe asking?" className="max-w-xl">
              <p className="text-fg-muted text-caption leading-relaxed">{request.whyNeeded}</p>
            </Disclosure>
            <Button type="submit" disabled={pending || selectedChoice === null} busy={pending}>
              {pending ? "Saving…" : "Continue"}
            </Button>
          </div>

          {state && !state.ok && (
            <p role="alert" aria-live="polite" className="text-amber text-body">
              {state.message}
            </p>
          )}
        </form>
      </div>
    );
  }

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
        <h3 className="text-fg text-moment font-semibold">{request.question}</h3>
        <p className="text-fg-prose max-w-2xl text-body leading-relaxed">{request.whyNeeded}</p>
        {runtime ? (
          <p className="text-fg-muted text-caption leading-relaxed">
            After you answer, Vibe checks the project again and starts a fresh attempt.
          </p>
        ) : null}
      </div>

      <form action={formAction} noValidate aria-busy={pending} className="flex flex-col gap-3">
        {request.recommendation ? (
          <div className="border-mint-line bg-mint-tint/40 flex flex-col gap-3 rounded-field border p-4">
            <MonoLabel className="tracking-[0.14em]">Vibe recommends</MonoLabel>
            <div className="flex flex-col gap-1">
              <p className="text-fg font-semibold">{request.recommendation.label}</p>
              {request.recommendation.explanation ? (
                <p className="text-fg-secondary text-body leading-relaxed">
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
            <p className="text-fg-secondary text-body font-medium">Other options</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {request.alternatives.map((option) => (
                <button
                  key={option.id}
                  type="submit"
                  name="choice"
                  value={`option:${option.id}`}
                  disabled={pending}
                  className="border-line-3 bg-surface-2 hover:border-mint-line focus-visible:ring-mint flex cursor-pointer flex-col gap-1 rounded-field border p-3 text-left transition-interactive focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="text-fg text-body font-medium">{option.label}</span>
                  {option.explanation ? (
                    <span className="text-fg-muted text-caption leading-relaxed">
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
            disabled={pending}
            onClick={() => setCustomOpen(true)}
            className="self-start"
          >
            Something else
          </Button>
        ) : null}

        {customOpen ? (
          <div className="flex flex-col gap-2">
            <label htmlFor={customInputId} className="text-fg-secondary text-body font-medium">
              Your answer
            </label>
            <Textarea
              id={customInputId}
              name="customAnswer"
              maxLength={1200}
              rows={4}
              disabled={pending}
              aria-describedby={customHelpId}
              placeholder="Write the direction or information Vibe should use."
            />
            <p id={customHelpId} className="text-fg-muted text-caption leading-relaxed">
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
          <p role="alert" aria-live="polite" className="text-amber text-body">
            {state.message}
          </p>
        ) : null}
      </form>
    </Surface>
  );
}
