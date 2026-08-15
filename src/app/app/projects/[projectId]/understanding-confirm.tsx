"use client";

import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, inputClassName } from "@/components/ui/field";
import { Surface } from "@/components/ui/surface";
import { MAX_CORRECTION_LENGTH } from "@/modules/product-understanding/schema";
import {
  confirmUnderstandingAction,
  saveCorrectionsAction,
  type SaveCorrectionsState,
} from "./understanding-actions";

/**
 * "Did I get this right?" (CORE-1 §23, §24, §32).
 *
 * ## Why this is the most important control in the sprint
 *
 * If Vibe is right, this is the moment a founder decides it understands their
 * product. If Vibe is wrong, this is the only path by which it stops being
 * wrong — and a correction here outranks every scanner permanently, so the
 * cost of getting the flow wrong is a product that keeps confidently
 * misdescribing someone's work.
 *
 * ## What is editable, and what is not
 *
 * Six semantic fields, and nothing else. Scanner evidence is deliberately not
 * editable (CORE-1 §24): correcting "who this is for" tells Vibe something it
 * genuinely could not know, while editing "your code contains a pricing page"
 * would be overwriting an observation with an opinion.
 *
 * ## Accessibility
 *
 * Both paths are real `<button>`s inside real `<form>`s. The editor is a
 * plain form with labelled fields — no dialog, no focus trap, no custom
 * keyboard handling to get wrong. Opening it replaces the two buttons in
 * place, so focus stays where the user put it.
 */

export type EditableValues = {
  name: string;
  shortDescription: string;
  understanding: string;
  mainPurpose: string;
  mainPromise: string;
  primaryAudience: string;
  problemSolved: string;
};

const FIELDS: { name: keyof EditableValues; label: string; hint: string; long: boolean }[] = [
  { name: "name", label: "Product name", hint: "What you call it.", long: false },
  {
    name: "shortDescription",
    label: "One-line description",
    hint: "How you would describe it in a sentence.",
    long: false,
  },
  {
    name: "understanding",
    label: "What your product does",
    hint: "Two or three sentences, in your own words.",
    long: true,
  },
  { name: "mainPurpose", label: "What it's for", hint: "The job it exists to do.", long: false },
  {
    name: "mainPromise",
    label: "What you promise",
    hint: "The value someone gets from using it.",
    long: false,
  },
  {
    name: "primaryAudience",
    label: "Who it's for",
    hint: "The people you built it for.",
    long: false,
  },
  {
    name: "problemSolved",
    label: "The problem it solves",
    hint: "What is hard without it.",
    long: true,
  },
];

export function UnderstandingConfirm({
  projectId,
  profileId,
  values,
}: {
  projectId: string;
  profileId: string;
  /** Current values, so the editor starts from what Vibe said rather than blank. */
  values: EditableValues;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, startConfirm] = useTransition();

  const save = saveCorrectionsAction.bind(null, projectId, profileId);
  const [saveState, saveAction, saving] = useActionState<SaveCorrectionsState, FormData>(save, null);

  if (!editing) {
    return (
      <div className="flex flex-col items-center gap-3">
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button
            type="button"
            disabled={confirming}
            onClick={() =>
              startConfirm(async () => {
                await confirmUnderstandingAction(projectId, profileId);
              })
            }
          >
            {confirming ? "Saving…" : "Yes, that's my product"}
          </Button>
          <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
            Let me fix it
          </Button>
        </div>
        {saveState?.ok === false && (
          <p className="text-amber text-sm">That couldn&apos;t be saved. Try again in a moment.</p>
        )}
      </div>
    );
  }

  return (
    <Surface level="section" padding="lg" className="w-full text-left">
      <form action={saveAction} className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h3 className="text-fg text-base font-semibold">Tell Vibe what it got wrong</h3>
          <p className="text-fg-muted text-sm">
            Anything you write here outranks what Vibe worked out on its own, and it stays that way
            the next time Vibe looks at your product.
          </p>
        </div>

        {FIELDS.map((field) => (
          <Field key={field.name} id={field.name} label={field.label} hint={field.hint}>
            {field.long ? (
              <textarea
                id={field.name}
                name={field.name}
                defaultValue={values[field.name]}
                maxLength={MAX_CORRECTION_LENGTH}
                rows={3}
                aria-describedby={`${field.name}-hint`}
                className={inputClassName}
              />
            ) : (
              <Input
                id={field.name}
                name={field.name}
                type="text"
                defaultValue={values[field.name]}
                maxLength={MAX_CORRECTION_LENGTH}
                aria-describedby={`${field.name}-hint`}
              />
            )}
          </Field>
        ))}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save what I changed"}
          </Button>
          <Button type="button" variant="secondary" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>

        <p className="text-fg-meta text-xs">
          Leaving a field empty clears your correction and lets Vibe answer that one again.
        </p>
      </form>
    </Surface>
  );
}
