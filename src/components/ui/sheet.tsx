"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * The overlay primitive (UI Sourcing Spec §14, P13).
 *
 * ## Why native `<dialog>` and not a library
 *
 * The one place a hand-rolled implementation is genuinely weaker than a
 * dependency is overlay focus management, and `showModal()` is the platform
 * already doing it: focus moves in, focus is trapped, the background is inert,
 * Escape closes, and the element renders in the top layer above every stacking
 * context on the page. A Radix or Base UI dialog would reimplement those four
 * things in JavaScript and bring a dependency to do it.
 *
 * This is the same argument `Disclosure` makes for `<details>`, and it is the
 * reason `ConfirmPanel` is *not* built on this: that panel deliberately leaves
 * the page live behind it, because a confirmation that covers the evidence
 * somebody is deciding on has removed the thing they need. A dialog is right
 * here and wrong there, and the difference is whether the content behind
 * matters while the overlay is open.
 *
 * ## What it owns, and what it does not
 *
 * It owns position, scrim, the open/close transition and the imperative
 * open/close call. It owns no content: the header, body and footer are the
 * caller's, because a sheet that knew what a citation looked like would be a
 * second evidence component.
 *
 * Returning focus is the platform's here — unlike `ConfirmPanel`, whose opener
 * unmounts — because a sheet's trigger stays mounted behind it. `<dialog>`
 * restores focus to whatever was focused when `showModal()` ran.
 */

export type SheetSide = "right" | "bottom";

const SIDE_CLASSES: Record<SheetSide, string> = {
  /*
   * Anchored right on a wide screen, full height. `max-w-[520px]` with a
   * `w-full` under it means a narrow desktop window degrades to full width
   * rather than to a sliver.
   */
  right:
    "ms-auto me-0 my-0 h-dvh max-h-dvh w-full max-w-[min(520px,100vw)] rounded-none sm:rounded-l-card",
  /*
   * The mobile shape, and the reason `side` exists at all: a right-anchored
   * sheet on a 375px screen is a full-screen takeover with a pointless
   * animation. A bottom sheet reads as what it is — more detail about the
   * thing you were just looking at — and leaves the page edge visible.
   */
  bottom:
    "mt-auto mb-0 mx-auto h-auto max-h-[85dvh] w-full max-w-none rounded-t-card rounded-b-none",
};

export function Sheet({
  open,
  onClose,
  side = "right",
  labelledBy,
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  side?: SheetSide;
  /** Id of the element naming this sheet. Required — a dialog needs a name. */
  labelledBy: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      // `showModal` rather than `show`: only the modal form makes the rest of
      // the document inert and puts the element in the top layer. `show` would
      // leave a keyboard user able to Tab into the page behind — the exact lie
      // `ConfirmPanel` documents having removed from four hand-written panels.
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={labelledBy}
      // Escape fires `cancel`; the browser would then close the element without
      // telling React, leaving the caller's state saying "open" over a closed
      // dialog. Both events route back through the caller so one owns the state.
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
      // A click on the backdrop is a click on the dialog element itself, since
      // the backdrop is not a node. Anything inside the panel stops here.
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      className={cn(
        "bg-surface-4 border-line-4 text-fg-body max-h-dvh border p-0 shadow-card backdrop-blur-xl",
        "backdrop:bg-ground/70 backdrop:backdrop-blur-sm",
        "motion-safe:transition-interactive open:motion-safe:animate-none",
        SIDE_CLASSES[side],
        className,
      )}
    >
      {/*
        A plain wrapper rather than a form: `method="dialog"` would close the
        sheet on any submit inside it, and evidence is read-only anyway.
      */}
      <div className="flex h-full max-h-inherit flex-col overflow-y-auto overscroll-contain">
        {children}
      </div>
    </dialog>
  );
}
