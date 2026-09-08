import { readFileSync } from "node:fs";
import { join } from "node:path";
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
  /**
   * The order is the argument, so it is written out rather than counted.
   *
   * Every beat is a thing appearing that was not there, in the order it comes
   * to exist: she assembles, moves to a corner, the rail is drawn around her,
   * what has already happened arrives inside it, the status row appears above,
   * the panel rises under it, her line lights, and she speaks. A
   * reordering that still summed to the same total would be a different claim
   * about what is being built, which is why this compares the list.
   */
  it("runs in the order the screen depends on", () => {
    expect(BEATS.map((beat) => beat.id)).toEqual([
      "assembling",
      "settling",
      "rail_drawing",
      "rail_content",
      "header",
      "panel",
      "online",
      "speaking",
    ]);
  });

  /**
   * The room is built before anything speaks in it.
   *
   * The one ordering mistake this sequence could make and still look
   * plausible: a panel that arrived before the rail, or a message before the
   * room. Asserted as relations rather than indices so inserting a beat
   * between two of them does not fail for the wrong reason.
   */
  it("builds the room before she speaks in it", () => {
    for (const earlier of ["rail_drawing", "rail_content", "header", "panel", "online"] as const) {
      expect(atLeast("speaking", earlier), earlier).toBe(true);
    }
    expect(atLeast("rail_content", "rail_drawing")).toBe(true);
    expect(atLeast("panel", "header")).toBe(true);
    /* And she lands in the corner before it is drawn around her. */
    expect(atLeast("rail_drawing", "settling")).toBe(true);
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
     *
     * Six beats were added to this sequence and the ceiling was not moved.
     * They were cut to fit it, which is the right way round — a budget that
     * rises whenever something is added is not a budget.
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
    expect(beatIndex("rail_drawing")).toBe(2);
  });
});

/**
 * What the sequence is not allowed to animate.
 *
 * A beat that changes a *state* rather than revealing one is the one way this
 * screen can break a rule no ordering test would catch, and it already did:
 * the header was handed `connecting={!online}`, so for 300ms the project read
 * "Connecting…" and then became "Disconnected". Nothing was connecting.
 * `connected` is read on the server and arrives with the first frame, so the
 * pulse was a connection attempt that never happened — motion asserting
 * something the product had not observed, which is the line `DESIGN.md` draws.
 *
 * The fix is that the beat reveals rather than resolves: her availability line
 * is *absent* until it is true. So the invariant is about the source of the
 * two connection facts, not about how they look.
 */
describe("the states the opening may not animate", () => {
  const SCREEN = readFileSync(
    join(process.cwd(), "src/app/app/projects/[projectId]/nova/nova-opening-screen.tsx"),
    "utf8",
  );

  /** Comments quote the rule they explain; what is left is what renders. */
  const RENDERED = SCREEN.replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");

  it("passes the project's connection straight through, never through a beat", () => {
    expect(RENDERED).toContain("connected={connected}");
    /* `connected={online}`, `connected={atLeast(...)}` — a beat deciding a fact. */
    expect(RENDERED).not.toMatch(/connected=\{(?!connected\})/);
  });

  it("never writes a connection word of its own", () => {
    expect(RENDERED).not.toContain("Connecting");
    expect(RENDERED).not.toContain("Disconnected");
    expect(RENDERED).not.toContain("connecting=");
  });

  it("reveals her availability rather than resolving it", () => {
    /* Absence until true. A word here would be an assertion with no fact under it. */
    expect(RENDERED).toContain("availabilityPending={!online}");
    expect(RENDERED).toContain('availability={{ state: "online" }}');
  });
});
