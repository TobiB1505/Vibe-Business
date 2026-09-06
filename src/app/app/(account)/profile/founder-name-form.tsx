"use client";

import { useActionState } from "react";

import { buttonClasses } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { MAX_FOUNDER_NAME_LENGTH } from "@/modules/auth/founder-name";

import { saveFounderNameAction, type SaveFounderNameState } from "./founder-name-actions";

/**
 * The one field this product asks about a person.
 *
 * ## Why it says what it is for
 *
 * A name box with no explanation is a name box a founder fills in because
 * forms have them. This one says who uses it and what happens without it, so
 * giving a name is a decision rather than a reflex — and so is leaving it
 * empty, which stays a supported answer rather than an unfinished profile.
 *
 * ## Why clearing it is the same button
 *
 * Emptying the box and saving removes the name. There is no separate "remove"
 * control, because from the founder's side it is one gesture: they edited the
 * field and saved it. The store turns an empty value into a deletion, so "no
 * name" has one representation rather than two.
 */
export function FounderNameForm({ current }: { current: string | null }) {
  const [state, action, pending] = useActionState<SaveFounderNameState, FormData>(
    saveFounderNameAction,
    null,
  );

  /*
   * What the server last stored wins over what the page was rendered with, so
   * the field shows the saved value — including the normalized form, when it
   * differs from what was typed.
   */
  const value = state?.ok === true ? state.name : current;

  return (
    <form action={action} className="flex flex-col gap-3" data-testid="founder-name-form">
      <Field
        id="founder-display-name"
        label="What should Nova call you?"
        hint="Used when Vibe writes to you. Leave it empty and Vibe uses your GitHub login or your email address instead."
        error={state?.ok === false ? "That did not save. Try again." : undefined}
      >
        <Input
          id="founder-display-name"
          name="displayName"
          defaultValue={value ?? ""}
          key={value ?? ""}
          maxLength={MAX_FOUNDER_NAME_LENGTH}
          autoComplete="given-name"
          placeholder="Your first name"
          disabled={pending}
        />
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={buttonClasses({ size: "sm" })} disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </button>

        {/*
          Only after a save, and only about what actually happened. A form that
          says "saved" on every render says it about renders, not about saves.
        */}
        {state?.ok === true && (
          <p role="status" className="text-fg-muted text-xs">
            {state.name === null ? "Name removed." : `Saved. Nova will call you ${state.name}.`}
          </p>
        )}
      </div>
    </form>
  );
}
