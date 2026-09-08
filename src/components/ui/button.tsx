import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * The button (UI-26). Singular, now.
 *
 * ## What was here before, counted
 *
 * Five families made something pressable, and the counting is what settled it:
 *
 *   `Button`            94 renders — primary 63, secondary 28, accent 3, danger 0
 *   `InlineAction`      21 call sites across 18 files, 3 of them destructive
 *   `IconButton`         1
 *   `TextAction`         1
 *   `buttonClasses()`   pasted onto a `Link` or a raw `button` in 28 files
 *
 * The `danger` *variant* had never once been used while the product does have
 * destructive actions — every one of them was an `InlineAction` with a `danger`
 * tone. So the destructive button was dead code and the destructive action was
 * alive, which is one vocabulary pretending to be two. `accent` was the other
 * end of the same problem: three uses of a middle rung between "the action" and
 * "a control", asked for by no rule anyone could state.
 *
 * The founder chose system C from the four in `study-button.tsx`: **one
 * component, four variants, and icon-only as a size.**
 *
 * ## Nothing here looks different, deliberately
 *
 * The consolidation is the change. Every colour step below is the one that was
 * already reviewed and shipped — `ghost` is `InlineAction`'s neutral tone
 * verbatim and `danger` is its danger tone verbatim, down to the pressed
 * values. Twenty-three call sites move to a different import and render the
 * same pixels, which is the only honest way to do a migration this size: no
 * visual regressions hiding inside a refactor.
 *
 * ## Two arguments that came with those tones, and are load-bearing
 *
 * **A container exists at rest.** Touch has no hover, so a control whose
 * container only arrives under a pointer is not a control on a phone. `ghost`
 * is therefore not transparent-until-hover; it has a resting fill. This was
 * learned from a phone, on a real screen, and it is why `ghost` is not what the
 * word usually means elsewhere.
 *
 * **Destruction warns at rest.** For the same reason: a danger tone that only
 * appears on hover never appears on a phone, and "Delete account" and "Change"
 * become the same grey object. So `danger` carries a coral fill, line and text
 * from the first frame — it still reads as destructive with the hue removed.
 *
 * ## Radius
 *
 * `rounded-nav` for the contained sizes; a pill for `xs` and `icon`. That is
 * not an inconsistency — `xs` is the control that sits inside a sentence or a
 * table row, where the pill is the shape that says "this belongs to the text",
 * and a dismissal is round by convention (ADR 0097). Both were already those
 * shapes; the size scale is where that now lives.
 *
 * Radius, padding and gap all live in `SIZE_CLASSES` rather than in the base,
 * because `cn` is a filtered join and not `tailwind-merge`: a base `gap-2` and
 * a size `gap-1.5` would both ship and stylesheet order would decide. This file
 * has been bitten by exactly that before — see `lg` below.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "lg" | "md" | "sm" | "xs" | "icon";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-mint text-mint-ink font-bold shadow-mint hover:bg-mint-hover",
  secondary:
    "bg-surface-hover text-fg-body border border-line-strong hover:bg-white/10 hover:text-fg",
  // A resting container, then hover, then a press that is a visible step past
  // it. A pointer gets three states and a finger gets two, and the last one is
  // the only feedback touch ever receives.
  ghost:
    "bg-surface-3 text-fg-secondary hover:bg-surface-hover hover:text-fg " +
    "active:bg-surface-pressed active:text-fg",
  // Coral at rest, deepening on hover and again on press. `--color-coral-pressed`
  // exists for that third step; without it hover and press were the same value,
  // which is a control that stops responding exactly where a finger presses
  // hardest.
  danger:
    "border border-coral-line bg-coral-tint-soft text-coral " +
    "hover:bg-coral-tint active:bg-coral-pressed",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  /*
   * The marketing call to action, and it exists because three call sites were
   * already writing it: `` `${buttonClasses()} px-6 py-4 text-base` ``.
   *
   * Half of that was doing nothing. `cn` is a join, not a merge, so the
   * appended class list carried *both* `text-body` and `text-base`, and the
   * one later in the generated stylesheet won — measured, those three
   * buttons rendered at 14px while their class string said 16. The padding
   * grew and the type did not, for the whole life of the landing page. It is
   * the same failure `Surface` records for tones, where a tint was "written,
   * generated, shipped, and invisible".
   *
   * `text-lead` rather than either: the intent was type a step larger than a
   * medium button's, `text-base` names no Vibe step, and 15px is the step the
   * scale actually has there. So the CTA grows by one pixel and the class
   * that never applied is gone.
   */
  lg: "rounded-nav gap-2 px-6 py-4 text-lead",
  md: "rounded-nav gap-2 px-5 py-3 text-body",
  sm: "rounded-nav gap-2 px-4 py-2.5 text-ui",
  /**
   * The control inside a sentence, a header or a table row: 28px tall, a pill,
   * holding a mark and a word. Asked for 21 times before it was a size — which
   * is how a whole second button system appears without anyone deciding to
   * build one.
   */
  xs: "min-h-7 gap-1.5 rounded-full px-3 text-ui",
  /**
   * A mark and no word. `shrink-0` because these sit in flex headers beside
   * text that will happily squeeze them.
   */
  icon: "size-8 shrink-0 rounded-full",
};

