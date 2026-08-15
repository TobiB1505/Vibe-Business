import { type InputHTMLAttributes, forwardRef, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

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
 */

export const inputClassName =
  "rounded-field bg-field border-line-strong text-fg-body placeholder:text-fg-meta w-full border px-4 py-3 text-sm " +
  "transition-colors duration-150 ease-vibe " +
  "focus:border-mint/60 focus:ring-mint/10 focus:ring-4 focus:outline-none " +
  "disabled:text-fg-disabled disabled:cursor-not-allowed";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(inputClassName, className)} {...props} />;
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
        <p id={`${id}-hint`} className="text-fg-muted text-xs">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-coral text-xs">
          {error}
        </p>
      )}
    </div>
  );
}
