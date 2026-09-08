"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChoicePills, ChosenPills } from "@/components/ui/choice-pills";
import {
  GOAL_LABELS,
  MONETIZATION_LABELS,
  MONETIZATION_MODELS,
  PRIMARY_GOALS,
  PROJECT_STAGES,
  STAGE_LABELS,
  isEmptyFounderIntent,
  type FounderIntent,
  type MonetizationModel,
  type PrimaryGoal,
  type ProjectStage,
} from "@/modules/projects/founder-intent";
import type { SaveFounderIntentFailure } from "@/modules/projects/founder-intent-store";
import { saveFounderIntentAction, type FounderIntentActionState } from "./founder-intent-action";
import { DismissIcon, EditIcon } from "@/components/ui/icons.generated";

/**
 * Founder intent (CORE-2 §4; rebuilt UI-25).
 *
 * Three questions, none required, no free text. What used to be a paragraph
 * the founder had to write about their own product before Vibe would audit it
 * is now answered by the Product Profile, from evidence — so this asks only
 * for the things evidence genuinely cannot see.
 *
 * Nothing sensitive is requested: no revenue, no financial data, no personal
 * information.
 *
 * ## Why it stopped being three dropdowns
 *
 * Because a dropdown is the right control for a long list nobody needs to read
 * and the wrong one for a short set of authored alternatives that *is* the
 * question. Four, eight and six options, each label a complete answer — all of
 * them hidden behind a click, rendered by the operating system rather than by
 * Vibe, under labels that read like a schema: *Stage*, *Monetization you're
 * planning*, *Primary goal*.
 *
 * They are questions now, in the words a founder would use, and every possible
 * answer is on screen. The point is not that a pill is prettier than a
 * `<select>`; it is that seeing the eight monetization options is most of what
 * makes the question answerable.
 *
 * ## Why the read state is the same object
 *
 * It was a `dl` with a 128px label column — a spec sheet, and a different
 * shape from the thing that edits it, so saving swapped one layout for
 * another. It is the chosen pills now: what you answered, drawn the way you
 * answered it.
 */

const ERROR_MESSAGES: Record<SaveFounderIntentFailure, string> = {
  invalid_stage: "Choose a valid stage.",
  invalid_monetization_model: "Choose a valid monetization model.",
  invalid_primary_goal: "Choose a valid goal.",
  project_not_found: "This project could not be found.",
  save_failed: "This could not be saved. Try again in a moment.",
};

const initialState: FounderIntentActionState = null;

const STAGE_OPTIONS = PROJECT_STAGES.map((stage) => ({
  value: stage,
  label: STAGE_LABELS[stage],
}));
const MONETIZATION_OPTIONS = MONETIZATION_MODELS.map((model) => ({
  value: model,
  label: MONETIZATION_LABELS[model],
}));
const GOAL_OPTIONS = PRIMARY_GOALS.map((goal) => ({ value: goal, label: GOAL_LABELS[goal] }));

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

  /*
    Controlled, because a pill group has to be clearable and an uncontrolled
    radio set cannot be unchecked by anything but another radio. Seeded from
    the saved intent each time the form opens.
  */
  const [stage, setStage] = useState<ProjectStage | null>(intent.stage);
  const [monetization, setMonetization] = useState<MonetizationModel | null>(
    intent.monetizationModel,
  );
  const [goal, setGoal] = useState<PrimaryGoal | null>(intent.primaryGoal);

  if (!editing && !empty) {
    return (
      <div className="flex flex-col items-start gap-4">
        <ChosenPills
          items={[
            ...(intent.stage ? [{ term: "Stage", label: STAGE_LABELS[intent.stage] }] : []),
            ...(intent.monetizationModel
              ? [{ term: "Money", label: MONETIZATION_LABELS[intent.monetizationModel] }]
              : []),
            ...(intent.primaryGoal
              ? [{ term: "Goal", label: GOAL_LABELS[intent.primaryGoal] }]
              : []),
          ]}
        />
        <Button
          variant="ghost"
          icon={<EditIcon size={14} />}
          onClick={() => {
            // Back to what is saved, so a cancelled edit leaves nothing behind.
            setStage(intent.stage);
            setMonetization(intent.monetizationModel);
            setGoal(intent.primaryGoal);
            setEditing(true);
          }}
        >
          Change your answers
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <ChoicePills
        name="stage"
        question="Where is the product right now?"
        options={STAGE_OPTIONS}
        value={stage}
        onChange={setStage}
        disabled={pending}
      />

      <ChoicePills
        name="monetizationModel"
        question="How does it make money, or how will it?"
        options={MONETIZATION_OPTIONS}
        value={monetization}
        onChange={setMonetization}
        disabled={pending}
      />

      <ChoicePills
        name="primaryGoal"
        question="What are you working toward next?"
        options={GOAL_OPTIONS}
        value={goal}
        onChange={setGoal}
        disabled={pending}
      />

      <div className="flex items-center gap-3 pt-1">
        <Button type="submit" disabled={pending} busy={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        {!empty && (
          <Button
            variant="ghost"
            icon={<DismissIcon size={14} />}
            onClick={() => setEditing(false)}
          >
            Cancel
          </Button>
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
