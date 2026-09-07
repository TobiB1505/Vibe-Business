"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { MonoLabel } from "@/components/ui/typography";
import type { ActionPlanStep } from "@/modules/action-plans/schema";
import { attestationPrompt } from "@/modules/action-plans/view";
import {
  attestFounderActionStepAction,
  type FounderActionAttestationState,
} from "../founder-action-attestation";

/**
 * The step's own criterion, and the answer that closes it.
 *
 * ## Why this is not part of the card
 *
 * It used to be, and the card was rendered *inside* the handoff card as the
 * confirmation — which drew a second bordered panel with its own status pill,
 * its own copy of the title and its own copy of the description, directly under
 * the first. One step, twice, saying two different things about itself. The
 * founder's word for it was that they understood none of it.
 *
 * So the card owns the framing — who this belongs to and why — and this owns
 * the question and the answer. Both surfaces compose it; neither repeats the
 * other.
 */
export function AttestationForm({
  projectId,
  actionPlanId,
  step,
  handedOff = false,
}: {
  projectId: string;
  actionPlanId: string;
  step: ActionPlanStep;
  /** Whether Vibe handed this step to the founder's own tool (ADR 0096). */
  handedOff?: boolean;
}) {
  const prompt = attestationPrompt(step, handedOff);
  const action = attestFounderActionStepAction.bind(null, projectId, actionPlanId, step.id);
  const [state, formAction, pending] = useActionState<FounderActionAttestationState, FormData>(
    action,
    null,
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="border-amber-line bg-amber-tint/35 rounded-well border px-4 py-3">
        <MonoLabel className="text-amber tracking-[0.12em]">
          {prompt.finding ? "Answer this" : "Confirm when true"}
        </MonoLabel>
        {/* The step's own criterion, in its own element. Vibe writes the prompt
            beside it and never parses it into choices — it is model output, and
            model wording is not a machine API. */}
        <p className="text-fg-body mt-1.5 text-sm leading-relaxed">{step.completionCriteria}</p>
      </div>

      <form action={formAction} noValidate className="flex flex-col items-start gap-2.5">
        {prompt.finding && (
          <div className="flex w-full flex-col gap-1.5">
            <label htmlFor={`finding-${step.id}`} className="text-fg-secondary text-sm font-medium">
              {prompt.finding.label}
            </label>
            <textarea
              id={`finding-${step.id}`}
              name="finding"
              required
              rows={4}
              maxLength={1200}
              className="border-line-2 bg-surface-2 text-fg-body rounded-well w-full resize-y border px-3 py-2 text-sm leading-relaxed"
              data-testid="attestation-finding"
            />
            <p className="text-fg-muted text-xs">{prompt.finding.help}</p>
          </div>
        )}
        <Button type="submit" disabled={pending || state?.ok === true} busy={pending}>
          {pending ? "Saving…" : state?.ok ? "Recorded" : prompt.submitLabel}
        </Button>
        <p className="text-fg-muted text-xs">{prompt.footnote}</p>
      </form>

      {state && !state.ok && (
        <p role="alert" className="text-coral text-sm">
          {state.message}
        </p>
      )}
    </div>
  );
}
