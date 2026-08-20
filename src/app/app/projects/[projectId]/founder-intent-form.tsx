"use client";

import { useActionState, useState } from "react";
import { Button, TextAction } from "@/components/ui/button";
import {
  GOAL_LABELS,
  MONETIZATION_LABELS,
  MONETIZATION_MODELS,
  PRIMARY_GOALS,
  PROJECT_STAGES,
  STAGE_LABELS,
  isEmptyFounderIntent,
  type FounderIntent,
} from "@/modules/projects/founder-intent";
import type { SaveFounderIntentFailure } from "@/modules/projects/founder-intent-store";
import { saveFounderIntentAction, type FounderIntentActionState } from "./founder-intent-action";

/**
 * Founder intent form (CORE-2 §4).
 *
 * Three dropdowns, none required, no free text. What used to be a paragraph
 * the founder had to write about their own product before Vibe would audit it
 * is now answered by the Product Profile, from evidence — so this asks only
 * for the things evidence genuinely cannot see.
 *
 * Nothing sensitive is requested: no revenue, no financial data, no personal
 * information.
 */

const ERROR_MESSAGES: Record<SaveFounderIntentFailure, string> = {
  invalid_stage: "Choose a valid stage.",
  invalid_monetization_model: "Choose a valid monetization model.",
  invalid_primary_goal: "Choose a valid goal.",
  project_not_found: "This project could not be found.",
  save_failed: "This could not be saved. Try again in a moment.",
};

const inputClass =
  "w-full rounded-md border border-line-strong bg-field px-3 py-1.5 text-sm text-fg-body placeholder:text-fg-meta focus:border-mint/60 focus:ring-mint/10 focus:ring-4 focus:outline-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-fg-muted">{label}</span>
      {children}
    </label>
  );
}

const initialState: FounderIntentActionState = null;

export function FounderIntentForm({
  projectId,
  intent,
}: {
  projectId: string;
  intent: FounderIntent;
}) {
  const action = saveFounderIntentAction.bind(null, projectId);
  const [state, formAction, pending] = useActionState(action, initialState);
  const empty = isEmptyFounderIntent(intent);
  const [editing, setEditing] = useState(false);

  if (!editing && !empty) {
    return (
      <div className="space-y-2">
        <dl className="space-y-1 text-sm">
          {intent.stage && (
            <div className="flex gap-2">
              <dt className="w-32 shrink-0 text-fg-muted">Stage</dt>
              <dd className="text-fg-prose">{STAGE_LABELS[intent.stage]}</dd>
            </div>
          )}
          {intent.monetizationModel && (
            <div className="flex gap-2">
              <dt className="w-32 shrink-0 text-fg-muted">Monetization</dt>
              <dd className="text-fg-prose">{MONETIZATION_LABELS[intent.monetizationModel]}</dd>
            </div>
          )}
          {intent.primaryGoal && (
            <div className="flex gap-2">
              <dt className="w-32 shrink-0 text-fg-muted">Goal</dt>
              <dd className="text-fg-prose">{GOAL_LABELS[intent.primaryGoal]}</dd>
            </div>
          )}
        </dl>
        <TextAction type="button" onClick={() => setEditing(true)} className="text-xs">
          Edit what you&rsquo;re working toward
        </TextAction>
      </div>
    );
  }

  return (
    <form action={formAction} className="max-w-xl space-y-3">
      <p className="text-sm text-fg-muted">
        Vibe works out what your product is on its own. These are the things it can&rsquo;t see from
        your code or your site — all optional.
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Stage">
          <select name="stage" defaultValue={intent.stage ?? ""} className={inputClass}>
            <option value="">Not specified</option>
            {PROJECT_STAGES.map((stage) => (
              <option key={stage} value={stage}>
                {STAGE_LABELS[stage]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Monetization you're planning">
          <select
            name="monetizationModel"
            defaultValue={intent.monetizationModel ?? ""}
            className={inputClass}
          >
            <option value="">Not specified</option>
            {MONETIZATION_MODELS.map((model) => (
              <option key={model} value={model}>
                {MONETIZATION_LABELS[model]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Primary goal">
          <select name="primaryGoal" defaultValue={intent.primaryGoal ?? ""} className={inputClass}>
            <option value="">Not specified</option>
            {PRIMARY_GOALS.map((goal) => (
              <option key={goal} value={goal}>
                {GOAL_LABELS[goal]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        {!empty && (
          <TextAction type="button" onClick={() => setEditing(false)} className="text-xs">
            Cancel
          </TextAction>
        )}
      </div>

      {/* `text-danger` named no token and never has, so this alert rendered in
          whatever colour it inherited — invisible as an error, on the one
          message telling a founder their answer did not save. */}
      {state?.ok === false && (
        <p role="alert" className="text-sm text-coral">
          {ERROR_MESSAGES[state.error]}
        </p>
      )}
    </form>
  );
}
