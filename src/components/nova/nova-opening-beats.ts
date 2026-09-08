import { NOVA_INTRODUCTION_MS } from "./nova-presence";

/**
 * The opening's timing, with no React in it.
 *
 * Separated from `nova-opening.tsx` so the order and the durations can be checked
 * without rendering anything — and because the one bug worth a regression test
 * here was arithmetic, not visual: the first build held the mark for 1500ms
 * and moved it while its light curve was still being drawn.
 */

/**
 * The beats, in order, with how long each holds.
 *
 * Read as a stack rather than a timeline: each beat's duration is how long it
 * holds *before* the next begins, so the total is a sum anybody can check
 * against a stopwatch — `openingTotalMs` does exactly that, and the test
 * holds it to a ceiling.
 *
 * ## What the length is spent on
 *
 * Most of it is the mark's own assembly, and the rest is the room being built
 * around her: the rail stroked, its contents arriving, the status row, the
 * panel, the connection resolving. Every beat is a thing appearing that was
 * not there, in the order it comes to exist.
 *
 * That is the whole argument for the length. This is the signature tier and it
 * runs once per project, ever — and what it shows is not a loading state, it
 * is Nova assembling the environment the rest of setup happens in. An opening
 * that filled a wait would be cut; this one has something to say.
 *
 * ## And it still fits under the line that was already here
 *
 * Four seconds, asserted since the first build: *a founder meeting a product
 * should be read to, not made to wait for a splash screen*. Six beats were
 * added to this sequence and the ceiling was not moved — they were cut to fit
 * it instead, which is the right way round. `settling` is the only one that
 * could not be shortened: the mark's travel is 620ms and a beat shorter than
 * its own animation starts the next one mid-movement.
 */
export const BEATS = [
  /**
   * The mark assembles at full size, alone, centred.
   *
   * Its own length, taken from the component rather than guessed. The first
   * build guessed 1500ms and moved the mark while the light curve was still
   * being drawn — the one part of the assembly a founder is actually watching.
   */
  { id: "assembling", ms: NOVA_INTRODUCTION_MS },
  /**
   * It travels to the corner it occupies from now on.
   *
   * The rail's slot, not the header's. The mark needs somewhere to travel
   * *to*: `layoutId` animates between two mounted boxes, so the column has to
   * exist before she moves into it — but it is empty when she arrives, which
   * is the point. She lands in a corner and the room is built around her.
   */
  { id: "settling", ms: 620 },
  /**
   * The rail draws itself around her.
   *
   * A stroke rather than a fade, because a fade is a thing appearing and a
   * stroke is a thing being made. This is the one screen where Nova is
   * assembling her own environment, and the difference between those two
   * readings is the whole reason the opening exists.
   */
  { id: "rail_drawing", ms: 420 },
  /**
   * What has already happened arrives inside it, forward out of nothing.
   *
   * Opacity and a small scale from behind, so the rows read as coming toward
   * the reader rather than sliding in from an edge — nothing on this screen
   * has an off-screen it could have come from yet.
   */
  { id: "rail_content", ms: 240 },
  /**
   * The status row fades in, before her presence is on it.
   *
   * Her name, the project, and the project's connection — which during setup
   * is genuinely "Disconnected", a fact rather than a placeholder. The line
   * under her name is *blank*: no dot, no word. Absence, because there is no
   * true word for a presence that has not arrived, and a false one animated
   * into a true one is the thing the motion rules forbid.
   */
  { id: "header", ms: 260 },
  /** The thread's panel arrives under it. */
  { id: "panel", ms: 300 },
  /**
   * Her line lights: the dot and "Online".
   *
   * It appears where nothing was, rather than replacing something that was
   * never true — which is why it gets a beat of its own instead of arriving
   * with the header.
   */
  { id: "online", ms: 160 },
  /** Everything is in place. `NovaArriving` takes the thread from here. */
  { id: "speaking", ms: null },
] as const;

export type OpeningBeat = (typeof BEATS)[number]["id"];

/** How far past a beat the sequence has got, for a caller that renders by it. */
export function beatIndex(beat: OpeningBeat): number {
  return BEATS.findIndex((step) => step.id === beat);
}

export function atLeast(beat: OpeningBeat, than: OpeningBeat): boolean {
  return beatIndex(beat) >= beatIndex(than);
}

/**
 * How long the sequence runs before the first word, in milliseconds.
 *
 * A sum rather than a constant, so a beat that gets longer cannot quietly
 * lengthen the opening — the test reads this and holds it to a ceiling. The
 * last beat has no duration: it is where the sequence stops and the thread
 * takes over.
 */
export function openingTotalMs(): number {
  return BEATS.reduce((total, beat) => total + (beat.ms ?? 0), 0);
}
