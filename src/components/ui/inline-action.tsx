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
 * ## Destruction announces, and the reason is the same one
 *
 * This tone was built neutral at rest, becoming coral under the pointer, on
 * the argument that a delete should never be the most inviting thing on a
 * screen. Applying it to a real "Delete account" showed the argument is wrong,
 * and it is the container rule that breaks it: **touch has no hover.** A
 * finger never reaches the coral state, so the quiet version is not quiet on a
 * phone — it is absent, and "Delete account" and "Change" become the same
 * grey object.
 *
 * So `danger` carries its warning at rest: a coral-tinted fill, a coral line
 * and coral text and mark, from the first frame. It is the only version that
 * still reads as destructive with the colour removed entirely, because the
 * fill and the line are doing work that the hue is not.
 *
 * Hover deepens the fill and the press deepens it again — the same three-step
 * shape as the neutral tone, for the same reason. That is what
 * `--color-coral-pressed` exists for; without it hover and press were the same
 * value, which is a control that stops responding exactly where a finger is
 * looking hardest.
 */
export type InlineActionTone = "neutral" | "danger";

const BASE_CLASSES = cn(
  // `vibe-control` so the palette owns the press movement, exactly as it does
  // for `Button` and `IconButton`. This component owns only the colour steps,
  // which are what a phone gets and what survives reduced motion.
  "vibe-control inline-flex min-h-7 items-center gap-1.5 rounded-full px-3",
  "text-ui transition-interactive select-none",
  // `disabled:border-line-2` because the danger tone draws a coral line: a
  // control that cannot be pressed must not still be warning about what
  // pressing it would do.
  "disabled:pointer-events-none disabled:border-line-2 disabled:bg-surface-2 disabled:text-fg-disabled",
);

const TONE_CLASSES: Record<InlineActionTone, string> = {
  neutral:
    "bg-surface-3 text-fg-secondary hover:bg-surface-hover hover:text-fg " +
    "active:bg-surface-pressed active:text-fg",
  danger:
    "border border-coral-line bg-coral-tint-soft text-coral " +
    "hover:bg-coral-tint active:bg-coral-pressed",
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
