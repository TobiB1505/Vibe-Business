"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
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
import { DismissIcon, EditIcon } from "@/components/ui/icons.generated";
import { InlineAction } from "@/components/ui/inline-action";

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
        <dl className="space-y-1 text-body">
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
        <InlineAction icon={<EditIcon size={14} />} onClick={() => setEditing(true)}>
          Edit what you&rsquo;re working toward
        </InlineAction>
      </div>
    );
  }

  return (
    <form action={formAction} className="max-w-xl space-y-3">
      <p className="text-body text-fg-muted">
        Vibe works out what your product is on its own. These are the things it can&rsquo;t see from
        your code or your site — all optional.
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field id="stage" label="Stage">
          <Select id="stage" name="stage" defaultValue={intent.stage ?? ""}>
            <option value="">Not specified</option>
            {PROJECT_STAGES.map((stage) => (
              <option key={stage} value={stage}>
                {STAGE_LABELS[stage]}
              </option>
            ))}
          </Select>
        </Field>

        <Field id="monetizationModel" label="Monetization you're planning">
          <Select
            id="monetizationModel"
            name="monetizationModel"
            defaultValue={intent.monetizationModel ?? ""}
          >
            <option value="">Not specified</option>
            {MONETIZATION_MODELS.map((model) => (
              <option key={model} value={model}>
                {MONETIZATION_LABELS[model]}
              </option>
            ))}
          </Select>
        </Field>

        <Field id="primaryGoal" label="Primary goal">
          <Select id="primaryGoal" name="primaryGoal" defaultValue={intent.primaryGoal ?? ""}>
            <option value="">Not specified</option>
            {PRIMARY_GOALS.map((goal) => (
              <option key={goal} value={goal}>
                {GOAL_LABELS[goal]}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending} busy={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        {!empty && (
          <InlineAction icon={<DismissIcon size={14} />} onClick={() => setEditing(false)}>
            Cancel
          </InlineAction>
        )}
      </div>

      {/* `text-danger` named no token and never has, so this alert rendered in
          whatever colour it inherited — invisible as an error, on the one
          message telling a founder their answer did not save. */}
      {state?.ok === false && (
        <p role="alert" className="text-body text-coral">
          {ERROR_MESSAGES[state.error]}
        </p>
      )}
    </form>
  );
}
