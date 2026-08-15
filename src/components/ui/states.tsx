import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { Surface, type SurfaceTone } from "./surface";
import { MonoLabel } from "./typography";

/**
 * Empty, blocked and failed states (UI-0).
 *
 * These are one component family because the mockups treat them as one
 * pattern, and because the pattern encodes a product rule: **state the
 * situation, then give exactly one way forward.** Never a disabled control with
 * no explanation, and never an action for something Vibe cannot actually do.
 */

/**
 * Nothing here yet — and why, and what would change that.
 *
 * An empty state is not an error. It stays neutral and quiet; if it is quiet
 * because something is *blocked*, that is a `Notice`, not an `EmptyState`.
 */
export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <Surface
      level="section"
      padding="lg"
      className={cn("flex flex-col items-start gap-3", className)}
    >
      <p className="text-fg text-title font-bold">{title}</p>
      {description && <p className="text-fg-muted max-w-[62ch] text-sm">{description}</p>}
      {action && <div className="mt-1 flex flex-wrap items-center gap-3">{action}</div>}
    </Surface>
  );
}

/**
 * Something stopped, or something failed.
 *
 * `tone` carries the difference and must match what actually happened:
 * `waiting` for a state that a person or a pending job will resolve, `problem`
 * for a genuine failure or refusal, `info` for a neutral consequence.
 *
 * `label` is the mono rule above the message — "WHY IT STOPPED", "CONNECTION
 * FAILED". Say it in the words the code uses for the state rather than
 * translating it into something friendlier and vaguer.
 */
export function Notice({
  tone = "waiting",
  label,
  children,
  action,
  footnote,
  className,
}: {
  tone?: "waiting" | "problem" | "info";
  label?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  /** The quiet line under the action — a consequence, a limit, a caveat. */
  footnote?: ReactNode;
  className?: string;
}) {
  const surfaceTone: SurfaceTone = tone === "problem" ? "coral" : tone === "info" ? "neutral" : "amber";
  const labelColour =
    tone === "problem" ? "text-coral" : tone === "info" ? "text-fg-muted" : "text-amber";

  return (
    <Surface
      level="section"
      tone={surfaceTone}
      padding="md"
      // `status` rather than `alert`: these render on load as part of the page,
      // and an assertive live region would interrupt a screen reader mid-page
      // for something that is not urgent.
      role="status"
      className={cn("flex flex-col items-start gap-3", className)}
    >
      {label && <MonoLabel className={labelColour}>{label}</MonoLabel>}
      <div className="text-fg-prose max-w-[70ch] text-sm leading-relaxed">{children}</div>
      {action && <div className="flex flex-wrap items-center gap-3">{action}</div>}
      {footnote && <p className="text-fg-muted text-xs">{footnote}</p>}
    </Surface>
  );
}
