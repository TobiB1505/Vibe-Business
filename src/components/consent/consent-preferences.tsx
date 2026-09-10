"use client";

import { useState } from "react";
import {
  CATEGORY_DESCRIPTIONS,
  CONSENT_CATEGORIES,
  type ConsentChoices,
  type ConsentCategory,
} from "@/modules/consent/categories";
import { cn } from "@/lib/utils/cn";

/**
 * The categories, with a switch on the ones that are actually a choice (UI-23).
 *
 * One component for two places — the banner's expanded state and Settings →
 * General — because they are the same question and a second copy is a second
 * copy of the category list to keep in step. Sprint 0153 made the same
 * argument about a table of contents: a list written twice drifts the first
 * time somebody edits one of them, silently, because nothing breaks.
 *
 * ## Why `necessary` shows a state and not a switch
 *
 * A disabled switch is still a switch: it says *this could be off, and
 * somebody decided for you*. What is true is that these are not optional, so
 * the row says "Always on" as text. Nothing to click, nothing implied.
 *
 * ## Why every row names what it gates
 *
 * "Analytics cookies help us improve your experience" is the sentence every
 * banner writes and nobody believes, and it is unverifiable by construction.
 * These name the recipient and the thing: *Vercel Web Analytics — page views*.
 * A reader can check every line of it against the page source.
 */
export function ConsentPreferences({
  value,
  onChange,
  className,
}: {
  value: ConsentChoices;
  onChange: (next: ConsentChoices) => void;
  className?: string;
}) {
  return (
    <ul className={cn("divide-line-2 flex flex-col divide-y", className)}>
      {CONSENT_CATEGORIES.map((category) => (
        <CategoryRow
          key={category}
          category={category}
          value={value}
          onChange={onChange}
        />
      ))}
    </ul>
  );
}

function CategoryRow({
  category,
  value,
  onChange,
}: {
  category: ConsentCategory;
  value: ConsentChoices;
  onChange: (next: ConsentChoices) => void;
}) {
  const description = CATEGORY_DESCRIPTIONS[category];
  const optional = description.optional;
  const checked = optional ? value[category as keyof ConsentChoices] : true;

  return (
    <li className="flex items-start justify-between gap-5 py-4 first:pt-0 last:pb-0">
      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="text-fg-body text-body font-semibold">{description.title}</p>
        <p className="text-fg-muted max-w-[62ch] text-caption leading-relaxed">
          {description.summary}
        </p>
        <ul className="text-fg-meta flex flex-col gap-1 text-caption">
          {description.gates.map((gate) => (
            <li key={gate} className="flex gap-2">
              <span aria-hidden>·</span>
              {gate}
            </li>
          ))}
        </ul>
      </div>

      {optional ? (
        <ConsentSwitch
          label={description.title}
          checked={checked}
          onChange={(next) =>
            onChange({ ...value, [category as keyof ConsentChoices]: next })
          }
        />
      ) : (
        <span className="text-fg-meta shrink-0 pt-0.5 text-caption">Always on</span>
      )}
    </li>
  );
}

/**
 * A switch.
 *
 * `role="switch"` on a real `<button>`, which is what a two-state control
 * with an on and an off actually is — a checkbox announces "checked" where
 * this should announce "on", and the difference matters on a screen whose
 * whole subject is what is switched on.
 *
 * Written rather than sourced: this is one button, one attribute and a moving
 * dot, and the repository has no switch to reuse — the closest thing is the
 * palette switch, which is a two-option segmented control and a different
 * question.
 */
function ConsentSwitch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      data-testid={`consent-switch-${label.toLowerCase()}`}
      className={cn(
        "vibe-control relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition-interactive",
        "focus-visible:ring-mint focus-visible:ring-2 focus-visible:ring-offset-2",
        "focus-visible:ring-offset-surface-1 focus-visible:outline-none",
        checked ? "bg-mint border-mint" : "bg-surface-3 border-line-2",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute top-1/2 size-4 -translate-y-1/2 rounded-full transition-transform",
          checked ? "bg-surface-1 translate-x-[1.4rem]" : "bg-fg-muted translate-x-[0.2rem]",
        )}
      />
    </button>
  );
}

/**
 * The panel's own draft state.
 *
 * The switches move immediately and the decision is written on Save, so a
 * half-made choice is never stored — a person who turns marketing on, reads
 * the line under it and turns it back off has consented to nothing, which is
 * the only reading of that sequence that respects what they did.
 *
 * Adjusted during render rather than in an effect. The stored decision arrives
 * asynchronously (the first client render has not read the cookie yet) and a
 * second panel may save while this one is open, so the draft has to follow it
 * — but doing that in an effect renders the stale value first and then
 * replaces it, which is the extra pass `react-hooks/set-state-in-effect`
 * exists to stop. The key is the three flags, because the object identity
 * changes on every render and would resync forever.
 */
export function useDraftChoices(initial: ConsentChoices) {
  const key = `${initial.preferences}|${initial.analytics}|${initial.marketing}`;
  const [draft, setDraft] = useState(initial);
  const [seen, setSeen] = useState(key);

  if (seen !== key) {
    setSeen(key);
    setDraft(initial);
  }

  return [draft, setDraft] as const;
}
