"use client";

import { useId, type ReactNode } from "react";
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
        "focus-within:border-mint-line",
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
