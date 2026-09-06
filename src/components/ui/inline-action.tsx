import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * A control that lives inside text: a mark and a word, in a container.
 *
 * ## What it inherits from the dismissal, and what it could not
 *
 * `IconButton` settled two things that hold everywhere. **A container exists
 * at rest**, because touch has no hover and a control without a resting
 * container is not a control on a phone. And **press is a visible step past
 * hover**, because a pointer gets three states while a finger gets two, and
 * the last one is the only feedback it receives.
 *
 * The third thing — a 32px filled circle — does not hold here. There is one
 * dismissal per overlay and sixty-five of these, in the middle of sentences
 * and table rows. Sixty-five filled circles is furniture, not affordance.
 *
 * So the container is shaped to the text: 28px tall, a pill, and it holds the
 * word as well as the mark.
 *
 * ## Why the word is inside the control
 *
 * A cross in a corner is a convention and needs no label. "Change",
 * "2 sources" and "Delete project" are not conventions, so a bare mark would
 * be a guess — for a first-time reader, for a screen reader, and for anyone
 * who has never learned that a pencil means edit. Where the surrounding text
 * already names the thing, `IconButton size="sm"` is the lighter answer and
 * this is the wrong component.
 *
 * ## Destruction does not advertise
 *
 * The `danger` tone is neutral at rest and only becomes coral once somebody is
 * on it, so a delete is never the most inviting thing on a screen. That is the
 * same argument `TextAction` already makes by darkening rather than lightening
 * on hover, and the same one `IconButton` makes.
 */
export type InlineActionTone = "neutral" | "danger";

const BASE_CLASSES = cn(
  // `vibe-control` so the palette owns the press movement, exactly as it does
  // for `Button` and `IconButton`. This component owns only the colour steps,
  // which are what a phone gets and what survives reduced motion.
  "vibe-control inline-flex min-h-7 items-center gap-1.5 rounded-full px-3",
  "text-ui transition-interactive select-none",
  "disabled:pointer-events-none disabled:bg-surface-2 disabled:text-fg-disabled",
);

const TONE_CLASSES: Record<InlineActionTone, string> = {
  neutral:
    "bg-surface-3 text-fg-secondary hover:bg-surface-hover hover:text-fg " +
    "active:bg-surface-pressed active:text-fg",
  danger:
    "bg-surface-3 text-fg-secondary hover:bg-coral-tint-soft hover:text-coral " +
    "active:bg-coral-tint active:text-coral",
};

/**
 * The classes, separately from the component.
 *
 * `buttonClasses` exists for the same reason and this follows it. A
 * `<summary>` is already the control the browser hands to the keyboard and to
 * a screen reader, so a `<button>` nested inside one would be two controls
 * sharing a hit area — a disclosure wears the treatment on a `span` instead.
 */
export function inlineActionClasses(tone: InlineActionTone = "neutral"): string {
  return cn(BASE_CLASSES, TONE_CLASSES[tone]);
}

export type InlineActionProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /**
   * The mark. 14px against the 13px label — a mark that matches its word's
   * size reads as a second letter rather than as a sign.
   */
  icon?: ReactNode;
  tone?: InlineActionTone;
  children: ReactNode;
};

export const InlineAction = forwardRef<HTMLButtonElement, InlineActionProps>(function InlineAction(
  { icon, tone = "neutral", className, children, ...props },
  ref,
) {
  return (
    <button ref={ref} type="button" className={cn(inlineActionClasses(tone), className)} {...props}>
      {icon}
      {children}
    </button>
  );
});
