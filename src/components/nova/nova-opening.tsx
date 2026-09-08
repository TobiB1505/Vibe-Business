"use client";

import { useEffect, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { NovaPresence } from "./nova-presence";
import { BEATS, type OpeningBeat } from "./nova-opening-beats";
import { useMotionAllowed } from "./nova-motion";

/**
 * The first time a founder ever sees Nova.
 *
 * ## Why this is a choreography and not a component
 *
 * Every piece of it already exists. `NovaPresence` knows how to assemble
 * itself — the blades seat one by one, the iris opens, the curve draws last —
 * and it has known since it was lifted from the high-fidelity prototype.
 * `Header` knows how to be a status row. `Arriving` knows how a turn lands.
 * What did not exist is the *order*, and the order is the whole idea: the mark
 * builds, travels into its corner, the rail is drawn around it and the room
 * assembles above and beside it, and only then does she speak.
 *
 * So this file holds beats and timings and nothing else. It draws no shape of
 * its own, and every visual it stages is a component that ships.
 *
 * It lives beside the mark rather than in the design lab because the product
 * renders it: the lab draws the same components, which is what stops the
 * opening a founder meets and the opening a reviewer looks at from drifting
 * apart.
 *
 * ## Why the mark travels rather than fading out and in
 *
 * Because it is the same object. A hero that dissolves while a small one
 * appears in the corner is two marks; one that moves is Nova taking her place,
 * which is the sentence the whole sequence is making. `layoutId` is what
 * carries it: the mark is mounted once, in two different parents, and Motion
 * animates between the boxes.
 *
 * ## What it must never become
 *
 * A wait. This is the opening of a product, not a splash screen, and a founder
 * who has seen it once should never see it again — the position that raises it
 * is `introduce`, which `deriveNovaFirstRun` returns exactly once per project.
 * Under `prefers-reduced-motion` there is no sequence at all: the finished
 * screen renders on the first frame, with every beat already past.
 */

/**
 * Where the sequence has got to, and whether there is a sequence at all.
 *
 * `staged` is false when motion is not wanted, and then `beat` is the last one
 * from the first frame: not a faster sequence, no sequence. The server answers
 * the same way, so the markup that arrives — and the markup a reader without
 * JavaScript keeps — is the finished screen.
 *
 * The flag is returned rather than kept private because the *entrances* have
 * to know too. A panel with `initial={{ opacity: 0 }}` renders at opacity zero
 * on the server, and a reader who never gets the animation never gets the
 * panel: the first build of this shipped a blank screen under reduced motion
 * while claiming in its own comment to do the opposite.
 */
export function useOpening(): { beat: OpeningBeat; staged: boolean } {
  const staged = useMotionAllowed();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!staged) return;
    const hold = BEATS[index]?.ms;
    if (hold === null || hold === undefined) return;

    const next = window.setTimeout(() => setIndex((step) => step + 1), hold);
    return () => window.clearTimeout(next);
  }, [index, staged]);

  return { beat: staged ? (BEATS[index]?.id ?? "speaking") : "speaking", staged };
}

/** The one id both mounting points share, so Motion knows it is one mark. */
const MARK = "nova-opening-mark";

/**
 * The mark, wherever it currently belongs.
 *
 * Two call sites, one element. `place="hero"` is the centre of an empty
 * screen; `place="header"` is the status row's own slot. Only one is ever
 * mounted, which is what makes the transition a movement rather than a
 * crossfade between two marks that happen to look alike.
 *
 * `introduce` is passed only at the hero, and only that once: the assembly is
 * the first thing that happens on this screen and it never happens again.
 */
export function OpeningMark({ place }: { place: "hero" | "rail" }) {
  return (
    <motion.div
      layoutId={MARK}
      className="shrink-0"
      initial={false}
      transition={{ duration: 0.62, ease: [0.22, 1, 0.36, 1] }}
    >
      <NovaPresence state="idle" size="hero" introduce={place === "hero"} />
    </motion.div>
  );
}

/**
 * The rail's frame, drawn rather than faded in.
 *
 * ## Why a stroke and not an appearance
 *
 * Because a fade is a thing that was already there becoming visible, and a
 * stroke is a thing being made. This is the one screen where Nova assembles
 * the environment she then works in — she lands in an empty corner and the
 * room is built around her — and the difference between those two readings is
 * the whole reason the opening exists.
 *
 * ## Why an SVG rather than an animated border
 *
 * `border-width` and `clip-path` both animate on the layout or paint path. A
 * single stroked path animates `stroke-dashoffset`, which is one property on
 * one element and costs nothing near a layout. The rect is drawn at the box's
 * own radius so the finished stroke sits exactly on the border it replaces —
 * the real border fades in underneath as the stroke completes, so there is no
 * frame where the corner has two lines or none.
 *
 * `aria-hidden`, and vector-effect keeps the hairline a hairline at any size.
 */
