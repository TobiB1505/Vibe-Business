"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { MonoLabel } from "@/components/ui/typography";
import {
  GOAL_LABELS,
  MONETIZATION_LABELS,
  STAGE_LABELS,
} from "@/modules/projects/founder-intent";
import type { PendingQuestion } from "@/modules/business-audit/needs-user";
import { INTENT_ANSWER_VALUES, routeAnswer } from "@/modules/business-audit/answer-routing";
import { submitFounderAnswerAction, type AnswerActionState } from "./needs-user-action";
import type { AnswerFailure } from "@/modules/business-audit/answer-service";

/**
 * "Vibe needs u" (CORE-2a.4 §29–§31).
 *
 * ## What this is not
 *
 * Not an error, not a modal, not a form. The audit is mid-thought and has
 * reached one thing it genuinely cannot work out on its own — so this reads as
 * a collaborator asking, and it lives inside the audit rather than on top of
 * it. A dialog floating over the page would say "something went wrong"; a panel
 * in the audit's own flow says "this is part of the audit".
 *
 * ## The order of the copy
 *
 * What Vibe already understood comes **first**, and the question second. That
 * ordering is the whole feel of the thing: a founder should read the context
 * and think "it worked that out by itself", and only then be asked for the one
 * piece it could not. Reversed, it is a questionnaire with a preamble.
 *
 * Nothing here is decided client-side. The question, its options and where the
 * answer will be stored all come from the server; this renders them and sends
 * back which one was chosen.
 */

const ERROR_MESSAGES: Record<AnswerFailure, string> = {
  no_pending_question: "Vibe isn't waiting on anything right now.",
  question_mismatch: "This answer was for a different question. Reload to see the current one.",
  not_storable: "Vibe can't record this kind of answer yet.",
  value_not_permitted: "Choose one of the options.",
  value_empty: "Add an answer, or say you're not sure yet.",
  unknown_intent: "Vibe isn't waiting on anything right now.",
  save_failed: "That couldn't be saved. Try again in a moment.",
};

const OPTION_LABELS: Record<string, Record<string, string>> = {
  stage: STAGE_LABELS,
  monetizationModel: MONETIZATION_LABELS,
  primaryGoal: GOAL_LABELS,
};

const initialState: AnswerActionState = null;

export function NeedsUserPanel({
  projectId,
  question,
}: {
  projectId: string;
  question: PendingQuestion;
}) {
  const router = useRouter();
  const action = submitFounderAnswerAction.bind(null, projectId);
  const [state, formAction, pending] = useActionState(action, initialState);
  const [value, setValue] = useState("");

  // The same persisted question is used in the workspace and focused
  // onboarding. Once it is answered, refresh the current route so either shell
  // resolves the resumed operation from server state.
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [router, state]);

  const destination = routeAnswer(question.intent);
  const options =
    destination?.store === "founder_intent" ? INTENT_ANSWER_VALUES[destination.field] : null;
  const labels = destination?.store === "founder_intent" ? OPTION_LABELS[destination.field] : null;

  return (
    <section
      aria-labelledby="needs-user-heading"
      className="rounded-panel border-mint/40 bg-surface-3 relative flex flex-col gap-6 overflow-hidden border p-6 sm:p-8"
    >
      <span aria-hidden="true" className="audit-intelligence-glow pointer-events-none absolute inset-0" />
      <div className="relative flex flex-col gap-3">
        <MonoLabel className="text-mint">Vibe needs u</MonoLabel>

        {/*
          What Vibe worked out on its own. Absent rather than invented when the
          evidence supports nothing specific — a fabricated premise to sound
          perceptive is worse than no premise at all.
        */}
        {question.context && (
          <p className="text-fg-secondary max-w-[62ch] text-sm leading-relaxed">
            {question.context}
          </p>
        )}

        <h3
          id="needs-user-heading"
          className="text-fg max-w-[46ch] text-xl leading-snug font-semibold tracking-[-0.025em] sm:text-2xl"
        >
          {question.prompt}
        </h3>
      </div>

      <form action={formAction} className="relative flex max-w-[48rem] flex-col gap-4">
        <input type="hidden" name="intent" value={question.intent} />

        {options ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">{question.prompt}</legend>
            {options.map((option) => (
              <label
                key={option}
                className="border-line-3 hover:border-line-4 has-checked:border-mint/60 flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 transition-[border-color]"
              >
                <input
                  type="radio"
                  name="value"
                  value={option}
                  checked={value === option}
                  onChange={() => setValue(option)}
                  className="accent-mint"
                />
                <span className="text-fg-body text-sm">{labels?.[option] ?? option}</span>
              </label>
            ))}
          </fieldset>
        ) : (
          <label className="flex flex-col gap-1">
            <span className="text-fg-muted text-xs">Your answer</span>
            <input
              name="value"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              autoComplete="off"
              className="border-line-strong bg-field text-fg-body placeholder:text-fg-meta focus:border-mint/60 focus:ring-mint/10 w-full rounded-md border px-3 py-1.5 text-sm focus:ring-4 focus:outline-none"
              placeholder="Solo founders who already shipped something"
            />
          </label>
        )}

        {state && !state.ok && (
          <p role="alert" className="text-amber text-sm">
            {ERROR_MESSAGES[state.error]}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending || value.trim() === ""} busy={pending}>
            {pending ? "Continuing…" : "Continue audit"}
          </Button>

          {/*
            A real answer, not a skip (§17). The founder is telling Vibe
            something true — that this is genuinely undecided — and the audit
            is allowed to conclude exactly that. Nothing is written, because a
            placeholder would turn an honest unknown into a fabricated fact.
          */}
          {question.allowsUnsure && (
            <Button
              type="submit"
              variant="secondary"
              name="unsure"
              value="true"
              disabled={pending}
              formNoValidate
            >
              I&rsquo;m not sure yet
            </Button>
          )}
        </div>
      </form>
    </section>
  );
}
