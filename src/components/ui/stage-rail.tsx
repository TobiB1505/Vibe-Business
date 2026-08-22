"use client";

import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
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
 *
 * ## Why this is a client component
 *
 * For one effect, and it is the same one UI-7 §6 had to add to `ProjectNav`.
 * Seven steps do not fit on a phone, so the row scrolls — and a row that
 * scrolls without bringing the live step into view fails at the single job it
 * has. Measured at 390px: the current step sat under the fade at the right
 * edge, so the rail answered "where am I?" with the four steps you are past.
 *
 * It takes only serialisable props, so nothing above it has to leave the
 * server.
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

function Step({
  step,
  orientation,
  liveRef,
}: {
  step: StageRailStep;
  orientation: StageRailOrientation;
  liveRef?: React.Ref<HTMLLIElement>;
}) {
  const live = step.state === "active" || step.state === "blocked";

  const inner: ReactNode = step.href ? (
    <Link
      href={step.href}
      aria-current={live ? "step" : undefined}
      className={cn(
        // `relative` is load-bearing. The state text below is `sr-only`, which
        // is absolutely positioned — with no positioned ancestor its containing
        // block is the page, so it escapes this row's scroll container and
        // lands wherever the step would have been. Seven of those pushed the
        // *document* to 578px against a 375px viewport while the rail itself
        // looked correct: a page that scrolls sideways on a phone, caused by
        // text nobody can see.
        "rounded-nav relative flex items-center gap-2.5 px-2 py-1.5",
        "transition-interactive hover:bg-surface-hover",
      )}
    >
      <StepBody step={step} />
    </Link>
  ) : (
    <span
      aria-current={live ? "step" : undefined}
      className="relative flex items-center gap-2.5 px-2 py-1.5"
    >
      <StepBody step={step} />
    </span>
  );

  return (
    <li
      ref={liveRef}
      className={cn(
        "flex",
        // A scrolling row only works if its items keep their natural width.
        // Without this they compress instead of overflowing, and on a phone
        // seven labels collapse into each other rather than running off the
        // edge under the mask — which is what the mask exists to signal.
        orientation === "horizontal" ? "shrink-0" : "min-w-0 flex-col",
      )}
    >
      {inner}
      {/*
       * In a column the note belongs to its step and reads as part of it. In a
       * row it cannot: placed inline it sits *between* two steps, pushing every
       * later one sideways and breaking the rhythm the rail is made of. The
       * horizontal note is rendered under the whole rail instead.
       */}
      {orientation === "vertical" && live && step.note && (
        <p className="text-fg-secondary text-caption px-2 pb-1">{step.note}</p>
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
  const stripRef = useRef<HTMLOListElement>(null);
  const activeRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    const strip = stripRef.current;
    const active = activeRef.current;
    if (!strip || !active) return;
    // Nothing to do when the whole rail fits, which is every desktop width.
    if (strip.scrollWidth <= strip.clientWidth) return;

    // `scrollLeft` rather than `scrollIntoView`: the latter can scroll the
    // *page* as well, and moving the whole workspace to reveal a progress step
    // is a worse answer than not revealing it. Same choice as `ProjectNav`.
    const overshoot = active.offsetLeft + active.offsetWidth - strip.clientWidth;
    strip.scrollLeft = Math.max(0, Math.min(active.offsetLeft - 16, overshoot + 16));
  }, [steps]);

  // The note of whichever step is live. At most one step is ever live, so at
  // most one note is ever shown.
  const liveNote =
    steps.find((step) => (step.state === "active" || step.state === "blocked") && step.note)
      ?.note ?? null;

  const list = (
    <ol
      ref={stripRef}
      aria-label={label}
      // The scope every assertion about this rail is written against, so a test
      // about absence cannot be satisfied by text elsewhere on the page.
      data-stage-rail={orientation === "vertical" ? "" : undefined}
      className={cn(
        // Seven steps do not fit on a phone. The horizontal strip visibly runs
        // off its edge rather than appearing to end — a mask rather than an
        // overlay, so it cannot sit on top of a link and swallow a tap. The
        // same fix, and the same reason, as `ProjectNav` (UI-7 §6).
        // `min-w-0` is load-bearing, not tidiness: a flex child defaults to
        // `min-width: auto`, so without it this row reports its full content
        // width to the document even though it scrolls internally — and the
        // page then overflows sideways on a phone while the rail itself looks
        // correct. Measured at 375px: 578px of document against a 375px
        // viewport.
        orientation === "horizontal" &&
          "flex min-w-0 items-start gap-1 overflow-x-auto [mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)] sm:[mask-image:none]",
        orientation === "vertical" && "flex flex-col gap-0.5",
        orientation === "vertical" && className,
      )}
    >
      {steps.map((step) => (
        <Step
          key={step.id}
          step={step}
          orientation={orientation}
          liveRef={
            step.state === "active" || step.state === "blocked" ? activeRef : undefined
          }
        />
      ))}
    </ol>
  );

  if (orientation === "vertical") return list;

  return (
    <div data-stage-rail className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      {list}
      {liveNote && <p className="text-fg-secondary text-caption px-2">{liveNote}</p>}
    </div>
  );
}
