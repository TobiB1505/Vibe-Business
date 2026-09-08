import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * The measure a settings page is read at (UI-21).
 *
 * ## The defect this exists to fix
 *
 * Measured at 1440: the account content column is 1184px and the project
 * workspace is wider still, and **every settings page used all of it**. Profile
 * rendered a 1104px card holding an avatar and two lines. Project settings put
 * a paragraph that stops at 65ch on the left of a 1080px card and the control
 * that acts on it at the far right, with 580px of nothing between the sentence
 * and the button it describes.
 *
 * That is the defect Sprint 0153 named on the legal pages and fixed there: the
 * page never decided what to do with its width. A settings page is a column of
 * facts and controls, and a column has a measure.
 *
 * ## Why not narrow the shell instead
 *
 * Because the other settings pages are not columns. Billing is two columns of
 * panels, Repositories is a table, Products is a grid — all three earn the
 * width they take. Narrowing `AccountShell` would squeeze the pages that use
 * it correctly in order to fix the ones that do not.
 *
 * ## Why 48rem
 *
 * The widest thing these pages hold is a paragraph capped at 65ch, plus the
 * padding of the card around it. 48rem fits that with room for a control
 * beside a short caption and nothing left over. Wider and the button drifts
 * away from its sentence again; narrower and the three-column intent form
 * (Stage, Monetization, Goal) starts wrapping on a laptop.
 */
export function SettingsColumn({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("flex w-full max-w-[48rem] flex-col gap-5", className)}>{children}</div>;
}
