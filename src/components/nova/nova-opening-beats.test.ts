import { describe, expect, it } from "vitest";
import { NOVA_INTRODUCTION_MS } from "./nova-presence";
import { atLeast, beatIndex, BEATS } from "./nova-opening-beats";

/**
 * The opening is a sequence, so the things worth checking are ordering and
 * arithmetic. Both of the bugs this file exists for were exactly that, and
 * neither was visible in a still: the mark moved before it had finished
 * assembling, and the sequence's total was long enough to read as a wait.
 */
describe("the opening's beats", () => {
  it("runs in the order the screen depends on", () => {
    expect(BEATS.map((beat) => beat.id)).toEqual([
      "assembling",
      "settling",
      "connecting",
      "speaking",
    ]);
  });

  it("holds the mark until it has finished assembling itself", () => {
    const assembling = BEATS[0];
    expect(assembling.id).toBe("assembling");
    /*
     * Not "about right". The mark is moved the instant this elapses, and a
     * value below the entrance's own length cuts the light curve off partway —
     * which is what the first build did, and it read as a glitch rather than
     * as a choreography.
     */
    expect(assembling.ms).toBeGreaterThanOrEqual(NOVA_INTRODUCTION_MS);
  });

  it("reaches the first word before an opening becomes a wait", () => {
    const toSpeech = BEATS.filter((beat) => beat.ms !== null).reduce(
      (total, beat) => total + (beat.ms ?? 0),
      0,
    );

    /*
     * Four seconds is the line, and most of what is under it is the mark's own
     * assembly rather than padding. A founder meeting a product should be read
     * to, not made to wait for a splash screen.
     */
    expect(toSpeech).toBeLessThan(4000);
  });

  it("ends on the beat that never advances", () => {
    const last = BEATS[BEATS.length - 1];
    expect(last.id).toBe("speaking");
    // A duration here would schedule a timer past the end of the sequence.
    expect(last.ms).toBeNull();
  });

  it("compares beats by position rather than by name", () => {
    expect(atLeast("speaking", "assembling")).toBe(true);
    expect(atLeast("assembling", "speaking")).toBe(false);
    expect(atLeast("settling", "settling")).toBe(true);
    expect(beatIndex("connecting")).toBe(2);
  });
});
