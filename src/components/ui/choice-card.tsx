import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Pick one.
 *
 * ## Why this is not new artwork
 *
 * Six of these existed and the product already had two answers. Three drew a
 * card — the input `sr-only`, a mint border over a mint tint, and a ring with
 * a mint dot in it. Three rendered the platform's radio with `accent-mint` on
 * a bordered row. Nobody decided that; each screen used what was nearby.
 *
 * This is the first one, extracted. The mark is the same ring and the same
 * `size-2.5` dot `founder-input-card` has always drawn, at the same sizes,
 * because "wie heute" was the decision — the point is that there is now one of
 * it, not that it looks different.
 *
 * ## Why the mark stays, when the border already says selected
 *
 * A tinted border is a *comparative* signal: it means selected only if you can
 * see the others to compare against. On a dim screen, at a glance, or for a
 * reader who does not separate mint from grey, "selected" and "hovered" sit
 * close together. A dot is absolute — it is there or it is not — which is the
 * one thing the platform's radio was genuinely doing, and the reason removing
 * it entirely was the wrong simplification.
 *
 * ## The focus ring, which the original did not have
 *
 * `sr-only` hides the input in a 1px clipped box, so the browser drew the
 * focus outline there: a keyboard user tabbing through these three cards saw
 * nothing move. `has-[:focus-visible]:` puts the ring back on the card, which
 * is the part that can be seen.
 *
 * ## Two surfaces, one mark
 *
 * `card` is the default and is what the choices in a flow use. `row` exists
 * for the repository picker, where the options are an unbounded list from
 * GitHub rather than two or three authored alternatives — fifty bordered cards
 * with gaps between them is a worse list than fifty divided rows, and the
 * decision to be consistent was about the mark, not about the container.
 */
export function ChoiceCard({
  name,
  value,
  checked,
  onChange,
  disabled = false,
  label,
  detail,
  trailing,
  surface = "card",
  className,
}: {
  name: string;
  value: string | number;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  /** The line. A node, so a call site can set a badge beside the words. */
  label: ReactNode;
  /** The consequence, under the label. */
  detail?: ReactNode;
  /** Right-aligned, e.g. why an option cannot be picked. */
  trailing?: ReactNode;
  surface?: "card" | "row";
  className?: string;
}) {
  const card = surface === "card";
  return (
    <label
      className={cn(
        "flex gap-3 transition-interactive",
        // The ring goes on the label because the input it belongs to is 1px
        // and clipped. Without this the keyboard has no visible position.
        //
        // A halo rather than a hairline, and the same halo `inputClassName`
        // already focuses a field with. Tab lands on the *selected* option
        // first, and a tight mint ring on a card whose border is already mint
        // is the same two pixels twice — measured, focus was invisible on
        // exactly the card the keyboard reaches first. A translucent 4px band
        // reads outside the border in both states.
        "has-[:focus-visible]:ring-mint/30 has-[:focus-visible]:ring-4",
        card ? "rounded-field border p-4" : "px-4 py-3",
        // Centred when there is only a line to centre against; a detail makes
        // the block two lines tall and the mark belongs beside the first.
        detail ? "items-start" : "items-center",
        disabled
          ? "cursor-not-allowed opacity-50"
          : cn(
              "cursor-pointer",
              card && !checked && "hover:border-line-strong hover:bg-surface-hover",
              !card && !checked && "hover:bg-surface-hover",
            ),
        card && (checked ? "border-mint bg-mint-tint-soft" : "border-line-3 bg-surface-2"),
        !card && checked && "bg-mint-tint-soft",
        className,
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="sr-only"
      />
      <span
        aria-hidden
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-full border",
          "transition-interactive",
          detail ? "mt-0.5" : null,
          checked ? "border-mint" : "border-line-strong",
        )}
      >
        {checked && <span className="bg-mint size-2.5 rounded-full" />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-fg-body flex flex-wrap items-center gap-2 text-body font-medium">
          {label}
        </span>
        {detail && <span className="text-fg-muted text-caption leading-relaxed">{detail}</span>}
      </span>
      {trailing}
    </label>
  );
}
