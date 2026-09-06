import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * A control that is a mark inside a container.
 *
 * ## Why the container is the component
 *
 * A bare icon with a fill that arrives on hover is not a control on a phone.
 * There is no hover there, so the resting state is the only state a finger ever
 * sees, and a resting state with no container is a mark sitting next to a
 * heading. That was the objection, and it was made from a phone.
 *
 * So the container exists at rest. Everything else — the hover, the press — is
 * the same container becoming more present, which is what makes the three
 * states read as one control answering rather than as three different things.
 *
 * ## The three states, and why press is not optional
 *
 * A pointer gets `rest → hover → pressed`. Touch gets `rest → pressed`, with
 * nothing in between, so press is the *only* feedback a phone receives. It has
 * to be a visible step past hover rather than the same fill, or a finger is
 * answered with nothing. `--color-surface-pressed` exists for exactly that
 * step and is declared in both palettes.
 *
 * ## Round, deliberately
 *
 * The rest of this direction runs an 8px corner and nothing else on screen is
 * round. A dismissal is the one control people press without reading it, and
 * there the convention is worth more than the consistency — see ADR 0097.
 *
 * ## Motion
 *
 * The fill is a transition, and the press movement is **not** this component's
 * to write. It carries `vibe-control`, so the palette owns the press exactly as
 * it does for every other control — one mechanism, not one per component.
 *
 * A first draft added `active:scale-95` here anyway. Measuring the pressed
 * control showed `scale(0.994)`: the palette's rule had won, so the class was
 * dead in v2 and would have pressed differently in v1, which is two presses in
 * one product. It is gone. The colour steps below are this component's own
 * because they are what a phone gets, and they survive reduced motion.
 */
export type IconButtonTone = "neutral" | "danger";

const TONE_CLASSES: Record<IconButtonTone, string> = {
  neutral:
    "bg-surface-3 text-fg-secondary hover:bg-surface-hover hover:text-fg " +
    "active:bg-surface-pressed active:text-fg",
  /*
   * Destructive controls do not advertise. The container is neutral at rest and
   * carries its warning at rest, for the reason set out at length on
   * `InlineAction`: a finger never reaches a hover state, so a danger tone
   * that only appears on hover never appears on a phone. Kept identical to
   * that component's, so a destructive mark and a destructive pill are the
   * same object at two sizes.
   */
  danger:
    "border border-coral-line bg-coral-tint-soft text-coral " +
    "hover:bg-coral-tint active:bg-coral-pressed",
};

const SIZE_CLASSES = {
  /** The tightest a finger can be asked to find. Dense rows only. */
  sm: "size-7",
  /** The default, and what a drawer header uses. */
  md: "size-8",
  /** An overlay dismissal on a phone, where the target is the whole job. */
  lg: "size-9",
} as const;

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  /** The mark. Sized by the caller, because 16 in a 32 container is a ratio. */
  icon: ReactNode;
  /**
   * What the control does, as a sentence a screen reader can read.
   *
   * Required, and not optional with a fallback: an icon-only control with no
   * name is a button announced as "button", and the whole category is
   * icon-only.
   */
  label: string;
  tone?: IconButtonTone;
  size?: keyof typeof SIZE_CLASSES;
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, tone = "neutral", size = "md", className, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      className={cn(
        "vibe-control inline-flex shrink-0 items-center justify-center rounded-full",
        "transition-interactive",
        "disabled:pointer-events-none disabled:bg-surface-2 disabled:text-fg-disabled",
        SIZE_CLASSES[size],
        TONE_CLASSES[tone],
        className,
      )}
      {...props}
    >
      {icon}
    </button>
  );
});
