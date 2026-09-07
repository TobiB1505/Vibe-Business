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
 * against a stopwatch. Under four seconds to the first word, most of it the
 * mark's own assembly — which is about as long as an opening may take before
 * it is a delay rather than an arrival.
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
   * It travels into the status row it will occupy from now on, and the panel
   * forms around it as it arrives.
   *
   * One beat rather than two, and not for brevity. The mark needs somewhere to
   * travel *to*: `layoutId` animates between two mounted boxes, so a header
   * that does not exist yet is a mark that vanishes and reappears. Moving the
   * panel earlier would have meant the frame arriving before the thing it is a
   * frame for. So they happen together — she leads, and the panel closes around
   * her.
   */
  { id: "settling", ms: 820 },
  /** The one moment a connection state is unknown rather than false. */
  { id: "connecting", ms: 900 },
  /** Everything is in place. `Arriving` takes the thread from here. */
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
