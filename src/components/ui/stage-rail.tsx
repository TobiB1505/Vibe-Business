import Link from "next/link";
import type { ReactNode } from "react";
import { StatusDot, type StatusTone } from "./status-pill";
import { cn } from "@/lib/utils/cn";

/**
 * A sequence of steps, and which one you are on (UI-8 §1).
 *
 * Two things in this product are genuinely linear and had no way to say so: the
 * seven-step product loop, and the five gates one prepared change passes
 * through. Both were rendered as a single sentence naming the current position,
 * which tells you where you are and nothing about where that sits in the whole.
 *
 * One primitive serves both because they are the same shape — an ordered list
 * where every entry is behind you, under you, or ahead of you. What differs is
 * the axis, so that is the prop.
 *
 * ## Why a step never depends on its colour
 *
 * The design this came from marks the current step with a mint dot and a bolder
 * weight, and marks completed steps with a mint dot alone. Both are colour, and
 * one is colour plus font weight — neither reaches a screen reader, and the
 * difference between "done" and "current" is exactly what a person navigating
 * by voice needs most.
 *
 * So every step carries its state as text. It is visually hidden, because the
 * dot already says it to anyone who can see it, and a rail with the word
 * "completed" printed seven times would be unreadable. `aria-current` marks the
 * live step for the same reason `ProjectNav` uses it: it is the one thing that
 * survives a hard refresh and a new tab.
 *
 * ## Why blocked is amber and not coral
 *
 * Coral means failure or something destructive. A blocked step is neither — it
 * means the loop cannot advance until something changes, which is the waiting
 * state amber exists for. `merge_stalled` is the one that comes closest to a
 * failure, and even that is "this change cannot go in *as it is*". The note
 * beside it carries the specifics; the colour only says "look here".
 */

export type StageRailState =
  /** Behind you. The work this step names has produced its artifact. */
  | "done"
  /** Where you are now — Vibe working, or your turn. */
  | "active"
  /** Where you are now, and it cannot advance on its own. */
  | "blocked"
  /** Ahead of you. Never rendered as a problem. */
  | "pending";

export type StageRailStep = {
  id: string;
  label: string;
  state: StageRailState;
  /** The section that owns this step. Unlinked when omitted. */
  href?: string;
  /**
   * One short sentence, rendered only on the live step. A note on a step you
   * have not reached would be an answer to a question nobody asked yet.
   */
  note?: string | null;
};

const TONES: Record<StageRailState, StatusTone> = {
  done: "success",
  active: "active",
  blocked: "waiting",
  pending: "neutral",
};

/** What the dot means, for everyone the dot does not reach. */
const STATE_TEXT: Record<StageRailState, string> = {
  done: "completed",
  active: "current step",
  blocked: "current step, blocked",
  pending: "not started",
};

const LABEL_CLASSES: Record<StageRailState, string> = {
  done: "text-fg-prose",
  active: "text-fg font-semibold",
  blocked: "text-fg font-semibold",
  pending: "text-fg-meta",
};

function StepBody({ step }: { step: StageRailStep }) {
  return (
    <>
      <StatusDot tone={TONES[step.state]} />
      <span className={cn("text-ui whitespace-nowrap", LABEL_CLASSES[step.state])}>
        {step.label}
      </span>
      <span className="sr-only">({STATE_TEXT[step.state]})</span>
    </>
  );
}

function Step({ step, orientation }: { step: StageRailStep; orientation: StageRailOrientation }) {
  const live = step.state === "active" || step.state === "blocked";

  const inner: ReactNode = step.href ? (
    <Link
      href={step.href}
      aria-current={live ? "step" : undefined}
      className={cn(
        "rounded-nav flex items-center gap-2.5 px-2 py-1.5",
        "transition-interactive hover:bg-surface-hover",
      )}
    >
      <StepBody step={step} />
    </Link>
  ) : (
    <span
      aria-current={live ? "step" : undefined}
      className="flex items-center gap-2.5 px-2 py-1.5"
    >
      <StepBody step={step} />
    </span>
  );

  return (
    <li className={cn("flex min-w-0", orientation === "vertical" && "flex-col")}>
      {inner}
      {/*
       * The note is the whole reason a blocked step is worth marking at all: a
       * rail that says "something is wrong here" and makes you go looking is
       * worse than one that says nothing. Only ever on the live step.
       */}
      {live && step.note && (
        <p
          className={cn(
            "text-fg-secondary text-caption px-2 pb-1",
            orientation === "horizontal" && "max-w-[28ch]",
          )}
        >
          {step.note}
        </p>
      )}
    </li>
  );
}

export type StageRailOrientation = "horizontal" | "vertical";

export function StageRail({
  steps,
  label,
  orientation = "vertical",
  className,
}: {
  steps: StageRailStep[];
  /** Names the sequence for assistive technology. Required — an unnamed list of seven words is not navigable. */
  label: string;
  orientation?: StageRailOrientation;
  className?: string;
}) {
  return (
    <ol
      aria-label={label}
      className={cn(
        // Seven steps do not fit on a phone. The horizontal strip visibly runs
        // off its edge rather than appearing to end — a mask rather than an
        // overlay, so it cannot sit on top of a link and swallow a tap. The
        // same fix, and the same reason, as `ProjectNav` (UI-7 §6).
        orientation === "horizontal" &&
          "flex items-start gap-1 overflow-x-auto [mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)] sm:[mask-image:none]",
        orientation === "vertical" && "flex flex-col gap-0.5",
        className,
      )}
    >
      {steps.map((step) => (
        <Step key={step.id} step={step} orientation={orientation} />
      ))}
    </ol>
  );
}
