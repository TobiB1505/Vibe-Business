import {
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  forwardRef,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils/cn";
import { ChevronDownIcon } from "./icons.generated";

/**
 * Text fields (UI-0).
 *
 * Fields are wells — black at low alpha, cut into the surface — not another
 * white layer. The focused state moves the border to mint and adds a soft
 * mint halo, which is the same signal as the global focus ring but drawn to
 * the field's own radius.
 *
 * `Field` renders a real `<label htmlFor>` bound to the input's id and wires
 * `aria-describedby` to the hint and error, so the reason a field was
 * rejected is announced with it rather than sitting nearby unread.
 *
 * ## Why all three controls share one class string
 *
 * Because for a while they did not, and the divergence was not a design. Four
 * text-entry surfaces carried four fills, three borders and two focus
 * treatments, and the first two of them were in the same file — one on
 * `bg-field`, one on `bg-surface-1`, one `rounded-field`, one `rounded-field`.
 * Nobody chose that; each was written next to whatever was nearby.
 *
 * A shared constant is not enough on its own, because a call site can copy it
 * and drift. What removes the drift is that there is a component to reach for:
 * `Input`, {@link Textarea} and {@link Select} are the same well in three
 * shapes, and the shape is the only thing that differs.
 */

export const inputClassName =
  "rounded-field bg-field border-line-strong text-fg-body placeholder:text-fg-meta w-full border px-4 py-3 text-body " +
  "transition-interactive " +
  "focus:border-mint/60 focus:ring-mint/10 focus:ring-4 focus:outline-none " +
  "disabled:text-fg-disabled disabled:cursor-not-allowed";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(inputClassName, className)} {...props} />;
  },
);

/**
 * The same well, taller.
 *
 * `resize-y` rather than `resize-none`: the content is prose a founder wrote,
 * and the one thing they reliably want is to see more of it. Horizontal resize
 * stays off because it breaks the column it sits in.
 */
export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(inputClassName, "min-h-28 resize-y leading-relaxed", className)}
      {...props}
    />
  );
});

/**
 * The same well, with a menu behind it.
 *
 * ## Why the arrow is drawn rather than inherited
 *
 * The native arrow is painted by the platform in the platform's colours, so on
 * a dark well it is a grey wedge on a black ground — the one part of the field
 * that does not belong to Vibe. `appearance-none` removes it and this draws
 * the same `ChevronDownIcon` the rest of the product opens things with, at the
 * icon frame's own weight.
 *
 * The consequence is right-hand padding: the text has to stop before the
 * chevron rather than run under it, so the padding is asymmetric on purpose.
 * `pointer-events-none` on the mark keeps the click going to the select, which
 * is the whole control — a chevron that swallows the click is a select that
 * does not open where it looks like it should.
 */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <div className="relative">
        <select
          ref={ref}
          className={cn(inputClassName, "appearance-none pr-10", className)}
          {...props}
        >
          {children}
        </select>
        <ChevronDownIcon
          aria-hidden
          size={16}
          className="text-fg-muted pointer-events-none absolute top-1/2 right-3 -translate-y-1/2"
        />
      </div>
    );
  },
);

export function Field({
  id,
  label,
  hint,
  /** Rejection text. Sits under the field, in coral, and names the reason. */
  error,
  action,
  children,
  className,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** A control aligned with the label, e.g. a "Forgot it?" link. */
  action?: ReactNode;
  /** The input. Must carry `id` and the describedby ids rendered below. */
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-fg-secondary text-[0.84375rem]">
          {label}
        </label>
        {action}
      </div>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="text-fg-muted text-caption">
          {hint}
        </p>
      )}
      {error && (
        /*
          Announced, not merely displayed.

          `aria-describedby` binds this to the input, which is what a screen
          reader reads when focus *arrives* there. It says nothing when the
          text appears under a field the person has already left — which is
          exactly when a rejected submission renders one. `role="alert"` is
          the difference between a message and a message somebody hears.

          Assertive rather than `Notice`'s `role="status"`, and the two are
          right for different things: a notice renders as part of a page, this
          renders because something the person just did was refused.
        */
        <p role="alert" id={`${id}-error`} className="text-coral text-caption">
          {error}
        </p>
      )}
    </div>
  );
}
