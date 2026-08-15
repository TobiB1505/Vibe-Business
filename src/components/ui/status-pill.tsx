import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Status pills (UI-0).
 *
 * Mono, uppercase, wide tracking — because a status is a machine state, and
 * the type system says machine output is mono. The label is always rendered as
 * text, so the state never depends on colour alone.
 *
 * The tones are deliberately more specific than the palette:
 *
 * - `active`  — Vibe is the subject: running, current, selected. Mint because
 *               mint is Vibe.
 * - `success` — a confirmed, finished, good outcome. Also mint today, but kept
 *               separate from `active` so the two can diverge without a
 *               find-and-replace across every screen.
 * - `waiting` — amber: partial, blocked, needs a person, incomplete.
 * - `problem` — coral: failed, refused, a real gap.
 * - `neutral` — grey: everything else, including "not measurable". An
 *               unassessable state is neutral, never a problem — the audit
 *               layer's "unknown ≠ bad" rule applies to its pixels too.
 */
export type StatusTone = "active" | "success" | "waiting" | "problem" | "neutral";

const TONE_CLASSES: Record<StatusTone, string> = {
  active: "bg-mint-tint border-mint-line text-mint",
  success: "bg-mint-tint border-mint-line text-mint",
  waiting: "bg-amber-tint border-amber-line text-amber",
  problem: "bg-coral-tint border-coral-line text-coral",
  neutral: "bg-surface-hover border-line-4 text-fg-prose",
};

const DOT_CLASSES: Record<StatusTone, string> = {
  active: "bg-mint",
  success: "bg-mint",
  waiting: "bg-amber",
  problem: "bg-coral",
  neutral: "bg-fg-meta",
};

export function StatusPill({
  tone = "neutral",
  dot = false,
  children,
  className,
}: {
  tone?: StatusTone;
  /** A leading dot. Reserved for live/current states, not every pill. */
  dot?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1",
        "font-mono text-[0.65625rem] tracking-[0.1em] uppercase",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {dot && <span className={cn("size-1.5 shrink-0 rounded-full", DOT_CLASSES[tone])} />}
      {children}
    </span>
  );
}

/**
 * A category chip is not a status. It names a taxonomy — `seo`, `pricing`,
 * `conversion` — so it stays lowercase and never takes a status colour.
 */
export function CategoryChip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "bg-surface-hover border-line-4 text-fg-prose inline-flex items-center rounded-full border px-2.5 py-1",
        "font-mono text-[0.65625rem] lowercase",
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * The small glowing dot used in list rows and the sidebar to carry a project's
 * state. It is decorative on its own — every use must sit next to text that
 * says the same thing, which is why it takes no label of its own and is hidden
 * from assistive technology.
 */
export function StatusDot({ tone = "neutral", className }: { tone?: StatusTone; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-2.5 shrink-0 rounded-full",
        DOT_CLASSES[tone],
        tone === "active" || tone === "success" ? "shadow-dot-mint" : "",
        tone === "waiting" ? "shadow-dot-amber" : "",
        className,
      )}
    />
  );
}
