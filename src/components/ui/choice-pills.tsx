"use client";

import { useId, type ReactNode } from "react";
import { CheckIcon } from "@/components/ui/icons.generated";
import { InlineAction } from "@/components/ui/inline-action";
import { DismissIcon } from "@/components/ui/icons.generated";
import { cn } from "@/lib/utils/cn";

/**
 * One answer, out of a handful, all visible (UI-25).
 *
 * ## What this replaces, and why
 *
 * Three native `<select>` elements. A dropdown is the right control for a long
 * list nobody needs to read — a country, a timezone — and the wrong one for a
 * short set of authored alternatives that *is* the question. It hides the
 * options behind a click, renders as the operating system rather than as Vibe,
 * and turns "what are you working toward?" into a database field labelled
 * *Primary goal*.
 *
 * ## Why not `ChoiceCard`
 *
 * Vibe owns one already, and it is the right component where it is used: a
 * bordered card per option, with a radio mark, for two or three alternatives
 * that each need a sentence of explanation. These three questions have four,
 * eight and six options whose labels are the whole answer — eighteen cards is
 * a page, and the detail slot would be empty on every one of them.
 *
 * ## The mark, and the objection it answers
 *
 * `ChoiceCard`'s docblock makes the case for keeping a dot when the border
 * already says selected: a tinted border is a *comparative* signal, readable
 * only against the unselected ones beside it. That argument applies here and
 * is why a selected pill is not merely tinted — it is **filled**, inverting
 * text and ground, and it carries a tick. Both are absolute: they are there or
 * they are not, with nothing to compare against.
 *
 * ## Clearing
 *
 * There is no "Not specified" pill. It would sit among the real answers
 * looking like one, and the honest shape of "no answer" is no pill selected.
 * The clear control appears only once something is selected, so an untouched
 * question offers nothing to undo. With no radio checked the field is absent
 * from the submission, which the domain layer already reads as null.
 */
export function ChoicePills<Value extends string>({
  name,
  question,
  hint,
  options,
  value,
  onChange,
  disabled = false,
}: {
  name: string;
  /** Asked as a question, in the founder's terms — not a column heading. */
  question: string;
  hint?: ReactNode;
  options: readonly { value: Value; label: string }[];
  value: Value | null;
  onChange: (next: Value | null) => void;
  disabled?: boolean;
}) {
  const labelId = useId();

  return (
    <fieldset
      className={cn(
        "flex min-w-0 flex-col gap-2.5",
        // A rule between the groups, so three questions read as three blocks
        // rather than as one column of text with pills in it. The first is
        // flush with the paragraph above it and needs no line of its own.
        "border-line-1 [&:not(:first-of-type)]:border-t [&:not(:first-of-type)]:pt-5",
      )}
      disabled={disabled}
    >
      {/*
        Beside the question, not at the far edge of the card.

        `justify-between` put it against the right border, ~700px from the
        words it undoes — the same separation of a control from its own
        sentence that UI-21 measured on this page and UI-24 fixed in the danger
        zone.
      */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {/*
          A step above the answers, not level with them — and measured, not
          guessed.

          It was `text-body font-medium`: the same size as the eighteen pill
          labels under it, so the questions read as three more lines in a wall
          rather than as the structure of the section. The first attempt at
          fixing that used `text-ui`, which is **0.8125rem against body's
          0.875rem** — smaller. `text-lead` (0.9375rem) is the next step up and
          the one that leaves `text-title` to the section heading above.
        */}
        <legend id={labelId} className="text-fg text-lead font-semibold">
          {question}
        </legend>
        {value !== null && (
          <InlineAction
            icon={<DismissIcon size={13} />}
            onClick={() => onChange(null)}
            data-testid={`clear-${name}`}
          >
            Clear
          </InlineAction>
        )}
      </div>
      {hint && <p className="text-fg-muted max-w-[62ch] text-caption">{hint}</p>}

      <div role="radiogroup" aria-labelledby={labelId} className="flex flex-wrap gap-2">
        {options.map((option) => {
          const checked = value === option.value;
          return (
            <label
              key={option.value}
              className={cn(
                "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3.5 py-1.5",
                "text-body transition-interactive select-none",
                // The ring goes on the label because the input it belongs to is
                // 1px and clipped, the same reason `ChoiceCard` does it.
                "has-[:focus-visible]:ring-mint/30 has-[:focus-visible]:ring-4",
                checked
                  ? "bg-mint border-mint text-mint-ink font-semibold"
                  : "border-line-3 bg-surface-2 text-fg-body hover:border-line-strong hover:bg-surface-hover",
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={checked}
                onChange={() => onChange(option.value)}
                className="sr-only"
              />
              {checked && <CheckIcon size={14} aria-hidden />}
              {option.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * The same answers, at rest.
 *
 * The read state was a `dl` with a 128px label column — a spec sheet, and a
 * different object from the thing that edits it. These are the pills that were
 * chosen, unselectable, so a founder recognises what they answered rather than
 * reading it back in another form.
 */
export function ChosenPills({ items }: { items: readonly { term: string; label: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {items.map((item) => (
        <li
          key={item.term}
          className="border-line-3 bg-surface-2 inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5"
        >
          <span className="text-fg-meta text-caption">{item.term}</span>
          <span className="text-fg-body text-body font-medium">{item.label}</span>
        </li>
      ))}
    </ul>
  );
}
