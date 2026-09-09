"use client";

import { useId, useRef, type ReactNode, type RefObject } from "react";
import { SearchIcon } from "@/components/ui/dashboard-icons";
import { DismissIcon } from "@/components/ui/icons.generated";
import { cn } from "@/lib/utils/cn";

/**
 * The controls above a list.
 *
 * ## Why a filter is not a field
 *
 * Both index screens used to draw their filter as a well — a border, a fill
 * and a select inside it — which is the same clothing a field wears. A field
 * asks you to supply something, can be left wrong, and is submitted. A filter
 * does none of that: it changes what you are looking at, there is no incorrect
 * answer, and nothing is sent anywhere. Dressing it as a field says the list
 * is a form you are partway through filling in.
 *
 * {@link SegmentedControl} says the opposite. Every option is visible at once,
 * so the alternatives do not have to be opened to be discovered, and the
 * current one is a state rather than a value you typed.
 *
 * ## Why sort stays in a pill
 *
 * Sorting is not the same question. A filter's options are a small closed set
 * a reader benefits from seeing; sort orders are interchangeable and nobody
 * scans them. It keeps the container it has, so the two controls read as two
 * different jobs rather than as one row of identical chips.
 *
 * ## Why the segment is made of real radios
 *
 * The visible pills are labels over `sr-only` inputs, so grouping, arrow-key
 * movement and the announcement all come from the browser. A row of buttons
 * with `aria-pressed` would need a roving tabindex, a keydown handler and a
 * `radiogroup` role to get back to where the platform already is.
 *
 * The cost is that a hidden input takes focus invisibly, which is why the
 * label carries `has-[:focus-visible]:` — the ring has to be drawn on the
 * thing you can see, not on the 1px box that has it.
 */

export type SegmentOption<T extends string> = {
  value: T;
  /** What the pill says. Kept short — every one of these is always on screen. */
  label: string;
};

export function SegmentedControl<T extends string>({
  label,
  name,
  value,
  options,
  onChange,
  className,
}: {
  /** Announced for the group. Never rendered — the pills are the labels. */
  label: string;
  name?: string;
  value: T;
  options: readonly SegmentOption<T>[];
  onChange: (value: T) => void;
  className?: string;
}) {
  const generated = useId();
  const group = name ?? generated;
  return (
    <fieldset
      className={cn(
        "border-line-2 bg-field rounded-nav inline-flex items-center gap-0.5 border p-0.5",
        className,
      )}
    >
      <legend className="sr-only">{label}</legend>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <label
            key={option.value}
            className={cn(
              "cursor-pointer rounded-[calc(var(--radius-nav)-2px)] px-3 py-1.5 text-ui font-medium",
              "transition-interactive",
              "has-[:focus-visible]:ring-mint has-[:focus-visible]:ring-2",
              selected ? "bg-surface-3 text-fg" : "text-fg-muted hover:text-fg-body",
            )}
          >
            <input
              type="radio"
              name={group}
              value={option.value}
              checked={selected}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        );
      })}
    </fieldset>
  );
}

/**
 * The sort pill.
 *
 * The one place in the product a raw `<select>` is still written by hand, and
 * deliberately: this is not a field, so it must not be `Select` from
 * `field.tsx`, and the native popup is the right geometry for four
 * interchangeable orderings. `field.test.ts` names this file as the exception
 * so the pattern has one home rather than a copy per index screen — which is
 * what it had, with two different fills.
 */
export function SortSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  /** Announced for the control. The visible "Sort:" is decoration. */
  label: string;
  value: T;
  options: readonly SegmentOption<T>[];
  onChange: (value: T) => void;
  className?: string;
}): ReactNode {
  return (
    <label
      className={cn(
        "border-line-2 bg-field rounded-nav flex items-center gap-2 border px-3 py-2.5",
        /*
         * The ring, drawn on the label (UI-31).
         *
         * The `<select>` sets `outline-none` — it has to, or the native
         * control paints its own box inside ours — and what replaced the
         * global mint ring was `focus-within:border-mint-line`: a 1px border
         * going from 8% white to **26% mint**. Measured with a real Tab press,
         * that is the whole of the focus indicator, next to a
         * `SegmentedControl` that draws a proper ring three pixels away.
         *
         * Same mechanism as that control, for the same reason: the element
         * that takes focus is not the element a sighted user is looking at.
         */
        "has-[:focus-visible]:ring-mint has-[:focus-visible]:ring-2",
        className,
      )}
    >
      <span className="text-fg-meta text-caption font-medium">Sort:</span>
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        aria-label={label}
        className="text-fg-body bg-transparent text-body font-semibold outline-none"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * The search field above a list.
 *
 * ## Why this exists, and it is not a style preference
 *
 * There were two of these, hand-written, one on each index screen — and when
 * the repositories audit (0189) found focus invisible on that one and fixed
 * it, the products page kept the defect. Measured with real Tab presses in
 * UI-33: `box-shadow: none` and a border going to 32% mint on one page,
 * `rgb(0, 229, 160) 0px 0px 0px 2px` on the other. Two copies, one repair.
 *
 * The fills had drifted too — `bg-surface-2` against `bg-field` — and only
 * one of them offered a way to clear the query.
 *
 * So the ring lives here now, on the label, for the reason {@link SortSelect}
 * records at length: the element that takes focus is a bare `<input>` with
 * `outline-none`, and it is not the element anybody is looking at.
 *
 * ## Why the clear control is optional
 *
 * Not every list wants one — a short list is faster to re-read than to clear.
 * Passing `onClear` draws it, and it returns focus to the input, because a
 * control that empties a field and then leaves the keyboard nowhere is a
 * control that costs a sighted user nothing and a keyboard user their place.
 */
export function SearchField({
  label,
  value,
  onChange,
  placeholder,
  onClear,
  clearLabel = "Clear search",
  inputRef,
  className,
}: {
  /** Announced for the input. The magnifier is decoration. */
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** Draws a clear control while there is a query. */
  onClear?: () => void;
  /**
   * What the clear control is called.
   *
   * Named rather than derived from `label`: "Clear search repositories" is
   * what a template produces and not what anybody says.
   */
  clearLabel?: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  className?: string;
}): ReactNode {
  const fallbackRef = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? fallbackRef;

  return (
    <label
      className={cn(
        "border-line-2 bg-field focus-within:border-mint-line rounded-nav",
        "flex min-w-0 items-center gap-2.5 border px-3.5 py-2.5",
        "has-[:focus-visible]:ring-mint has-[:focus-visible]:ring-2",
        className,
      )}
    >
      <SearchIcon size={16} className="text-fg-meta shrink-0" />
      <span className="sr-only">{label}</span>
      <input
        ref={ref}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="text-fg-body placeholder:text-fg-meta min-w-0 flex-1 bg-transparent text-body outline-none"
      />
      {onClear && value && (
        <button
          type="button"
          onClick={() => {
            onClear();
            ref.current?.focus();
          }}
          aria-label={clearLabel}
          /*
            `DismissIcon`, not `×`. A text character takes the font's weight
            instead of the icon frame's 1.5px and sits on the baseline rather
            than the optical centre — the defect the disclosure caret and
            `ArrowIcon` both record, in two other files.
          */
          className="text-fg-meta hover:text-fg rounded-inline transition-interactive shrink-0"
        >
          <DismissIcon size={14} />
        </button>
      )}
    </label>
  );
}
