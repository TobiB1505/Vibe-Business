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

/**
 * A tone as plain foreground colour, for a status word set in prose (UI-6 §2).
 *
 * ## Why this is separate from `TONE_CLASSES`
 *
 * A pill is a filled chip and its text sits on a tint, so `neutral` there can
 * be `fg-prose` and still read. The same word inline on a panel has no fill
 * behind it and belongs one step further down the ramp. Same vocabulary,
 * different job.
 *
 * ## What it replaces
 *
 * Seven local `Record<SomeState, string>` tables that each mapped a domain
 * state straight to `text-mint` / `text-amber` / `text-coral`. Written that
 * way, a panel choosing amber for `failed` and another choosing coral looks
 * like drift — and the only way to find out whether it was drift or a decision
 * was to read both files and guess.
 *
 * Naming the tone makes the choice legible at the call site: a check that did
 * not appear in production is `waiting`, because the product may simply not
 * have deployed yet, while a build that failed in the sandbox is `problem`,
 * because something really is wrong. Those are different states that share an
 * English word, and the tables now say so.
 */
const TONE_TEXT: Record<StatusTone, string> = {
  active: "text-mint-dim",
  success: "text-mint",
  waiting: "text-amber",
  problem: "text-coral",
  neutral: "text-fg-muted",
};

export function statusToneText(tone: StatusTone): string {
  return TONE_TEXT[tone];
}

/**
 * The glyph vocabulary (UI-6 §2).
 *
 * Three of these existed — `✓ ✕ ⏱ –`, `✓ ✕ – !` and `✓ ~ —` — so the same
 * character meant different things on adjacent panels and different characters
 * meant the same thing. They are one table now, keyed by what the mark *says*
 * rather than by any one panel's state names.
 *
 * Every glyph is decorative: each is rendered beside a label that carries the
 * same information as text, because a state must never depend on a symbol any
 * more than it may depend on a colour.
 */
export type StatusGlyphName =
  /** Confirmed, and Vibe checked it. */
  | "confirmed"
  /** Ran, and did not hold. */
  | "refused"
  /** Ran out of time rather than producing an answer. */
  | "expired"
  /** Deliberately not applicable — never a failure. */
  | "skipped"
  /** Looked for and not seen. Neither a tick nor a cross. */
  | "unseen"
  /** Happening now. */
  | "running"
  /** Not started. */
  | "pending"
  /** Vibe could not tell — a statement about Vibe, not about the product. */
  | "unknown";

export const STATUS_GLYPHS: Record<StatusGlyphName, string> = {
  confirmed: "✓",
  refused: "✕",
  expired: "⏱",
  skipped: "–",
  unseen: "–",
  running: "●",
  pending: "○",
  unknown: "!",
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
