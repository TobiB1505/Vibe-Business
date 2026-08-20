import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * The button system (UI-0).
 *
 * Every interactive control is a full pill — that is a rule of the visual
 * system, not a per-button choice. The variants below are the complete set;
 * a screen that needs a sixth should get a design decision, not a one-off
 * `className`.
 *
 * `primary` is mint, and mint means Vibe. One primary per screen area. A
 * destructive control never borrows the accent, which is why `danger` is coral
 * and not "a red primary".
 */
export type ButtonVariant = "primary" | "secondary" | "accent" | "danger";
export type ButtonSize = "md" | "sm";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-mint text-mint-ink font-bold shadow-mint hover:bg-mint-hover",
  secondary:
    "bg-surface-hover text-fg-body border border-line-strong hover:bg-white/10 hover:text-fg",
  accent:
    "bg-mint-tint text-mint border border-mint-line font-semibold hover:bg-mint-tint/60 hover:text-mint-hover",
  danger: "bg-coral-tint text-coral border border-coral-line hover:bg-coral-tint/70",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  md: "px-5 py-3 text-sm",
  sm: "px-4 py-2.5 text-[0.8125rem]",
};

const BASE_CLASSES =
  "inline-flex items-center justify-center gap-2 rounded-full " +
  // Not `transition-colors`: that list includes `outline-color`, which would
  // fade the focus ring in over 150ms, so the indicator arrives after the
  // keyboard user has already started deciding where they are. This file
  // worked that out first and wrote the property list by hand — which fixed
  // one control and nothing else, because a comment is not a mechanism.
  // `transition-interactive` in `globals.css` is the mechanism.
  "transition-interactive " +
  // A disabled control drops to the bottom of the ramp and keeps a border, so
  // it still reads as a control that exists but is not available — never as an
  // invisible gap. Per the writing rules it should also be accompanied by a
  // reason somewhere on screen; the button itself cannot enforce that.
  "disabled:pointer-events-none disabled:border disabled:border-line-2 disabled:bg-surface-3 " +
  "disabled:text-fg-disabled disabled:shadow-none disabled:font-normal";

export function buttonClasses({
  variant = "primary",
  size = "md",
}: { variant?: ButtonVariant; size?: ButtonSize } = {}): string {
  return cn(BASE_CLASSES, VARIANT_CLASSES[variant], SIZE_CLASSES[size]);
}

/**
 * Retained so `<Link className={buttonClassName}>` call sites keep working
 * unchanged. New code should call `buttonClasses(...)`, which can express a
 * variant.
 */
export const buttonClassName = buttonClasses();

/**
 * The one control that is not a pill (UI-6 §1).
 *
 * ## Why this exists rather than a fifth `Button` variant
 *
 * Because the pill rule above is real and worth keeping: a `Button` is always
 * a pill, and a variant that was not one would make that sentence false.
 *
 * But nine controls in this product are genuinely not buttons in the visual
 * sense — "Sign out" in the header, "Change" beside a value, "More context"
 * under a paragraph, "Cancel" beside a form's real action. Rendering those as
 * pills would give a header two competing controls and turn every inline
 * affordance into furniture. They were written nine separate times instead,
 * each with its own size, colour and hover, which is how a third button system
 * appears without anyone deciding to build one.
 *
 * So the category is named once, here, next to the one it is not.
 *
 * ## What it fixes for free
 *
 * All nine used `transition-colors`, which includes `outline-color` — so the
 * focus ring faded in over 150ms on every one of them. Same bug the pill
 * documents avoiding two comments above, in the controls that never inherited
 * the knowledge.
 */
export type TextActionTone = "muted" | "danger";

const TEXT_ACTION_TONES: Record<TextActionTone, string> = {
  muted: "text-fg-muted hover:text-fg-body",
  // Coral, and it darkens rather than lightens on hover, so a destructive
  // control never reads as the most inviting thing on the screen.
  danger: "text-coral hover:text-coral/80",
};

const TEXT_ACTION_BASE =
  "rounded-sm underline underline-offset-4 " +
  // The same shared utility as the pill, for the reason given there.
  "transition-interactive " +
  "disabled:pointer-events-none disabled:text-fg-disabled disabled:no-underline";

export function textActionClasses(tone: TextActionTone = "muted"): string {
  return cn(TEXT_ACTION_BASE, TEXT_ACTION_TONES[tone]);
}

export type TextActionProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: TextActionTone;
};

export const TextAction = forwardRef<HTMLButtonElement, TextActionProps>(function TextAction(
  { className, tone = "muted", ...props },
  ref,
) {
  return <button ref={ref} className={cn(textActionClasses(tone), className)} {...props} />;
});

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /**
   * The action this button started is still running (UI-6 §3).
   *
   * Twenty-one controls in this product swap their label for "Merging…",
   * "Approving…", "Saving…" while a transition is in flight. A sighted user
   * sees that immediately. A screen-reader user was told nothing at all: the
   * label of a button that already has focus is not re-read, and the app has
   * three live regions in total, none of them near these.
   *
   * `aria-busy` is the right answer rather than a live region per button. It
   * says "this control is working" on the element the user is already on, it
   * needs no region to exist beforehand, and it cannot double-announce the way
   * a polite region next to changing text does.
   */
  busy?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "primary", size = "md", busy, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      aria-busy={busy || undefined}
      className={cn(buttonClasses({ variant, size }), className)}
      {...props}
    />
  );
});
