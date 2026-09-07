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
 * builds, travels into its corner as the panel closes around it, the
 * connection resolves, and only then does she speak.
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
export function OpeningMark({ place }: { place: "hero" | "header" }) {
  return (
    <motion.div
      layoutId={MARK}
      className="shrink-0"
      initial={false}
      transition={{ duration: 0.62, ease: [0.22, 1, 0.36, 1] }}
    >
      <NovaPresence
        state="idle"
        size={place === "hero" ? "hero" : "md"}
        introduce={place === "hero"}
      />
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
export function OpeningStage({ show, children }: { show: boolean; children: ReactNode }) {
  return (
    <motion.div
      className="flex shrink-0 flex-col items-center justify-center overflow-hidden"
      initial={false}
      animate={{ height: show ? 320 : 0, opacity: show ? 1 : 0 }}
      transition={{ duration: 0.62, ease: [0.22, 1, 0.36, 1] }}
    >
      {show && children}
    </motion.div>
  );
}

/**
 * The panel, drawing itself around her.
 *
 * Scale rather than a slide, and a small one: the panel arrives *around* the
 * mark that is already travelling into it, so anything moving sideways would
 * read as a second object pushing the first out of the way.
 *
 * It never leaves, so there is no `AnimatePresence` — the same reasoning as the
 * stage, and the same bug avoided. Nothing that holds the mark may linger past
 * the frame it is replaced in.
 */
export function OpeningPanel({
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
      initial={arrive ? { opacity: 0, scale: 0.97 } : false}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: arrive ? 0.42 : 0, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