const BASE_CLASSES =
  // Inert in v1; `theme-v2.css` gives it the press. Emitted here rather than
  // on `<Button>` so that `<Link className={buttonClasses()}>` call sites —
  // which have no component to hang an attribute on — carry it too.
  "vibe-control " +
  "inline-flex items-center justify-center select-none " +
  // Not `transition-colors`: that list includes `outline-color`, which would
  // fade the focus ring in over 150ms, so the indicator arrives after the
  // keyboard user has already started deciding where they are. This file
  // worked that out first and wrote the property list by hand — which fixed
  // one control and nothing else, because a comment is not a mechanism.
  // `transition-interactive` in `globals.css` is the mechanism.
  "transition-interactive " +
  // A disabled control drops to the bottom of the ramp and keeps a border, so
  // it still reads as a control that exists but is not available — never as an
  // invisible gap. The border matters most to `danger`: a control that cannot
  // be pressed must not still be warning about what pressing it would do, so
  // the coral line is replaced rather than merely faded. Per the writing rules
  // it should also be accompanied by a reason somewhere on screen; the button
  // itself cannot enforce that.
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

type CommonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  variant?: ButtonVariant;
  /**
   * A mark before the label. Sized by the caller, because 14px against a 13px
   * word is a ratio — a mark that matches its word's size reads as a second
   * letter rather than as a sign.
   */
  icon?: ReactNode;
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
   *
   * It also draws a spinner. The first lens-scored dogfood run showed that a
   * swapped label alone does not read as "working" — the founder pressed the
   * audit button and saw nothing happen. The spinner is `aria-hidden` (the
   * label and `aria-busy` already say it) and `motion-safe` only: under
   * reduced motion it stands still as a static mark rather than moving.
   */
  busy?: boolean;
};

/**
 * `label` is required exactly where the control has no words, and impossible
 * everywhere else.
 *
 * That requirement is the whole reason `IconButton` was a separate component,
 * and folding it into a size would have quietly dropped it: an icon-only
 * control with no accessible name is announced as "button", and the entire
 * category is icon-only. Expressed as a union so the compiler asks, rather than
 * as an optional prop with a fallback nobody reads.
 */
export type ButtonProps =
  | (CommonProps & {
      size?: Exclude<ButtonSize, "icon">;
      label?: never;
      children: ReactNode;
    })
  | (CommonProps & {
      size: "icon";
      icon: ReactNode;
      /** What the control does, as a sentence a screen reader can read. */
      label: string;
      children?: never;
    });

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(props, ref) {
  const {
    className,
    variant = "primary",
    size = "md",
    busy,
    icon,
    label,
    children,
    // A button says what it is. The browser's implicit `submit` inside a form
    // turned "Cancel" and "Clear" into form submissions the moment those
    // controls stopped being their own component, so the default is the safe
    // one and a submit declares itself — including a `formAction` button,
    // which is a submit button whether or not it says so.
    type = "button",
    ...rest
  } = props as CommonProps & {
    size?: ButtonSize;
    label?: string;
    children?: ReactNode;
    type?: "button" | "submit" | "reset";
  };

  return (
    <button
      ref={ref}
      type={type}
      aria-busy={busy || undefined}
      aria-label={label}
      className={cn(buttonClasses({ variant, size }), className)}
      {...rest}
    >
      {busy ? (
        <span
          aria-hidden="true"
          className="size-3.5 shrink-0 rounded-full border-[1.5px] border-current border-t-transparent motion-safe:animate-spin"
        />
      ) : (
        // The spinner replaces the mark rather than joining it: two symbols in
        // one control is a control saying two things.
        icon
      )}
      {children}
    </button>
  );
});
