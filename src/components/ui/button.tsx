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
  "inline-flex items-center justify-center gap-2 rounded-full duration-150 ease-vibe " +
  // Not `transition-colors`: that list includes `outline-color`, which would
  // fade the focus ring in over 150ms. A focus indicator has to appear at
  // once, so the transition names the properties hover actually changes.
  "transition-[color,background-color,border-color] " +
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

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "primary", size = "md", ...props },
  ref,
) {
  return (
    <button ref={ref} className={cn(buttonClasses({ variant, size }), className)} {...props} />
  );
});