export function OpeningStroke({ drawn }: { drawn: boolean }) {
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full"
      preserveAspectRatio="none"
    >
      <motion.rect
        x="0.5"
        y="0.5"
        width="99%"
        height="99%"
        rx="12"
        fill="none"
        stroke="var(--color-mint)"
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
        initial={drawn ? { pathLength: 0, opacity: 0.9 } : false}
        animate={{ pathLength: 1, opacity: drawn ? 0 : 0 }}
        /* Both inside the beat that holds for them: the stroke completes at
           380ms and hands over to the real border at 420ms, which is exactly
           when `rail_content` begins. A stroke still running when the next
           beat starts would be two frames on one box. */
        transition={{
          pathLength: { duration: 0.38, ease: [0.22, 1, 0.36, 1] },
          opacity: { duration: 0.24, delay: 0.36 },
        }}
      />
    </svg>
  );
}

/**
 * Something arriving forward out of nothing.
 *
 * Opacity and a small scale from behind, never a slide: nothing on this screen
 * has an off-screen edge it could have come from yet, so anything travelling
 * sideways would imply a space that does not exist. Used for the rail's
 * contents and for the status row.
 *
 * `arrive` false is the reduced-motion answer and the server's: the element is
 * simply present, with no initial state to be stuck in.
 */
export function OpeningFade({
  arrive,
  delay = 0,
  className,
  children,
}: {
  arrive: boolean;
  delay?: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <motion.div
      className={className}
      initial={arrive ? { opacity: 0, scale: 0.94 } : false}
      animate={{ opacity: 1, scale: 1 }}
      transition={{
        duration: arrive ? 0.36 : 0,
        delay: arrive ? delay : 0,
        ease: [0.22, 1, 0.36, 1],
      }}
    >
      {children}
    </motion.div>
  );
}

/**
 * The empty stage the mark assembles on, and then gives up.
 *
 * ## Why it collapses rather than fading
 *
 * A fade would leave the height behind, and the panel would sit at the bottom
 * of an empty screen for the rest of the session. So the stage closes, and the
 * closing is what carries the panel up to where it belongs.
 *
 * ## Why there is no `AnimatePresence` here
 *
 * The first draft had one, and it produced the failure `layoutId` is most
 * prone to: an exiting copy of the mark still mounted while the arriving copy
 * mounts, so Motion sees the same id twice and animates one of them to the
 * other's box. On screen it read as the mark staying in the middle and the
 * header slot being empty — the opposite of the whole sequence.
 *
 * So the mark is unmounted from here in the same commit it is mounted in the
 * header. Exactly one exists at any moment, which is what makes the movement a
 * movement.
 */
export function OpeningStage({
  show,
  /**
   * How tall the stage is while it is open, in pixels.
   *
   * This is the only thing holding the mark near the middle of the screen
   * while it assembles, and it is here rather than on the page for one
   * reason: the room underneath must render at the *top* of its column,
   * where the next screen's thread renders. Centring the page instead
   * centred the finished room too, and then pressing Continue moved
   * everything on it — the one thing the choreography exists to avoid.
   *
   * So the stage is tall and the room is not, and the stage collapsing to
   * zero is what carries the room up into place.
   */
  height = 320,
  children,
}: {
  show: boolean;
  height?: number;
  children: ReactNode;
}) {
  return (
    <motion.div
      className="flex shrink-0 flex-col items-center justify-center overflow-hidden"
      initial={false}
      animate={{ height: show ? height : 0, opacity: show ? 1 : 0 }}
      transition={{ duration: 0.62, ease: [0.22, 1, 0.36, 1] }}
    >
      {show && children}
    </motion.div>
  );
}

/**
 * The conversation column, arriving under the row.
 *
 * ## Why it is not called a panel any more
 *
 * Because it drew one. It closed *around* the mark, which is why it scaled
 * rather than slid, and when the mark moved to the rail the box stayed —
 * leaving the opening finishing inside a bordered panel that the screen
 * replacing it does not have. A founder pressing *Continue* watched the room
 * she had just been given lose its frame.
 *
 * So it carries no surface at all now. What arrives is the thread's own
 * `section`, at the width the next screen renders it, and this wrapper does
 * one thing: brings it up from below. That is the only direction on this
 * screen implying a space that exists.
 *
 * It never leaves, so there is no `AnimatePresence` — the same reasoning as the
 * stage, and the same bug avoided. Nothing that holds the mark may linger past
 * the frame it is replaced in.
 */
export function OpeningColumn({
  show,
  /** False when there was no sequence, and the panel is simply already here. */
  arrive,
  className,
  children,
}: {
  show: boolean;
  arrive: boolean;
  className?: string;
  children: ReactNode;
}) {
  if (!show) return null;

  return (
    <motion.div
      className={className}
      initial={arrive ? { opacity: 0, y: 14 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: arrive ? 0.42 : 0, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
