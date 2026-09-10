"use client";

import { useId, useState, type InputHTMLAttributes } from "react";
import { EyeIcon, EyeOffIcon } from "@/components/ui/dashboard-icons";
import { inputClassName } from "@/components/ui/field";
import { cn } from "@/lib/utils/cn";

/**
 * A password field you can look at (UI-19).
 *
 * ## Why this exists
 *
 * Because the product asks for at least eight characters and then offers no
 * way to check what was typed. On a phone that is a real failure rate, not a
 * nicety: the one place a typo is both likely and invisible is a masked field,
 * and the only recovery Vibe offered was submitting and being told the
 * password was wrong — which on sign-in is indistinguishable from having the
 * wrong password.
 *
 * ## Why the toggle is inside the field
 *
 * It belongs to the field, not to the form. Outside it, it is a control whose
 * subject you have to work out; inside it, at the trailing edge, it is the
 * only thing it could refer to. The input's right padding makes room for it
 * rather than letting text run underneath — the same asymmetry `Select` uses
 * for its chevron, and for the same reason.
 *
 * ## What it must never do
 *
 * **Start revealed.** A password on screen at first paint is a password on
 * screen in a screenshot, in a screen share and over a shoulder. Every mount
 * begins masked, including after a failed submission.
 *
 * **Submit.** `type="button"` explicitly: a bare `<button>` inside a form
 * submits it, so the reveal would post the credentials on the first click.
 *
 * ## What it says
 *
 * The label names the *action*, not the state — "Show password" when hidden.
 * A control labelled with the state it is in reads as a claim about what you
 * are looking at, and people press it to get the other thing.
 */
export function PasswordInput({
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [revealed, setRevealed] = useState(false);
  const describedBy = useId();

  return (
    <div className="relative">
      <input
        {...props}
        type={revealed ? "text" : "password"}
        className={cn(inputClassName, "pr-12", className)}
      />
      <button
        type="button"
        onClick={() => setRevealed((shown) => !shown)}
        aria-label={revealed ? "Hide password" : "Show password"}
        aria-describedby={describedBy}
        data-testid="password-reveal"
        className={cn(
          "text-fg-muted hover:text-fg-body absolute top-1/2 right-2 -translate-y-1/2",
          "rounded-inline grid size-8 place-items-center transition-interactive",
          "focus-visible:ring-mint focus-visible:ring-2 focus-visible:outline-none",
        )}
      >
        {revealed ? <EyeOffIcon size={17} /> : <EyeIcon size={17} />}
      </button>
      {/*
        The state, for a reader who cannot see the mark. The button's own name
        is the action; this is the fact, and it is polite rather than
        assertive because nothing about it is urgent.
      */}
      <span id={describedBy} role="status" className="sr-only">
        {revealed ? "Password is visible" : "Password is hidden"}
      </span>
    </div>
  );
}
