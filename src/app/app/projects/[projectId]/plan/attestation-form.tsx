"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { MonoLabel } from "@/components/ui/typography";
import type { ActionPlanStep } from "@/modules/action-plans/schema";
import type { HandoffPurpose } from "@/modules/handoff/schema";
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
  handoff = null,
}: {
  projectId: string;
  actionPlanId: string;
  step: ActionPlanStep;
  /** Which prompt Vibe issued for this step, if any (ADR 0099). */
  handoff?: HandoffPurpose | null;
}) {
  const prompt = attestationPrompt(step, handoff ?? null);
  const action = attestFounderActionStepAction.bind(null, projectId, actionPlanId, step.id);
  const [state, formAction, pending] = useActionState<FounderActionAttestationState, FormData>(
    action,
    null,
  );

  return (
    <div className="flex flex-col gap-4">
      {/* The step's own criterion, in its own element. Vibe writes the prompt
          beside it and never parses it into choices — it is model output, and
          model wording is not a machine API.

          Absent on a handed-off step, and that is the point: the prompt above
          already carries this exact sentence as its `DONE WHEN:` line, so a
          second copy under "Answer this" asked the founder to answer something
          their tool had already been given. */}
      {prompt.criterion && (
        <div className="border-amber-line bg-amber-tint/35 rounded-well border px-4 py-3">
          <MonoLabel className="text-amber tracking-[0.12em]">{prompt.criterion.label}</MonoLabel>
          <p className="text-fg-body mt-1.5 text-body leading-relaxed">{step.completionCriteria}</p>
        </div>
      )}

      <form action={formAction} noValidate className="flex flex-col items-start gap-2.5">
        {prompt.finding && (
          <Field
            id={`finding-${step.id}`}
            label={prompt.finding.label}
            hint={prompt.finding.help}
            className="w-full"
          >
            <Textarea
              id={`finding-${step.id}`}
              name="finding"
              required
              rows={4}
              maxLength={1200}
              aria-describedby={`finding-${step.id}-hint`}
              data-testid="attestation-finding"
            />
          </Field>
        )}
        <Button type="submit" disabled={pending || state?.ok === true} busy={pending}>
          {pending ? "Saving…" : state?.ok ? "Recorded" : prompt.submitLabel}
        </Button>
        <p className="text-fg-muted text-caption">{prompt.footnote}</p>
      </form>

      {state && !state.ok && (
        <p role="alert" className="text-coral text-body">
          {state.message}
        </p>
      )}
    </div>
  );
}
