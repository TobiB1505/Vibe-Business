"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";

/**
 * The confirmation before a consequential action (UI-6 §3).
 *
 * ## What was here before
 *
 * Four hand-written blocks — approve, revoke, merge, start preview — each
 * repeating the same container, heading, body and button row, and each
 * carrying `role="dialog" aria-modal="true"`.
 *
 * `aria-modal="true"` is a promise that everything outside the element is
 * inert. None of them were: the page behind stayed scrollable, focusable and
 * fully interactive. A screen-reader user was told the rest of the page had
 * gone away while a sighted keyboard user could Tab straight out of the
 * confirmation into the card behind it and press something else. The two
 * experiences disagreed about what was on screen, on the four screens where
 * being wrong costs the most.
 *
 * ## Why this is not a modal
 *
 * Because the inline form is *better* here, and the fix is to stop claiming
 * otherwise. A merge confirmation that covers the card removes the evidence
 * the person is deciding on — the branch, the commit, the checks — at the
 * moment they need it. The audit says the same thing from the other side: the
 * approval and merge semantics and their dialog copy are to be re-clothed,
 * never restructured.
 *
 * So the role stays, the lie goes, and the keyboard behaviour a dialog owes
 * its user arrives: focus moves in when it opens, returns to whatever opened
 * it when it closes, and Escape cancels. Those are the parts that were
 * actually missing. A focus *trap* is not among them — trapping focus inside
 * something the rest of the page is still live behind would be the same lie
 * again, written in JavaScript instead of ARIA.
 *
 * Only the first half lives here. Returning focus cannot: every one of these
 * sections renders *either* its opener *or* this panel, so by the time this
 * unmounts the button that opened it is a detached node and focusing it does
 * nothing. That was a real bug in the first version of this file, and a
 * browser test caught it. `useReturnFocus` handles the other half from the
 * section, where the opener still exists.
 *
 * ## The button order, and why the confirm is the primary
 *
 * Cancel first, confirm second, and the confirm carries the section's one
 * mint control. A confirmation with two identical grey buttons makes the
 * reader work out which one continues; that is a fine thing to slow down and
 * a bad thing to obscure.
 */

export type ConfirmTone = "action" | "caution";

const TONE_SURFACE: Record<ConfirmTone, string> = {
  /** Vibe is about to do the thing this section exists for. */
  action: "border-mint-line/60 bg-mint-tint-soft",
  /** It is reversible or bounded, but it spends or exposes something. */
  caution: "border-amber-line/60 bg-amber-tint-soft",
};

/**
 * Puts focus back on the control that opened a confirmation (UI-6 §3).
 *
 * Lives in the section rather than in `ConfirmPanel` because the opener is
 * unmounted while the confirmation is on screen. A ref captured inside the
 * panel would point at a node that is no longer in the document, and calling
 * `focus()` on one silently does nothing — which is exactly what it did, until
 * a browser test asked where focus had gone.
 *
 * Without this, dismissing a confirmation drops focus to the top of the
 * document, and a keyboard user has to walk the whole page again to get back
 * to the control they were standing on.
 */
export function useReturnFocus<T extends HTMLElement>(open: boolean) {
  const ref = useRef<T>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    // Only on the closing edge. On first render nothing was open, so nothing
    // is owed focus, and stealing it would move the page under the user.
    if (wasOpen.current && !open) ref.current?.focus();
    wasOpen.current = open;
  }, [open]);

  return ref;
}

export function ConfirmPanel({
  title,
  tone = "action",
  confirmLabel,
  confirmType = "button",
  cancelLabel = "Cancel",
  pending = false,
  onConfirm,
  onCancel,
  children,
}: {
  title: string;
  tone?: ConfirmTone;
  /** The full label, including any in-flight wording the caller decides. */
  confirmLabel: ReactNode;
  /**
   * `submit` when the confirmation sits inside a `<form>` whose action is the
   * thing being confirmed — so the server action stays the mechanism rather
   * than a click handler imitating one.
   */
  confirmType?: "button" | "submit";
  cancelLabel?: string;
  pending?: boolean;
  /** Optional for a `submit` confirm, whose form action is what runs. */
  onConfirm?: () => void;
  onCancel: () => void;
  /** What the person is being asked to agree to. Never summarised here. */
  children: ReactNode;
}) {
  const titleId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <div
      role="dialog"
      aria-labelledby={titleId}
      className={cn("space-y-3 rounded-md border p-4", TONE_SURFACE[tone])}
      onKeyDown={(event) => {
        // Escape cancels for real — it runs the caller's cancel rather than
        // hiding the element, so nothing is left half-started behind it.
        if (event.key === "Escape" && !pending) {
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <h5
        id={titleId}
        ref={headingRef}
        tabIndex={-1}
        className="text-sm font-medium text-fg focus-visible:outline-none"
      >
        {title}
      </h5>

      <div className="space-y-2 text-sm text-fg-prose">{children}</div>

      <div className="flex gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={onCancel} disabled={pending}>
          {cancelLabel}
        </Button>
        <Button type={confirmType} variant="primary" size="sm" onClick={onConfirm} disabled={pending}>
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}
